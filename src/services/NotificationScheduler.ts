// services/NotificationScheduler.ts — 期日が近づいたら通知する（Issue #71 / ch.19）。
// サーバなし（BYOS）のため、アプリが動いている間だけ動作する（未起動中は発火しない＝仕様）。
// core も DOM も持たず、依存はすべて注入する（テスト容易性のため）。
import { NOTIFY_CHECK_INTERVAL_MS } from '../model/constants';
import type { Millis, Todo, Uuid } from '../model/types';
import type { Permission } from './notify';

export interface NotificationSchedulerDeps {
  getTodos: () => Todo[]; // 現在のタスク一覧（表示済み＝tombstone 除外）。
  notify: (title: string, options?: NotificationOptions) => void; // 通知発火（権限判定は notify 側）。
  getPermission: () => Permission;
  loadNotified: () => Promise<Record<Uuid, Millis>>; // 起動時に通知済みマップを読む。
  saveNotified: (map: Record<Uuid, Millis>) => Promise<void>; // 通知済みを永続（write-through）。
  now?: () => Millis; // テスト用に時刻注入（既定 Date.now）。
  intervalMs?: number; // テスト用に間隔上書き。
}

export interface NotificationScheduler {
  start(): void; // 定期チェック開始（通知済みマップのロードを含む）。
  stop(): void; // タイマ解除。
  check(): void; // 即時チェック（タスク変更・前面復帰時に呼ぶ）。
}

export function createNotificationScheduler(
  deps: NotificationSchedulerDeps,
): NotificationScheduler {
  const now = deps.now ?? (() => Date.now());
  const intervalMs = deps.intervalMs ?? NOTIFY_CHECK_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let notified: Record<Uuid, Millis> = {};
  let loaded = false;

  function check(): void {
    if (!loaded) return; // 通知済みマップ未ロード中は二重通知を避けるため待つ。
    if (deps.getPermission() !== 'granted') return;

    const t = now();
    let changed = false;
    for (const todo of deps.getTodos()) {
      if (todo.done || todo.deleted) continue;
      if (todo.dueDate === null || todo.notifyBeforeMs === null) continue;

      const fireAt = todo.dueDate - todo.notifyBeforeMs;
      // リード期間内（fireAt 到達〜期日まで）で、この fireAt をまだ通知していなければ発火。
      // 期日経過後は通知しない（取りこぼしは Web 制約として許容）。
      if (t >= fireAt && t < todo.dueDate && notified[todo.id] !== fireAt) {
        deps.notify('期日が近づいています', {
          body: todo.title,
          tag: `due-${todo.id}`,
        });
        notified[todo.id] = fireAt;
        changed = true;
      }
    }
    if (changed) void deps.saveNotified(notified);
  }

  return {
    start() {
      if (timer) return;
      void deps.loadNotified().then((map) => {
        notified = map;
        loaded = true;
        check(); // ロード直後にキャッチアップ。
      });
      timer = setInterval(check, intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    check,
  };
}
