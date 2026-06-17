# 2026-06-17 Phase 1 同期エンジン（core）＋InMemory＋6 シナリオ

## 日付
2026-06-17

## 依頼内容
- 「phase1 に入りましょうか」。Phase 1（設計書 17.1）の実装。
- 着手前の確認で以下を決定:
  - 作業ブランチ: `feature/sync-engine`（設計書 17・Git Flow 準拠。branch-policy ガードを通過し develop へマージ可能）。
  - 進め方: **Phase 1 を一括実装 → まとめてレビュー**（Phase 0 と同じ）。
  - 完了後: レビュー反映後に **PR（`feature/sync-engine → develop`）まで作成**（マージはしない）。

## 対応概要
要件「同期エンジン仕様／テストすべき並行シナリオ」と設計書 04/16/05/03 を正本として、
**UI 非依存の純 TS 同期エンジン**・**InMemory アダプタ**・**全シナリオ green** を実装した（UI 変更なし）。

### `src/core/`（設計書 04 全節）
- `serialize.ts` — 決定的シリアライズ。キー辞書順・`undefined` 除去・`-0`→`0`・`NaN`/`Infinity` 拒否・
  `Snapshot.todos` を id 昇順配列に正規化。**マージコミット（parents≥2）の blob は `parents`＋`snapshot` の
  純関数**（`deviceId` 非格納・`timestamp`＝親 timestamp の最大）＝同時同期でも単一先端へ収束（§4.1）。
- `hash.ts` — SHA-256（64 桁 hex 小文字）＋再ハッシュ検証 `verify`（不一致は `IntegrityError`）。
- `objects.ts` — blob のエンコード/デコード・種別判別・鍵生成（`objKey`/`headKey`）。
  マージコミット blob は `deviceId` 非格納のためデコード時は `''` を補う（権威 deviceId はサイドカー＝Phase 1 未使用）。
- `dag.ts` — 先端導出（`deriveHeads`：参照されないコミット、hash 昇順で安定）・祖先探索（`ancestors`）・
  LCA（`lca`：極大共通祖先を `(timestamp, hash)` の全順序で一意化。共通祖先ゼロは `null`）。advisory HEAD 非依存。
- `merge.ts` — フィールド単位 3-way（`mergeField`：片側変更は自動採用／両側別値は競合・暫定 left）・
  `tags` の集合 3-way（`mergeSet`：競合化しない）・**edit vs delete を `deleted` 競合として扱う（自動解決しない）**・
  メタ（`version`/`updatedAt`）は最大・`merge3`／`merge3NoBase`（base 不在のフォールバック）。
- `sync.ts` — `syncOnce`（先端再導出 → fork はフィールド単位 3-way でマージ → **オブジェクト先・advisory HEAD 後**で
  publish。3 先端以上は hash 昇順に 2 つずつ畳み込み）・`publishHead`（マージ無し publish にも使用）。
- `index.ts` — 公開境界の barrel（他レイヤは barrel 経由で import）。

### `src/adapters/`（設計書 05：IF＋InMemory）
- `StorageAdapter.ts` — 共通 IF を再公開（型の単一の真実は `model/types.ts`）。
- `InMemoryAdapter.ts` — 純メモリ。`putIfAbsent`（CAS、`opts.cas=false` で無効化＝CAS 非依存テスト用）・
  `lazyList`（put 直後に list へ出さない遅延整合の擬似）・`clone()`（収束テストで同一 fork を独立にマージ）。

### `src/model/types.ts`
- `Clock` 型を追加（`now(): Millis`）。core/sync は `Date.now()` を直呼びせず時刻注入で決定性を担保（§16.1）。

### `tests/`（設計書 16）
- `tests/core/scenarios.test.ts` — **6 並行シナリオ #1〜#6**（別項目／fork 3-way／別フィールド自動／同フィールド競合／
  edit vs delete／古い状態からの上書き）＋ CAS 非依存・遅延整合・`SyncResult` 形状。
- `tests/core/{serialize,hash,dag,merge,convergence}.test.ts` — 単体（serialize 決定性・再ハッシュ検証・
  先端導出/祖先/LCA tie-break・mergeField 決定表/mergeSet/edit-vs-delete/merge3NoBase・**マージコミット収束**）。
- `tests/adapters/contract.test.ts` — アダプタ契約（往復・未存在 null・put べき等・前方一致・delete・putIfAbsent）。
- `tests/helpers/{device,factories,storage}.ts` — `Device` ハーネス・`makeDevice`/`fixedClock`/`seedSnapshot`/`makeTodo`・
  InMemory ファクトリ。tests/core は core・model・helpers のみ参照（実アダプタ/IDB/UI に依存しない＝§16.4 の意図）。

### 検証
- `typecheck` / `lint`（依存方向ガード含む） / `test`（**61 件すべてパス**：新規 47＋既存 14） / `build` すべて green。
- TS 5.7 の `Uint8Array<ArrayBufferLike>` と `crypto.subtle.digest`（`BufferSource`）の不整合を、
  `hash` で ArrayBuffer 裏付けのコピーを渡して解消。
- core テストは `crypto.subtle` を使うため各ファイル冒頭で `// @vitest-environment node` を指定。

## 決定事項
- 作業ブランチは `feature/sync-engine`（セッション既定の `claude/blissful-lamport-6pjsj4` ではなく、Git Flow・
  branch-policy ガード準拠の命名を採用。ユーザー承認済み）。
- マージコミットは blob から `deviceId` を除外＝決定的。これにより同時同期でも単一先端へ収束（マージ合戦が起きない）。
- `deleted` の食い違い（edit vs delete）は汎用 3-way で自動採用せず、`deleted` フィールドの競合として明示検出する
  （受け入れ基準「黙って失われない」に忠実。設計書 §4.5 の擬似コードはこの特別扱いをレビューで追記予定）。
- `tests/core` は InMemory を tests/helpers 経由で使い、実アダプタ/IDB/UI を直接 import しない構造とする。
- 設計準拠レビューは別途サブエージェントに依頼し、指摘反映は「review-fixes」コミットで行う（Phase 0 と同じ進め方）。

## 成果物
- 新規: `src/core/{serialize,hash,objects,dag,merge,sync,index}.ts`
- 新規: `src/adapters/{StorageAdapter,InMemoryAdapter}.ts`
- 更新: `src/model/types.ts`（`Clock` 追加）
- 新規: `tests/core/{serialize,hash,dag,merge,scenarios,convergence}.test.ts`
- 新規: `tests/adapters/contract.test.ts`
- 新規: `tests/helpers/{device,factories,storage}.ts`
- 証跡: `docs/history/2026-06-17-phase1-sync-engine.md`（本履歴）
