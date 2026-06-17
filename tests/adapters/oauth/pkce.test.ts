import { describe, expect, it } from 'vitest';
import {
  buildAuthUrl,
  codeChallenge,
  generateCodeVerifier,
  parseCallback,
  redirectUri,
} from '../../../src/adapters/oauth/pkce';

describe('adapters/oauth/pkce (S256)', () => {
  it('codeChallenge は RFC 7636 Appendix B の既知ベクトルと一致', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await codeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generateCodeVerifier は base64url・43 文字', () => {
    expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('buildAuthUrl は必須パラメータを含む', () => {
    const url = buildAuthUrl({
      authUrl: 'https://www.dropbox.com/oauth2/authorize',
      clientId: 'APPKEY',
      redirectUri: 'https://example.com/app/',
      state: 'st',
      challenge: 'ch',
      tokenAccessType: 'offline',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(u.searchParams.get('client_id')).toBe('APPKEY');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('code_challenge')).toBe('ch');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe('https://example.com/app/');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.get('token_access_type')).toBe('offline');
  });

  it('parseCallback は code/state/error を抽出', () => {
    expect(parseCallback('?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' });
    expect(parseCallback('error=access_denied&error_description=nope')).toEqual({
      error: 'access_denied',
      errorDescription: 'nope',
    });
  });

  it('redirectUri はハッシュ・クエリを除いたページ URL（オリジン非依存）', () => {
    const orig = window.location.href;
    window.history.replaceState(null, '', '/app/?foo=1#/tasks');
    expect(redirectUri()).toBe(`${window.location.origin}/app/`);
    window.history.replaceState(null, '', orig);
  });
});
