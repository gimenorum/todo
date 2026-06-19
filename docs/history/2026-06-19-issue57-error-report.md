# 2026-06-19 バグ/エラーの Issue 起票導線（#57）

## 日付
2026-06-19

## 依頼内容
- アプリのバグ/エラーを GitHub Issue に起票できる導線を用意（まずは利用者名義 / Issue #57）。
- 実装方式は調査必須 →「案 A（GitHub 新規 Issue 画面をプレフィルして開く）」で確定。
- 捕捉範囲＝「問題を報告」ボタン＋直近エラー添付＋致命的エラー画面からの報告。
- Phase 5（v1.0.0）リリースに含めたい。README（#58）とは別 PR。**マージは保留**（ユーザー指示）。

## 対応概要
- **`src/services/issueReporter.ts`（新規）**:
  - `buildIssueUrl({version, route, userAgent, errors})`（純関数）＝ `…/issues/new?title=…&body=…&labels=bug` を
    `URLSearchParams` で生成。本文は「不具合の内容/再現手順」記入欄＋自動入力の環境・直近エラー要約。URL 長対策で上限切り詰め。
  - `recordError` / `recentErrors` / `clearErrors`＝直近 5 件のみメモリ保持（個人データは載せない・自動送信しない）。
- **`src/main.ts`（変更）**: `window` の `error` / `unhandledrejection` を記録。`bootstrap` 失敗時は記録のうえ
  「この内容を報告」リンク（GitHub 新規 Issue 画面）を表示。
- **`src/state/actions.ts`（変更）**: `reportProblemUrl()` を追加（`__APP_VERSION__`・現在ルート・UA・直近エラーで URL 生成）。
- **`src/ui/views/SettingsView.ts`（変更）**: 「アプリ」セクションに「問題を報告」ボタン → `window.open` で新規タブ。

## 決定事項
- 案 A はトークン不要・CSP 変更不要・**ログイン中の利用者名義**で起票・送信前に確認可（GitHub へのトップレベル遷移は CSP 非規制）。
- エラーは記録のみで自動送信しない。タスク本文など個人データは本文に含めない。
- バージョン据え置き（0.4.11）。develop 向け PR。

## 成果物
- 追加: `src/services/issueReporter.ts`, `tests/services/issueReporter.test.ts`
- 変更: `src/main.ts`, `src/state/actions.ts`, `src/ui/views/SettingsView.ts`
- 追加: 本履歴ファイル
- 検証: `npm run lint && npm run typecheck && npm test`（174 passed）`&& npm run build` すべて緑。
