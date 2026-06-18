// @vitest-environment node
//
// DropboxAdapter の契約テスト＋固有挙動。実 API は叩かず Dropbox 互換のモック fetch を使う（ch.05 §5.6）。
import { afterAll, describe, expect, it } from 'vitest';
import type { StorageAdapter } from '../../src/model/types';
import { DropboxAdapter } from '../../src/adapters/DropboxAdapter';
import { AuthError } from '../../src/adapters/errors';
import type { TokenProvider } from '../../src/adapters/oauth/tokenStore';
import { createDropboxMock } from '../helpers/dropboxMock';
import { runContract } from '../helpers/contract';

const tokens: TokenProvider = { getAccessToken: () => Promise.resolve('test-token') };
const realFetch = globalThis.fetch;

// make() は it ごとに呼ばれる。毎回新しいモック store とともに global.fetch を差し替える。
function makeDropbox(): StorageAdapter {
  const mock = createDropboxMock();
  globalThis.fetch = mock.fetch;
  return new DropboxAdapter({ tokens });
}

afterAll(() => {
  globalThis.fetch = realFetch;
});

runContract('DropboxAdapter (モック fetch)', makeDropbox);

describe('DropboxAdapter 固有挙動', () => {
  it('401 で onAuthError を呼びエラーを投げる', async () => {
    const mock = createDropboxMock({ requireAuth: true });
    globalThis.fetch = mock.fetch;
    let reauth = false;
    const a = new DropboxAdapter({
      tokens: { getAccessToken: () => Promise.resolve('') }, // 無効トークン → mock が 401
      onAuthError: () => {
        reauth = true;
      },
    });
    await expect(a.list('objects/')).rejects.toThrow(/401|失効/);
    expect(reauth).toBe(true);
  });

  it('403 missing_scope は AuthError を投げ onAuthError を呼ぶ（権限不足→再連携）', async () => {
    // 権限（スコープ）未許可時の Dropbox 応答を模した 403。実 API のみで起きモックでは出ない経路。
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error_summary: 'missing_scope/...',
            error: { '.tag': 'missing_scope', required_scope: 'files.content.write' },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
      )) as unknown as typeof fetch;
    let reauth = false;
    const a = new DropboxAdapter({
      tokens,
      onAuthError: () => {
        reauth = true;
      },
    });
    await expect(a.put('objects/abc', new TextEncoder().encode('z'))).rejects.toThrow(AuthError);
    expect(reauth).toBe(true);
  });

  it('その他の失敗（5xx）は本文を含むエラーで原因が分かる', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('Internal Server Error', { status: 500 }),
      )) as unknown as typeof fetch;
    const a = new DropboxAdapter({ tokens });
    await expect(a.put('objects/abc', new TextEncoder().encode('z'))).rejects.toThrow(
      /500.*Internal Server Error/,
    );
  });

  it('download 409 は null（未存在）', async () => {
    globalThis.fetch = createDropboxMock().fetch;
    const a = new DropboxAdapter({ tokens });
    expect(await a.get('objects/missing')).toBeNull();
  });

  it('upload は overwrite モードで正しい Dropbox パスへ書く', async () => {
    const mock = createDropboxMock();
    globalThis.fetch = mock.fetch;
    const a = new DropboxAdapter({ tokens });
    await a.put('objects/abc', new TextEncoder().encode('z'));
    expect(mock.store.has('/objects/abc')).toBe(true);
  });

  it('content 操作（download/upload）は CORS 単純リクエスト＝独自ヘッダ無し・arg/authorization はクエリ', async () => {
    // ブラウザ CORS 対策（ch.05 §5.4）: content.dropboxapi.com は preflight を正しく返さないため、
    // Dropbox-API-Arg / Authorization / Content-Type を一切付けず、arg・authorization をクエリで渡す
    // ＝preflight を起こさない「単純リクエスト」にする。本テストでその形状を固定する。
    const mock = createDropboxMock();
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
      return mock.fetch(input as unknown as string, init);
    }) as unknown as typeof fetch;
    const a = new DropboxAdapter({ tokens });

    await a.put('objects/abc', new TextEncoder().encode('z'));
    await a.get('objects/abc');

    const contentCalls = calls.filter((c) => /\/files\/(download|upload)/.test(c.url));
    expect(contentCalls).toHaveLength(2);
    for (const c of contentCalls) {
      const url = new URL(c.url);
      const h = new Headers(c.init?.headers);
      // arg と authorization はクエリで渡る（ヘッダではない）
      expect(url.searchParams.get('arg')).toBeTruthy();
      expect(url.searchParams.get('authorization')).toMatch(/^Bearer /);
      // preflight を誘発する独自ヘッダは付けない
      expect(h.has('Dropbox-API-Arg')).toBe(false);
      expect(h.has('Authorization')).toBe(false);
      expect(h.has('Content-Type')).toBe(false);
    }
  });
});
