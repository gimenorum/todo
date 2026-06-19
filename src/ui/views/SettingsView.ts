import type { DeviceSettings, ExportRequest, ImportData, State } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { el, setTextIfChanged } from '../dom';
import { saveFile } from '../download';

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

  // --- データ（エクスポート / インポート ／ Phase 5・ch.13） ---
  const data = el('section', { class: 'settings-section' });
  data.append(el('h2', { text: 'データ' }));

  // 結果/エラー表示（確認中も見えるよう section 直下に置く）。
  const dataNote = el('p', { class: 'muted', attrs: { hidden: '' } });
  const showDataError = (e: unknown): void => {
    dataNote.textContent = e instanceof Error ? e.message : String(e);
    dataNote.hidden = false;
  };

  // 通常操作（エクスポート/インポート）。確認表示中は隠す。
  const dataControls = el('div', { class: 'data-controls' });

  function exportButton(label: string, req: ExportRequest): HTMLButtonElement {
    const b = el('button', { class: 'btn btn-secondary', text: label, attrs: { type: 'button' } });
    b.addEventListener('click', () => {
      dataNote.hidden = true;
      void ctx.actions.exportData(req).then(saveFile).catch(showDataError);
    });
    return b;
  }

  dataControls.append(
    el('p', { class: 'muted', text: 'エクスポート' }),
    exportButton('タスクをバックアップ', { kind: 'tasks', format: 'json' }),
    exportButton('タスク (Markdown)', { kind: 'tasks', format: 'md' }),
    exportButton('タスク (CSV)', { kind: 'tasks', format: 'csv' }),
    exportButton('設定をバックアップ', { kind: 'settings', format: 'json' }),
    exportButton('全体をバックアップ（タスク＋設定）', { kind: 'all', format: 'json' }),
  );

  // インポート: hidden file input をボタンから開く。
  const importInput = el('input', {
    class: 'f-import',
    attrs: { type: 'file', accept: '.json,application/json', hidden: '' },
  });
  const importBtn = el('button', {
    class: 'btn btn-secondary',
    text: 'バックアップから読み込む',
    attrs: { type: 'button' },
  });
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = ''; // 同じファイルを連続選択しても change が発火するように
    if (!file) return;
    dataNote.hidden = true;
    void file
      .text()
      .then((text) => showImportConfirm(ctx.actions.previewImport(text))) // parse は throw しうる
      .catch(showDataError);
  });
  dataControls.append(
    el('p', { class: 'muted', text: 'インポート' }),
    importBtn,
    importInput,
    el('p', { class: 'muted', text: 'バックアップファイルを選んで取り込みます' }),
  );

  // ローカルデータの削除系（Issue #38）。危険操作として btn-danger で区別。
  function resetButton(
    label: string,
    desc: string,
    confirm: { message: string; confirmLabel: string; run: () => Promise<void> },
  ): void {
    const b = el('button', { class: 'btn btn-danger', text: label, attrs: { type: 'button' } });
    b.addEventListener('click', () => showResetConfirm(confirm));
    dataControls.append(b, el('p', { class: 'muted', text: desc }));
  }
  dataControls.append(
    el('h3', { text: 'ローカルデータ' }),
    el('p', { class: 'muted', text: '表示がおかしいときや同期がうまくいかないときに試してください。' }),
  );
  resetButton('ローカルデータを削除', 'ローカルデータを削除します。クラウド上のデータは消えません。', {
    message: 'ローカルデータを削除します。クラウド上のデータは消えません。',
    confirmLabel: '削除する',
    run: () => ctx.actions.deleteLocalData(),
  });
  resetButton('クラウドから復元', 'ローカルデータを削除し、クラウドから復元します。', {
    message:
      'ローカルデータを削除し、クラウドから復元します。クラウド側は変わりません。まだ送信していない変更は失われる場合があります。オンラインで実行してください。',
    confirmLabel: '復元する',
    run: () => ctx.actions.refetchFromCloud(),
  });
  resetButton(
    '連携を解除してすべて削除',
    'クラウド連携を解除し、ローカルデータと設定をすべて削除します。',
    {
      message:
        'クラウド連携を解除し、ローカルデータと設定をすべて削除します。クラウド上のデータは消えません。',
      confirmLabel: '削除する',
      run: () => ctx.actions.factoryReset(),
    },
  );

  // 取り込み内容のインライン確認（dataControls と差し替え表示）。
  const importConfirm = el('div', { class: 'data-confirm', attrs: { hidden: '' } });
  function closeImportConfirm(): void {
    importConfirm.hidden = true;
    importConfirm.replaceChildren();
    dataControls.hidden = false;
  }
  function showImportConfirm(d: ImportData): void {
    const summary = el('ul', { class: 'muted' });
    if (d.tasks) {
      summary.append(
        el('li', {
          text: `タスク ${d.tasks.length} 件を取り込みます（同じタスクは新しい方を採用、別のタスクは両方残します）`,
        }),
      );
    }
    if (d.settings) summary.append(el('li', { text: 'この端末の設定を上書きします' }));

    const cancel = el('button', { class: 'btn btn-secondary', text: 'キャンセル', attrs: { type: 'button' } });
    const apply = el('button', { class: 'btn', text: '適用する', attrs: { type: 'button' } });
    cancel.addEventListener('click', closeImportConfirm);
    apply.addEventListener('click', () => {
      apply.disabled = true;
      dataNote.hidden = true;
      void ctx.actions
        .commitImport(d)
        .then(closeImportConfirm)
        .catch((e) => {
          apply.disabled = false;
          showDataError(e);
        });
    });
    const actions = el('div', { class: 'form-actions' });
    actions.append(cancel, apply);
    importConfirm.replaceChildren(el('h3', { text: '取り込み内容を確認' }), summary, actions);
    dataControls.hidden = true;
    importConfirm.hidden = false;
  }

  // リセット系のインライン確認（dataControls と差し替え表示）。確定で run（成功時はページ再読込される）。
  const resetConfirm = el('div', { class: 'data-confirm', attrs: { hidden: '' } });
  function showResetConfirm(c: { message: string; confirmLabel: string; run: () => Promise<void> }): void {
    const cancel = el('button', { class: 'btn btn-secondary', text: 'キャンセル', attrs: { type: 'button' } });
    const go = el('button', { class: 'btn btn-danger', text: c.confirmLabel, attrs: { type: 'button' } });
    cancel.addEventListener('click', () => {
      resetConfirm.hidden = true;
      resetConfirm.replaceChildren();
      dataControls.hidden = false;
    });
    go.addEventListener('click', () => {
      go.disabled = true;
      dataNote.hidden = true;
      void c.run().catch((e) => {
        go.disabled = false;
        showDataError(e);
      });
    });
    const actions = el('div', { class: 'form-actions' });
    actions.append(cancel, go);
    resetConfirm.replaceChildren(
      el('h3', { text: '確認' }),
      el('p', { class: 'muted', text: c.message }),
      actions,
    );
    dataControls.hidden = true;
    resetConfirm.hidden = false;
  }

  data.append(dataControls, importConfirm, resetConfirm, dataNote);
  root.append(data);

  // --- アプリ（インストール・バージョン） ---
  const app = el('section', { class: 'settings-section' });
  app.append(el('h2', { text: 'アプリ' }));
  const installLine = el('p', { class: 'muted' });
  const installBtn = el('button', { class: 'btn', text: 'インストール', attrs: { type: 'button' } });
  installBtn.addEventListener('click', () => void ctx.install.promptInstall());
  app.append(installLine, installBtn);

  // 問題を報告（Issue #57）。GitHub の新規 Issue 画面を環境情報入りで開く（利用者名義・送信前に確認可）。
  const reportBtn = el('button', { class: 'btn btn-secondary', text: '問題を報告', attrs: { type: 'button' } });
  reportBtn.addEventListener('click', () => {
    window.open(ctx.actions.reportProblemUrl(), '_blank', 'noopener');
  });
  app.append(
    reportBtn,
    el('p', { class: 'muted', text: '不具合の報告画面（GitHub）を開きます。送信前に内容を確認できます。' }),
  );

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
