# 2026-06-18 Issue #33 文言変更（「連携」基調へ）＋ ヘッダーにバージョン表記

## 日付
2026-06-18

## 依頼内容
- Issue #33（文言変更依頼）:
  - 設定のクラウド連携「保存先に接続」「複数端末で同期」が分かりにくい。「連携」「複数端末で利用」へ。
  - 「インストール済みで起動しています。」はデバッグ寄りで一般利用者に不要。消す。
- 追加要望（会話中）:
  - 「接続/切断系すべて揃える」「基調語は単に『連携』」。
  - 「バージョン表記もあわせて対応して」＝ヘッダーに動作中バージョンを常設表示。
  - 「今回は機能拡張ではないので、ホットフィックス扱いが適当」。

## 対応概要
- 設定（`src/ui/views/SettingsView.ts`）の文言を「連携」基調に統一:
  - ボタン「Dropbox に接続」「Google Drive に接続」→「Dropbox と連携」「Google Drive と連携」。
  - ボタン「保存先から切断」→「連携を解除」。
  - 未連携説明「保存先に接続すると、複数端末で同期できます。」→「連携すると、複数端末で利用できます。」。
  - 連携済み説明「接続済み（…）。複数端末で同期されます。」→「連携済み（…）。複数端末で利用できます。」。
  - `providerLabel` のフォールバック「保存先」は据え置き（連携済み表示でのみ使われ実際にはサービス名が入る dead fallback）。
- インストール済み起動時の行（「インストール済みで起動しています。」）を**行ごと非表示**に変更。
- アダプタのエラー文言を整合（ボタン改名に追従）:
  - `src/adapters/GoogleDriveAdapter.ts` / `src/adapters/DropboxAdapter.ts` の AuthError 文言
    「設定で一度切断し、再度連携し直してください。」→「設定で一度連携を解除し、再度連携し直してください。」。
- ヘッダーに動作中バージョンを常設表示:
  - `src/ui/layout/AppShell.ts` のタイトル直後に `v${__APP_VERSION__}` の span を追加。
  - `styles/layout.css` に `.app-version`（小さめ・muted）を追加。
  - `__APP_VERSION__` は package.json を単一の真実として注入（vite.config.ts）。設定画面の版表記は据え置き。
- hotfix 扱いのため `package.json` の version を 0.4.5 → 0.4.6 に bump。

## 決定事項
- 基調語は「連携」（「アカウント」「保存先」「接続」は使わない）。`providerLabel` は変更しない。
- ヘッダーのバージョン表記は別 Issue 化せず、本対応に含めて実装する。
- 機能拡張ではないため hotfix 扱い（`hotfix/settings-wording-version` を main から分岐、version bump 必須）。
- ステータス表示 `要再接続`（StatusIndicator）は別概念のため今回は据え置き。

## 成果物
- 変更: `src/ui/views/SettingsView.ts`
- 変更: `src/adapters/GoogleDriveAdapter.ts`
- 変更: `src/adapters/DropboxAdapter.ts`
- 変更: `src/ui/layout/AppShell.ts`
- 変更: `styles/layout.css`
- 変更: `package.json`（version 0.4.5 → 0.4.6）
- 新規: `docs/history/2026-06-18-issue33-wording-and-header-version.md`（本ファイル）
