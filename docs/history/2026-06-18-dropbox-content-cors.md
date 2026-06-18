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
  3. **Content-Type（download / upload で要件が異なる）**: **download は付けない**（本文が無く不要。cors-hack
     charset を付けると download は **400「Bad Content-Type」** で拒否される）。**upload は
     `text/plain; charset=dropbox-cors-hack`**（安全リスト＝preflight 不要・Dropbox は octet-stream 相当として受理。
     無いと **400「Missing Content-Type」**）。
  - `src/adapters/DropboxAdapter.ts`: `CORS_HACK_CT` 定数と `contentUrl(endpoint, arg)` ヘルパ（auth/arg/
    reject_cors_preflight をクエリに）を追加。`get` はヘッダ無し、`put` は cors-hack の Content-Type のみ。
    `list`/`delete`（RPC）は preflight を処理するため**ヘッダ方式のまま**。
  - **反復経緯（本番テストで段階的に判明）**:
    - (i) 初回 d1ad695 は①のみ → CORS は解消したが download=401「Invalid authorization value」・
      upload=400「Missing Content-Type」。
    - (ii) 29add53 で②`reject_cors_preflight=true` と③cors-hack Content-Type を全 content 操作に付与 →
      **download が 400「Bad Content-Type: text/plain; charset=dropbox-cors-hack」**（download はこの charset を拒否）。
    - (iii) 57db6ca で **download は Content-Type を付けない**ことにした → なお download/upload とも 401「Invalid
      authorization value」（両方 401）。
    - (iv) **ブラウザ実機診断で HTTP 挙動を確定**（コンテナ curl は既知で動く api list すら 403 で再現不能）。
      `tokens` ストアの実トークンで content を直接叩いた結果: **download F1（`Bearer%20<token>` クエリ）→
      409 path/not_found＝認証 OK**、**upload A（クエリ＋cors-hack CT）→ 200**、**upload B（ヘッダ＋octet-stream）→
      200**、生トークンのみ → 400。⇒ **現行（57db6ca）の方式は HTTP 的に正しい**。(i)〜(iii) の 401 は当時の
      **トークン状態の揺らぎ**（同一 sync で list（ヘッダ）成功・content（URL）だけ 401 という矛盾）と判明。
  - **堅牢化（本コミットの主眼）**: content 操作（get/put）が **401** を返したら、`getAccessToken({ forceRefresh: true })`
    で**トークンを強制 refresh し URL を作り直して 1 回だけリトライ**。一過性のトークン状態 401 を自己回復する。
    2 回目も 401 なら従来どおり `AuthError`（needs-reauth）。`TokenProvider.getAccessToken` に `forceRefresh`
    オプションを追加（`src/adapters/oauth/tokenStore.ts`／`src/services/SettingsService.ts`）。
  - `tests/helpers/dropboxMock.ts`: content は `arg`/`authorization` をクエリで受理（RPC は従来どおり本文）。
    URL はパスで判定（クエリ無視）。両形式を受理（`requireAuth` はクエリ authorization も見る）。
  - `tests/adapters/dropbox.test.ts`: 「content は独自ヘッダ無し・arg/authorization/reject_cors_preflight はクエリ・
    download は CT 無し／upload は cors-hack CT」で形状を固定。「content 401→forceRefresh→リトライ成功」を追加。
- 設計書 `docs/design/05-storage-adapter.md` §5.4 に cors-hack 3 点セット・診断結果・401 リトライを明記。

## 決定事項
- content エンドポイントは **クエリ方式（単純リクエスト・cors-hack）** を正とする（ブラウザ診断で確定）。
  download は CT 無し、upload は cors-hack CT。RPC（list/delete）は preflight 対応済みのためヘッダ方式を維持。
- upload はヘッダ方式（octet-stream）でも 200（実証済み）だが、download とクエリ方式に**統一**する。Firefox 等で
  cors-hack CT が書き換えられて upload が不安定なら、upload のみヘッダ方式へ切替で回避可能。
- content の **401 は一過性トークン状態**のことがあるため、**強制 refresh＋1 回リトライ**で自己回復する
  （`getAccessToken({ forceRefresh: true })`）。2 回目も 401 なら needs-reauth。
- `files/get_temporary_link`＋`dropboxusercontent.com` 直リンクは ACAO が付かず fetch 不可のため**代替に使えない**。
- トークンは短命のアクセストークンで、HTTPS のクエリに載るのみ。PKCE public client ゆえ秘密ではない。
- 本修正は v0.2.1（未リリース）に同梱。CSP 変更は不要（宛先は `content.dropboxapi.com`＝`connect-src` に既存）。

## 成果物
- 変更: `src/adapters/DropboxAdapter.ts`（cors-hack＋401 リトライ）、`src/adapters/oauth/tokenStore.ts`
  （`TokenProvider` に `forceRefresh`）、`src/services/SettingsService.ts`（`dropboxTokenProvider` の forceRefresh）、
  `tests/helpers/dropboxMock.ts`、`tests/adapters/dropbox.test.ts`、`docs/design/05-storage-adapter.md`
- 新規: `docs/history/2026-06-18-dropbox-content-cors.md`（本ファイル）
