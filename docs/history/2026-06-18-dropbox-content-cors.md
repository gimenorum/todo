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
- **修正（Dropbox 公式のブラウザ CORS 回避策）**: content エンドポイント（download/upload）を
  **CORS「単純リクエスト」化**する。`arg` と `authorization` を **URL クエリ**（`?arg=…&authorization=Bearer%20…`）
  で渡し、**独自ヘッダを一切付けない**＝preflight が走らない。
  - `src/adapters/DropboxAdapter.ts`: `contentUrl(endpoint, arg)` ヘルパを追加。`get`/`put` をクエリ方式に変更
    （`get` はヘッダ無し、`put` は `Content-Type` を外し本文のみ＝単純リクエスト）。`list`/`delete`（RPC）は
    preflight を処理するため**ヘッダ方式のまま**。
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
