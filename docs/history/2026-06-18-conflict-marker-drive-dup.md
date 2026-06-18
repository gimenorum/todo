# 2026-06-18 競合マーカーの Drive 同名ファイル重複を修正（Issue #29 フォローアップ）

## 日付
2026-06-18

## 依頼内容
- v0.4.4（Issue #29・共有マーカー方式）リリース後の NG 報告:
  「同時に解決したとき iPhone 側がオンラインになると、メモ（notes）の入力欄が 2 つある状態になる。データが壊れた？」
- ユーザー調査で「IndexedDB の `meta.conflicts` に競合が 2 件入っていた」ことも判明。
- 方針はユーザー決定（Option B: Drive アダプタで集約＋読み取り側 dedup）。リリースまで実施。

## 対応概要
- **根本原因**: Issue #29 で追加した `conflicts/<todoId>` は「**可変かつ複数端末が同一キーに書き込む**」初の鍵空間。
  `GoogleDriveAdapter.put` は `findId`（name 検索＋端末ごと idCache）→無ければ新規作成だが、**Drive は同名ファイルを
  許可**・name 検索は**遅延整合**・各端末は自分の idCache しか持たないため、別端末が作った `conflicts/<todoId>` を
  発見できず**同名 2 つ目を新規作成**。結果 `list` が同名を 2 回返し → `readAllMarkers` が同一 `(todoId,'notes')` を
  2 件返す → `meta.conflicts` に 2 件 → `ConflictMergeView` が conflict ごとに行を描画し**メモ入力欄が 2 つ**。
  Dropbox（パス上書き）・InMemory（Map）は重複せず、Drive モックも同名を上書き保持していたため既存テストは緑だった。
- **修正（core・SyncService フローは不変）**:
  - `GoogleDriveAdapter`: 可変・複数ライタのキー（`conflicts/`）で `put` 時に同名全 id を取得し**先頭更新・残り削除で
    1 ファイルへ集約**、`delete` は**同名を全削除**（幽霊マーカー防止）。`findAllIds`/`collapseDuplicates`/`isSharedMutable`
    を追加。`objects/`（不変）・`heads/`（単一ライタ）の高速パスは維持。
  - `readAllMarkers`: 戻り値を **`(todoId,field)` で dedup**。どのプロバイダでも・壊れた IDB キャッシュ復元時でも正規化。
  - Drive モックを **id キー化**して同名重複を保持できるようにし、**遅延整合オプション**（`lazyList`/`flush`）を追加。

## 決定事項
- 共有キー `conflicts/<todoId>` の設計（sticky・「片方で解決→全端末で消える」）は維持し、Drive 固有の同名重複は
  アダプタ層で集約＋読み取り側 dedup で封じ込める（Option B / 2026-06-18）。
- 端末別キー再設計（Option A）・#29 リバートは不採用。
- 既存の壊れた状態は self-heal: `meta.conflicts` は次回同期の dedup→`setConflicts` で 1 件へ、Drive の重複ファイルは
  次回 put（集約）／解決時 delete（全削除）で除去。
- バージョン `v0.4.5`、`hotfix/conflict-marker-drive-dup` を main(0.4.4) から作成。

## 成果物
- 変更 `src/adapters/GoogleDriveAdapter.ts`（同名集約・全削除）。
- 変更 `src/services/conflictMarkers.ts`（`readAllMarkers` の dedup）。
- 変更 `tests/helpers/googleDriveMock.ts`（id キー化・遅延整合・`fileCount`/`flush`）。
- 追加テスト `tests/adapters/googledrive.test.ts`（集約・全削除）・`tests/services/conflictMarkers.test.ts`（dedup）。
- 変更 `docs/design/05-storage-adapter.md`（§5.2 鍵の性質・§5.5 同名集約）・`10-conflict-ui.md`（§10.5 dedup）。
- `package.json` 0.4.4 → 0.4.5。
