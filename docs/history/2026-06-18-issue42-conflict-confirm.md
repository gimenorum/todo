# 2026-06-18 Issue #42 同期競合解決ページの UX 改善（確定前の確認画面＋レイアウト整理）

## 日付
2026-06-18

## 依頼内容
- Issue #42（「同期の不具合を解決」ページの UX 改善）:
  1. 「編集を確定」前に確認を挟む（`alert` ではなく確認画面）。「同時に確定するのは非推奨」を伝え、
     OK で確定→一覧、キャンセルで留まる。
  2. 解決マーカーエリア（`.merge-panes`）とプレビュー（`.merge-preview`）が近接してごちゃつく。整理する。
- 実装方式（ユーザー確認）: **「確認画面に切替（プレビューを確認画面へ移動）」** を採用。
- デリバリ（ユーザー指示）: **ホットフィックス扱い**。

## 対応概要
- `src/ui/views/ConflictMergeView.ts`:
  - 編集画面からインラインプレビュー（`.merge-preview` / 旧 `renderPreview` の `previewEl` 書き込み）を撤去。
  - 旧 `renderPreview()`（副作用関数）を、現在の選択から `.merge-preview` 要素を返す純粋関数
    `buildPreview()` にリファクタ。確認画面でのみ使用。
  - 値変更ハンドラ（`setMode` / `onEdit` / 削除二択の change）からインライン更新呼び出しを除去
    （選択状態 `choices`/`deletedDecision` の更新ロジックは温存）。
  - 「編集を確定」ボタンを「即解決」から「確認画面を表示（`showConfirm()`）」に変更。
  - `showConfirm()` を追加: 編集画面の DOM を `editingNodes` に退避し、`root` を確認画面へ差し替え。
    確認画面は「確定の確認」見出し＋「同時確定は非推奨」注記（`.merge-confirm-note`）＋プレビュー
    （`buildPreview()`）＋ `[← 編集に戻る]` / `[確定する]`。
    - 「編集に戻る」→ 退避 DOM を再装着し選択を完全復元（radio/checked・input/value は detached でも保持）。
    - 「確定する」→ 既存の確定ロジック（`resolveConflict` → 一覧遷移）を実行。
- `styles/components.css`:
  - `.merge-confirm-note`（確認画面の注意書き / `--warn` 系）を追加。
  - `.merge-edit` に区切り（破線 border-top ＋ padding）を追加し、選択ペインと「直接入力」を視覚的に分離。
- hotfix 扱いのため `package.json` の version を 0.4.6 → 0.4.7 に bump。

## 決定事項
- 確認は「確認画面に切替」方式を採用（モーダル基盤・フォーカストラップは新設しない／既存の画面切替流儀に一貫）。
- プレビュー「編集後の内容」は確認画面に集約。これにより編集画面のごちゃつき（Issue #42 の 2 点目）も同時に解消。
- `buildPatch` / `parseFieldInput`（純関数）・データモデル・SyncService・収束経路は無変更（挙動同一・確定の
  発火タイミングのみ移動）。既存テスト（純関数のみ）に影響なし。
- 機能改善だが、ユーザー指示により hotfix 扱い（`hotfix/conflict-merge-confirm` を main から分岐、version bump 必須）。

## 成果物
- 変更: `src/ui/views/ConflictMergeView.ts`
- 変更: `styles/components.css`
- 変更: `package.json`（version 0.4.6 → 0.4.7）
- 新規: `docs/history/2026-06-18-issue42-conflict-confirm.md`（本ファイル）

## 追記（2026-06-18）PR #43 レビュー反映：文言調整

### 依頼内容
- PR #43 のレビューコメント2点。
  1. ボタン「編集を確定」→「プレビュー」（押下で確定せずプレビュー画面を開く実態に合わせる）。
  2. 画面見出し「確定の確認」が直訳調で違和感 →「プレビュー」。
- 追加で、編集画面タイトル「同期の不具合を解決」を「同期エラーを解決」に変更
  （「競合」という内部用語を避けつつ、一般利用者に伝わる表現にする）。

### 対応概要
- `src/ui/views/ConflictMergeView.ts`:
  - 「編集を確定」ボタン → **「プレビュー」**。
  - プレビュー画面の見出し「確定の確認」→ **「プレビュー」**。
  - 画面見出しと内側の小見出しが重複するため、`buildPreview()` 内の小見出し「編集後の内容」(h3) を**削除**
    （内容の dl のみ返す）。
  - 編集画面タイトル「同期の不具合を解決」→ **「同期エラーを解決」**。
  - 関連コメントの「確認画面」表現を「プレビュー画面」に整合。
- `styles/components.css`: 未使用になった `.merge-preview-title` を削除。

### 決定事項
- 画面名・ボタン名を「プレビュー」で統一（押下→プレビュー→「確定する」の二段階を維持）。
  なお過去の「IT 外来語を避ける」方針（`2026-06-18-conflict-ui-phase4.md`）とは一部逆行するが、
  「プレビュー」は一般利用者にも通じる語であり、オーナー判断で採用。
- タイトルは「競合」「不具合」を避け「同期エラーを解決」とする。
- 履歴は上書きせず本節として追記（初回実装の記録は上に残す）。

### 成果物（追記分）
- 変更: `src/ui/views/ConflictMergeView.ts`
- 変更: `styles/components.css`（`.merge-preview-title` 削除）
