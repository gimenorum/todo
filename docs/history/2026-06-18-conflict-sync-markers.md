# 2026-06-18 競合を他端末にも共有する（Issue #29・共有マーカー方式）

## 日付
2026-06-18

## 依頼内容
- GitHub Issue #29「競合が他端末に同期されない」（bug）の修正。
  - 本文「おそらくは競合した側のみに競合を解決と出るのでは？」＝競合を検出した端末だけに「解決する」が出て、
    もう一方の端末には競合が伝わらない。
- 進め方は承認済みプラン（共有マーカー方式）に従い、PR 作成まで行う。

## 対応概要
- **根本原因**: 競合 `FieldConflict[]` は `syncOnce`（`src/core/sync.ts`）の戻り値で、検出端末の
  `SyncService.activeConflicts`（メモリ）＋ローカル IDB（Issue #26）にしか存在せず**リモートに publish されない**。
  競合時も left 採用の自動マージで先端が単一化されるため、相手端末は `tips.length===1` で競合を再導出できない。
  「未解決」状態は DAG から再導出できない（暫定表示中と解決済みが履歴上区別不能）ため、明示的に共有が必要。
- **方針（共有マーカー方式）**: 未解決競合をリモートの小さな keyspace `conflicts/<todoId>` に publish し、各端末が
  毎同期で読む。中核の収束ロジック（`merge3`／heads 導出／自動マージ）は**一切変更せず**、マーカーの読み書き
  削除をすべて services 層に閉じる（`src/core/sync.ts`・`merge.ts` は無変更）。
  - **書き込み（検出端末）**: `syncOnce` が返した `res.conflicts` を `writeMarkers` で publish。
  - **読み取り（全端末）**: 毎同期で `readAllMarkers`（`list('conflicts/')`）し、これを未解決集合の**権威**にする。
  - **削除（解決端末）**: 削除意図を保留集合 `pendingConflictDeletes`（IDB 永続）に積み、毎同期で `deleteMarker` を
    実行。**リモートから消えたと確認できた todoId だけ集合から外す**＝確実に同期できるまでリトライ（成功を仮定しない）。
  - 周回内順序は **①保留削除（確認付き）→②検出分 publish→③共有集合を読む**。削除を先に行うので、別値での
    再解決による**再衝突**でも新マーカーが正しく書き直る。
- IDB(meta) の `conflicts` は権威ではなく**オフライン再表示用キャッシュ**に格下げ（#26 の復元は維持）。

## 決定事項
- 代替案（DAG からの純粋再導出）は、保留中に別項目を編集すると競合が黙って left 確定する欠陥があり受け入れ基準
  「解決するまで黙って失われない」に反するため不採用。未解決状態は履歴から導けないので明示共有する（2026-06-18）。
- 両端末が**別値に解決**した場合は各解決コミットが分岐し、再同期で `merge3` が新競合として再検出する＝データは
  失われず再合意を促す正しい挙動（有限ラウンドで収束）。
- ブランチは repo の Git 戦略どおり `hotfix/conflict-sync-markers` を main(0.4.3) から作成。PR→main、`v0.4.4`。
- 既知の限界（軽微・データ損失より軽い）: 解決直後に相手が未 pull で同一競合を再検出する幽霊マーカーのレース、
  オフライン解決後の再接続前に復元キャッシュで一瞬残る等。いずれも次回同期で自己回復し受け入れ基準は満たす。

## 成果物
- 新規 `src/services/conflictMarkers.ts` — マーカー I/O（`conflictKey`/`writeMarkers`/`readAllMarkers`/`deleteMarker`）。
- 変更 `src/services/SyncService.ts` — `syncCycle` にマーカー段（確認付き削除→publish→読み取り）、`resolveConflict`
  を保留削除キュー方式に変更、`unionConflicts` 削除、`restoreConflicts` のコメント更新。
- 変更 `src/store/metaStore.ts`・`src/model/constants.ts` — `pendingConflictDeletes` の get/set とキーを追加。
- 変更 `docs/design/05-storage-adapter.md`（§5.2 鍵空間に `conflicts/<todoId>`）・`10-conflict-ui.md`（§10.5 を端末間
  共有に更新）・`06-local-store.md`（meta の注記）。
- 新規 `tests/services/conflictMarkers.test.ts`、`tests/services/syncService.test.ts` に #29 シナリオ 5 件を追加。
- `package.json` 0.4.3 → 0.4.4。
