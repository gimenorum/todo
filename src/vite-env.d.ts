/// <reference types="vite/client" />

// vite.config.ts の define で注入されるアプリバージョン（SW のキャッシュ名等に使う）。
declare const __APP_VERSION__: string;

// アプリ固有のビルド時 env（Phase 2–3）。vite/client の ImportMetaEnv に宣言マージで追加する。
interface ImportMetaEnv {
  // Dropbox OAuth の App key（PKCE public client なので秘密情報ではない）。未設定なら連携不可。
  readonly VITE_DROPBOX_APP_KEY?: string;
  // Google OAuth クライアント ID（GIS トークンモデル / public client・秘密でない）。未設定なら Google 連携不可。
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
