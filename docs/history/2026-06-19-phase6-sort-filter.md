# 2026-06-19 Phase 6 — 一覧の並び替え（4 軸）＋ 絞り込み（4 軸）

## 日付
2026-06-19

## 依頼内容
- 一覧の並びを **期限 / カテゴリ / タイトル / 優先度** で選べるようにし、加えて**それらで絞り込み**たい。
- カテゴリは既存の**タグ**を流用、優先度は既存の `Priority`（高/中/低/なし）。

## 対応概要
- 直前の手動並べ替え（`sortMode: auto|manual`）を、より表現力のある設定に発展（同一ブランチ `feature/manual-reorder`・未マージ）。
- **並び替え（5 択・1 つ選ぶ / `DeviceSettings.sortBy`）**: 手動（ドラッグ）/ 期限 / 優先度 / タイトル / カテゴリ。
  どの並びも「完了は下」（`done` 第1キー）を維持。
- **絞り込み（4 軸・AND / `DeviceSettings.filter: ListFilter`）**: カテゴリ（タグ）/ 優先度 / 期限バケツ（すべて/期限切れ/今日/今週/期限なし）/ タイトル検索。
- いずれも**端末ごと設定（同期しない）**。
- **実装**:
  - `src/model/types.ts` / `constants.ts`: `SortBy`・`ListFilter` 型、`DeviceSettings.sortBy`/`filter`、`DEFAULT_FILTER`。
  - `src/state/selectors.ts`: `compareByDue/Priority/Title/Category/Order` ＋ `comparatorFor`、`matchesDue`/`matchesFilter`/`activeFilterCount`/`distinctTags`、`visibleTodos`（フィルタ→ソート）。
  - `src/state/actions.ts`: `setSortBy`（手動化時 order バックフィル）、`setFilter`（部分更新）、`clearFilter`。
  - `src/services/ImportService.ts`: 設定インポートで `sortBy`/`filter` を検証して適用。
  - `src/ui/views/TaskListView.ts` / `styles/components.css`: 並び替え select ＋ 折りたたみ絞り込みパネル（検索・カテゴリ・優先度・期限）＋「絞り込み中」インジケータ。
    入力中のキャレットを壊さないよう差分のみ反映。手動時のみドラッグハンドル表示は維持。
- **テスト**（全 205 緑）: selectors（各 comparator・`matchesFilter` 4 軸＋AND・`activeFilterCount`・`distinctTags`）、actions（`setFilter`/`clearFilter`・`setSortBy` バックフィル）。

## 決定事項
- 並び替えキー・絞り込みは端末ごと（同期しない）。`order` のみ recency 同期（手動並べ替え）。
- 絞り込みは折りたたみで既定表示をすっきり保つ。永続フィルタの取り違え防止に「絞り込み中（N 件）」を常時表示し、有効時はパネル初期展開。
- カテゴリ＝タグ流用（新フィールドは追加しない）。
- バージョン bump（→ `v1.1.0`）はリリース時に別 PR。

## 成果物
- 追加: `docs/history/2026-06-19-phase6-sort-filter.md`（本ファイル）。
- 変更: `src/model/types.ts`・`constants.ts`、`src/state/selectors.ts`・`actions.ts`、`src/services/ImportService.ts`、
  `src/ui/views/TaskListView.ts`、`styles/components.css`、
  `tests/state/selectors.test.ts`・`actions.test.ts`・`tests/services/syncScheduler.test.ts`、
  設計 `docs/design/03,08,17,18`。
- 検証: `npm run typecheck` / `lint` / `test`（205）/ `build` すべて緑。

## 実機レビュー対応（同日・追補）
動作確認で出た 4 点を修正:
1. **ドラッグの後始末**: ノードを DOM 移動するとポインタキャプチャが外れ、以降の `pointermove`/`pointerup` を
   要素ローカルで取りこぼしていた。→ move/up/cancel を **window で受ける** + `pointermove` で `e.buttons===0` なら
   ドロップ確定するガードを追加。これで「押していないのにカーソル移動だけで並び替わる」現象を解消。
2. **先頭へ移動できない**: 上記キャプチャ喪失で複数ステップ上方向（＝先頭まで）が止まっていた。window 化で解消。
   タッチのスクロール奪取防止のためキャプチャは best-effort 併用（正は window）。
3. **プルダウンが縦に見える**: グローバル `select { width:100% }` が原因。ツールバー/絞り込みの select を
   `width:auto` にしてラベルと横並びに（`styles/components.css`）。
4. **検索ボックスの見た目不一致**: `input[type='search']` を共通入力スタイルの対象に追加し、追加欄と同じ装飾に
   （Safari のピル形は `appearance:none` で打ち消し）。

### 実機レビュー対応（その2）
- **文言統一**: 並び替え・絞り込みの UI 文言「カテゴリ」を **「タグ」** に統一（内部の `sortBy: 'category'` 値は据え置き）。
- **長いタグのはみ出し**: タグ選択 `<select>` に `max-width`（上限）＋ flex 子の `min-width:0` を入れて表示領域からはみ出さないように。
  一覧行のタグ表示（`.todo-tags`）にも `overflow-wrap: anywhere` を入れ、長い 1 語でも折り返すように。
