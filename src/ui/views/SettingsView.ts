import type { State } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { el } from '../dom';

// 設定シェル（ch.08）。未連携時は同期系ステータス/バッジを出さない（受け入れ基準 / ch.09）。
// 接続導線だけは常設する（連携導線は設定に置く）。
export function createSettingsView(ctx: UiContext): ViewController {
  const root = el('section', { class: 'settings-view' });
  root.append(el('h2', { class: 'view-title', text: '設定' }));

  // クラウド連携（接続導線を常設。実接続は Phase 2 以降）
  const link = el('section', { class: 'settings-section' });
  link.append(el('h2', { text: 'クラウド連携' }));
  link.append(
    el('p', {
      class: 'muted',
      text: '保存先はまだ接続されていません。接続すると複数端末で同期できます（Phase 2 以降で対応）。',
    }),
  );
  const connectBtn = el('button', { class: 'btn', text: '保存先に接続', attrs: { type: 'button' } });
  const connectNote = el('p', { class: 'muted', attrs: { hidden: '' } });
  connectBtn.addEventListener('click', () => {
    connectNote.textContent =
      '同期機能（Dropbox / Google Drive）は今後のフェーズで提供します。';
    connectNote.hidden = false;
  });
  link.append(connectBtn, connectNote);
  root.append(link);

  // 同期設定（接続後に出す。未連携では同期系 UI を出さない）
  const sync = el('section', { class: 'settings-section' });
  sync.append(el('h2', { text: '同期設定' }));
  sync.append(
    el('p', {
      class: 'muted',
      text: '保存先に接続すると、自動同期の間隔（「手動のみ」も選択可）を設定できます。',
    }),
  );
  root.append(sync);

  // データ（エクスポート/インポート）= Phase 5
  const data = el('section', { class: 'settings-section' });
  data.append(el('h2', { text: 'データ' }));
  data.append(
    el('p', {
      class: 'muted',
      text: 'タスク／設定のエクスポート・インポートは Phase 5 で提供します。',
    }),
  );
  root.append(data);

  // アプリ（インストール導線・バージョン）
  const app = el('section', { class: 'settings-section' });
  app.append(el('h2', { text: 'アプリ' }));
  const installLine = el('p', { class: 'muted' });
  const installBtn = el('button', { class: 'btn', text: 'インストール', attrs: { type: 'button' } });
  installBtn.addEventListener('click', () => void ctx.install.promptInstall());
  app.append(installLine, installBtn);
  app.append(el('p', { class: 'muted', text: `バージョン ${__APP_VERSION__}` }));
  root.append(app);

  function refreshInstall(): void {
    if (ctx.install.isStandalone) {
      installLine.textContent = 'インストール済みで起動しています。';
      installBtn.hidden = true;
    } else if (ctx.install.canInstall()) {
      installLine.textContent = 'ホーム画面／アプリとしてインストールできます。';
      installBtn.hidden = false;
    } else if (ctx.install.isIOS) {
      installLine.textContent =
        'Safari の共有メニューから「ホーム画面に追加」でインストールできます。';
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
    update(_state: State) {
      // 設定値は変更時に即保存するため、ここでの再描画は不要（Phase 0）。
    },
  };
}
