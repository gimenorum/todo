# 2026-06-18 Phase 4: 競合解決 UI（WinMerge ライク / v0.4.0）

## 日付
2026-06-18

## 依頼内容
- 「次に進めましょうか」— v0.3.0（Phase 3 / Google Drive）リリース後、ロードマップ（`docs/design/17-phase-map.md`）の
  次フェーズへ。AskUserQuestion で **Phase 4 = 競合解決 UI** を選択。tag `v0.4.0` / branch `feature/conflict-ui`。

## 対応概要
- Phase 2 の暫定競合解決（per-todo の全体二択「こちら/もう一方」）を、**WinMerge ライクなフィールド単位の解決画面**へ置換
  （ch.10 §10.2）。受け入れ基準（17.2 Phase 4）: 同一フィールド競合をこの画面で解決／確定でマージコミット／黙って失われない。
- **既存資産の再利用で省コスト化**:
  - 確定の収束メカニズムは Phase 2 の `updateTodo(patch)→runOnce` 経路を流用（マージコミット生成後に相手先端が祖先化して
    base 化し、選択値が再競合せず収束）。`core/merge.ts`（競合検出）・ルート `#/todo/:id/merge`・`FieldConflict` 型・`Route`
    は変更なし。
  - フォーカス保持は `TodoEditView` 方式（本体で 1 回構築・`update(state)` は競合消滅時のみ完了表示へ）を踏襲。
  - 整形ヘルパ（`toDateInputValue`/`fromDateInputValue`/`parseTags`）・優先度定数を流用。
- **新規**:
  - `src/ui/components/TextDiff.ts`: 依存ゼロの LCS 行差分（`diffLines`/`renderTextDiff`）。メモの差分表示用（§10.3）。
- **変更（中核）**:
  - `src/ui/views/ConflictMergeView.ts`: 全面書き換え。競合フィールドごとに 2 ペイン（この端末/相手）＋直接編集
    （型別 input/select/textarea）。メモは `renderTextDiff` を併置。非競合の内容フィールドは muted で一致表示。
    deleted 競合は「編集版を残す/削除を適用」の二択。下部にマージ結果プレビュー（選択/入力でライブ更新）。
    純関数 `buildPatch`/`parseFieldInput` を export（テスト用）。
  - `src/services/SyncService.ts`: `resolveConflictProvisional(choice)` を `resolveConflict(patch: TodoPatch)` に
    リネーム＋一般化（choice→patch 変換を UI へ移譲）。`ConflictChoice` 型を削除。
  - `src/state/actions.ts`・`src/syncRuntime.ts`: 解決アクションを patch 受け取りへ。`ConflictChoice` import 削除。
  - `src/ui/layout/AppShell.ts`: merge ルートのコメントを Phase 4 へ。
  - `styles/components.css`: 2 ペイングリッド・競合行強調・選択ペイン強調・テキスト差分・プレビューのスタイル。
  - `tests/services/syncService.test.ts`・`tests/services/syncScheduler.test.ts`: 新 API へ追従。
  - `package.json`: 0.3.0 → 0.4.0。設計書 `10-conflict-ui.md`/`08-routing-views.md` の状態を Phase 4 実装済へ。
- **検証**: `typecheck`／`lint`／`test`（138 passed・+15＝textDiff 6 / conflictMerge 9）／`build` すべて green。

## 決定事項
- 解決アクションの patch 型は `model/types` の `Todo` からローカル定義（ui→services 依存を持ち込まない／eslint レイヤ規約）。
  `SyncService`/`actions`/`syncRuntime` 側は `TodoPatch`（構造同一）で受ける。
- `done` 競合は二値ゆえ left/right 選択のみ（直接編集は省略）。`tags` の直接編集はスペース/カンマ区切り→`parseTags` で正規化。
- `deleted` 競合は他フィールドと併発しない前提（`core/merge.ts` 上、alive 側の内容変更時のみ単独で出る）で、二択 UI を排他表示。
- 再描画でのキャレット喪失回避: フォームは初回構築のみ・`update` は競合消滅時に完了表示へ切り替えるだけ（`resolving` フラグで
  自分の確定中はフリップしない）。

## 成果物
- 新規: `src/ui/components/TextDiff.ts`、`tests/ui/textDiff.test.ts`、`tests/ui/conflictMerge.test.ts`、
  `docs/history/2026-06-18-conflict-ui-phase4.md`（本ファイル）
- 変更: `src/ui/views/ConflictMergeView.ts`、`src/services/SyncService.ts`、`src/state/actions.ts`、`src/syncRuntime.ts`、
  `src/ui/layout/AppShell.ts`、`styles/components.css`、`tests/services/syncService.test.ts`、
  `tests/services/syncScheduler.test.ts`、`package.json`、`docs/design/10-conflict-ui.md`、`docs/design/08-routing-views.md`
