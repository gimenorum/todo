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

  it('content 操作（download/upload）は cors-hack（reject_cors_preflight ＋ クエリ認証）で preflight を避ける', async () => {
    // ブラウザ CORS 対策（ch.05 §5.4）: content.dropboxapi.com は preflight を正しく返さないため、
    // ① arg/authorization を URL クエリで渡し、② reject_cors_preflight=true で URL パラメータ認証を有効化し、
    // ③ 独自ヘッダ（Dropbox-API-Arg / Authorization）は付けない。Content-Type は download/upload で要件が
    // 異なる: download は付けない（cors-hack charset を 400 で拒否）、upload は text/plain;charset=dropbox-cors-hack
    // （安全リストかつ Dropbox が受理）。本テストでこの形状を固定する。
    const mock = createDropboxMock();
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
      return mock.fetch(input as unknown as string, init);
    }) as unknown as typeof fetch;
    const a = new DropboxAdapter({ tokens });

    await a.put('objects/abc', new TextEncoder().encode('z'));
    await a.get('objects/abc');

    const get = calls.find((c) => /\/files\/download/.test(c.url));
    const put = calls.find((c) => /\/files\/upload/.test(c.url));
    expect(get).toBeDefined();
    expect(put).toBeDefined();

    for (const c of [get!, put!]) {
      const url = new URL(c.url);
      const h = new Headers(c.init?.headers);
      // arg・authorization・reject_cors_preflight はクエリで渡る
      expect(url.searchParams.get('arg')).toBeTruthy();
      expect(url.searchParams.get('authorization')).toMatch(/^Bearer /);
      expect(url.searchParams.get('reject_cors_preflight')).toBe('true');
      // preflight を誘発する独自ヘッダは付けない
      expect(h.has('Dropbox-API-Arg')).toBe(false);
      expect(h.has('Authorization')).toBe(false);
    }
    // download は Content-Type を付けない（cors-hack charset は download で拒否される）
    expect(new Headers(get!.init?.headers).has('Content-Type')).toBe(false);
    // upload は安全リストの cors-hack Content-Type（無いと 400「Missing Content-Type」）
    expect(new Headers(put!.init?.headers).get('Content-Type')).toBe('text/plain; charset=dropbox-cors-hack');
  });

  it('同一 objects/* を 2 回 put すると 2 回目は files/upload を出さない／heads は毎回（Issue #27）', async () => {
    const mock = createDropboxMock();
    let uploads = 0;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (/\/files\/upload/.test(url)) uploads++;
      return mock.fetch(input as unknown as string, init);
    }) as unknown as typeof fetch;
    const enc = new TextEncoder();
    const a = new DropboxAdapter({ tokens });

    await a.put('objects/x', enc.encode('v'));
    await a.put('objects/x', enc.encode('v')); // 既知＝スキップ
    expect(uploads).toBe(1);

    // heads/* は可変なので毎回アップロードする。
    await a.put('heads/dev', enc.encode('a'));
    await a.put('heads/dev', enc.encode('b'));
    expect(uploads).toBe(3);
  });

  it('content 401 は token を強制 refresh して 1 回リトライする（一過性のトークン状態を自己回復）', async () => {
    // stale-token → 401、forceRefresh 後に fresh-token → 200 を模す（list は通るが content だけ 401 の自己回復）。
    const refreshing: TokenProvider = (() => {
      let refreshed = false;
      return {
        getAccessToken: (opts?: { forceRefresh?: boolean }) => {
          if (opts?.forceRefresh) refreshed = true;
          return Promise.resolve(refreshed ? 'fresh-token' : 'stale-token');
        },
      };
    })();
    const mock = createDropboxMock({ requireAuth: true, validToken: 'fresh-token' });
    globalThis.fetch = mock.fetch;
    const a = new DropboxAdapter({ tokens: refreshing });

    await a.put('objects/retry', new TextEncoder().encode('v')); // stale→401→forceRefresh→fresh→200
    expect(mock.store.has('/objects/retry')).toBe(true); // リトライで書き込めた
    expect((await a.get('objects/retry')) !== null).toBe(true); // download もリトライ後は取得できる
  });
});
