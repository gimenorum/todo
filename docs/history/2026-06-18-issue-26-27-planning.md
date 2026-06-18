# 2026-06-18 Issue #26・#27 修正方針の確定（実装は次セッション）

## 日付
2026-06-18

## 依頼内容
- 本リリース（v1.0 / GA）前に解決したい bug を 2 件起票したので対応したい。両方とも本リリース前に解決する。
  - **#26 ページリロードで競合が消える**（データ正しさ）。
  - **#27 同期まで時間がかかる**（性能）。Dropbox の挙動も確認すること。issue コメントの原因（`drive/v3/files` への過剰アクセス）はあくまで推測なので、安全に可能ならそれ以上踏み込んでよい。
- リリースは **別々**（独立ブランチ・PR・プレリリース）。順序は #26 → #27。
- **本セッションでは実装を行わず、証跡のみをコミットする**（ユーザー指示）。

## 対応概要
- 一次資料（`src/core/sync.ts`・`src/services/SyncService.ts`・`src/syncRuntime.ts`・`src/adapters/*`・`src/store/*`・`tests/*`）を読み、両 issue の原因を確認。
- 修正プランを作成し、ユーザー承認を得た（ExitPlanMode 承認）。
- #27 の「push 削減をどこで行うか」を確認し、**アダプタ層のみ（コア同期エンジンは不変）** に決定。
- 実装・テスト・コミット・push・PR・マージ・リリースは **次セッション以降**、各ステップでユーザーの OK を得てから着手する。

## 決定事項

### 全体
- バージョン・順序: #26 → **v0.4.2**、その後 #27 → **v0.4.3**（現行 `package.json` は 0.4.1）。
- 各修正は独立ブランチ／PR（→ develop → main）／プレリリース。`hotfix/*` ブランチを使う（CI の branch-policy が develop へ `feature/*|hotfix/*` のみ許可するため）。
- 各外向き操作（コミット／push／PR／マージ／リリース）は **ユーザーの明示 OK 後** に着手。
- CLAUDE.md の「履歴は作業と同一コミット（履歴単独コミットを作らない）」は、本セッションに限りユーザー指示「証跡のみコミット」により **例外** とする。

### #26 ページリロードで競合が消える（→ v0.4.2, branch `hotfix/conflict-persist-reload`）
- **原因（確認済み）**: 競合 `FieldConflict[]` は `SyncService.activeConflicts`（メモリのみ／`SyncService.ts:108,130`）に保持し IndexedDB 未永続。`syncOnce` は競合時も「左採用のマージコミット」を生成・publish（`core/sync.ts:117-135`）し `persistLocalState` で先端 1 本化。リロード → 新 `SyncService`（`activeConflicts=[]`）＋先端 1 本 → 競合なし再導出（`sync.ts:81-88`）→「解決する」ボタン消滅 → 左の値が黙って確定（受け入れ基準「黙って失われない」に反する）。
- **修正方針**: 自動マージ（左を暫定表示）の挙動は変えず、「未解決」状態だけ IDB に永続化して起動時に復元・再表示する（最小・低リスク）。
  - `src/model/constants.ts`: `META_KEY.conflicts` 追加。
  - `src/store/metaStore.ts`: `getConflicts()/setConflicts()`（`STORE.meta` に格納。`getHead/setHead` と同型。`FieldConflict` は直列化可能。`DB_VERSION` は据置）。
  - `src/services/SyncService.ts`: `conflictsLoaded` フラグ＋遅延ロード、union 後／`resolveConflict` の filter 後に `setConflicts`、`restoreConflicts()` を新設し I/F に追加（永続競合をロードし、ローカル todos から `buildOutcome` を emit してオフライン起動でも導線を即復元）。
  - `src/syncRuntime.ts`: `buildRuntime()` 内・初回同期前に `restoreConflicts()`。
  - `src/services/SettingsService.ts`: `disconnect()` で `setConflicts([])`（再連携で古い競合が蘇らないように）。
  - テスト: `tests/services/syncService.test.ts` に ①競合検出→別インスタンスで復元 ②`resolveConflict` 後は復元されない、の 2 ケース。
  - ドキュメント: `docs/design/10-conflict-ui.md` に永続・復元方針を追記。`package.json` 0.4.1 → 0.4.2。

### #27 同期まで時間がかかる（→ v0.4.3, branch `hotfix/sync-perf`、#26 マージ後の develop から分岐）
- **原因（確認済み）**: `pushReachable`（`sync.ts:224-244`）が 1 同期で到達可能な全 object を毎回 `adapter.put` し直す。その「1 操作あたりのコスト」がアダプタ実装で過大。
  - Google Drive: `get`=`findId`+download の 2 リクエスト、`put`=毎回 `findId`（`objects/*` は不変なのに）、`list`=全件取得だが id 未キャッシュ。
  - Dropbox: findId 問題は無い（パス直指定で各 1 リクエスト）が、`put`=`mode:overwrite` で毎回フル本文を再アップロード（既存の不変 `objects/*` も上げ直す）。
- **方針（確定・ユーザー決定）**: **アダプタ内部のキャッシュだけで対処し、コア同期エンジン（`core/sync.ts` の `pushReachable`/`syncOnce`/`merge3`）には手を入れない。** 体感の遅さ＝ネットワーク往復はアダプタ層で「差分のみ」に縮められ、収束テスト（`tests/core/convergence・scenarios`）の回帰リスクを負わない（コアでの枝刈り案は追加で減るのがメモリ上の walk のみ＝体感差なし）。
  - Google Drive — name→id キャッシュ（`list` が全件取得時に全 id を無料でウォーム、`findId` はキャッシュ優先・ミス時のみ `authedFetch` 経由＝401 リトライ済みで検索、`createMultipart` で id 登録、`delete` で除去）。⇒ `get` 2→1、既存 `objects` の `put` は 0 リクエスト。
  - Dropbox — 既知 object 集合（Set）。`put` は `objects/*` が既知ならアップロード省略・成功後 add、`get` 成功で add、`delete` で除去。`heads/*` は常にアップロード。**事前 list はしない**（`content 401 リトライ` テストの auth 経路に干渉しないため）。`objects/*` は不変かつ非削除なので偽陽性は起きない。
  - テスト: 既存の契約テスト（`tests/helpers/contract.ts`）・`googledrive.test.ts`・`dropbox.test.ts` は観測結果不変で緑のまま。呼び出し回数の回帰防止テストを各アダプタに 1 ケース追加。
  - ドキュメント: `docs/design/05-*`（adapters 章）に「アダプタ内キャッシュで差分 push／コアは不変」を追記。`package.json` 0.4.2 → 0.4.3。

## 成果物
- `docs/history/2026-06-18-issue-26-27-planning.md`（本ファイル）。
- コード・テスト・設計・バージョンの変更は **なし**（次セッション以降に実装）。
- 承認済みプラン本体は実行環境のプランファイル（リポジトリ外・揮発）にあり、要点は本証跡へ転記済み。
