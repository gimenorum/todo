# 2026-06-19 同期エラーのサイドバーバッジ件数が一覧「要解決」と一致しない不具合を修正（Issue #52）

## 日付
2026-06-19

## 依頼内容
- 競合（要解決）が一覧に **1 件** しか出ていないのに、サイドバーのタスクバッジが **2** と表示される。
  直感では 1 と出るはずで、原因の調査を依頼された（バグか意図かの切り分け含む）。
- 調査の結果「意図ではなくバグ（不整合）」と判明。ユーザー決定で **表示の整合 ＋ 根本原因の両方を修正**。
- GitHub ダッシュボードからも追えるよう **Issue #52 を起票**してから着手。

## 対応概要
- 原因: バッジと一覧が **別ソースを別条件でフィルタして** 数えていた。
  - バッジ `tasksBadge`（`src/state/selectors.ts`）は `state.conflicts`（＝リモートマーカー全件・未フィルタ）の
    todoId を数えていた。
  - 一覧「要解決」は `perTodoStatus[id] === 'conflict'`（`buildOutcome` で **生きているタスクのみ**に生成）。
  - 競合中タスクを「解決」せず削除（tombstone）すると、マーカー `conflicts/<todoId>` は残るが
    `perTodoStatus` には出ない（`deleteTodo` はマーカーを消さない）。→ バッジだけ過大計上。
- A) 表示の整合（`src/state/selectors.ts`）: `tasksBadge` を一覧と同一ソースに変更し、
  `perTodoStatus` の `'conflict'` 件数を数える。これでバッジ件数が一覧の行数と必ず一致する。
- B) 根本原因（`src/services/SyncService.ts` `syncCycle`）: `readAllMarkers` 直後に、マージ結果で
  「生きているタスク」に対応しない競合マーカー（削除済み/不在）を検出し、既存の確認付き削除キュー
  `pendingDeletes`（Issue #29 経路）に積んで権威集合から落とす。次周回冒頭の `deleteMarker` で
  リモートからも確実に掃除される。当該周回の outcome は filter 後の集合を載せるため、バッジは即時に正しい値。
- hotfix 扱いのため `package.json` version を 0.4.10 → 0.4.11 に bump。

## 決定事項
- バッジは「一覧が実際に表示する件数」と完全一致させる（`perTodoStatus` を唯一のソースにする）。
- 残留マーカーは同期サイクルで一般的に掃除する（`deleteTodo` 側に個別フックは足さない）。
  `merge3` の edit-vs-delete 挙動（相手が編集中なら resurrect して再競合）は不変＝生きている競合は掃除しない。
- 同期エンジン・マージ規則・データモデル・UX（解決フロー）は変更しない。

## 成果物
- 変更: `src/state/selectors.ts`（`tasksBadge` を perTodoStatus 基準に）
- 変更: `src/services/SyncService.ts`（残留マーカーの掃除を syncCycle に追加）
- 変更: `tests/state/selectors.test.ts`（バッジ算出の更新＋残留マーカー非加算ケース）
- 変更: `tests/services/syncService.test.ts`（残留マーカー掃除／生きている競合は残る、の検証）
- 変更: `package.json`（version 0.4.10 → 0.4.11）
- 新規: `docs/history/2026-06-19-conflict-badge-count-fix.md`（本ファイル）
- 関連: GitHub Issue #52
