# 2026-06-17 hotfix: アプリ版数を package.json 由来に＋CI 自動タグ/デプロイ（v0.1.1）

## 日付
2026-06-17

## 依頼内容
- v0.1.0 デプロイ後、設定画面のバージョン表示が古い（`0.0.1` のまま）。直してほしい。
- ついでに「`package.json` の version を起点に CI でリリースタグ付与＋デプロイ」を自動化できないか。

## 経緯・決定
- 原因: `vite.config.ts` の `APP_VERSION` が `'0.0.1'` ハードコードで、`package.json`（`0.0.1`）・git タグ（`v0.1.0`）と独立にドリフトしていた。設定画面（`SettingsView`）と SW キャッシュ名はこの定数（`__APP_VERSION__`）由来。
- 版数の直し方（設計書 17「Phase 1=v0.1.0」と 15.3「タグは動かさない／修正は PATCH」の衝突）→ ユーザー決定: **v0.1.1 として hotfix**（タグ v0.1.0 は不動）。
- 自動化の懸念「main への直接 push 禁止では？」→ 整理: `release.yml` は (1) PR マージで main が更新された**後**に発火、(2) 作るのは **`refs/tags/v*`**（main ブランチへの push ではない）ため**抵触しない**。`GITHUB_TOKEN` で push したタグは他 workflow を起動しないため、デプロイは同 workflow 内で完結。→ ユーザー決定: **今回の hotfix に同梱**。

## 対応概要
- **版数の単一真実化**: `vite.config.ts` を `package.json` の `version` を読んで `APP_VERSION` に設定するよう変更（ハードコード廃止）。`package.json` を `0.1.1` に更新。
  - 検証: build 後 `dist/assets/app-*.js`（設定表示）と `dist/sw.js`（`app-shell-0.1.1`）に `0.1.1` が注入されることを確認。test 64 件 green。
- **CI 自動タグ＋デプロイ**: `.github/workflows/release.yml` を追加。
  - `on: push: branches:[main]`。`tag` ジョブが `package.json` の version で未作成なら `vX.Y.Z` を作成・push（`GITHUB_TOKEN`/`contents: write`）。`deploy` ジョブ（`created==true` のみ）が build → `upload-pages-artifact` → `deploy-pages`。
  - 手動/UI タグ発行は従来どおり `deploy.yml`（`on: push: tags`）が処理（温存）。`concurrency: pages` で同時デプロイを防止。
- **設計書**: `15 §15.2`（ワークフロー表に release.yml 行を追加・deploy.yml を手動タグ用と明記）、`§15.3`（通常リリースを「package.json 更新→main マージで自動タグ＋デプロイ」に）、`§15.4`（版数は package.json 単一真実／タグ作成はブランチ保護に抵触しない、を不変条件に追記）。

## 決定事項
- アプリ版数は **`package.json` を単一の真実**とし、`vite.config.ts` が `__APP_VERSION__` に注入。リリース時の版数更新は package.json のみ。
- リリースは **`package.json` を上げて main にマージするだけ**で、CI（`release.yml`）が version からタグ作成＋デプロイ。手動 Releases 発行は不要。
- 今回の修正は **v0.1.1**（PATCH hotfix）。タグ `v0.1.0` は動かさない。
- `release.yml` はタグ（`refs/tags/*`）のみ作成し main ブランチを更新しないため、「main 直接 push 禁止」に反しない。

## 成果物
- 変更: `vite.config.ts`, `package.json`
- 追加: `.github/workflows/release.yml`
- 設計書: `docs/design/15-build-deploy-ci.md`
- 証跡: `docs/history/2026-06-17-phase1-hotfix-version-automation.md`（本履歴）
