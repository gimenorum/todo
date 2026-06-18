# Google Drive 連携のセットアップ（Phase 3）

このアプリは Google Drive を 2 つ目の保存先に使えます。バックエンドの無い静的 PWA のため、
**Google Identity Services（GIS）のトークンモデル**を採用しています（アクセストークンのみ・約 1 時間・
リフレッシュトークン無し。`client_secret` は使いません）。実機テスト／本番リリースには、あなた自身の
**Google OAuth クライアント ID** が必要です。以下の手順で発行してください。

> 設計の根拠は [`docs/design/05-storage-adapter.md` §5.5](./design/05-storage-adapter.md)。

## 1. Google Cloud プロジェクトと Drive API

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成（既存でも可）。
2. 「API とサービス」→「ライブラリ」で **Google Drive API** を有効化。

## 2. OAuth 同意画面

1. 「API とサービス」→「OAuth 同意画面」。User Type は **External**。
2. アプリ名・サポートメール等を入力。
3. スコープに **`https://www.googleapis.com/auth/drive.appdata`**（appDataFolder。アプリ専用フォルダのみ・
   非機微スコープ）を追加。これ以外は要求しません。
4. 公開ステータスが「**テスト**」の間は、利用するアカウントを **テストユーザー**に追加してください
   （未追加だと同意できません）。広く使う場合は「本番（公開）」へ。

## 3. OAuth クライアント ID（ウェブ アプリケーション）

1. 「API とサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」。
2. アプリケーションの種類は **「ウェブ アプリケーション」**。
3. **承認済みの JavaScript 生成元** に、アプリを動かすオリジンを追加（GIS トークンモデルは
   **リダイレクト URI ではなく JavaScript 生成元**を使います）:
   - 開発: `http://localhost:5173`（`npm run dev` の既定ポート。異なる場合はそれに合わせる）
   - 本番: GitHub Pages のオリジン（例: `https://<user>.github.io`。独自ドメインならそのオリジン）
4. **承認済みのリダイレクト URI は不要**です（空のままで可）。
5. 作成後に表示される **クライアント ID** を控えます（`client_secret` は使いません）。

## 4. クライアント ID をアプリに渡す（`VITE_GOOGLE_CLIENT_ID`）

PKCE/GIS の public client なので、この値は秘密ではなくクライアントに同梱されます。

- **ローカル開発**: リポジトリ直下に `.env`（または `.env.local`）を作成し、
  ```
  VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
  ```
  を記載（`.gitignore` 済みのファイルを使う）。`npm run dev` で読み込まれます。
- **本番（GitHub Pages）**: リポジトリの **Settings → Secrets and variables → Actions → Variables** に
  リポジトリ変数 **`VITE_GOOGLE_CLIENT_ID`** を追加（Dropbox の `VITE_DROPBOX_APP_KEY` と同じ要領）。
  `deploy.yml` / `release.yml` のビルドが `import.meta.env` へ注入します。未設定ならバンドルに ID が入らず
  「Google Drive に接続」ボタンは表示されません。

## 5. 動作確認（E2E）

1. 設定画面の「**Google Drive に接続**」を押すと Google の同意ポップアップが出ます。許可すると連携完了です。
2. タスクを作成・編集して別端末（同一 Google アカウント）と同期されることを確認。
3. データはアプリ専用の **appDataFolder** に保存され、他アプリやユーザーの通常のドライブからは見えません。

## 注意・制約

- **トークンは約 1 時間で失効**します。失効後は自動で無音再取得を試み、できない場合は「**要再接続**」表示に
  なります。設定画面の「Google Drive に接続」で再度許可してください（GIS の仕様上の挙動）。
- 一部ブラウザのサードパーティ Cookie 制限により無音再取得が失敗することがあります（その場合も再接続で復帰）。
- Dropbox と Google Drive は同時に 1 つだけ連携できます（切替は「保存先から切断」→ もう一方に接続）。
