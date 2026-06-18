# 2026-06-18 本番ビルドに VITE_DROPBOX_APP_KEY を注入（デプロイ設定の穴を塞ぐ）

## 日付
2026-06-18

## 依頼内容
- main へマージする前のデプロイ設定の説明依頼に続き、「B（ワークフロー修正）はやってください」。

## 対応概要
- 問題: `release.yml`／`deploy.yml` のビルド step が `npm run build` のみで、`VITE_DROPBOX_APP_KEY`
  をビルドに渡していなかった。リポジトリ変数を設定しても Vite に届かず、**本番バンドルに Dropbox の
  App key が入らない**＝本番で連携が起動しない（`connectDropbox` が「未設定」で停止）。
- 修正: 両ワークフローのビルド step に環境変数注入を追加。
  ```yaml
  - run: npm run build
    env:
      VITE_DROPBOX_APP_KEY: ${{ vars.VITE_DROPBOX_APP_KEY }}
  ```
- 設計書 `docs/design/15-build-deploy-ci.md` §15.2 に App key の供給方法（**リポジトリ変数**を使う／
  `deploy.yml` の build は environment 未宣言ゆえ Environment 変数では参照不可）を明記。
- CI（`ci.yml`）の build は本番デプロイではなくスモークなので注入不要（キー未設定でもビルドは通る）。

## 決定事項
- App key は **GitHub Actions のリポジトリ変数 `VITE_DROPBOX_APP_KEY`**（Secret でなく Variable）で供給する。
  Environment 変数は `deploy.yml` の build ジョブ（environment 未宣言）から見えないため採用しない。
- 本修正は `feature/ci-dropbox-app-key` → develop の PR で入れ、develop→main（PR #14）に同梱して
  main 反映時に有効化する（deploy 時に走るのは main 上のワークフローのため）。

## 成果物
- 変更: `.github/workflows/release.yml`、`.github/workflows/deploy.yml`（ビルド step に env 注入）、
  `docs/design/15-build-deploy-ci.md`（§15.2 追記）
- 新規: `docs/history/2026-06-18-ci-dropbox-app-key-inject.md`（本ファイル）
