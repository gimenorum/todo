# 2026-06-17 Phase 0（雛形＋ローカル専用 TODO アプリ）の実装

## 日付
2026-06-17

## 依頼内容
- 設計書（`docs/design/`）に基づき **Phase 0** を実装する。着手前に方針を確認。
- 確認の結果、以下を決定：
  - ブランチ: `main → develop → feature/scaffold` を作成し `feature/scaffold` で実装（要件の Git Flow）。
  - 提供単位: Phase 0 全体を実装してからまとめてレビュー（途中停止なし。レビューしやすいよう論理単位でコミット）。
  - CI/デプロイ: PR 用 CI（lint/typecheck/test/build）＋ `v*` タグ時の Pages デプロイ workflow を用意。実 Pages 有効化・`v0.0.1` タグ・main マージはレビュー後。
  - アイコン: プレースホルダーを生成（後で差し替え可）。

## 対応概要
- **雛形・ビルド基盤**: Vite（`base: './'`＝オリジン非依存）、TypeScript（strict、app と SW で tsconfig 分離）、ESLint flat config（依存逆流を `no-restricted-imports` で機械強制 / ch.01 §1.5）、Vitest（jsdom）。CSP は本番ビルド時のみ `<meta>` を `<head>` 先頭に注入（dev は HMR のため除外）。
- **データモデル**（ch.03）: `model/types.ts` に型の単一の真実（Todo/Snapshot/Commit/State/Route ほか）。`constants.ts`・`ids.ts`。
- **ローカルストア**（ch.06, Phase 0 範囲）: `store/`（idb）に `todos`/`settings`/`meta(deviceId)`。materialize 済みリストを永続。
- **サービス/状態/ルータ**: `services/`（CRUD・設定）、`state/`（observable store＋selectors＋actions、setState→render 単一経路 / ch.07）、`router/`（ハッシュルート / ch.08）。依存方向 `ui→state→services→store`。
- **UI**（ch.07/08）: `ui/`（AppShell、タスク一覧＝id キー差分更新でフォーカス維持、個別編集＝全フィールド、設定シェル）。`<template>` クローン＋`textContent`（`innerHTML` 不使用）。レスポンシブナビ ~768px（CSS：モバイル＝下部タブ／PC＝折り畳み可サイドバー）。
- **PWA**（ch.12）: 手書き SW（precache＋実行時キャッシュ、`skipWaiting` なし＝安全側、固定名 `sw.js` 別ビルド）、`registerSW`、`beforeinstallprompt` 取り扱い、`manifest.webmanifest`（相対 `scope`/`start_url`）、プレースホルダーアイコン（192/512/maskable/apple-touch、`scripts/gen-icons.mjs` で生成）。
- **未連携の徹底**: `State.global = 'unlinked'` 固定。同期系のステータス/バッジを一切描画しない（受け入れ基準 / ch.09）。設定には接続導線のみ常設。
- **テスト**: `tests/`（store・selectors・routes・id キー差分更新＝フォーカス維持）。14 件 green。
- **CI/CD**: `.github/workflows/ci.yml`（lint/typecheck/test/build）、`deploy.yml`（`v*` タグ → Pages）。
- 検証: typecheck / lint / test(14) / build すべて green。`vite preview` で index.html・sw.js・manifest・icons が 200。CSP が script/style より前に配置されることを確認。

## 決定事項
- Phase 0 は「未連携のローカル TODO アプリ」に徹し、同期系 UI を出さない。同期エンジンは Phase 1。
- アーキテクチャの依存方向を ESLint で機械強制（`core` は将来 Phase 1、`ui` は core/adapters/store を直接呼ばない）。
- SW は `skipWaiting` を使わず更新は次回起動で切替（安全側）。手書き SW を classic worker として固定名出力。
- CSP は本番のみ注入（dev は HMR と非両立）。Phase 0 は保存先が無いため `connect-src 'self'`、Phase 2 で保存先 FQDN を追加。
- アイコンは Node 標準のみで生成したプレースホルダー（依存を増やさない）。後で差し替え可能。
- 実 Pages 有効化（リポジトリ設定）・`v0.0.1` タグ・develop→main マージはレビュー後に実施。

## 成果物
- 設定: `package.json` / `package-lock.json` / `tsconfig.json` / `tsconfig.sw.json` / `vite.config.ts` / `eslint.config.js` / `.gitignore` / `index.html` / `src/vite-env.d.ts`
- ソース: `src/model/*` / `src/store/*` / `src/services/*` / `src/state/*` / `src/router/*` / `src/ui/**` / `src/pwa/*` / `src/sw/*` / `src/main.ts`
- スタイル/資産: `styles/*.css` / `public/manifest.webmanifest` / `public/icons/*` / `scripts/gen-icons.mjs`
- テスト: `tests/state/*` / `tests/router/*` / `tests/ui/*`
- CI/CD: `.github/workflows/ci.yml` / `.github/workflows/deploy.yml`
- 証跡: `docs/history/2026-06-17-phase0-scaffold.md`（本履歴）
