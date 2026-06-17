# 2026-06-17 Phase 1 同期エンジン レビュー反映（deleted 規則精緻化・newHead 統一・設計整合）

## 日付
2026-06-17

## 依頼内容
- Phase 1（UI 非依存の同期エンジン）実装後、「実装と設計書の突き合わせレビュー」を実施。
- レビューで見つかった**設計書内の自己矛盾 3 点**（M1/L2/L3）について、「実装を正として設計書を更新」する前に内容を開示し、扱いをユーザーが決定する。

## 経緯
- 実装（コミット `d01b644`、`origin/feature/sync-engine` に push 済み）の状態でレビューを開始。
- 担当が「実装が正・設計書更新」を進めようとしたところ、ユーザーから「実装を正？一度内容を開示してほしい」との要請。3 件を根拠込みで開示した。
- いずれも「**設計書内の記述同士の食い違い**」であり、実装は権威ある側（決定表・確定事項・型定義・テスト方針）に従っていたことを確認。
- ユーザー決定：M1 は規則を精緻化、L2 は実装修正、L3 は設計文言を精緻化。

## 対応概要
- **M1（edit vs delete の規則精緻化）**
  - 規則を「`deleted` が食い違えば必ず競合」から、「**alive 側に内容編集があるときのみ競合（edit vs delete）。削除 vs 未編集／復活 vs 未編集は片側変更として自動適用**」へ精緻化（無用な競合を避けつつ、編集が削除で黙って消えない）。
  - 競合時の暫定は **alive（編集版）に固定**（hash 順非依存・一覧から消さない）。
  - `src/core/merge.ts`：`mergeTodo` を「内容フィールド 3-way → deleted 判定」の 2 段に再構成し、`contentChangedVsBase` を追加。
  - テスト追加：`merge.test.ts` に「削除 vs 未編集→自動適用」「復活 vs 未編集→自動適用」、`scenarios.test.ts` に「削除 vs 未編集（別項目を編集）→ 競合なしで削除適用・追加も残る」。
  - 設計書：`04 §4.5` の存在表に 2 行追加・擬似コードを精緻化（`CONTENT_FIELDS` ＋ `contentChangedVsBase`）・「設計判断（確定）」を更新。
- **L2（`SyncResult.newHead` の意味論）→ 実装修正**
  - `04 §4.6` の原典（`newHead = 同期後の先端 = target`）に実装を合わせ、単一先端時も先端を返すよう `src/core/sync.ts` を修正。**マージ発生は `picked`（マージ時のみ非 null）で判定**。
  - `03 §3.4`・`src/model/types.ts` の `newHead` コメントを「同期後の先端」に統一。先に入れていた `04 §4.6` の編集（`newHead` 条件化）は撤回（原典どおり）。
  - テスト更新：#2 再同期・遅延整合・収束を `picked`/先端一致で検証。
- **L3（`tests/core` の依存範囲）→ 文言精緻化**
  - 実装は維持（InMemory は `tests/helpers/storage.ts` 経由で供給し、`tests/core` は `src/adapters` を直接 import しない＝実アダプタ/IDB/UI 非依存）。
  - 設計文言を精緻化：`16 §16.4`・`02 §2.3` を「`core`・`model`・`tests/helpers` のみ／実アダプタ（Dropbox/Drive）・IDB・UI には直接・間接とも非依存」に。
- 章ステータス更新：`03/04/16`＝実装済（P1）、`05`＝一部実装済（P1）。README 章一覧・各章ヘッダも更新。
- 検証：typecheck / lint / test（**64 件**）/ build すべて green。

## 決定事項
- **edit vs delete** は「alive 側に内容編集がある場合のみ」競合。削除/復活 vs 未編集は自動適用（競合にしない）。競合時の暫定は alive（編集版）。
- **`SyncResult.newHead`** は「同期後の先端」。マージ発生は `picked` で判定する。
- **InMemory アダプタ**は `src/adapters` に置き、`tests/core` へはヘルパ経由で供給（実アダプタ/IDB/UI には非依存）。
- 設計書内の記述矛盾は、より権威ある側（決定表・確定事項・型・テスト方針・受け入れ基準）に合わせて解消する。
- 相談・確定が要る論点は、実装を正と決め打ちせず、内容を開示してからユーザー判断を仰ぐ。

## 成果物
- 修正: `src/core/merge.ts`, `src/core/sync.ts`, `src/model/types.ts`
- テスト: `tests/core/merge.test.ts`, `tests/core/scenarios.test.ts`, `tests/core/convergence.test.ts`
- 設計書: `docs/design/02-directory.md`, `03-data-model.md`, `04-sync-engine.md`, `05-storage-adapter.md`, `16-testing.md`, `README.md`
- 証跡: `docs/history/2026-06-17-phase1-review-fixes.md`（本履歴）
