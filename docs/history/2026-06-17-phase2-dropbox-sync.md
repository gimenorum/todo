# 2026-06-17 Phase 2 — Dropbox 連携＋実同期（feature/dropbox-sync → v0.2.0）

## 日付
2026-06-17

## 依頼内容
- 「phase2 に入りましょう。現在既に develop にマージコミットがありますが、これも今回 phase の対象とします」。
- Phase 2 = `feature/dropbox-sync` / `v0.2.0`「Dropbox 連携＋実同期」を実装する（設計 05/06/09/10/11）。
- develop に既にあるリリース自動化のマージコミットも v0.2.0 に同梱する。

## 決定事項（着手時）
- **App key（Dropbox OAuth クライアント ID）**: ビルド時 env `VITE_DROPBOX_APP_KEY`
  （ローカル `.env.local` / 本番は GitHub Actions のリポジトリ変数）。PKCE public client なので秘密でない。
  Dropbox アプリ発行とリダイレクト URI 登録（`window.location.origin` 基準）はユーザーが実施。
- **デリバリ**: develop へ 3 つの増分 PR に分割（①ストレージ基盤 ②同期オーケストレーション ③UI）。
  最後に `package.json` を 0.2.0 にして develop→main で `v0.2.0` リリース。
- 実装方針: LocalState は services 層保持・`syncOnce` がミューテート／adapters は store/idb 非依存で
  TokenProvider 注入／state 反映はコールバック経由の単一経路／ちらつき(400/500ms)は services／
  DOM イベント購読は composition root／トークンは offline スコープで取得し 401 時 refresh、失敗で needs-reauth。
- `core/` は無変更（Phase 1 の 6 シナリオを保全）。

## 対応概要

### PR1 — ストレージ基盤＋Dropbox アダプタ/OAuth
- `src/model/types.ts`: `SyncProvider`・`StoredToken` を追加（OAuth トークンの型）。
- `src/model/constants.ts`: `DB_VERSION` 1→2、`STORE.objects`/`STORE.tokens`、`META_KEY.head` を追加。
- `src/store/db.ts`: IndexedDB スキーマに `objects`（key=hash, index kind）と `tokens`（key=provider）を追加。
  `upgrade` は contains ガードで冪等（v1→v2 は追加のみ・既存ストア不変）。
- `src/store/objectStore.ts`（新）: content-addressed blob 複製の CRUD（get/put/putObjects/getAllObjects/listObjectHashes）。
- `src/store/tokenStore.ts`（新）: OAuth トークンの永続（get/put/deleteToken、同期しない）。
- `src/store/metaStore.ts`: advisory HEAD の `getHead`/`setHead` を追加。
- `src/adapters/oauth/pkce.ts`（新）: PKCE(S256) の純ロジック（verifier/state 生成・challenge・認可 URL 組立・
  `redirectUri()` オリジン非依存・`parseCallback`）。
- `src/adapters/oauth/tokenStore.ts`（新）: トークン交換/更新の fetch（`exchangeCodeForToken`/`refreshAccessToken`）と
  `TokenProvider` IF（adapters は store/idb を import せず注入で受ける）。
- `src/adapters/DropboxAdapter.ts`（新）: `StorageAdapter` 実装。upload/download/list_folder(+continue)/delete_v2 へ写像、
  404/409→null・冪等、401→`onAuthError`＋throw。`putIfAbsent` は実装しない（CAS 非依存）。
- テスト: 契約スイートを `tests/helpers/contract.ts` に共有化し InMemory＋Dropbox(モック fetch)で再利用
  （`tests/helpers/dropboxMock.ts`）。`tests/adapters/{dropbox,oauth/pkce}.test.ts`、`tests/store/{db,objectStore,tokenStore}.test.ts`。
  `fake-indexeddb` を devDep に追加し `vite.config.ts` の `setupFiles` に登録。
- 検証: `npm run lint`／`typecheck`／`test`（85 件 green、Phase 1 の 6 シナリオ回帰なし）／`build` すべて green。

### PR2 — 同期オーケストレーション（予定）
### PR3 — UI ＋ composition root ＋ CSP ＋ 設計書反映（予定）

## 成果物（PR1）
- 変更: `src/model/types.ts`, `src/model/constants.ts`, `src/store/db.ts`, `src/store/metaStore.ts`,
  `tests/adapters/contract.test.ts`, `vite.config.ts`, `package.json`, `package-lock.json`
- 新規: `src/store/objectStore.ts`, `src/store/tokenStore.ts`,
  `src/adapters/DropboxAdapter.ts`, `src/adapters/oauth/pkce.ts`, `src/adapters/oauth/tokenStore.ts`,
  `tests/helpers/contract.ts`, `tests/helpers/dropboxMock.ts`,
  `tests/adapters/dropbox.test.ts`, `tests/adapters/oauth/pkce.test.ts`,
  `tests/store/db.test.ts`, `tests/store/objectStore.test.ts`, `tests/store/tokenStore.test.ts`
- 証跡: `docs/history/2026-06-17-phase2-dropbox-sync.md`（本ファイル）
