# 2026-06-18 Dropbox content エンドポイントのブラウザ CORS を解消（v0.2.1 に同梱）

## 日付
2026-06-18

## 依頼内容
- PR #18（v0.2.1）の動作確認中、コンソールに CORS エラー:
  「Access to fetch at 'https://content.dropboxapi.com/2/files/download' ... blocked by CORS policy:
  No 'Access-Control-Allow-Origin' header is present」。`DropboxAdapter.get`→`loadRemoteCommits`→
  `[sync] 同期に失敗しました: TypeError: Failed to fetch`。**本番でも同じ**に再現。「このPRで深掘りして直す」。

## 対応概要
- **切り分け**: 同じスタックで `api.dropboxapi.com`（`/files/list_folder`）は成功し、
  `content.dropboxapi.com`（`/files/download`）だけが CORS で失敗。dev では CSP 未注入なので CSP は無関係。
  当初は Codespaces プレビュー固有を疑ったが、**本番（実オリジン＋実 CSP）でも再現**との報告で否定。
- **根本原因**: `content.dropboxapi.com` は CORS の **preflight を正しく返さない**。現行コードは
  `Dropbox-API-Arg`／`Authorization`／`Content-Type` の独自ヘッダを付けており、これが preflight を誘発 →
  応答に `Access-Control-Allow-Origin` が無く CORS 失敗（`TypeError: Failed to fetch`）。`api`（RPC）は
  preflight を処理するため list/delete は通り、content だけ落ちるという非対称が説明できる。
- **修正（Dropbox 公式の「cors-hack」＝3 点セット）**: content エンドポイント（download/upload）を
  **CORS「単純リクエスト」化**する。次の 3 点を揃える:
  1. `arg` と `authorization`（`Bearer <token>`）を **URL クエリ**で渡す（独自ヘッダを使わない）。
  2. **`reject_cors_preflight=true`** を URL クエリに付ける（無いと URL パラメータ認証が無効＝**401「Invalid
     authorization value」**）。
  3. **`Content-Type: text/plain; charset=dropbox-cors-hack`**（MIME が text/plain＝CORS 安全リストなので
     preflight を起こさない／Dropbox は octet-stream 相当として受理。**無いと upload は 400「Missing Content-Type」**）。
  - `src/adapters/DropboxAdapter.ts`: `CORS_HACK_CT` 定数と `contentUrl(endpoint, arg)` ヘルパ（auth/arg/
    reject_cors_preflight をクエリに）を追加。`get`/`put` は Content-Type に cors-hack のみ付ける単純リクエストに。
    `list`/`delete`（RPC）は preflight を処理するため**ヘッダ方式のまま**。
  - **反復経緯**: 初回（commit d1ad695）は ①のみで ②③が欠けており、本番テストで download=401／upload=400 が判明。
    ②`reject_cors_preflight=true` と ③cors-hack Content-Type を追加して完成させた（本コミット）。
  - `tests/helpers/dropboxMock.ts`: content は `arg`/`authorization` をクエリで受理（RPC は従来どおり本文）。
    URL はパスで判定（クエリ無視）。両形式を受理。
  - `tests/adapters/dropbox.test.ts`: 「content 操作は独自ヘッダ無し・arg/authorization はクエリ」で形状を固定。
- 設計書 `docs/design/05-storage-adapter.md` §5.4 に CORS 対策を明記。

## 決定事項
- content エンドポイントは **クエリ方式（単純リクエスト）** を正とする。RPC は preflight 対応済みのため
  ヘッダ方式を維持（変更は content の get/put に限定し、動いている list/delete には触れない）。
- トークンは短命のアクセストークンで、HTTPS のクエリに載るのみ（Dropbox が公式に案内する方式）。PKCE public
  client ゆえ秘密ではない。
- 本修正は v0.2.1（未リリース）に**同梱**する（同期エラーの主要因のため別リリースに分けない）。version は据え置き 0.2.1。
- CSP 変更は不要（宛先は引き続き `content.dropboxapi.com`＝`connect-src` に既存）。

## 成果物
- 変更: `src/adapters/DropboxAdapter.ts`、`tests/helpers/dropboxMock.ts`、`tests/adapters/dropbox.test.ts`、
  `docs/design/05-storage-adapter.md`
- 新規: `docs/history/2026-06-18-dropbox-content-cors.md`（本ファイル）
