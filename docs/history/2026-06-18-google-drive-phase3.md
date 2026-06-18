# 2026-06-18 Phase 3: Google Drive アダプタ（GIS トークン方式 / v0.3.0）

## 日付
2026-06-18

## 依頼内容
- 「phase3に進めましょうか。」— 要件の Phase 3（Google Drive を 2 つ目の保存先に。同一同期エンジン／同一
  `StorageAdapter` IF。一覧の遅延整合でも fork はマージで吸収・データ消失なし。`feature/google-drive`・tag `v0.3.0`）。

## 対応概要
- **調査で設計前提の食い違いが判明**: 設計書 §5.5 は「PKCE / public client（Dropbox 同様）」を想定していたが、
  Google は「ウェブ アプリケーション」クライアントだと PKCE でも `client_secret` を要求し、**バックエンド無しの
  静的 PWA ではリフレッシュトークンを安全に得られない**（Web 検索で確認）。→ ユーザー決定で **GIS トークンモデル**
  （`google.accounts.oauth2.initTokenClient`。アクセストークンのみ・約 1 時間・リフレッシュ無し）を採用。
- **段階（ユーザー決定）**: アダプタ＋ユニットテスト＋UI＋CSP＋CI env を実装して develop へ。実機 E2E と v0.3.0
  リリースは、ユーザーの Google OAuth クライアント発行後。Google Cloud 設定手順を同梱。
- **新規**:
  - `src/adapters/GoogleDriveAdapter.ts`: Drive API v3（appDataFolder）への写像。`Authorization: Bearer` ヘッダ
    （標準 CORS）。`list`=全件取得→`name.startsWith(prefix)`、name→id 解決、`get`=`alt=media`（404→null）、
    `put`=既存 `objects/` はスキップ（不変・重複回避）／既存 `heads/` は media 更新／無ければ multipart create、
    `delete`=id 解決して削除（未存在は冪等）。401→強制 refresh で 1 回リトライ→なお 401 で `AuthError`、403
    スコープ不足も `AuthError`。
  - `src/adapters/oauth/gis.ts`: GIS スクリプトの遅延ロード＋`initTokenClient` ラッパ（`requestAccessToken` を
    Promise 化）。window/document 依存をここに隔離（pkce.ts と同じ adapters/oauth 層）。
  - `tests/helpers/googleDriveMock.ts`・`tests/adapters/googledrive.test.ts`: 契約テスト＋固有挙動（重複回避・
    heads 上書き・multipart 往復・401 リトライ・401 失効・403 スコープ不足）。
- **変更**:
  - `src/services/SettingsService.ts`: Google 定数（`VITE_GOOGLE_CLIENT_ID`／scope `drive.appdata`）、
    `isGoogleConfigured()`、`connectGoogle()`（GIS consent→トークン永続＋`connectedProvider='gdrive'`）、
    `googleTokenProvider()`（失効/forceRefresh は GIS 無音取得→失敗で `AuthError`）、`disconnect()` を現
    `connectedProvider` 対応に一般化、`buildAdapter()` を `switch(provider)` 化。
  - `src/syncRuntime.ts`・`src/state/actions.ts`: `connect()`→`connectDropbox()` にリネーム＋`connectGoogle()` 追加。
    Google は in-page 完結のため、接続後に設定反映→`buildRuntime()`→`syncNow()`。
  - `src/ui/context.ts`・`src/main.ts`: `UiContext.providers`（dropbox/gdrive の configured 真偽を root で評価）。
  - `src/ui/views/SettingsView.ts`: 「Dropbox に接続」「Google Drive に接続」の 2 ボタン（configured で出し分け）、
    接続済み表示を provider 名で出し分け。
  - `vite.config.ts`: 本番 CSP に Google を追加（`script-src accounts.google.com/gsi/client`／`connect-src
    www.googleapis.com accounts.google.com`／新規 `frame-src 'self' https://accounts.google.com`）。
  - `.github/workflows/deploy.yml`・`release.yml`: ビルドに `VITE_GOOGLE_CLIENT_ID`（`vars`）を注入。
  - `src/vite-env.d.ts`: `VITE_GOOGLE_CLIENT_ID` 型。`package.json`: version 0.2.1→0.3.0。
  - 設計書: `05-storage-adapter.md` §5.5（GIS 方式＋API 写像に更新・§5.5.1 追記）、`12-pwa-sw-csp.md`（CSP 表）、
    `14-security.md`（OAuth 方式）、`18-open-questions.md` #4/#5 を確定。`docs/setup-google-drive.md` 新規。
- **検証**: `typecheck`／`lint`／`test`（123 passed・+13）／`build` すべて green。本番ビルドの `<meta>` CSP に
  Google ディレクティブが入ることを確認。

## 決定事項
- Drive の認証は **GIS トークンモデル**（アクセストークンのみ・リフレッシュ無し）。`client_secret` は使わない。
  失効は GIS 無音再取得→不可なら `needs-reauth`。設計書 §5.5.1 に「PKCE 前提からの改訂」として明記。
- Google 側の登録はユーザー実施（「ウェブ アプリケーション」＋**承認済み JavaScript 生成元**。リダイレクト URI
  不要）。Client ID は `VITE_GOOGLE_CLIENT_ID`（ローカル `.env`／Actions Variables）。
- ブランチは `feature/google-drive`（branch-policy: `develop ← feature/*`）。version 0.3.0。**E2E／main マージ／
  リリースは後続**（ユーザーのクライアント発行後）。
- `objects/` は内容アドレス指定＝不変で重複作成を避ける、`heads/` は advisory で上書き。一覧遅延整合は同期エンジン
  の「先端再導出」＋未伝播オブジェクト握りつぶし（§4.6）で吸収。

## 成果物
- 新規: `src/adapters/GoogleDriveAdapter.ts`、`src/adapters/oauth/gis.ts`、
  `tests/helpers/googleDriveMock.ts`、`tests/adapters/googledrive.test.ts`、`docs/setup-google-drive.md`、
  `docs/history/2026-06-18-google-drive-phase3.md`（本ファイル）
- 変更: `src/services/SettingsService.ts`、`src/syncRuntime.ts`、`src/state/actions.ts`、`src/ui/context.ts`、
  `src/main.ts`、`src/ui/views/SettingsView.ts`、`vite.config.ts`、`src/vite-env.d.ts`、`package.json`、
  `.github/workflows/deploy.yml`、`.github/workflows/release.yml`、`tests/services/settingsService.test.ts`、
  `docs/design/05-storage-adapter.md`、`docs/design/12-pwa-sw-csp.md`、`docs/design/14-security.md`、
  `docs/design/18-open-questions.md`
