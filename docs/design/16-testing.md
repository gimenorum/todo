# 16. テスト設計

> 要件トレース: requirements.md「実装フェーズ」「受け入れ基準」「テストすべき並行シナリオ」
> 状態: 実装済（Phase 1／Phase 2 のアダプタ・services・store テスト） ／ 実装フェーズ: 1→2

中核（[04](./04-sync-engine.md)）の正しさを **Vitest で決定的に**検証する。テストは UI/IndexedDB に依存しない。

## 16.1 決定性の 3 本柱

| 柱 | 方法 |
|---|---|
| deviceId 固定 | ヘルパ `makeDevice(id)` で commit の `deviceId` を固定（通常コミットのタイブレーク再現性） |
| InMemory アダプタ | ネットワーク無し。必要なら遅延整合フラグで現実をシミュレート（[05](./05-storage-adapter.md)） |
| 時刻注入 | `timestamp`/`updatedAt` は `Clock`（`now: () => Millis`）注入。**core 内で `Date.now()` 直呼び禁止** |

ヘルパは `tests/helpers/`（`makeDevice()`, `fixedClock()`, `seedSnapshot()`）。

## 16.2 6 並行シナリオ（要件「テストすべき並行シナリオ」）

すべて InMemory 上で決定的に。`#` は要件のシナリオ番号。

| # | セットアップ | 期待 |
|---|---|---|
| 1 | 2 端末がオフラインで**別々の項目**を編集 | 両方の TODO が merged に残る・競合 0 |
| 2 | 同一 parent から両端末が同時 commit（fork） | LCA からの 3-way で一貫・決定的な結果 |
| 3 | 同一 TODO の**異なるフィールド**を両端末で編集 | 自動マージ・競合 0 |
| 4 | 同一 TODO の**同じフィールド**を別値に編集 | `conflicts` に該当・per-todo `conflict`・自動解決しない |
| 5 | 片方が編集・他方が削除（edit vs delete） | **競合として検出**（`deleted` 競合）。UI は「編集版を残す／削除を適用」（[04 §4.5](./04-sync-engine.md)） |
| 6 | 古い状態からの上書き | `deriveHeads` で検出 → マージしてから反映・変更が消えない |

> 各テストは「セットアップ → `syncOnce` を両端末で交互に実行 → `SyncResult`（mergedSnapshot / conflicts / picked）を assert」。`picked`（base/left/right）も検証し、LCA 選択の決定性を固定する。

## 16.3 追加の単体テスト

| テスト | 検証内容 | 根拠 |
|---|---|---|
| serialize 決定性 | 同内容（キー順・挿入順違い）→ 同バイト列・同ハッシュ | [04 §4.1](./04-sync-engine.md) |
| **tags 集合マージ** | 両端末が**別タグを追加/削除** → 和・差で解決・**競合 0**（`FieldConflict` に出ない） | [04 §4.5](./04-sync-engine.md) #7 |
| **マージコミット収束** | 両端末が push 前に**同じ fork を各自マージ** → 同一マージコミット（同一ハッシュ）→ 単一先端に収束（マージ合戦が起きない） | [04 §4.1/§4.6](./04-sync-engine.md) ② |
| 再ハッシュ検証 | 改竄バイト列で `IntegrityError`。**マージコミット blob（deviceId 非含）**も対象 | [04 §4.2](./04-sync-engine.md) |
| 先端導出 | 単線/fork/孤立を正しく分類 | [04 §4.3](./04-sync-engine.md) |
| LCA tie-break | 交差マージで極大共通祖先から決定的に 1 つ選ぶ | [04 §4.4](./04-sync-engine.md) |
| CAS 非依存 | `putIfAbsent` を無効化しても全シナリオ green | 受け入れ基準 |
| アダプタ契約 | list/get/put/delete のべき等・前方一致など | [05 §5.6](./05-storage-adapter.md) |

## 16.4 テストの不変条件

- **`tests/core/` は `core/`・`model/`・`tests/helpers/` のみに依存する**（[02 §2.3](./02-directory.md)）。実アダプタ（Dropbox/Drive）・IDB・UI には直接・間接とも依存させない。テスト用 InMemory は `tests/helpers/`（`storage.ts`）経由で供給し、`tests/core` から `src/adapters` を直接 import しない（InMemory は純メモリで決定性を損なわない）。
- 乱数・時刻・端末 ID をすべて注入し、フレーキーを排除（同じ入力→同じ結果）。
- マージコミットは deviceId 非含＝決定的なので、収束テストは deviceId を別々にしても同一ハッシュになることを確認する。
- Phase 1 の完了条件＝**6 シナリオ green**＋上記単体 green（要件「実装フェーズ」）。

## 16.5 実アダプタ（Dropbox/Drive）の扱い

- 実 API は単体の決定的テストに載せない。契約テストはモック/録画で代替し、**手動 E2E**（接続→同期→別端末反映→競合）をチェックリスト化して各 Phase の受け入れ確認に用いる。
- **Phase 2 のテスト構成**: 契約スイートを `tests/helpers/contract.ts` に共有化し、InMemory と **Dropbox（モック fetch `tests/helpers/dropboxMock.ts`）** に同じ契約を適用。PKCE は純関数として検証（RFC 7636 既知ベクトル）。store 層（`objects`/`tokens`/`db` v2）は **`fake-indexeddb`**（`vite.config.ts` の `setupFiles`）で検証。SyncService/Scheduler は InMemory＋`Device` ハーネス＋fake timers（ちらつき 400/500ms・デバウンス・interval・dedup）。
- **Phase 2 手動 E2E チェックリスト**（実 Dropbox／サンドボックス外でユーザーが実施。`VITE_DROPBOX_APP_KEY` 設定とアプリ登録が前提）:
  1. 設定で「保存先に接続」→ 認可 → 復帰で `idle`、設定が「接続済み（Dropbox）」。
  2. タスク作成 → 約 2 秒で push。別端末（別ブラウザ）で接続 → pull で同タスクが出る。
  3. 両端末オフラインで別フィールド編集 → オンライン → 自動マージ・競合 0。
  4. 同一フィールドを別値に編集 → per-todo「要解決」＋「同期不具合を解決する」→ merge 画面で二択 → 解決で competition 解消。
  5. edit vs delete → `deleted` 競合 →「編集版を残す／削除を適用」の二択。
  6. オフライン→オンラインでバナー＋同期。トークン失効 → `needs-reauth`＋設定タブにバッジ。
  7. 複数タブで 1 つを編集 → 他タブが BroadcastChannel で再 materialize。
  8. iOS: ホーム追加 → IDB クリア（ローカル消失）を模す → 起動で `heads/` 起点に復旧（[06 §6.4](./06-local-store.md)）。
