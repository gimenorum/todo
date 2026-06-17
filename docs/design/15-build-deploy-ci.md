# 15. ビルド・デプロイ・CI

> 要件トレース: requirements.md「Git ブランチ戦略」「技術スタック」「デプロイ / ホスティング」
> 状態: 実装済（Phase 0） ／ 実装フェーズ: 0

## 15.1 ビルド（Vite）

- **Vite** でビルド。アプリ本体と **手書き SW**（[12](./12-pwa-sw-csp.md)）を**複数入力**にする（`rollupOptions.input` に `index.html` と `src/sw/sw.ts`）。SW はハッシュ無しの固定名で出力。
- `base` は **相対（`./`）＝オリジン/サブパス非依存**（決定 #1）。本番オリジンや Pages パスをビルドに固定せず、独自ドメイン（ルート）でもサブパスでも同一成果物が動く。
- 依存は最小（`idb` 程度）。テストは Vitest、スタイルは素の CSS（要件「技術スタック」）。

## 15.2 デプロイ（GitHub Pages + Actions）

- ホスト: **GitHub Pages（public リポジトリ）**。**GitHub Actions** で `dist/` をデプロイ（main のバージョンタグ基準 / 要件「デプロイ / ホスティング」）。
- 独自ドメイン使用（取得済み・DNS は GitHub Pages に向け済み / 要件「デプロイ / ホスティング」）。**本番オリジンはビルド・文書に固定しない**（決定 #1）。
- マニフェスト `scope`/`start_url` は相対、OAuth リダイレクトは `window.location.origin` 基準、CSP は保存先 FQDN＋`'self'`＝すべて**オリジン非依存**（[12](./12-pwa-sw-csp.md)・[05](./05-storage-adapter.md)）。OAuth リダイレクト URI の各プロバイダ登録は **Phase 2/3 にユーザーが実施**。

### ワークフロー設計

| イベント | ジョブ | 必須チェック |
|---|---|---|
| PR（→ develop / main） | lint（**依存逆流 lint を内包**＝独立ジョブにしない / [01 §1.5](./01-architecture.md)）＋typecheck＋test＋build | green 必須（ブランチ保護） |
| `main` 更新（PR マージ） | `package.json` の version から未作成なら `v*` タグを作成 → Pages デプロイ（`release.yml`） | — |
| `main` のバージョンタグ（`v*`）push | build → Pages デプロイ（`deploy.yml`：手動/UI タグ用） | — |

## 15.3 Git Flow 運用（簡易）

要件「Git ブランチ戦略」 を運用チェックリストとして固定する（再掲でなく運用化）。

- ブランチ: **main**（リリース・常にデプロイ可能）/ **develop**（統合先）/ **feature/<名前>**（develop から）/ **hotfix/<名前>**（main から）。
- 保護: main・develop とも **PR 必須・直接 push 禁止・force-push 禁止・必須チェック green**。
- マージ方式: **「Create a merge commit」のみ**許可（Squash/Rebase を無効化）。
- 通常リリース: feature →(PR)→ develop → フェーズ完成・green → **`package.json` の version を更新** → develop →(PR)→ main →（`release.yml` が version から **タグ自動作成＋デプロイ**。手動タグは不要）。
- フェーズ途中の PATCH: hotfix を main から → 修正 →(PR)→ main → PATCH タグ → デプロイ → 同じ hotfix を develop にも取り込み。
- 巻き戻し: すべて GitHub「Revert」（reset/force-push 不可）。
- release ブランチは作らない。

### バージョン（小文字 v ＋ SemVer）

| Phase | tag |
|---|---|
| 0 | `v0.0.1` |
| 1 | `v0.1.0` |
| 2 | `v0.2.0` |
| 3 | `v0.3.0` |
| 4 | `v0.4.0` |
| 5 | **`v1.0.0`（最初の安定版）** |
| 6 以降（任意） | `v1.1.0`… |

フェーズ途中/後のバグ修正は hotfix で PATCH（例 `v0.2.1`）。

## 15.4 関連する不変条件

- 依存逆流（[01](./01-architecture.md)）を CI の必須チェックで機械的に防ぐ。
- main は常にデプロイ可能（ブランチ保護＋必須 green）。
- マージはマージコミットのみ（履歴の追跡性 / Revert 運用の前提）。
- アプリ版数は **`package.json` を単一の真実**とし、`vite.config.ts` が読み込んで `__APP_VERSION__`（設定画面表示・SW キャッシュ名 `app-shell-<version>`）へ注入する。版数更新は package.json のみ（別定数へのハードコードはドリフトの原因なので禁止）。
- `release.yml` のタグ作成は `refs/tags/v*` への push＝**main ブランチ（`refs/heads/main`）は更新しない**ため、ブランチ保護（直接 push 禁止）に抵触しない。`GITHUB_TOKEN` で push したタグは `deploy.yml` を起動しない仕様なので、デプロイは `release.yml` 内で完結させる。
