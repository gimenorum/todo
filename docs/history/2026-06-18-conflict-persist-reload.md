# 2026-06-18 Issue #26 競合のリロード消失を修正（未解決競合を IDB 永続）

## 日付
2026-06-18

## 依頼内容
- 本リリース前のバグ Issue #26・#27 を、承認済みプランに沿って #26 → #27 の順に別々のブランチ・PR・プレリリースで進める。
- まず Issue #26「ページリロードで競合が消える」を v0.4.2 として対応する。
- hotfix ブランチは規定通り main から作成し、承認済みプランの「経緯本体」履歴ファイルのみを当ブランチへ引き継ぐ（プランファイル本体はコミットしない）。

## 対応概要
- ブランチ `hotfix/conflict-persist-reload` を `origin/main`（v0.4.1）から作成。
- 経緯本体 `docs/history/2026-06-18-issue-26-27-planning.md` のみを引き継ぎ、プラン本体は取り込まない。
- 未解決競合（`FieldConflict[]`）を IndexedDB の `meta` ストアに永続し、起動時に復元する実装を追加。
  - `META_KEY.conflicts` を追加（`src/model/constants.ts`）。
  - `metaStore` に `getConflicts()` / `setConflicts()` を追加（`STORE.meta` に JSON 1 レコード）。
  - `SyncService`:
    - 同期周回冒頭で未ロードなら永続競合を一度だけ取り込む（`conflictsLoaded` フラグ）。
    - union 直後と `resolveConflict` の除外直後に `setConflicts(activeConflicts)` で永続。
    - `restoreConflicts()` を新設（I/F にも追加）。永続競合をロードし、空でなければローカル todos から outcome を emit（オフライン起動でも「解決する」を即復元）。
  - `syncRuntime.buildRuntime()` で `createSyncService` 後・初回同期前に `await svc.restoreConflicts()`（startup / connectGoogle の両経路が通る）。
  - 連携解除（`SettingsService.disconnect`）で `setConflicts([])`（再連携時に古い競合が蘇らない）。
- 自動マージ（left を暫定表示）の挙動は変えず、「未解決」状態の永続・復元のみを足した（最小・低リスク）。
- テスト追加（`tests/services/syncService.test.ts`）:
  - 競合検出 → 別インスタンスの `restoreConflicts()` で競合が復元される（リロード相当）。
  - `resolveConflict` 後は永続が空になり、`restoreConflicts()` で蘇らない。
  - スケジューラのモック `SyncService` に `restoreConflicts` を追加（`tests/services/syncScheduler.test.ts`）。
- 設計更新: `docs/design/10-conflict-ui.md`（§10.5 に永続・起動復元を追記、不変条件は §10.6 へ）、`docs/design/06-local-store.md`（meta キーに conflicts を追記）。
- `package.json` 0.4.1 → 0.4.2。
- ローカルで `typecheck` / `lint` / `test`（140 件）/ `build` をすべて green を確認。

## 決定事項
- 競合の「未解決」状態だけを IDB に永続し、自動マージの挙動（left 暫定表示・マージコミット publish）は変更しない。
- hotfix は main 基点で作成し、経緯本体のみを引き継ぐ。プランファイル本体はリポジトリへコミットしない。
- バージョンは main 実体（0.4.1）を基準に 0.4.2 へ引き上げる。

## 成果物
- 変更: `src/model/constants.ts`, `src/store/metaStore.ts`, `src/services/SyncService.ts`, `src/services/SettingsService.ts`, `src/syncRuntime.ts`
- 変更: `tests/services/syncService.test.ts`, `tests/services/syncScheduler.test.ts`
- 変更: `docs/design/10-conflict-ui.md`, `docs/design/06-local-store.md`, `package.json`
- 引き継ぎ: `docs/history/2026-06-18-issue-26-27-planning.md`
- 新規: `docs/history/2026-06-18-conflict-persist-reload.md`（本ファイル）
