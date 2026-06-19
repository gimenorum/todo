# 2026-06-19 タグ入力に候補サジェスト（Issue #65）

## 日付
2026-06-19

## 依頼内容
- タスク編集のタグ入力を、テキストボックスのまま **既存タスクのタグから候補を選べる**ようにしたい（Issue #65）。
- 候補の出し方は **入力欄にアンカー＋自動フリップ**（モバイルの仮想キーボードで下が隠れるときは上へ）。入力 UI は **現状テキスト＋サジェスト**（チップ化はしない）。

## 対応概要
- 新規 `src/ui/tagSuggest.ts`（純 UI・`format`/`dom` のみ依存）:
  - `attachTagSuggest(input, getCandidates)` — `role=combobox`/`listbox`、候補ポップアップ、↑↓/Enter/Esc、外側クリック/blur で閉じる、`destroy()` で後始末。
  - **自動フリップ**: `getBoundingClientRect` と `visualViewport?.height ?? innerHeight` から下の余白を測り、足りなければ上へ（`is-above`）。`focus/input/scroll/resize/visualViewport` で再計算。
  - 純粋ヘルパ: `activeToken`（キャレットのトークン境界）/ `filterCandidates`（使用済み除外・大小無視部分一致・件数上限）/ `applySelection`（トークン置換＋空白）。
- `src/ui/views/TodoEditView.ts`: `.f-tags` を `.tag-suggest`（relative）で包み、`attachTagSuggest(tags, () => distinctTags(ctx.store.getState().todos))`。
  `ViewController.destroy()` で `suggest.destroy()`（リスナのリーク防止。`AppShell` がルート切替時に呼ぶ）。保存経路（`parseTags`）は不変。
- `styles/components.css`: `.tag-suggest`/`.tag-suggest-list`（影・スクロール・`z-index`）/`.is-above`（上反転）/`.tag-suggest-option.is-active`。
- テスト `tests/ui/tagSuggest.test.ts`（13 件）: 純粋ヘルパ＋ jsdom（フォーカスで候補表示／トークン絞り込み／クリックで「タグ＋空白」更新・選択済み除外／使用済み除外／Esc・候補無しで閉じる）。

## 決定事項
- 候補配置はアンカー＋自動フリップ（PC/モバイル 1 実装）。入力は現状のスペース区切りテキスト＋サジェスト（最小変更）。
- 候補ソースは `selectors.distinctTags`（一覧の全タグ）。新規タグ（候補に無い文字列）は従来どおり入力・保存可能。
- フリップ位置は layout 非対応の jsdom で検証困難 → ロジックは純粋関数で担保、配置は実機確認。

## 成果物
- 追加: `src/ui/tagSuggest.ts`、`tests/ui/tagSuggest.test.ts`、本履歴ファイル。
- 変更: `src/ui/views/TodoEditView.ts`、`styles/components.css`、`docs/design/08-routing-views.md`。
- 検証: `npm run typecheck` / `lint` / `test`（218）/ `build` すべて緑。

## 実機レビュー対応（その2）
- **見た目**: 候補ポップアップがメモ欄（textarea）と同色で一続きに見えた → 一段持ち上げた面・青アクセント枠・強い影で浮いたカードに（`.tag-suggest-list`）。
- **チップ式へ変更**: 「複数タグの付与に結局テキスト入力が要る」指摘を受け、タグ欄を**チップ式入力**に刷新（ユーザー承認済み）。
  - 新規 `src/ui/tagInput.ts`（`createTagInput(initial, getCandidates)` → `el`/`getTags()`/`destroy()`、純粋 `filterTags`）。
    付与済みはチップ（× 削除）、既存タグは候補タップ/↑↓+Enter、未知タグは入力＋Enter/スペース/カンマ、空入力 Backspace で末尾削除。候補ポップアップ（自動フリップ）は流用。
  - `TodoEditView`: タグ欄を `createTagInput` に置換、保存は `tagInput.getTags()`。旧 `ui/tagSuggest.ts`＋テストは削除（未マージのため安全）。
  - `styles/components.css`: `.tag-input`（入力風コンテナ・focus-within 枠）／`.tag-chip`（×）／`.tag-input-text`（枠なしで伸長・グローバル input 上書き）。
  - テスト差し替え `tests/ui/tagInput.test.ts`（10 件）。設計 08 を更新。
- 検証（最新）: `typecheck` / `lint` / `test`（215）/ `build` すべて緑。
