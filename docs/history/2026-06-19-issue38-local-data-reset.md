# 2026-06-19 Issue #38 ローカルデータの削除（3 ボタン）

## 日付
2026-06-19

## 依頼内容
- Issue #38「ローカルデータの削除／リセット機能」を実装する。
- Phase 5（エクスポート/インポート）とは**別の PR** で develop に出す。
- 「削除」の解釈は 1 ボタンに条件分岐を詰めず、**用途の異なる 3 つの独立ボタン**として実装する（ユーザー決定）。

## 対応概要
- 設定画面「データ」セクションに**リセット系 3 ボタン**（危険操作として `btn-danger` で区別）を追加。
  冒頭にユースケース説明「表示がおかしいときや同期がうまくいかないときに試してください。」を表示。
  各ボタンは押下でインライン確認（［キャンセル］／確定）。
  - **① ローカルデータを削除**: ローカル（todos・同期キャッシュ）を消すだけ。クラウドは不変。
  - **② クラウドから復元**: 事前に best-effort 同期（未送信を push）→ クリア → 再読込で起動時同期によりクラウドから再構築。
  - **③ 連携を解除してすべて削除**: 連携解除＋ローカル全消し＋設定を既定へ。クラウドは不変。
- **`src/store/resetStore.ts`（新規）** `clearLocalData()`: `todos`/`objects`/`meta`（同期キー）を消し、`deviceId` は
  書き戻して保持。`settings`・`tokens` は残す（連携を維持＝②で取り直せる）。リモートには触れない。
- **配線**: `src/state/actions.ts`（Actions/SyncBridge に `deleteLocalData`/`refetchFromCloud`/`factoryReset` を追加・委譲）、
  `src/syncRuntime.ts`（3 メソッドを実装。teardown→clearLocalData→`window.location.reload()`。③は `disconnect` ＋
  `saveSettings(DEFAULT_SETTINGS)` を併用）。

## 決定事項
- ③ の「初期化」は内部処理を表す「連携を解除してすべて削除」と表現（「端末」「初期化」等の曖昧語を避ける）。
- 復元（クラウドから取り直す）は「復元」と表現。ローカル⇔クラウドの対比で統一。
- 3 ボタンとも常時表示（②は未連携時に取り直せず①と同義になる点は確認文で補足）。
- バージョン据え置き（0.4.11）。develop 向け PR（CI は verify＋branch-policy）。

## 成果物
- 追加: `src/store/resetStore.ts`, `tests/store/resetStore.test.ts`
- 変更: `src/state/actions.ts`, `src/syncRuntime.ts`, `src/ui/views/SettingsView.ts`
- 追加: 本履歴ファイル
- 検証: `npm run lint && npm run typecheck && npm test`（169 passed）`&& npm run build` すべて緑。
