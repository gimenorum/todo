# 2026-06-19 期日リマインド通知（Issue #71）

## 日付
2026-06-19

## 依頼内容
- 期日が近づいたら通知してほしい（Issue #71）。
- 通知はタスクごとに設定でき、「どのくらい前に通知するか」を 5 分刻み・1 時間刻み・1 日刻みで、最大 1 日前まで選べる。
- デフォルトは「通知しない」。明示的に「通知しない」も選べる。
- 相談で確定: 期日に時刻（任意）を持たせる／既存データは 00:00 のまま後方互換／Web 制約を受け入れる（サーバなし・アプリ稼働中のみ）／通知設定は端末間で同期。
- 追加要望: 「通知はアプリ起動中のみ届く」制約をアプリ内に明示。誤って通知を拒否した場合の再許可導線も用意。非対応環境では通知フィールドを表示したまま無効化。

## 対応概要
- データモデル: `Todo` に `notifyBeforeMs: number | null`（null=通知しない）を追加。`TodoField`・3-way マージ（`CONTENT_FIELDS`/`assignField`）に組み込み、同期対象化（`serializeSnapshot` が Todo 全体を直列化するため同期へ自動で載る）。`DB_VERSION` は据え置き（インデックス不要）。旧レコードは `withNotifyDefault` で null 補完。
- 期日の時刻: `src/ui/format.ts` に `toTimeInputValue`/`fromDateTimeInputValues` を追加。編集 UI を日付＋時刻（時刻は任意）に。時刻空＝ローカル 00:00（従来互換）。
- 通知タイミング選択肢 `NOTIFY_OPTIONS`（通知しない／5〜55 分・5 分刻み／1〜23 時間・1 時間刻み／1 日）を `constants.ts` に生成。
- 通知ヘルパ `src/services/notify.ts`（権限・SW/メインスレッドの `showNotification` フォールバック）。
- スケジューラ `src/services/NotificationScheduler.ts`: 定期＋タスク変更＋前面復帰で `fireAt=dueDate−notifyBeforeMs` を判定し、`fireAt ≤ now < dueDate` で 1 回通知。通知済みは meta（`notifiedFires`・端末ローカル・非同期）で管理。`main.ts` で結線。
- 編集 UI（`TodoEditView.ts`）: 通知 select を常時表示。`.field-help` に「アプリ稼働中のみ通知」を常時表示し、権限状態（default=有効化ボタン／denied=サイト設定での再許可案内／非対応=disabled）で出し分け。`focus`/`visibilitychange` で再評価。
- 競合解決 UI（`ConflictMergeView.ts`）も `notifyBeforeMs` を選択・編集・表示できるよう対応。
- テスト: `notificationScheduler.test.ts`（発火/抑止/再アーム）、`format.test.ts`（時刻往復）、`merge.test.ts`（3-way 追加）、各 Todo リテラルの新フィールド追従、`serialize.test.ts` の固定文字列更新。全 240 テスト緑。
- ドキュメント: 設計章 `19-notifications.md` 追加、`README.md`/`03-data-model.md`/`17-phase-map.md`/`requirements.md` を更新。

## 決定事項
- 期日の時刻は任意。既存の日付のみデータは 00:00 のまま保持（破壊的マイグレーションなし）。
- 通知はサーバなし＝アプリ稼働中のみ。未起動中の取りこぼしは許容し、その制約を UI に常時明示。
- 通知タイミングはタスク属性として端末間で同期（3-way マージ対象）。通知済み記録は端末ローカル（meta・非同期）。
- 通知選択肢は 1 つのドロップダウンに全刻みを列挙（5 分／1 時間／1 日刻み・最大 1 日前）。
- 非対応環境では通知フィールドを表示したまま disabled、拒否時はサイト設定での再許可を案内。

## 成果物
- 変更: `src/model/types.ts`, `src/model/constants.ts`, `src/core/merge.ts`, `src/services/TodoService.ts`, `src/services/ImportService.ts`, `src/services/SyncService.ts`, `src/store/metaStore.ts`, `src/ui/format.ts`, `src/ui/views/TodoEditView.ts`, `src/ui/views/ConflictMergeView.ts`, `src/main.ts`, `styles/components.css`
- 新規: `src/services/notify.ts`, `src/services/NotificationScheduler.ts`, `docs/design/19-notifications.md`, `tests/services/notificationScheduler.test.ts`, `tests/ui/format.test.ts`, 本履歴ファイル
- ドキュメント更新: `docs/design/README.md`, `docs/design/03-data-model.md`, `docs/design/17-phase-map.md`, `docs/requirements.md`
- テスト追従: `tests/core/merge.test.ts`, `tests/core/serialize.test.ts`, `tests/helpers/factories.ts`, `tests/services/exportService.test.ts`, `tests/services/importService.test.ts`, `tests/state/selectors.test.ts`, `tests/store/resetStore.test.ts`
