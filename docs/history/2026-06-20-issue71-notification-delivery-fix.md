# 2026-06-20 タスク通知が出ない不具合の修正（Issue #71）

## 日付
2026-06-20

## 依頼内容
- Issue #71 の通知機能で、ブラウザ単体のテスト（手動 `new Notification()`）は出るのに、**アプリのタスク通知が来ない**。
- まず開発者ツールで原因を切り分けたい。安易に編集せず、根本原因を確定してから直すこと。

## 対応概要（切り分け→修正）
- 切り分け（実機）:
  - 発火判定（`fireAt=dueDate−notifyBeforeMs`、`fireAt≤now<dueDate`）と状態更新（`editTodo`→`setState`→`subscribe`→`check()`）は正常と確認。
  - dev では SW 未登録のため `showNotification` の `await navigator.serviceWorker.ready` が無限待ち（副次要因）。
  - **preview（SW 有効・許可済み）でも、コンソールから直接 `registration.showNotification()` を呼ぶと表示されない**ことを確認。一方 `new Notification()` は表示される。
  - → 真因: `showNotification` が **SW 経路を優先**し、確実に表示できる `new Notification()` に到達していなかった（macOS、特に Safari の通常タブは SW 通知を出さない）。SW 優先は本来 Android Chrome 対策（`new Notification()` が throw）。
- 修正:
  - `src/services/notify.ts`: 経路の優先順位を**逆転**。`new Notification()` を先に試し、throw 時のみ SW にフォールバック（`navigator.serviceWorker.ready` は 1.5s タイムアウトでレースし dev のハングも解消）。表示成否を `boolean` で返す。
  - `src/services/NotificationScheduler.ts`: `notify` の戻り（`Promise<boolean>`）を待ち、**表示成功時のみ** `notifiedFires` に記録。失敗時は未記録で次周回に再試行。多重実行は running フラグで畳む（公開 `check()` は同期 fire-and-forget のまま）。
  - `src/main.ts`: `notify` 配線を `showNotification` の戻り値を返す形に。
- 仕様確定: **即時キャッチアップ**（`fireAt` が過去でも期日前なら 1 回通知）をユーザー承認。現行判定式どおりでロジック変更なし。

## 決定事項
- 通知表示は `new Notification()` 優先・Android のみ SW フォールバック。dev の SW スキップ（`registerSW.ts`）は HMR・成果物の都合で正しく、変更しない。
- 通知済み記録は「表示成功を確認してから」。失敗は再試行。
- リード時点が過去でも期日前なら即時キャッチアップ通知する。

## 成果物
- 変更: `src/services/notify.ts`, `src/services/NotificationScheduler.ts`, `src/main.ts`, `docs/design/19-notifications.md`
- 新規テスト: `tests/services/notify.test.ts`（経路の優先順位・フォールバック・権限）、`tests/services/notificationScheduler.test.ts` に失敗→再試行ケース追加
- 検証: `npm run typecheck` / `lint` / `test`（246 件緑）/ `build` 成功
