import '../styles/base.css';
import '../styles/layout.css';
import '../styles/components.css';

import type { State } from './model/types';
import { createStore } from './state/store';
import { createActions } from './state/actions';
import { currentRoute, navigate, startRouter } from './router/router';
import { createAppShell } from './ui/layout/AppShell';
import type { UiContext } from './ui/context';
import { registerServiceWorker } from './pwa/registerSW';
import { setupInstall } from './pwa/installPrompt';
import * as todoSvc from './services/TodoService';
import * as settingsSvc from './services/SettingsService';

// アプリ全体の composition root（ch.01）。各レイヤをここで結線する。
async function bootstrap(): Promise<void> {
  // 初期データはローカル（IDB）から読む。リモート未連携でも常に動く（受け入れ基準）。
  const [allTodos, settings] = await Promise.all([
    todoSvc.listAll(),
    settingsSvc.loadSettings(),
  ]);
  void settingsSvc.deviceId(); // 端末 ID を生成・永続（無ければ）。

  const initial: State = {
    todos: allTodos.filter((t) => !t.deleted),
    settings,
    global: 'unlinked', // Phase 0 は未連携固定＝同期系 UI を出さない（ch.09）。
    lastSyncAt: null,
    perTodoStatus: {},
    conflicts: [],
    route: currentRoute(),
  };

  const store = createStore(initial);
  const actions = createActions(store);
  const install = setupInstall();
  const ctx: UiContext = { store, actions, navigate, install };

  const shell = createAppShell(ctx);
  const mount = document.getElementById('app');
  if (!mount) throw new Error('#app mount point not found');
  mount.replaceChildren(shell.el);
  mount.removeAttribute('aria-busy');

  // setState → render 単一経路（ch.07）。
  store.subscribe((state) => shell.update(state));
  shell.update(store.getState());

  startRouter(store);
  registerServiceWorker();
}

void bootstrap().catch((err: unknown) => {
  console.error('[main] bootstrap failed', err);
  const mount = document.getElementById('app');
  if (mount) {
    mount.textContent = '初期化に失敗しました。ページを再読み込みしてください。';
    mount.removeAttribute('aria-busy');
  }
});
