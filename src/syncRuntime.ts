// syncRuntime.ts — composition root のグルー（main.ts から使う）。
// services（SyncService/SyncScheduler）と state（store）を結線し、連携のライフサイクルを握る。
// 本ファイルはレイヤ配下（core/ui/state/services）ではないため層 lint の対象外＝結線専用。
import type { Store } from './state/store';
import type { SyncBridge } from './state/actions';
import { createSyncService, type SyncOutcome, type SyncService } from './services/SyncService';
import type { TodoPatch } from './services/TodoService';
import { createSyncScheduler, type SyncScheduler } from './services/SyncScheduler';
import { createBroadcast, type Broadcast } from './state/broadcast';
import * as settingsSvc from './services/SettingsService';
import * as settingsStore from './store/settingsStore';
import { clearLocalData } from './store/resetStore';
import { DEFAULT_SETTINGS } from './model/constants';
import type { Clock, GlobalSyncStatus, Uuid } from './model/types';

export interface SyncRuntime extends SyncBridge {
  startup(): Promise<void>; // OAuth コールバック処理 + 連携済みなら runtime 構築 + 初回同期
  onVisibilityHidden(): void;
  onOnline(): void;
}

const BANNER_VISIBLE_MS = 4000;

export function createSyncRuntime(store: Store): SyncRuntime {
  let svc: SyncService | null = null;
  let scheduler: SyncScheduler | null = null;
  let broadcast: Broadcast | null = null;
  const clock: Clock = { now: () => Date.now() };

  function onOutcome(o: SyncOutcome): void {
    store.setState({
      todos: o.todos,
      perTodoStatus: o.perTodoStatus,
      conflicts: o.conflicts,
      lastSyncAt: o.lastSyncAt,
    });
  }
  function onStatus(s: GlobalSyncStatus): void {
    store.setState({ global: s });
  }

  function showBanner(): void {
    store.setState({ banner: 'オンラインに復帰しました。同期しています…' });
    setTimeout(() => store.setState({ banner: null }), BANNER_VISIBLE_MS);
  }

  async function reload(): Promise<void> {
    if (!svc) return;
    store.setState({ todos: await svc.reloadFromLocal() });
  }

  async function buildRuntime(): Promise<boolean> {
    const adapter = await settingsSvc.buildAdapter();
    if (!adapter) return false;
    const deviceId = await settingsSvc.deviceId();
    broadcast = createBroadcast((m) => {
      if (m.type === 'todos-changed') void reload();
    });
    svc = createSyncService({
      adapter,
      deviceId,
      clock,
      onOutcome,
      onStatus,
      broadcast: () => broadcast?.post({ type: 'todos-changed' }),
    });
    // 起動時に未解決競合を復元する（初回同期より前）。リロードしても「解決する」が残る（Issue #26）。
    await svc.restoreConflicts();
    scheduler = createSyncScheduler({
      sync: svc,
      getSettings: () => store.getState().settings,
      onOnlineBanner: showBanner,
    });
    scheduler.start();
    store.setState({ global: 'idle' });
    return true;
  }

  function teardown(): void {
    scheduler?.stop();
    broadcast?.close();
    svc = null;
    scheduler = null;
    broadcast = null;
  }

  return {
    async startup() {
      if (settingsSvc.isOAuthCallback(window.location.search)) {
        try {
          await settingsSvc.completeOAuthRedirect(window.location.search);
        } catch (err) {
          console.error('[oauth] callback failed', err);
        }
        // ?code=… を URL から除去（履歴を汚さない）。ハッシュルートはそのまま。
        history.replaceState(null, '', window.location.pathname);
        store.setState({ settings: await settingsSvc.loadSettings() });
      }
      if (store.getState().settings.connectedProvider !== 'none') {
        const ok = await buildRuntime();
        if (ok) void scheduler?.syncNow();
        else store.setState({ global: 'needs-reauth' });
      }
    },

    async connectDropbox() {
      await settingsSvc.connectDropbox(); // 認可ページへ遷移（戻りは startup で処理）
    },

    async connectGoogle() {
      // GIS はポップアップで in-page 完結するため、ここで設定反映＋ランタイム構築＋初回同期まで行う
      //（Dropbox のようなリダイレクト startup 経路を通らない / ch.05 §5.5）。
      await settingsSvc.connectGoogle();
      store.setState({ settings: await settingsSvc.loadSettings() });
      const ok = await buildRuntime();
      if (ok) void scheduler?.syncNow();
      else store.setState({ global: 'needs-reauth' });
    },

    async disconnect() {
      const next = await settingsSvc.disconnect();
      teardown();
      store.setState({
        settings: next,
        global: 'unlinked',
        perTodoStatus: {},
        conflicts: [],
        lastSyncAt: null,
        banner: null,
      });
    },

    async syncNow() {
      await scheduler?.syncNow();
    },

    notifyEdited() {
      scheduler?.notifyEdited();
    },

    async resolveConflict(id: Uuid, patch: TodoPatch) {
      await svc?.resolveConflict(id, patch);
    },

    async reloadFromLocal() {
      await reload();
    },

    applyIntervalChange() {
      scheduler?.start();
    },

    // ① 削除のみ。能動的な再取得はしない（scheduler を止めてからクリア）。再読込後は連携が残るアプリ既定動作に委ねる。
    async deleteLocalData() {
      teardown();
      await clearLocalData();
      window.location.reload();
    },

    // ② 削除して取り直す。未送信のローカル変更を守るため事前に best-effort で push してからクリア。
    //    再読込→startup→初回同期でクラウドから再構築される。
    async refetchFromCloud() {
      try {
        await scheduler?.syncNow();
      } catch {
        /* オフライン/壊れは無視してクリアへ進む */
      }
      teardown();
      await clearLocalData();
      window.location.reload();
    },

    // ③ この端末を初期化。連携解除（トークン削除・未連携へ）＋全消し＋設定既定化。クラウド側は不変。
    async factoryReset() {
      try {
        await scheduler?.syncNow();
      } catch {
        /* best-effort */
      }
      await settingsSvc.disconnect();
      teardown();
      await clearLocalData();
      await settingsStore.saveSettings(DEFAULT_SETTINGS);
      window.location.reload();
    },

    onVisibilityHidden() {
      scheduler?.onVisibilityHidden();
    },

    onOnline() {
      scheduler?.onOnline();
    },
  };
}
