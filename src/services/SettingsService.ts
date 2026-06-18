import * as settingsStore from '../store/settingsStore';
import * as tokenStore from '../store/tokenStore';
import { getOrCreateDeviceId } from '../store/metaStore';
import { DropboxAdapter } from '../adapters/DropboxAdapter';
import { AuthError } from '../adapters/errors';
import type { TokenProvider } from '../adapters/oauth/tokenStore';
import { exchangeCodeForToken, refreshAccessToken } from '../adapters/oauth/tokenStore';
import {
  buildAuthUrl,
  codeChallenge,
  generateCodeVerifier,
  generateState,
  parseCallback,
  redirectUri,
} from '../adapters/oauth/pkce';
import type { DeviceId, DeviceSettings, StorageAdapter } from '../model/types';

// 端末ごと設定 ＋ Dropbox OAuth（PKCE）連携（ch.05 §5.4・ch.18 #3）。

const DROPBOX_APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY;
const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
// アダプタが必要とする最小スコープ（list=metadata.read／download=content.read／upload・delete=content.write）。
// 認可 URL に明示指定して付与を確定させる。※ Dropbox アプリの「Permissions」でも同じ権限を有効化
// しておかないとトークンに付与されず、各操作が 403 missing_scope になる（ch.05 §5.4）。
const DROPBOX_SCOPE = 'files.metadata.read files.content.read files.content.write';
// アクセストークン失効のこの時間前から先回りで refresh する。
const TOKEN_REFRESH_MARGIN_MS = 60_000;
// PKCE 一時値はリダイレクト往復をまたぐため sessionStorage に置く。
const PKCE_VERIFIER_KEY = 'todo.pkce.verifier';
const PKCE_STATE_KEY = 'todo.pkce.state';

export async function loadSettings(): Promise<DeviceSettings> {
  return settingsStore.loadSettings();
}

export async function updateSettings(
  patch: Partial<DeviceSettings>,
): Promise<DeviceSettings> {
  const current = await settingsStore.loadSettings();
  const next: DeviceSettings = { ...current, ...patch };
  await settingsStore.saveSettings(next);
  return next;
}

export async function deviceId(): Promise<DeviceId> {
  return getOrCreateDeviceId();
}

export function isDropboxConfigured(): boolean {
  return Boolean(DROPBOX_APP_KEY);
}

// 認可サーバからのリダイレクトかどうか（?code=… または ?error=…）。
export function isOAuthCallback(search: string): boolean {
  const cb = parseCallback(search);
  return Boolean(cb.code ?? cb.error);
}

// Dropbox 連携を開始する（PKCE）。認可ページへ遷移するため、以降のコードは実行されない。
export async function connectDropbox(): Promise<void> {
  if (!DROPBOX_APP_KEY) {
    throw new Error(
      'VITE_DROPBOX_APP_KEY が未設定です。Dropbox アプリの App key をビルド時 env に設定してください。',
    );
  }
  const verifier = generateCodeVerifier();
  const state = generateState();
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(PKCE_STATE_KEY, state);
  const challenge = await codeChallenge(verifier);
  const url = buildAuthUrl({
    authUrl: DROPBOX_AUTH_URL,
    clientId: DROPBOX_APP_KEY,
    redirectUri: redirectUri(),
    state,
    challenge,
    scope: DROPBOX_SCOPE, // 必要権限を明示要求（未指定だとアプリ既定権限頼みになり 403 の原因になる）
    tokenAccessType: 'offline', // refresh token を得る
  });
  window.location.assign(url);
}

// 認可コールバックを処理する（code→token 交換、state 検証、永続）。連携成立で true。
export async function completeOAuthRedirect(search: string): Promise<boolean> {
  const cb = parseCallback(search);
  if (!cb.code) return false;
  const savedState = sessionStorage.getItem(PKCE_STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_STATE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  if (!verifier || !savedState || cb.state !== savedState) {
    throw new Error('OAuth state の検証に失敗しました（CSRF 対策）。');
  }
  if (!DROPBOX_APP_KEY) throw new Error('VITE_DROPBOX_APP_KEY が未設定です。');
  const token = await exchangeCodeForToken({
    tokenUrl: DROPBOX_TOKEN_URL,
    clientId: DROPBOX_APP_KEY,
    code: cb.code,
    codeVerifier: verifier,
    redirectUri: redirectUri(),
  });
  await tokenStore.putToken('dropbox', token);
  await updateSettings({ connectedProvider: 'dropbox' });
  return true;
}

// 連携解除（トークン破棄＋設定を未連携へ）。
export async function disconnect(): Promise<DeviceSettings> {
  await tokenStore.deleteToken('dropbox');
  return updateSettings({ connectedProvider: 'none' });
}

// 有効なアクセストークンを返す TokenProvider。失効間際（または forceRefresh 指定時）は refresh して永続する。
// forceRefresh は content 操作の 401 後リトライで使う（一過性のトークン状態 401 を自己回復 / ch.05 §5.4）。
function dropboxTokenProvider(): TokenProvider {
  return {
    async getAccessToken(opts?: { forceRefresh?: boolean }): Promise<string> {
      const t = await tokenStore.getToken('dropbox');
      if (!t) throw new AuthError('Dropbox 未連携です。');
      const expiringSoon =
        t.expiresAt !== undefined && t.expiresAt - Date.now() < TOKEN_REFRESH_MARGIN_MS;
      if ((opts?.forceRefresh || expiringSoon) && t.refreshToken && DROPBOX_APP_KEY) {
        try {
          const next = await refreshAccessToken(
            { tokenUrl: DROPBOX_TOKEN_URL, clientId: DROPBOX_APP_KEY, refreshToken: t.refreshToken },
            t,
          );
          await tokenStore.putToken('dropbox', next);
          return next.accessToken;
        } catch {
          throw new AuthError('Dropbox トークンの更新に失敗しました。再連携が必要です。');
        }
      }
      return t.accessToken;
    },
  };
}

// 現在の連携設定から StorageAdapter を生成する（未連携/トークン無しは null）。
export async function buildAdapter(): Promise<StorageAdapter | null> {
  const settings = await settingsStore.loadSettings();
  if (settings.connectedProvider !== 'dropbox') return null;
  const token = await tokenStore.getToken('dropbox');
  if (!token) return null;
  return new DropboxAdapter({ tokens: dropboxTokenProvider() });
}
