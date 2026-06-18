# 2026-06-17 タグ作成後に GitHub Release を自動作成（プレリリース判定付き）

## 日付
2026-06-17

## 依頼内容
- Phase 2 に着手するにあたり、**今フェーズのリリースから、タグ作成に続けて GitHub Release を自動作成**したい。
- 補足: Release の**タイトル・説明**を設定し、**Phase 5 まではプレリリース**として扱ってほしい。

## 経緯・決定
- 現状の `release.yml` は `main` 更新時に「`package.json` の version からタグ作成 → Pages デプロイ」までで、**GitHub Release オブジェクトは未作成**だった（タグのみ）。`gh` CLI は GitHub ランナー標準、`release.yml` は既に `contents: write` を持つため、同一ワークフロー内に `gh release create` を 1 ステップ足すだけで実現できる。
- プレリリース境界（設計書では Phase 5 = `v1.0.0` =「最初の安定版」）→ ユーザー決定: **`v0.x.y`（Phase 0–4）はプレリリース、`v1.0.0`（Phase 5）以降は正式リリース**（「5 からリリースで問題ない」と確認）。タグの**メジャーが 0 か否か**で機械判定する。
- タイトル/本文 → ユーザー決定: **タイトル=タグ名 `vX.Y.Z`／本文=GitHub 自動生成リリースノート**（追加メンテ不要）。

## 対応概要
- **`.github/workflows/release.yml`**: `tag` ジョブのタグ作成ステップ直後に「Create GitHub Release」ステップを追加（`if: steps.tag.outputs.created == 'true'`）。`GH_TOKEN` を渡し、タグ名のメジャーが `0` なら `--prerelease` を付けて `gh release create "$version" --title "$version" --generate-notes [--prerelease]` を実行。先頭コメントも更新。
  - Release 作成はタグ push を伴わないため `deploy.yml`（`on: push: tags`）を再起動せず、`deploy` ジョブは従来どおり別ジョブで実行＝**二重デプロイは起きない**。
- **設計書 `15-build-deploy-ci.md`**: §15.2 ワークフロー表の「main 更新」行に GitHub Release 作成を追記／§15.3 通常リリースを「タグ自動作成＋GitHub Release 作成＋デプロイ」に更新／バージョン表下にプレリリース判定の注記を追加／§15.4 不変条件に GitHub Release 自動作成＋プレリリース方針を 1 項目追加。
- **設計書 `17-phase-map.md`**: §17.1 の表の直後に、`v0.x.y` はプレリリース・`v1.0.0` から正式という注記（15 章へクロスリファレンス）を追加。

## 決定事項
- GitHub Release は `release.yml` が**自動作成**（タイトル=タグ名、本文=自動生成ノート）。リリース時の手作業は不要。
- **プレリリース判定はタグのメジャーで機械化**: `v0.x.y` = プレリリース、`v1.0.0` 以降 = 正式リリース。
- 本変更は**版数を上げず・リリースを発生させない**（`package.json` は `0.1.1` のまま）。初発火は Phase 2 の `v0.2.0` リリース（develop→main マージ時、その時点の `release.yml` が使われる）。
- デリバリは Git Flow 準拠で **`feature/release-automation` → develop**（`branch-policy.yml` が `develop ← feature/*` のみ許可のため）。

## 成果物
- 変更: `.github/workflows/release.yml`
- 設計書: `docs/design/15-build-deploy-ci.md`, `docs/design/17-phase-map.md`
- 証跡: `docs/history/2026-06-17-release-github-release-automation.md`（本履歴）
