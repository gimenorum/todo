// services/SyncService.ts — 1 回の同期の実行・materialize・状態反映の単一経路（ch.01 §1.4・ch.06 §6.2）。
// state を import せず、結果は onOutcome/onStatus コールバックで返す（actions が setState）。
// ちらつき抑制（400/500ms）は本層で管理し、UI は state.global を素直に描画する（ch.09 §9.2）。
import { syncOnce, MissingObjectError } from '../core';
import * as todoStore from '../store/todoStore';
import * as todoSvc from './TodoService';
import { setLastSyncAt } from '../store/metaStore';
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

export type ConflictChoice = 'left' | 'right' | 'keep-edit' | 'apply-delete';

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
  resolveConflictProvisional(todoId: Uuid, choice: ConflictChoice): Promise<void>;
  reloadFromLocal(): Promise<Todo[]>;
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

function unionConflicts(a: FieldConflict[], b: FieldConflict[]): FieldConflict[] {
  const key = (c: FieldConflict): string => `${c.todoId} ${c.field}`;
  const map = new Map<string, FieldConflict>();
  for (const c of a) map.set(key(c), c);
  for (const c of b) if (!map.has(key(c))) map.set(key(c), c);
  return Array.from(map.values());
}

function classifyError(err: unknown): GlobalSyncStatus {
  if (err instanceof AuthError) return 'needs-reauth';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'error';
}

export function createSyncService(deps: SyncServiceDeps): SyncService {
  const flicker = createFlicker(deps.onStatus);
  // 競合フラグはセッション内で蓄積する。マージを行った端末が検出し、解決まで保持する
  // （次回同期は単一先端で competition=[] を返すため、union で既存を維持する）。Phase 2 暫定。
  let activeConflicts: FieldConflict[] = [];

  function buildOutcome(snap: Snapshot, lastSyncAt: number): SyncOutcome {
    const conflictIds = new Set(activeConflicts.map((c) => c.todoId));
    const todos = Object.values(snap.todos).filter((t) => !t.deleted);
    const perTodoStatus: Record<Uuid, TodoSyncStatus> = {};
    for (const t of todos) perTodoStatus[t.id] = conflictIds.has(t.id) ? 'conflict' : 'synced';
    return { todos, perTodoStatus, conflicts: activeConflicts, lastSyncAt };
  }

  async function syncCycle(): Promise<void> {
    const local = await loadLocalState(deps.deviceId);
    const before = new Set(local.objects.keys());
    const todos = await todoStore.getAllTodos();
    await appendCommitIfChanged(local, snapshotFromTodos(todos), deps.clock);

    const res = await syncOnce(deps.adapter, local);
    await persistLocalState(local, before);

    // materialize: マージ結果を todos ストアへ（tombstone 含む）。表示の正はローカル todos。
    await todoStore.putTodos(Object.values(res.mergedSnapshot.todos));

    activeConflicts = unionConflicts(activeConflicts, res.conflicts);
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

  async function resolveConflictProvisional(todoId: Uuid, choice: ConflictChoice): Promise<void> {
    const fields = activeConflicts.filter((c) => c.todoId === todoId);
    if (fields.length > 0) {
      const patch: Record<string, unknown> = {};
      for (const c of fields) {
        if (c.field === 'deleted') {
          patch.deleted = choice === 'apply-delete'; // keep-edit/left/right → alive(false)
        } else {
          patch[c.field] = choice === 'right' ? c.right : c.left;
        }
      }
      await todoSvc.updateTodo(todoId, patch);
    }
    // 解決した todo を競合集合から外し、解決コミットを push（runOnce 内で emit）。
    activeConflicts = activeConflicts.filter((c) => c.todoId !== todoId);
    await runOnce();
  }

  // 別タブの同期完了通知（broadcast）を受けた際の再読込。conflicts/status は据え置き、todos のみ返す。
  async function reloadFromLocal(): Promise<Todo[]> {
    const all = await todoStore.getAllTodos();
    return all.filter((t) => !t.deleted);
  }

  return { runOnce, resolveConflictProvisional, reloadFromLocal };
}
