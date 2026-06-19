// services/SyncService.ts — 1 回の同期の実行・materialize・状態反映の単一経路（ch.01 §1.4・ch.06 §6.2）。
// state を import せず、結果は onOutcome/onStatus コールバックで返す（actions が setState）。
// ちらつき抑制（400/500ms）は本層で管理し、UI は state.global を素直に描画する（ch.09 §9.2）。
import { syncOnce, MissingObjectError } from '../core';
import * as todoStore from '../store/todoStore';
import * as todoSvc from './TodoService';
import type { TodoPatch } from './TodoService';
import {
  getConflicts,
  getLastSyncAt,
  getPendingConflictDeletes,
  setConflicts,
  setLastSyncAt,
  setPendingConflictDeletes,
} from '../store/metaStore';
import { deleteMarker, readAllMarkers, writeMarkers } from './conflictMarkers';
import {
  appendCommitIfChanged,
  loadLocalState,
  persistLocalState,
  snapshotFromTodos,
} from './syncLocalState';
import { AuthError } from '../adapters/errors';
import { SYNCING_MIN_VISIBLE_MS, SYNCING_SHOW_DELAY_MS } from '../model/constants';
import type {
  Clock,
  DeviceId,
  FieldConflict,
  GlobalSyncStatus,
  Snapshot,
  StorageAdapter,
  Todo,
  TodoSyncStatus,
  Uuid,
} from '../model/types';

export interface SyncOutcome {
  todos: Todo[]; // 表示用（tombstone を除いた materialize 済みリスト）
  perTodoStatus: Record<Uuid, TodoSyncStatus>;
  conflicts: FieldConflict[];
  lastSyncAt: number;
}

export interface SyncServiceDeps {
  adapter: StorageAdapter;
  deviceId: DeviceId;
  clock: Clock; // 同期エンジンのコミット時刻（決定性）。ちらつき/lastSyncAt は Date.now を使う。
  onOutcome: (outcome: SyncOutcome) => void;
  onStatus: (status: GlobalSyncStatus) => void;
  broadcast?: () => void; // 同期完了を他タブへ通知
}

export interface SyncService {
  runOnce(): Promise<void>;
  // フィールド単位に解決した patch を適用してマージコミットを確定する（ch.10 §10.2 / Phase 4）。
  // patch の組み立ては UI（ConflictMergeView.buildPatch）が担う。
  resolveConflict(todoId: Uuid, patch: TodoPatch): Promise<void>;
  reloadFromLocal(): Promise<Todo[]>;
  // 永続化済みの未解決競合を IDB から復元する（起動時 / Issue #26）。
  // 競合があればローカル todos から outcome を emit し、オフライン起動でも「解決する」を即復元する。
  restoreConflicts(): Promise<void>;
}

// 全体ステータスのちらつき抑制（ch.09 §9.2）。開始から 400ms 超で初めて 'syncing'、点灯後は最低 500ms 維持。
// 時刻は Date.now()（vitest の fake timers で決定的に検証できる）。
export interface Flicker {
  start(): void;
  end(finalStatus: GlobalSyncStatus): void;
}
export function createFlicker(onStatus: (s: GlobalSyncStatus) => void): Flicker {
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let shownAt = 0;
  let showing = false;
  return {
    start() {
      showing = false;
      showTimer = setTimeout(() => {
        showing = true;
        shownAt = Date.now();
        onStatus('syncing');
      }, SYNCING_SHOW_DELAY_MS);
    },
    end(finalStatus) {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      if (showing) {
        const remain = SYNCING_MIN_VISIBLE_MS - (Date.now() - shownAt);
        if (remain > 0) setTimeout(() => onStatus(finalStatus), remain);
        else onStatus(finalStatus);
        showing = false;
      } else {
        onStatus(finalStatus); // 400ms 未満で完了 → 'syncing' は出さず直接最終状態へ
      }
    },
  };
}

function classifyError(err: unknown): GlobalSyncStatus {
  if (err instanceof AuthError) return 'needs-reauth';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'error';
}

