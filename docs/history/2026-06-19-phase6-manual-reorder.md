# 2026-06-19 Phase 6 — タスクの手動並べ替え（D&D）

## 日付
2026-06-19

## 依頼内容
- Phase 6（任意拡張）に着手。候補のうち **手動並べ替え（ドラッグ&ドロップ）** を実装する。
- 予約済みの `Todo.order`（フラクショナルインデックス）を使う。

## 対応概要
- **設計判断（ユーザー承認済み）**:
  1. 一覧に「並び: 自動 ⇄ 手動」トグルを追加。手動モード時のみドラッグハンドル（⠿）を表示。
     完了タスクは下に集め（`done` が第1キー）、グループ内を手動並べ替え。自動並び（期日順）も残す。
     モードは端末ごと設定（`DeviceSettings.sortMode`、**同期しない**）。
  2. 並び順（`order` 値）は**同期する**。同時並べ替えは**最近性（recency）で確定し、競合 UI に出さない**（データ消失なし）。
  3. モバイル PWA のため標準 `draggable`（タッチ非対応）でなく **Pointer Events** で実装。
- **実装**:
  - `src/core/order.ts`（新規・純 core）: フラクショナルインデックス `keyBetween(a,b)` / `keysAfter(prev,n)`。barrel から re-export。
  - `src/core/merge.ts`: `order` を `pickOrder(l,r)`（recency LWW・空は非空優先）で確定。`TodoField` には入れず競合化しない。
  - `src/state/selectors.ts`: `compareByOrder` を追加し、`visibleTodos` を `sortMode` で分岐。
  - `src/state/actions.ts`: `setSortMode`（手動化時に現在の表示順を初期 order として一括バックフィル）、`reorderTodo`（前後 id から `keyBetween`）。
    `addTodo` は既存 order があれば末尾 order を付与。
  - `src/services/TodoService.ts`: `TodoPatch`/`TodoDraft` に `order` を許可。
  - `src/model/types.ts` / `constants.ts`: `DeviceSettings.sortMode`（既定 'auto'）。
  - `src/services/ImportService.ts`: 設定インポートで `sortMode` を許可。
  - `index.html` / `src/ui/views/TaskListView.ts` / `styles/components.css`: トグル UI・ドラッグハンドル・Pointer Events ドラッグ・CSS。
- **テスト**（全 193 緑）: `tests/core/order.test.ts`（フラクショナルインデックス）、`tests/core/merge.test.ts`（order recency）、
  `tests/state/selectors.test.ts`（手動ソート）、`tests/state/actions.test.ts`（setSortMode バックフィル / reorder）。
- **設計ドキュメント**（正本）更新: 03（order/sortMode）、04（pickOrder・recency）、08（手動モード・D&D・Pointer Events）、
  17（Phase 6 進捗）、18（並び順同期の確定 #13）。

## 決定事項
- `order` はフィールド競合にせず recency 同期（`pickOrder`）。並びモードは端末ごとで同期しない。
- 入力は Pointer Events。ドラッグは同じ完了状態のグループ内に限定。
- バージョン bump（→ `v1.1.0`）はリリース時に別 PR（本作業では bump しない）。
- ブランチ `feature/manual-reorder` → develop 向け PR。

## 成果物
- 追加: `src/core/order.ts`、`tests/core/order.test.ts`、`tests/state/actions.test.ts`、本履歴ファイル。
- 変更: `src/core/merge.ts`・`index.ts`、`src/state/selectors.ts`・`actions.ts`、`src/services/TodoService.ts`・`ImportService.ts`、
  `src/model/types.ts`・`constants.ts`、`src/ui/views/TaskListView.ts`、`index.html`、`styles/components.css`、
  `tests/core/merge.test.ts`・`tests/state/selectors.test.ts`・`tests/services/syncScheduler.test.ts`、
  設計 `docs/design/03,04,08,17,18`。
- 検証: `npm run typecheck` / `lint` / `test`（193）/ `build` すべて緑。
