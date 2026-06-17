# 18. 未確定事項・要決定リスト

> 要件トレース: requirements.md「デプロイ / ホスティング」「同期エンジン仕様」「同期の設定・タイミング」「ストレージアダプタ」
> 状態: 進行中 ／ 実装フェーズ: 随時

確定し次第このファイルを更新し、該当章へ反映する。`推奨` は本設計書の提案（最終決定はレビューで）。

## 18.1 確定済み（2026-06-17）

| # | 項目 | 決定 |
|---|---|---|
| 1 | 本番オリジン | **固定しない＝オリジン非依存**。manifest は相対 `scope`/`start_url`、OAuth リダイレクトは `window.location.origin` 基準、CSP は保存先 FQDN＋`'self'`。リダイレクト URI のプロバイダ登録は **Phase 2/3 にユーザーが実施**（[12](./12-pwa-sw-csp.md)・[05](./05-storage-adapter.md)・[15](./15-build-deploy-ci.md)） |
| 2 | GitHub Pages のサブパス | **Vite `base` を相対（`./`）**にしてサブパス非依存（#1 に伴い解消） |
| 6 | edit vs delete | **`deleted` をフィールド競合**として扱う。競合 UI は「**編集版を残す／削除を適用**」の二択（[04 §4.5](./04-sync-engine.md)・[10](./10-conflict-ui.md)） |
| 7 | tags のマージ | **集合 3-way**（追加=和・削除=反映）（[04 §4.5](./04-sync-engine.md)） |
| 8 | 複数 LCA の tie-break | **`(timestamp, hash)` の全順序**で一意化（[04 §4.4](./04-sync-engine.md)） |
| 9 | 同期既定値 | **pull 間隔 = 5 分／push デバウンス = 2 秒**（[11](./11-sync-triggers.md)・[03](./03-data-model.md)） |

## 18.2 未決（残）

| # | 項目 | 影響箇所 | 状態 |
|---|---|---|---|
| 3 | Dropbox OAuth クライアント ID（public） | `DropboxAdapter` | 未発行。**Phase 2 までにユーザーが発行＋リダイレクト URI 登録** |
| 4 | Google OAuth クライアント ID | `GoogleDriveAdapter` | 未発行。**Phase 3 までにユーザーが発行＋リダイレクト URI 登録** |
| 5 | CSP の保存先 FQDN 列挙 | `index.html` `<meta>` | 方針は確定（`'self'`＋保存先）。**残: Dropbox/Google の具体 FQDN を列挙**（[12](./12-pwa-sw-csp.md)） |
| 10 | アイコン一式・テーマカラー | manifest（[12](./12-pwa-sw-csp.md)） | **要用意** |
| 11 | 言語リスト | i18n（[08](./08-routing-views.md) 設定） | 後回し（要件「設定画面」・Phase 6） |
| 12 | `skipWaiting`/`clients.claim` の採否 | `sw/sw.ts`（[12](./12-pwa-sw-csp.md)） | 既定は安全側（次回起動で切替）。実装時確定 |

## 18.3 設計判断として既に固定したもの（参考）

レビューで覆る可能性はあるが、本設計書では以下を既定として進める（根拠は各章）。

- マージ対象 `TodoField` は 7 つに限定（`createdAt`/`order`/`updatedAt`/`version` を除外）— [03 §3.2](./03-data-model.md)。
- スナップショットは直列化時に id 昇順配列へ正規化 — [04 §4.1](./04-sync-engine.md)。
- 書き込みは「オブジェクト先・advisory HEAD 後」— [04 §4.6](./04-sync-engine.md)。
- BroadcastChannel は「変わった通知」のみでペイロードを載せない — [06 §6.3](./06-local-store.md)。

## 18.4 レビュー反映による設計改訂（2026-06-17）

設計レビューで判明した不具合・整合性指摘を反映し、以下を確定した（詳細は各章）。

- **① tags の集合 3-way**: `mergeTodo` は tags を `mergeSet` で合成し、`mergeField` の比較は値等価 `valueEq`（配列＝要素集合）に。tags は `FieldConflict` に出ない（[04 §4.5](./04-sync-engine.md)・[03 §3.4](./03-data-model.md)）。
- **② マージコミットの決定化**: parents≥2 の blob は `deviceId` 非格納・`timestamp`=親最大。同一マージは同一ハッシュに dedup され、同時同期でも単一先端へ収束（マージ合戦の解消）。`deviceId` を保持するなら blob 外サイドカー（[04 §4.1/§4.2](./04-sync-engine.md)・[03 §3.3](./03-data-model.md)）。
- **③ LCA は極大共通祖先**: `ancestors` は集合（depth 廃止）、`lca` は極大共通祖先を `(timestamp, hash)` で tie-break。時計ずれで無用な競合は出得るが収束・非消失は保つ（[04 §4.4](./04-sync-engine.md)）。
- **④ 孤立先端の回復**: `heads/` 起点ロードに整合させ、孤立先端は作成端末の再 publish で回収（即時 peer 回復は `objects/` 走査が代替）（[04 §4.6](./04-sync-engine.md)・[05 §5.2](./05-storage-adapter.md)・[06 §6.4](./06-local-store.md)）。
- **⑤ オリジン非依存**: requirements デプロイ節も含めオリジン非依存に統一（#1）。
- **インポートの意味論**: 共通履歴を持たないため no-base 解決（同 id=recency、異 id=両立）。フィールド競合は出ない（[13 §13.2](./13-export-import.md)）。
- **命名統一**: `merge3NoBase`（snapshot 版）/ `resolveNoBase`（per-todo 版）。
- **Phase 6 暗号化の前提**: 内容アドレス指定を壊さない決定的暗号化（[14 §14.2](./14-security.md)）。