export function createSyncService(deps: SyncServiceDeps): SyncService {
  const flicker = createFlicker(deps.onStatus);
  // 未解決競合の集合。権威はリモートの共有マーカー（conflicts/<todoId> / Issue #29）で、毎同期で
  // readAllMarkers により上書きされる。IDB(meta) はオフライン再表示用のキャッシュに格下げ（Issue #26）。
  let activeConflicts: FieldConflict[] = [];
  // 解決済みだがリモートのマーカー削除をまだ確認できていない todoId 集合（確認付きリトライ / Issue #29）。
  // IDB(meta) に永続し、毎同期で deleteMarker を再送して「確実に同期できた」ものだけ外す。
  let pendingDeletes: Uuid[] = [];
  let pendingLoaded = false;

  // 保留削除集合を初回だけ IDB から取り込む（多重ロードを避ける）。
  async function ensurePendingLoaded(): Promise<void> {
    if (pendingLoaded) return;
    pendingDeletes = await getPendingConflictDeletes();
    pendingLoaded = true;
  }

  function buildOutcome(snap: Snapshot, lastSyncAt: number): SyncOutcome {
    const conflictIds = new Set(activeConflicts.map((c) => c.todoId));
    const todos = Object.values(snap.todos).filter((t) => !t.deleted);
    const perTodoStatus: Record<Uuid, TodoSyncStatus> = {};
    for (const t of todos) perTodoStatus[t.id] = conflictIds.has(t.id) ? 'conflict' : 'synced';
    return { todos, perTodoStatus, conflicts: activeConflicts, lastSyncAt };
  }

  async function syncCycle(): Promise<void> {
    await ensurePendingLoaded();
    const local = await loadLocalState(deps.deviceId);
    const before = new Set(local.objects.keys());
    const todos = await todoStore.getAllTodos();
    await appendCommitIfChanged(local, snapshotFromTodos(todos), deps.clock);

    const res = await syncOnce(deps.adapter, local);
    await persistLocalState(local, before);

    // materialize: マージ結果を todos ストアへ（tombstone 含む）。表示の正はローカル todos。
    await todoStore.putTodos(Object.values(res.mergedSnapshot.todos));

    // --- 共有マーカーの同期（Issue #29）。順序が重要 ---
    // 1) 保留削除を確認付きで再送。リモートに到達して成功（throw しない）todoId だけ集合から外す。
    //    失敗（オフライン/transient）は残し、次回同期で再試行＝確実に同期できるまでリトライ。
    if (pendingDeletes.length > 0) {
      const stillPending: Uuid[] = [];
      for (const todoId of pendingDeletes) {
        try {
          await deleteMarker(deps.adapter, todoId);
        } catch {
          stillPending.push(todoId);
        }
      }
      pendingDeletes = stillPending;
      await setPendingConflictDeletes(pendingDeletes);
    }
    // 2) 今回検出した競合を publish（削除を先に行うので、再衝突でも新しいマーカーが正しく書き直る）。
    if (res.conflicts.length > 0) await writeMarkers(deps.adapter, res.conflicts);
    // 3) 共有集合を読み、未解決競合の権威とする（検出端末も相手端末も同じ集合を見る）。
    activeConflicts = await readAllMarkers(deps.adapter);
    // 3a) マージ結果で「生きているタスク」に対応しない競合マーカー（削除済み/不在）は、一覧に出せず
    //     バッジだけ過大計上され（Issue #52）、リモートにも残り続ける。確認付き削除キューに積んで掃除する
    //     （次周回冒頭の deleteMarker で確実に削除）。perTodoStatus は alive のみなので一覧と件数が一致する。
    const aliveIds = new Set(
      Object.values(res.mergedSnapshot.todos)
        .filter((t) => !t.deleted)
        .map((t) => t.id),
    );
    if (activeConflicts.some((c) => !aliveIds.has(c.todoId))) {
      for (const c of activeConflicts) {
        if (!aliveIds.has(c.todoId) && !pendingDeletes.includes(c.todoId)) {
          pendingDeletes.push(c.todoId);
        }
      }
      activeConflicts = activeConflicts.filter((c) => aliveIds.has(c.todoId));
      await setPendingConflictDeletes(pendingDeletes);
    }
    await setConflicts(activeConflicts); // オフライン再表示用の IDB キャッシュ（権威はリモート）

    const lastSyncAt = Date.now();
    await setLastSyncAt(lastSyncAt);
    deps.onOutcome(buildOutcome(res.mergedSnapshot, lastSyncAt));
    deps.broadcast?.();
  }

  async function runOnce(): Promise<void> {
    flicker.start();
    try {
      await syncCycle();
      flicker.end('idle');
    } catch (err) {
      // リモート未伝播のオブジェクト（別端末の push が伝播途中）は一時的事象。
      // 「同期エラー」にせず idle に戻し、次回 pull で取り込む（手動同期が後で成功するのと同理）。
      // 通常は syncOnce 内で握りつぶされ throw されないが、防御的に SyncService でも受ける。
      if (err instanceof MissingObjectError) {
        console.debug('[sync] リモート未伝播のためこの周回はスキップ:', err.message);
        flicker.end('idle');
        return;
      }
      // 背景処理なので投げ直さない。状態（offline/error/needs-reauth）で UI に伝える。
      const status = classifyError(err);
      // 汎用 'error' は UI に「同期エラー」としか出ず原因が分からないため、必ずログに残す（診断容易性 / ch.09）。
      if (status === 'error') console.error('[sync] 同期に失敗しました:', err);
      flicker.end(status);
    }
  }

  async function resolveConflict(todoId: Uuid, patch: TodoPatch): Promise<void> {
    // patch は UI（ConflictMergeView.buildPatch）が組んだ「フィールド単位の解決値」。
    // 適用→競合集合から除外（即時 UI 反映）→マーカー削除意図を保留集合に積む→runOnce で解決コミットを
    // push しつつ確認付きでマーカーを削除する（runOnce 内で emit）。リモートのマーカー削除は成功を仮定せず
    // syncCycle の確認付きリトライ経路に一本化する（Issue #29）。マージコミット生成後は相手先端が祖先化して
    // base となり、選択値は再競合せず収束する（§10.2）。
    if (Object.keys(patch).length > 0) await todoSvc.updateTodo(todoId, patch);
    activeConflicts = activeConflicts.filter((c) => c.todoId !== todoId);
    await setConflicts(activeConflicts); // 解決済みを IDB キャッシュから除去（リロードで蘇らせない / Issue #26）
    await ensurePendingLoaded();
    if (!pendingDeletes.includes(todoId)) pendingDeletes.push(todoId);
    await setPendingConflictDeletes(pendingDeletes); // 削除意図を永続（オフライン/再起動でも再送される）
    await runOnce();
  }

  // 永続済みの未解決競合を復元する（起動時 / Issue #26）。先端は競合時も単一化されるため、
  // メモリの activeConflicts を IDB から戻さないとリロードで「解決する」が消えて左の値が黙って確定する。
  // 起動直後は IDB キャッシュから復元し、最初の runOnce の readAllMarkers で共有集合に上書きされる（Issue #29）。
  async function restoreConflicts(): Promise<void> {
    activeConflicts = await getConflicts();
    if (activeConflicts.length === 0) return;
    // ローカル todos からそのまま outcome を組み、オフライン起動でも即「解決する」を復元する。
    const snap = snapshotFromTodos(await todoStore.getAllTodos());
    const lastSyncAt = (await getLastSyncAt()) ?? Date.now();
    deps.onOutcome(buildOutcome(snap, lastSyncAt));
  }

  // 別タブの同期完了通知（broadcast）を受けた際の再読込。conflicts/status は据え置き、todos のみ返す。
  async function reloadFromLocal(): Promise<Todo[]> {
    const all = await todoStore.getAllTodos();
    return all.filter((t) => !t.deleted);
  }

  return { runOnce, resolveConflict, reloadFromLocal, restoreConflicts };
}
