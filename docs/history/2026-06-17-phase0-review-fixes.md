# 2026-06-17 Phase 0 設計準拠レビューの反映

## 日付
2026-06-17

## 依頼内容
- サブエージェントに「設計書とソースの突き合わせ（設計準拠レビュー）」を依頼し、その指摘を反映する。
- 対応範囲はユーザー選択により「**実装の軽微修正＋設計書の更新（章ステータス更新含む）**」。追加分は `feature/scaffold` にコミット。

## 対応概要
- **レビュー結果**: 準拠度は高く、設計違反（Blocker/High）は 0。Medium 1・Low 12・Nit 6。Medium と複数の Low は「実装が正・設計書が陳腐化」。
- **実装の軽微修正（4 件）**:
  - `eslint.config.js`: `services/` レイヤの import 制約規則を追加（ui/state/router/pwa を禁止＝依存逆流の網を補完 / ch.01 §1.3）。
  - `vite.config.ts`: CSP `<meta>` を `head-prepend`（charset より前）から **`<meta charset>` の直後**へ注入するよう変更（charset 最優先を維持しつつ後続リソースに効かせる）。
  - `.github/workflows/ci.yml` / `deploy.yml`: Node を 20 → **22**（`@types/node ^22`・`engines >=20.11` と整合）。
  - `.github/workflows/deploy.yml`: タグが **main 上にあることを保証**するガード（`git merge-base --is-ancestor`）を追加（要件「main のバージョンタグ基準」）。
- **設計書の更新（実装が正・設計の陳腐化を解消）**:
  - `06 §6.1`: `todos` の index から `deleted` を削除（boolean は IDB index 不可＝表示フィルタは selectors）。
  - `12 §12.1`: キャッシュ名を `app-shell-<APP_VERSION>` に修正、ナビゲーションの SWR 風更新と `skipWaiting` 不採用（安全側）を明記。
  - `12 §12.3`: CSP に `base-uri`/`manifest-src`/`worker-src` を追記、本番ビルド時のみ charset 直後に注入する旨を明記。
  - `02 §2.1/§2.3`: `<template>` は `index.html` に集約（`ui/templates/` は当面使わない）方針を反映。
  - `01 §1.3`: state は `idb` 直 import 禁止（ESLint で強制）を明文化。
  - `15 §15.2`: 依存逆流 lint は `npm run lint` に内包（独立ジョブにしない）を明記。
  - 章ステータス更新: `07/08/12/15` を「実装済（Phase 0）」、`02/03/06/14` を「一部実装済（Phase 0）」に。`README` 章一覧の状態列とライフサイクル注記（`一部実装済（Phase N）`）も更新。
- **検証**: lint / typecheck / test(14) / build すべて green。本番ビルドで CSP が `<meta charset>` の直後・script/style の前に来ることを確認。

## 決定事項
- 設計書は要件に次ぐ参照対象として実装と整合させ続ける（実装が妥当な箇所は設計書側を更新する）。
- 依存逆流の機械強制に `services/` を追加し、全レイヤを ESLint の網でカバー。
- CSP は charset 最優先、その直後に注入。Pages デプロイはタグが main 上にある場合のみ実行。
- 設計章の状態に中間値「一部実装済（Phase N）」を導入。
- 受け入れ基準のうち実機依存項目（インストール/オフライン/~768px 切替/iOS）は手動確認が必要（別途）。

## 成果物
- 修正: `eslint.config.js`, `vite.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- 設計書更新: `docs/design/01,02,06,12,15` ＋ `docs/design/README.md`、章ステータス（`02,03,06,07,08,12,14,15`）
- 証跡: `docs/history/2026-06-17-phase0-review-fixes.md`（本履歴）
