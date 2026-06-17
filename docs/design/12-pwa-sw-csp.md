# 12. PWA / Service Worker / CSP / マニフェスト

> 要件トレース: requirements.md「技術スタック」「対応プラットフォームと制約」「デプロイ / ホスティング」「セキュリティ」
> 状態: 実装済（Phase 0 ／ Phase 2：CSP に Dropbox FQDN 追加） ／ 実装フェーズ: 0→2

## 12.1 Service Worker（手書き・依存なし）

- **手書き SW**（ライブラリ非依存 / 要件「技術スタック」）。`src/sw/sw.ts` を**別ビルド入力**にする（Vite の `rollupOptions.input` に app と sw を並べる / [15](./15-build-deploy-ci.md)）。
- キャッシュ戦略:

| 対象 | 戦略 | 備考 |
|---|---|---|
| アプリシェル（HTML/JS/CSS/アイコン） | precache | バージョン付きキャッシュ名（`app-shell-<APP_VERSION>`。`vite.config.ts` の define 由来） |
| ナビゲーション要求 | cache-first → ネット fallback | オフライン起動を保証。背面で再取得し `./index.html` を更新（stale-while-revalidate 風）＝ハッシュ無し HTML/manifest の陳腐化を緩和 |
| データ（TODO） | キャッシュしない | IndexedDB が正（[06](./06-local-store.md)） |
| OAuth/API 通信 | SW 介入しない | network only |

- 更新フロー: 新 SW を `install` で precache、`activate` で旧キャッシュ掃除。**実装は安全側を採用＝`skipWaiting` は使わず（更新は次回起動で切替）、`activate` で `clients.claim` のみ**。

## 12.2 マニフェスト

`public/manifest.webmanifest`:

- `name` / `short_name` / `display: standalone` / `theme_color` / `background_color` / `icons`（各サイズ）。
- **`scope` / `start_url` は相対（`./`）＝オリジン非依存**（決定 / [18](./18-open-questions.md) #1）。本番オリジンを文書・ビルドに固定しない。独自ドメインでもサブパスでも同一成果物が動く。
- iOS は「ホーム画面に追加」想定（要件「対応プラットフォームと制約」）。`apple-touch-icon` 等の iOS 向けメタを `index.html` に併記。

## 12.3 CSP（`<meta http-equiv>`）

GitHub Pages はレスポンスヘッダを設定できないため、CSP は `index.html` の `<meta http-equiv="Content-Security-Policy">` で指定する（要件「デプロイ / ホスティング」）。本実装では**本番ビルド時のみ** Vite プラグインで `<meta charset>` の直後（後続リソース読み込みに効く位置）へ注入する。dev は HMR がインライン/eval を使うため注入しない（`vite.config.ts`）。

方針（**オリジン非依存**＝決定 #1）。アプリ自身のオリジンは `'self'` で吸収するため、本番オリジンを CSP にハードコードしない。保存先（Dropbox/Google）の固定 FQDN だけを列挙する（Dropbox は確定済み＝下表。Google は Phase 3 / [18](./18-open-questions.md) #5）。

| ディレクティブ | 値（方針） |
|---|---|
| `default-src` | `'self'` |
| `script-src` | `'self'`（インライン不可＝nonce 不要設計） |
| `style-src` | `'self'`（必要なら `'unsafe-inline'` を最小限） |
| `img-src` | `'self' data:` |
| `connect-src` | `'self' https://api.dropboxapi.com https://content.dropboxapi.com`（Dropbox：download/upload と RPC/token。認可ページ `www.dropbox.com` はトップレベル遷移ゆえ対象外。Google は Phase 3） |
| `object-src` | `'none'` |
| `base-uri` | `'self'` |
| `manifest-src` | `'self'` |
| `worker-src` | `'self'`（手書き SW の登録元） |

## 12.4 オフライン / インストール

- Phase 0 で「インストール可・オフライン動作」を満たす（受け入れ基準 / 要件「実装フェーズ」）。
- `pwa/installPrompt.ts` が `beforeinstallprompt` を扱い、設定や初回案内からインストール導線を出す。
- iOS は `beforeinstallprompt` 非対応のため、Safari の「ホーム画面に追加」を案内（要件「対応プラットフォームと制約」）。

## 12.5 プラットフォーム制約

- 標準 Web API のみで全エンジン（Chromium/WebKit/Gecko）で動く（要件「対応プラットフォームと制約」）。
- **File System Access API は使わない**（要件「対応プラットフォームと制約」, 要件「エクスポート / インポート」）。
- iOS は Background Sync 非依存。前面復帰/起動時に同期（[11](./11-sync-triggers.md)・受け入れ基準）。

## 12.6 関連する不変条件

- CSP は `<meta>` で効かせる（ヘッダ不可 / 要件「デプロイ / ホスティング」）。
- `innerHTML` 不使用・最小権限スコープ・HTTPS（[14](./14-security.md)）。
- インストール・オフライン動作（受け入れ基準 / 要件「実装フェーズ」）。
