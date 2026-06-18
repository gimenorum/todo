# 2026-06-18 main 向け PR に version 引き上げ必須チェックを追加（version-check.yml）

## 日付
2026-06-18

## 依頼内容
- 「main への PR のチェック条件に、前回バージョンから（version が）上がったことをチェックできますか？」

## 対応概要
- 背景: リリースは `release.yml` が main 更新時に `package.json` の version からタグ未作成なら作成する方式で、
  **版数採番は手動**。version を上げ忘れて main にマージしても `release.yml` は `created=false` で何もしない
  （デプロイされない“無言の失敗”）。この上げ忘れ／下降を CI で機械的に弾く。
- 追加: `.github/workflows/version-check.yml`（新規）。
  - トリガ: `pull_request` の `branches: [main]`（**main 向け PR 限定**）。`permissions: contents: read`。
  - 取得: HEAD 版は作業ツリーの `package.json`、BASE 版は `git show "origin/<base>:package.json"`
    （`actions/checkout` は `fetch-depth: 0`＋base を明示 fetch）。**PR 由来スクリプトは実行しない**（JSON 読取 /
    git show / sort のみ・secrets 不使用）。
  - 判定: `package.json` の version が base(main) より**厳密に大きい**こと。同値は文字列一致で先に弾き、
    残りは `sort -V` で比較（依存ゼロ・`npm ci` 不要）。X.Y.Z 形式のみ許可（pre-release は `sort -V` が誤順のため弾く）。
  - メジャー昇格（例 `0.5.1→1.0.0`）・二桁セグメント（`0.9.0→0.10.0`）も `sort -V` で正しく PASS することを実機確認。
- 初回有効化: `pull_request` はマージコミットからワークフロー定義を評価するため、本 PR を develop に入れると
  開いている PR #14（develop→main）で version-check が走り、`0.1.1→0.2.0` を検証して green になる。
- 設計書 `docs/design/15-build-deploy-ci.md`: §15.2 表に version-check 行を追加、§15.3/§15.4 に機械強制を明記。

## 決定事項
- 比較対象は **base(main) の `package.json`**（＝前回バージョン）。タグ参照は不要（main の package.json は最後の
  リリース版＝最新タグと一致するため等価で単純）。
- バージョンは **X.Y.Z 前提**で `sort -V` 比較。将来 pre-release 識別子を使うなら `semver`（lock に既存）へ切替。
- **必須チェック化**（`main` ブランチ保護の Require status checks に `version-check` を追加）は GitHub 設定で
  ユーザーが実施。**初回 green（PR #14）を出してから**必須指定する（未生成コンテキストを必須にすると全 PR が pending）。
- ブランチは `feature/version-check`（develop ← feature/* 準拠）。ワークフロー＋設計＋履歴を 1 コミットに。

## 利用者側の必要対応
- `main` のブランチ保護／ruleset の「Require status checks to pass」に **`version-check`**（ジョブ id）を追加。
  PR #14 で一度 green を出した後に指定する。

## 成果物
- 新規: `.github/workflows/version-check.yml`、`docs/history/2026-06-18-version-bump-check.md`（本ファイル）
- 変更: `docs/design/15-build-deploy-ci.md`（§15.2 表・§15.3・§15.4）
