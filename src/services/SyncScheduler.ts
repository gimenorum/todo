// services/SyncScheduler.ts — いつ同期するかを司る（ch.11）。core も I/O も持たず SyncService を駆動。
// 5 トリガ: ①編集後デバウンス ②間隔 pull ③前面退避(flush) ④online 復帰 ⑤手動。
// 多重実行防止: 同期中フラグ＋末尾 1 回再実行（ch.11 §11.4）。DOM イベント購読は呼び出し側
//（composition root）が行い、ここへフックを渡す＝services は DOM 非依存。
import { PUSH_DEBOUNCE_MS } from '../model/constants';
import type { DeviceSettings } from '../model/types';
import type { SyncService } from './SyncService';

export interface SyncSchedulerDeps {
  sync: SyncService;
  getSettings: () => DeviceSettings;
  onOnlineBanner?: () => void; // online 復帰時のバナー表示（ch.11 §11.3）
}

export interface SyncScheduler {
  start(): void; // 間隔 pull を（再）設定する。設定変更後も呼ぶ。
  stop(): void; // タイマ解除（切断・破棄時）。
  notifyEdited(): void; // ① 編集後デバウンス push
  syncNow(): Promise<void>; // ⑤ 手動
  onVisibilityHidden(): void; // ③ 前面退避で flush
  onOnline(): void; // ④ オンライン復帰
}

export function createSyncScheduler(deps: SyncSchedulerDeps): SyncScheduler {
  let syncing = false;
  let pendingRerun = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  // 同期中フラグで重なりを末尾 1 回に畳む（ch.11 §11.4）。syncOnce は冪等。
  async function runGuarded(): Promise<void> {
    if (syncing) {
      pendingRerun = true;
      return;
    }
    syncing = true;
    try {
      await deps.sync.runOnce();
    } finally {
      syncing = false;
      if (pendingRerun) {
        pendingRerun = false;
        void runGuarded();
      }
    }
  }

  function clearDebounce(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function clearInterval_(): void {
    if (intervalTimer) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  }

  return {
    start() {
      clearInterval_();
      const s = deps.getSettings();
      if (s.autoSyncMode === 'interval') {
        intervalTimer = setInterval(() => void runGuarded(), s.autoSyncIntervalMs);
      }
    },
    stop() {
      clearDebounce();
      clearInterval_();
    },
    notifyEdited() {
      clearDebounce();
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void runGuarded();
      }, PUSH_DEBOUNCE_MS);
    },
    async syncNow() {
      await runGuarded();
    },
    onVisibilityHidden() {
      clearDebounce(); // 保留中の編集 push を即時 flush
      void runGuarded();
    },
    onOnline() {
      deps.onOnlineBanner?.();
      void runGuarded();
    },
  };
}
