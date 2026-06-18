# 2026-06-18 Issue #45 ＋ #48 タスク編集画面の改善（競合導線 ＋ 期日幅 / select 見た目）

## 日付
2026-06-18

## 依頼内容
- Issue #45・#48 をホットフィックスとしてまとめて対応（PR は 1 つに統合）。
  1. **#45（編集画面に競合の導線が無い）**: 競合（要解決）状態のタスクでも編集画面が開けてしまい、利用者が
     気づかず編集して（Git 的に）ツリーが伸びる懸念。編集画面でも「競合あり」を明示し、競合解決画面へ
     遷移できるようにしたい。
  2. **#48（期日の横幅がおかしい）**: 「期日」入力が横幅いっぱいに広がる。＋コメント: Mac Safari で
     プルダウン（select）が OS 依存スタイルになり見た目が崩れる。
- ユーザー確認: #45 は **注意表示＋解決ボタンのみ**（編集・保存はブロックしない）。**1 つの PR にまとめる**。

## 対応概要
- `src/ui/views/TodoEditView.ts`（#45）:
  - ヘッダー直後に競合注意バナー `edit-conflict-note`（`role=alert`）＋「競合を解決」ボタンを追加。
    押下で `ctx.navigate({ name: 'merge', id })`（一覧の競合解決ボタンと同じ遷移）。
  - 表示判定は一覧（`TaskListView`）と同条件で `showsSyncUi(s) && perTodoStatusOf(s, id) === 'conflict'`。
    既存 selector（`src/state/selectors.ts`）を再利用。
  - フォームは従来どおり再描画しない（入力保持）が、`update(state)` でバナーの表示/非表示のみ反映
    （`refreshConflict`）。編集・保存挙動は不変。
- `styles/components.css`（#48）:
  - 期日・優先度（`.f-due` / `.f-priority`）を `width:auto; max-width:100%; align-self:flex-start` にし、
    横幅いっぱいに伸ばさない。
  - `select` に `appearance:none`（＋ `-webkit-appearance`）と自前の chevron（インライン SVG 背景）・
    右パディング・最小幅を付与し、OS 非依存の一貫表示に（Mac Safari の崩れ回避）。
  - 競合バナー `.edit-conflict-note`（danger 系の枠/背景・横並び、ボタン右寄せ）を追加。
- hotfix 扱いのため `package.json` version を 0.4.8 → 0.4.9 に bump。

## 決定事項
- #45 は編集をブロックせず「注意表示＋解決導線」に留める（最小変更・利用者の判断を妨げない）。
- 競合判定・遷移は新規ロジックを足さず既存 selector / `navigate` を再利用。
- select の見た目は OS 依存を避け自前矢印で統一（アプリ全体の select に適用）。
- 既存テストは純関数・サービス層が対象で UI 表示・ナビに非依存（155 件グリーン維持）。

## 成果物
- 変更: `src/ui/views/TodoEditView.ts`
- 変更: `styles/components.css`
- 変更: `package.json`（version 0.4.8 → 0.4.9）
- 新規: `docs/history/2026-06-18-issue45-48-edit-screen-fixes.md`（本ファイル）
