# 2026-06-18 Issue #41 「要再接続」導線の改善（再連携アクション ＋ ヘッダー誘導 ＋ 同期ボタン連打防止）

## 日付
2026-06-18

## 依頼内容
- Issue #41（本文＋コメント2件）の計 3 点を対応。ホットフィックス扱い。
  1. **再連携アクション（本文）**: 同期が `needs-reauth`（再認証要）になると、ヘッダーに「要再接続」・設定タブに
     `!` バッジは出るが、設定画面に明確な再連携アクションが無い（連携済みは連携ボタンを隠し「連携を解除」のみ）。
     利用者が復帰操作にたどり着けない。
  2. **ヘッダー導線（コメント1）**: 「要再接続」表示をタップで設定画面を開けるようにしたい。
  3. **「今すぐ同期」連打防止（コメント2）**: 同期中はボタンを非活性化し文言を「同期中」に。文言が変わっても
     ボタン横幅は同じになるよう調整。
- ユーザー確認: ヘッダー文言「要再接続」→「要再連携」に変更（「連携」基調 / #33 に整合）。
  再連携 UI は「説明文＋再連携ボタン」。

## 対応概要
- `src/ui/views/SettingsView.ts`:
  - 「クラウド連携」セクションに説明文 `reconnectNote`（「再連携が必要です。下のボタンから再連携してください。」）
    と `reconnectBtn`（「再連携」）を追加。`update(state)` で `connected && global==='needs-reauth'` のときのみ表示。
  - 再連携ボタンは新規アクションを足さず、現在の `connectedProvider` に応じて既存の
    `connectGoogle()` / `connectDropbox()` を再実行（needs-reauth でも `connectedProvider` は保持）。エラー表示は
    既存 `showConnectError` を再利用。
  - 「今すぐ同期」ボタンに `btn-sync-now` クラスを付与。`update(state)` で `global==='syncing'` のとき
    `disabled=true` ＋ 文言「同期中…」（`setTextIfChanged`）に切替＝連打防止。
- `src/ui/layout/StatusIndicator.ts`:
  - `needs-reauth` のラベルを「要再接続」→「**要再連携**」に変更。
  - `createStatusIndicator(onActivate?)` に誘導コールバックを追加。`needs-reauth` 表示中のみ `role=button`/
    `tabindex=0`/`title`/`status-actionable` クラスを付け、クリック・Enter/Space で `onActivate` を発火
    （操作可否は `update` で立てる `actionable` フラグで管理）。それ以外は `role=status` に戻す。
- `src/ui/layout/AppShell.ts`:
  - `createStatusIndicator(() => ctx.navigate({ name: 'settings' }))` を渡し、ヘッダーから設定画面へ誘導。
- `styles/layout.css`: `.sync-status.status-actionable`（cursor/underline）を追加。
- `styles/components.css`: `.btn:disabled`（薄表示・not-allowed）、`.btn-sync-now { min-width: 7.5em }`
  （文言切替で幅が変わらない）を追加。
- hotfix 扱いのため `package.json` version を 0.4.7 → 0.4.8 に bump。

## 決定事項
- ヘッダー文言は「要再連携」に統一（リポジトリの「連携」基調 / #33 に整合）。
- 再連携は専用アクションを新設せず、既存 `connectGoogle`/`connectDropbox` の再実行で実現（範囲最小）。
- ヘッダーの誘導は `needs-reauth` のときのみ（通常時は従来どおり `role=status` で非リンク）。
- 同期ボタンの連打防止は `global` ステータス参照のみで実現（同期エンジン・データモデルは無変更）。
- 既存テストは純関数・サービス層が対象で UI 表示・ナビには非依存（155 件グリーン維持）。

## 成果物
- 変更: `src/ui/views/SettingsView.ts`
- 変更: `src/ui/layout/StatusIndicator.ts`
- 変更: `src/ui/layout/AppShell.ts`
- 変更: `styles/layout.css`
- 変更: `styles/components.css`
- 変更: `package.json`（version 0.4.7 → 0.4.8）
- 新規: `docs/history/2026-06-18-issue41-reauth-guidance.md`（本ファイル）
