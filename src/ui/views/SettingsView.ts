import type { DeviceSettings, State } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { el, setTextIfChanged } from '../dom';

// 連携済み保存先の表示名。
function providerLabel(provider: DeviceSettings['connectedProvider']): string {
  return provider === 'gdrive' ? 'Google Drive' : provider === 'dropbox' ? 'Dropbox' : '保存先';
}

// 設定シェル（ch.08）。未連携時は同期系 UI を出さない（受け入れ基準 / ch.09）。
// 連携導線は設定に置く（Dropbox / Google Drive 連携 / ch.05）。
export function createSettingsView(ctx: UiContext): ViewController {
  const root = el('section', { class: 'settings-view' });
  root.append(el('h2', { class: 'view-title', text: '設定' }));

  // --- クラウド連携 ---
  const link = el('section', { class: 'settings-section' });
  link.append(el('h2', { text: 'クラウド連携' }));
  const linkDesc = el('p', { class: 'muted' });
  link.append(linkDesc);

  const connectDropboxBtn = el('button', { class: 'btn', text: 'Dropbox と連携', attrs: { type: 'button' } });
  const connectGoogleBtn = el('button', { class: 'btn', text: 'Google Drive と連携', attrs: { type: 'button' } });
  const connectNote = el('p', { class: 'muted', attrs: { hidden: '' } });
  // 再認証要（needs-reauth）のときの復帰導線。連携済みは連携ボタンを隠すため、現プロバイダで
  // 連携フローを再実行する専用ボタンを別に用意する（Issue #41）。
  const reconnectNote = el('p', {
    class: 'muted',
    text: '再連携が必要です。下のボタンから再連携してください。',
    attrs: { hidden: '' },
  });
  const reconnectBtn = el('button', {
    class: 'btn',
    text: '再連携',
    attrs: { type: 'button', hidden: '' },
  });
  const disconnectBtn = el('button', {
    class: 'btn btn-secondary',
    text: '連携を解除',
    attrs: { type: 'button', hidden: '' },
  });
  const showConnectError = (e: unknown): void => {
    connectNote.textContent = e instanceof Error ? e.message : String(e);
    connectNote.hidden = false;
  };
  connectDropboxBtn.addEventListener('click', () => {
    connectNote.hidden = true;
    void ctx.actions.connectDropbox().catch(showConnectError);
  });
  connectGoogleBtn.addEventListener('click', () => {
    connectNote.hidden = true;
    void ctx.actions.connectGoogle().catch(showConnectError);
  });
  reconnectBtn.addEventListener('click', () => {
    // 現在連携中のプロバイダで再認証する（needs-reauth でも connectedProvider は保持されている）。
    const provider = ctx.store.getState().settings.connectedProvider;
    const run = provider === 'gdrive' ? ctx.actions.connectGoogle : ctx.actions.connectDropbox;
    connectNote.hidden = true;
    void run().catch(showConnectError);
  });
  disconnectBtn.addEventListener('click', () => void ctx.actions.disconnect());
  link.append(connectDropboxBtn, connectGoogleBtn, reconnectNote, reconnectBtn, disconnectBtn, connectNote);
  root.append(link);

  // --- 同期設定（連携済みのみ表示） ---
  const sync = el('section', { class: 'settings-section', attrs: { hidden: '' } });
  sync.append(el('h2', { text: '同期設定' }));

  const modeManual = el('input', { class: 'f-mode', attrs: { type: 'radio', name: 'autosync', value: 'manual' } });
  const modeInterval = el('input', { class: 'f-mode', attrs: { type: 'radio', name: 'autosync', value: 'interval' } });
  const manualLabel = el('label', { class: 'field field-inline' });
  manualLabel.append(modeManual, el('span', { text: '手動のみ' }));
  const intervalLabel = el('label', { class: 'field field-inline' });
  intervalLabel.append(modeInterval, el('span', { text: '自動（間隔）' }));

  const intervalField = el('label', { class: 'field' });
  const intervalInput = el('input', {
    class: 'f-interval',
    attrs: { type: 'number', min: '1', max: '120', step: '1' },
  });
  intervalField.append(el('span', { text: '同期間隔（分）' }), intervalInput);

  const onMode = (): void => {
    void ctx.actions.changeSettings({ autoSyncMode: modeInterval.checked ? 'interval' : 'manual' });
  };
  modeManual.addEventListener('change', onMode);
  modeInterval.addEventListener('change', onMode);
  intervalInput.addEventListener('change', () => {
    const min = Math.max(1, Math.min(120, Number(intervalInput.value) || 5));
    void ctx.actions.changeSettings({ autoSyncIntervalMs: min * 60_000 });
  });

  const syncNowBtn = el('button', { class: 'btn btn-sync-now', text: '今すぐ同期', attrs: { type: 'button' } });
  syncNowBtn.addEventListener('click', () => void ctx.actions.syncNow());

  sync.append(manualLabel, intervalLabel, intervalField, syncNowBtn);
  root.append(sync);

  // --- データ（Phase 5） ---
  const data = el('section', { class: 'settings-section' });
  data.append(el('h2', { text: 'データ' }));
  data.append(
    el('p', { class: 'muted', text: 'タスク／設定のエクスポート・インポートは Phase 5 で提供します。' }),
  );
  root.append(data);

  // --- アプリ（インストール・バージョン） ---
  const app = el('section', { class: 'settings-section' });
  app.append(el('h2', { text: 'アプリ' }));
  const installLine = el('p', { class: 'muted' });
  const installBtn = el('button', { class: 'btn', text: 'インストール', attrs: { type: 'button' } });
  installBtn.addEventListener('click', () => void ctx.install.promptInstall());
  app.append(installLine, installBtn);
  app.append(el('p', { class: 'muted', text: `バージョン ${__APP_VERSION__}` }));
  root.append(app);

  function refreshInstall(): void {
    installLine.hidden = false;
    if (ctx.install.isStandalone) {
      // インストール済み起動はユーザーに見せる必要がない（デバッグ寄り）ため行ごと隠す（Issue #33）。
      installLine.textContent = '';
      installLine.hidden = true;
      installBtn.hidden = true;
    } else if (ctx.install.canInstall()) {
      installLine.textContent = 'ホーム画面／アプリとしてインストールできます。';
      installBtn.hidden = false;
    } else if (ctx.install.isIOS) {
      installLine.textContent = 'Safari の共有メニューから「ホーム画面に追加」でインストールできます。';
      installBtn.hidden = true;
    } else {
      installLine.textContent = 'ブラウザのメニューからインストールできます（対応ブラウザ）。';
      installBtn.hidden = true;
    }
  }
  refreshInstall();
  ctx.install.onChange(refreshInstall);

  return {
    el: root,
    update(state: State) {
      const provider = state.settings.connectedProvider;
      const connected = provider !== 'none';
      linkDesc.textContent = connected
        ? `連携済み（${providerLabel(provider)}）。複数端末で利用できます。`
        : '連携すると、複数端末で利用できます。';
      connectDropboxBtn.hidden = connected || !ctx.providers.dropbox;
      connectGoogleBtn.hidden = connected || !ctx.providers.gdrive;
      disconnectBtn.hidden = !connected;
      if (connected) connectNote.hidden = true;

      // 再認証要のときだけ「再連携」導線を出す（Issue #41）。
      const needsReauth = connected && state.global === 'needs-reauth';
      reconnectNote.hidden = !needsReauth;
      reconnectBtn.hidden = !needsReauth;

      sync.hidden = !connected;
      const interval = state.settings.autoSyncMode === 'interval';
      if (modeManual.checked === interval) modeManual.checked = !interval;
      if (modeInterval.checked !== interval) modeInterval.checked = interval;
      intervalField.hidden = !interval;
      const min = String(Math.round(state.settings.autoSyncIntervalMs / 60_000));
      if (intervalInput.value !== min) intervalInput.value = min;

      // 同期中は「今すぐ同期」を連打不可にし、文言で進行を示す（Issue #41）。幅は CSS で固定。
      const syncing = state.global === 'syncing';
      syncNowBtn.disabled = syncing;
      setTextIfChanged(syncNowBtn, syncing ? '同期中…' : '今すぐ同期');
    },
  };
}
