# 2026-06-18 Dropbox 認証後の「同期エラー」原因調査と修正（スコープ不足の検出・明示要求）

## 日付
2026-06-18

## 依頼内容
- 「Dropbox の認証後、タスク作成をしたところ『同期エラー』と出ています」。原因の調査と修正。

## 対応概要
- 症状の切り分け: UI の「同期エラー」は `GlobalSyncStatus = 'error'`（`StatusIndicator`）。
  `SyncService.classifyError` は `AuthError→needs-reauth`／`navigator.onLine===false→offline`／
  それ以外→`error` に分類するため、**401 以外の HTTP 失敗 or 例外**が初回の Dropbox 呼び出しで起きていると判断。
- 原因（最有力）: `connectDropbox` が認可 URL に `scope` を渡しておらず、Dropbox アプリ側で
  `files.*` 権限が有効化されていないとトークンにファイル操作権限が付かない。実 Dropbox では
  最初の `list_folder`／`upload` が **403 `missing_scope`** を返す。403 は 401 ではないため
  `needs-reauth` にならず汎用 `error`（「同期エラー」）に落ちていた。
- 二次的問題（診断容易性）: `SyncService.runOnce` の catch が元エラーを**ログにも残さず握り潰して**
  おり、「同期エラー」としか分からなかった。
- 修正:
  1. **必要スコープを明示要求**（`SettingsService`）: `files.metadata.read files.content.read
     files.content.write` を認可 URL の `scope` に指定。
  2. **403 missing_scope を権限不足として検出**（`DropboxAdapter`）: 401 以外の失敗を本文付きで
     投げる共通 `fail()` を追加。`403 + missing_scope` は `onAuthError()` を呼び `AuthError`
     （UI: 要再接続）として投げ、再連携を促す。その他は HTTP ステータス＋本文を含めて投げる。
  3. **原因をログに残す**（`SyncService`）: 汎用 `error` 分類時に `console.error` で元エラーを出力。
- テスト: `tests/adapters/dropbox.test.ts` に「403 missing_scope→AuthError＋onAuthError」「5xx は本文を
  含むエラー」を追加。
- 設計書: `docs/design/05-storage-adapter.md` §5.4 に必要 OAuth スコープと「Permissions タブで有効化／
  変更時は再連携」の運用注意を明記。

## 決定事項
- Dropbox の**必要 OAuth スコープ**は `files.metadata.read`／`files.content.read`／`files.content.write`
  の 3 つ（最小権限）。`scope` に明示要求し、アプリの Permissions でも同じ権限を有効化する運用とする。
- `missing_scope`（403）は再連携で解決するため **`needs-reauth`（要再接続）** 扱いにする
  （汎用「同期エラー」にしない）。
- 同期失敗の原因は今後ブラウザ開発者コンソールに必ず出す（握り潰さない）。
- 作業ブランチは `claude/blissful-lamport-6pjsj4`（ベース＝最新 `origin/develop` 0e8f7ec＝Phase 2 マージ済）。

## 利用者側の必要対応（コード変更だけでは完結しない）
1. Dropbox App Console → 対象アプリ → **Permissions** で `files.metadata.read`／`files.content.read`／
   `files.content.write` を有効化し **Submit**。
2. 本コードを反映したビルドをデプロイ。
3. アプリで **一度「切断」してから再度「連携」**（新スコープでトークンを再取得）。

## 成果物
- 変更: `src/services/SettingsService.ts`（scope 明示）、`src/adapters/DropboxAdapter.ts`（fail()＋missing_scope 検出）、
  `src/services/SyncService.ts`（error ログ）、`tests/adapters/dropbox.test.ts`（テスト2件追加）、
  `docs/design/05-storage-adapter.md`（§5.4 スコープ明記）
- 新規: `docs/history/2026-06-18-dropbox-sync-error-scope.md`（本ファイル）
