// adapters/oauth/tokenStore.ts — OAuth トークンエンドポイントとの交換/更新（ch.05 §5.4）。
// トークンの永続（IndexedDB）は store/tokenStore が担うため、ここは fetch のみ。
// DropboxAdapter には TokenProvider（有効な access token を返す getter）を注入する
// ＝ adapters は store/idb を直接 import しない（依存方向 / ch.01）。
import type { StoredToken } from '../../model/types';

// 有効なアクセストークンの供給契約。実装は services（必要なら refresh して永続する）。
export interface TokenProvider {
  // forceRefresh=true なら失効前でも refresh token があれば再取得する（content 401 後のリトライ用 / ch.05 §5.4）。
  getAccessToken(opts?: { forceRefresh?: boolean }): Promise<string>;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number; // 秒
  account_id?: string;
}

function toStoredToken(r: TokenResponse, prev: StoredToken | undefined, now: number): StoredToken {
  const token: StoredToken = { accessToken: r.access_token };
  // refresh では refresh_token が返らないことがあるため、前回値を引き継ぐ。
  const refresh = r.refresh_token ?? prev?.refreshToken;
  if (refresh) token.refreshToken = refresh;
  if (typeof r.expires_in === 'number') token.expiresAt = now + r.expires_in * 1000;
  const accountId = r.account_id ?? prev?.accountId;
  if (accountId) token.accountId = accountId;
  return token;
}

export interface ExchangeParams {
  tokenUrl: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

// 認可コード → アクセストークン（＋ offline 指定時は refresh token）。
export async function exchangeCodeForToken(
  p: ExchangeParams,
  now: number = Date.now(),
): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    code_verifier: p.codeVerifier,
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
  });
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`OAuth トークン交換に失敗しました（${res.status}）`);
  return toStoredToken((await res.json()) as TokenResponse, undefined, now);
}

export interface RefreshParams {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
}

// refresh token → 新しいアクセストークン（refresh token は据え置きのことが多い）。
export async function refreshAccessToken(
  p: RefreshParams,
  prev?: StoredToken,
  now: number = Date.now(),
): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    client_id: p.clientId,
  });
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`OAuth トークン更新に失敗しました（${res.status}）`);
  return toStoredToken((await res.json()) as TokenResponse, prev, now);
}
