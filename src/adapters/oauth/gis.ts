// adapters/oauth/gis.ts — Google Identity Services（GIS）トークンモデルの薄いラッパ（ch.05 §5.5）。
// 静的 PWA（バックエンド無し）では Google のリフレッシュトークンが使えないため、GIS の
// initTokenClient で「アクセストークン（約 1 時間）」だけを取得する。期限切れは無音再取得（prompt:''）、
// 不可なら呼び出し側（googleTokenProvider）が AuthError（要再接続）に落とす。
// window/document への依存はこのモジュールに隔離する（pkce.ts と同じ adapters/oauth 層。
// services は DOM 非依存を保つ）。

const GIS_SRC = 'https://accounts.google.com/gsi/client';

// GIS が公開する最小の型（@types は使わず必要分だけ宣言する）。
interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GisTokenClient {
  requestAccessToken(overrideConfig?: { prompt?: string }): void;
}
interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (resp: GisTokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }): GisTokenClient;
}
type GisWindow = Window & { google?: { accounts?: { oauth2?: GisOAuth2 } } };

let gisPromise: Promise<GisOAuth2> | null = null;

// GIS スクリプトを一度だけ読み込み、google.accounts.oauth2 を返す（オンライン時のみ）。
function loadGis(): Promise<GisOAuth2> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<GisOAuth2>((resolve, reject) => {
    const ready = (): boolean => {
      const oauth2 = (window as GisWindow).google?.accounts?.oauth2;
      if (oauth2) {
        resolve(oauth2);
        return true;
      }
      return false;
    };
    if (ready()) return;
    const fail = (): void => {
      gisPromise = null; // 次回再試行できるようキャッシュを捨てる
      reject(new Error('Google 認証ライブラリ（GIS）の読み込みに失敗しました（オフライン？）。'));
    };
    const onLoad = (): void => {
      if (!ready()) fail();
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', onLoad);
      existing.addEventListener('error', fail);
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', onLoad);
    s.addEventListener('error', fail);
    document.head.appendChild(s);
  });
  return gisPromise;
}

export interface GoogleTokenRequest {
  clientId: string;
  scope: string;
  // 'consent'=初回連携（ポップアップで同意）, ''=無音再取得（既存同意・セッション有効なら UI なし）。
  prompt: 'consent' | '';
}

export interface GoogleToken {
  accessToken: string;
  expiresIn: number; // 秒
}

// GIS でアクセストークンを取得する。成功で {accessToken, expiresIn}、失敗/キャンセルで reject。
export async function requestGoogleAccessToken(req: GoogleTokenRequest): Promise<GoogleToken> {
  const oauth2 = await loadGis();
  return new Promise<GoogleToken>((resolve, reject) => {
    let settled = false;
    const client = oauth2.initTokenClient({
      client_id: req.clientId,
      scope: req.scope,
      callback: (resp) => {
        settled = true;
        if (!resp.access_token || resp.error) {
          reject(
            new Error(resp.error_description ?? resp.error ?? 'Google トークン取得に失敗しました。'),
          );
          return;
        }
        resolve({ accessToken: resp.access_token, expiresIn: resp.expires_in ?? 3600 });
      },
      error_callback: (err) => {
        if (settled) return;
        reject(new Error(err.message ?? err.type ?? 'Google 認可がキャンセルされました。'));
      },
    });
    client.requestAccessToken({ prompt: req.prompt });
  });
}
