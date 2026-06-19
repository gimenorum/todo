import '../styles/base.css';
import '../styles/layout.css';
import '../styles/components.css';

import type { State } from './model/types';
import { createStore } from './state/store';
import { createActions } from './state/actions';
import { createSyncRuntime } from './syncRuntime';
import { currentRoute, navigate, startRouter } from './router/router';
import { createAppShell } from './ui/layout/AppShell';
import type { UiContext } from './ui/context';
import { registerServiceWorker } from './pwa/registerSW';
import { setupInstall } from './pwa/installPrompt';
import * as todoSvc from './services/TodoService';
import * as settingsSvc from './services/SettingsService';
import * as issueReporter from './services/issueReporter';

// グローバルエラーを記録する（送信はせず「問題を報告」時の本文素材にするだけ / Issue #57）。
window.addEventListener('error', (e: ErrorEvent) => {
  issueReporter.recordError({
    message: e.message || String(e.error),
    stack: e.error instanceof Error ? e.error.stack : undefined,
    source: 'error',
  });
});
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  const r: unknown = e.reason;
  issueReporter.recordError({
    message: r instanceof Error ? r.message : String(r),
    stack: r instanceof Error ? r.stack : undefined,
    source: 'unhandledrejection',
  });
});

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
    global: 'unlinked', // startup() が連携状態に応じて idle/needs-reauth へ更新する（ch.09）。
    lastSyncAt: null,
    perTodoStatus: {},
    conflicts: [],
    banner: null,
    route: currentRoute(),
  };

  const store = createStore(initial);
  const runtime = createSyncRuntime(store); // services↔state を結線する同期ランタイム。
  const actions = createActions(store, runtime);
  const install = setupInstall();
  const ctx: UiContext = {
    store,
    actions,
    navigate,
    install,
    providers: {
      dropbox: settingsSvc.isDropboxConfigured(),
      gdrive: settingsSvc.isGoogleConfigured(),
    },
  };

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

  // 同期トリガのうち DOM 由来（前面退避・online 復帰）は root で購読し scheduler フックへ渡す
  //（services は DOM 非依存 / ch.11）。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) runtime.onVisibilityHidden();
  });
  window.addEventListener('online', () => runtime.onOnline());

  // OAuth コールバック処理 ＋ 連携済みなら同期ランタイム構築・初回同期（ch.05・06・11）。
  await runtime.startup();
}

void bootstrap().catch((err: unknown) => {
  console.error('[main] bootstrap failed', err);
  const e = err instanceof Error ? err : new Error(String(err));
  issueReporter.recordError({ message: e.message, stack: e.stack, source: 'bootstrap' });
  const mount = document.getElementById('app');
  if (mount) {
    const p = document.createElement('p');
    p.textContent = '初期化に失敗しました。ページを再読み込みしてください。';
    // 致命的エラー画面からも報告できるようにする（Issue #57）。
    const report = document.createElement('a');
    report.href = issueReporter.buildIssueUrl({
      version: __APP_VERSION__,
      route: 'bootstrap',
      userAgent: navigator.userAgent,
      errors: issueReporter.recentErrors(),
    });
    report.target = '_blank';
    report.rel = 'noopener';
    report.textContent = 'この内容を報告';
    mount.replaceChildren(p, report);
    mount.removeAttribute('aria-busy');
  }
});
