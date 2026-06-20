# 19. 期日リマインド通知

> 要件トレース: requirements.md「データモデル」「対応プラットフォームと制約」（Issue #71）
> 状態: 実装済（Phase 6） ／ 実装フェーズ: 6

期日のあるタスクで、**期限が近づいたらタスクごとに通知**する（Issue #71）。サーバを持たない
ローカルファースト（BYOS）の制約上、**アプリが動いている間だけ**通知できる。

## 19.1 決定事項

1. **通知タイミングはタスク属性**: `Todo.notifyBeforeMs: number | null`（`null`＝通知しない＝既定）。
   「期日の何ミリ秒前に通知するか」。同期対象（3-way マージ）に含める＝端末間で共有。
2. **期日に時刻（任意）**: `Todo.dueDate` は時刻も保持する。時刻未指定はローカル 00:00 として扱い、
   既存の「日付のみ」データと完全互換（破壊的マイグレーションをしない）。
3. **選択肢（粒度）**: 1 つのドロップダウンに全刻みを列挙する（`NOTIFY_OPTIONS`）。
   通知しない ／ 5〜55 分（5 分刻み）／ 1〜23 時間（1 時間刻み）／ 1 日（＝最大）。
4. **発火は Web 制約を受容**: サーバ（Web Push）を使わない。`new Notification()` または
   Service Worker の `registration.showNotification()`。アプリ未起動中は発火しない（取りこぼしは許容）。
   この制約は **UI に常時明示**する。
5. **DB スキーマ不変**: 新フィールドにインデックスは不要なため `DB_VERSION` は据え置き。
   旧レコード（フィールド欠落）は読み出し・materialize 時に `null` 補完（`TodoService.withNotifyDefault`）。

## 19.2 スケジューラ（`NotificationScheduler`）

- 純粋な依存注入（DOM・core 非依存）。`createNotificationScheduler({ getTodos, notify, getPermission, loadNotified, saveNotified, now? })`。
- `start()` で通知済みマップを読み、`setInterval`（`NOTIFY_CHECK_INTERVAL_MS`＝30 秒）で `check()`。
  composition root（`main.ts`）が、タスク変更（`store.subscribe`）と前面復帰（`visibilitychange→visible`）でも `check()` を呼ぶ。
- `check()` の不変条件:
  - 権限が `granted` 以外、`done`/`deleted`、`dueDate==null`、`notifyBeforeMs==null` は対象外。
  - `fireAt = dueDate − notifyBeforeMs`。**`fireAt ≤ now < dueDate`** かつ未通知のときだけ発火。
    `fireAt` が既に過去でも期日前なら 1 回発火する（**即時キャッチアップ**＝確定仕様。起動が遅れても「間もなく期限」を知らせる）。
  - 期日経過後は発火しない（未起動の取りこぼしは許容）。
- **表示成功を確認してから記録**: `notify` は表示できたら `true` を返す（`showNotification`）。
  `true` のときだけ `notifiedFires` に記録する。`false`（表示失敗）なら記録せず、**次の周回で再試行**する
  （「一度失敗すると恒久的に沈黙」する取りこぼしを防ぐ）。多重実行は内部フラグで畳む。
- **通知済み管理**: meta ストア `notifiedFires: Record<Uuid, Millis>`（todoId → 通知した `fireAt`）。
  端末ローカルのみ（**同期しない**）。`fireAt` が変われば（期日/リード変更）再アーム＝再通知できる。

## 19.2.1 通知の表示経路（`notify.ts`）
- `showNotification` は **`new Notification()`（ページコンテキスト）を優先**し、表示できたら `true`。
  - 理由: macOS（特に Safari の通常タブ）では SW の `registration.showNotification()` が**表示されない**ことがあるため、
    確実に表示できるページ通知を先に使う。
- `new Notification()` が **throw する環境（Android Chrome の "Illegal constructor"）でのみ** SW にフォールバック:
  `navigator.serviceWorker.ready` を**タイムアウト（1.5s）でレース**して打ち切り（SW 未登録の dev で無限待ちしない）、
  取得できれば `registration.showNotification()`。いずれも不可なら `false`。

## 19.3 権限の扱い（編集画面）

通知 `<select>` 直下に `.field-help` を常時表示し、`getPermission()` で出し分ける:

| 状態 | 表示 |
|---|---|
| 共通 | 「通知はアプリを開いている間のみ届きます。完全に終了している間は通知されません。」 |
| `granted` | 共通のみ |
| `default` | 「通知を有効にする」ボタン（押下で `requestNotificationPermission()`）。通知あり保存時にも要求 |
| `denied` | 「サイト設定から通知を許可してください（アプリからは再許可不可）」を明示 |
| 非対応 | `<select>` を `disabled` ＋「この環境では通知を利用できません」 |

`focus` / `visibilitychange→visible` で再評価し、ブラウザ設定の変更が即反映される。

## 19.4 受け入れ基準（不変条件）

- 編集画面で期日に時刻（任意）と通知タイミングを設定でき、既定は「通知しない」。
- 設定したリードタイムだけ期日前に、許可済みかつアプリ稼働中なら 1 回通知する。二重通知しない。
- 通知設定の無い既存タスクは通知しない＝後方互換（時刻 00:00 保持）。
- 「アプリ稼働中のみ通知」「拒否時の再許可導線」が UI から分かる。

## 19.5 関連

- 型: [03](./03-data-model.md)（`notifyBeforeMs`・`dueDate` の時刻保持）。3-way マージ: [04](./04-sync-engine.md)。
- 通知 API・SW: [12](./12-pwa-sw-csp.md)。トリガ結線の考え方: [11](./11-sync-triggers.md)。
- 実装: `src/services/NotificationScheduler.ts`・`src/services/notify.ts`・`src/ui/views/TodoEditView.ts`・`src/model/constants.ts`（`NOTIFY_OPTIONS`）。
