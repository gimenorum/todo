# 2026-06-19 Phase 5 エクスポート / インポート

## 日付
2026-06-19

## 依頼内容
- 次のタスク（Phase 5）として、設定画面「データ」セクションに**エクスポート / インポート**を実装する。
- Issue #38（ローカルデータのリセット）とは**別の PR** で develop に出す。

## 対応概要
- 正本仕様（`docs/design/13-export-import.md`）に沿って実装。
- **エクスポート 3 種 / 5 ボタン**（`src/services/ExportService.ts`・純関数）:
  - タスク（JSON 正本＝tombstone/version 込み・無損失）／タスク (Markdown)／タスク (CSV)／設定（JSON）／全体（タスク＋設定 JSON）。
  - 受け渡しは `src/ui/download.ts` の `saveFile`（`navigator.share` 優先、不可なら `a[download]` フォールバック、
    `URL.revokeObjectURL` で後始末）。File System Access API は不使用。
- **インポート**（`src/services/ImportService.ts`）:
  - `parse` でバックアップ JSON を検証（別アプリ/別バージョン/不正は説明的に throw）。
  - タスクは既存マージエンジン `merge3NoBase`（recency: version→updatedAt→id）で no-base 統合し materialize。
    競合表示は生じない（同 id は新しい版、異 id は両立、古い tombstone では resurrect しない）。
  - 設定は端末ごと設定へ適用。`sanitizeSettings` で `connectedProvider` を除外（トークン依存のため上書きしない）。
- **UI**（`src/ui/views/SettingsView.ts`）: 「データ」プレースホルダを置換。エクスポート5ボタン＋インポート（hidden file
  input）＋取り込み内容のインライン確認（［キャンセル］／［適用する］）。エクスポート/インポートは未連携でも表示（ローカルファースト）。
- **配線**（`src/state/actions.ts`）: `exportData` / `previewImport` / `commitImport` を追加。インポートのタスク反映は
  `bridge.notifyEdited()` 経由で次同期に push（未連携なら no-op）。設定反映は `applyIntervalChange()` を呼ぶ。
- **型**（`src/model/types.ts`）: `ExportFileV1` / `FileDescriptor` / `ExportRequest` / `ImportData` を追加。

## 決定事項
- UI 文言は内部用語（JSON 正本/マージ）を避け、無損失 JSON は「バックアップ」と表現。ただし Markdown/CSV は
  用途が明確なため形式名のまま残す（ユーザー判断）。
- インポートのタスクは「マージ（同じタスクは新しい方を採用、別のタスクは両方残す）」と確認文で説明。設定は「上書き・確認」。
- バージョンは据え置き（0.4.11）。Phase 5 の `v1.0.0` への bump は将来の develop→main リリース時に行う。
- 本 PR は develop 向け（CI は verify＋branch-policy）。

## 成果物
- 追加: `src/services/ExportService.ts`, `src/services/ImportService.ts`, `src/ui/download.ts`
- 追加: `tests/services/exportService.test.ts`, `tests/services/importService.test.ts`
- 変更: `src/model/types.ts`, `src/state/actions.ts`, `src/ui/views/SettingsView.ts`
- 追加: 本履歴ファイル
- 検証: `npm run lint && npm run typecheck && npm test`（168 passed）`&& npm run build` すべて緑。
