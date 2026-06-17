// adapters/oauth/pkce.ts — PKCE（RFC 7636, S256）の純ロジック（ch.05 §5.4）。
// fetch は持たない（純関数＝テスト容易）。リダイレクト URI は現在ページ URL 基準で動的生成
// ＝オリジン非依存（決定 #1）。本番オリジンをコードに固定しない。

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64url(byteLen: number): string {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

// code_verifier: unreserved 文字列（32 バイト乱数の base64url ＝ 43 文字）。
export function generateCodeVerifier(): string {
  return randomBase64url(32);
}

// state（CSRF 対策の不透明値）。
export function generateState(): string {
  return randomBase64url(16);
}

// S256: base64url(SHA-256(code_verifier))。
export async function codeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
  return base64url(new Uint8Array(digest));
}

// リダイレクト URI（オリジン非依存）。現在ページ URL からハッシュ・クエリを除いたもの。
// 例: https://example.com/ や https://example.com/app/ をそのまま redirect_uri に使う。
export function redirectUri(): string {
  const u = new URL(window.location.href);
  u.hash = '';
  u.search = '';
  return u.toString();
}

export interface AuthUrlParams {
  authUrl: string; // 例: https://www.dropbox.com/oauth2/authorize
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scope?: string;
  tokenAccessType?: 'online' | 'offline'; // Dropbox: offline で refresh token を得る
}

export function buildAuthUrl(p: AuthUrlParams): string {
  const u = new URL(p.authUrl);
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('state', p.state);
  if (p.scope) u.searchParams.set('scope', p.scope);
  if (p.tokenAccessType) u.searchParams.set('token_access_type', p.tokenAccessType);
  return u.toString();
}

export interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

// 認可サーバからのリダイレクトのクエリ文字列を解析する（入力は location.search 想定）。
export function parseCallback(search: string): CallbackParams {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out: CallbackParams = {};
  const code = q.get('code');
  const state = q.get('state');
  const error = q.get('error');
  const desc = q.get('error_description');
  if (code) out.code = code;
  if (state) out.state = state;
  if (error) out.error = error;
  if (desc) out.errorDescription = desc;
  return out;
}
