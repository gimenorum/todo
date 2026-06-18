// @vitest-environment node
//
// GoogleDriveAdapter の契約テスト＋固有挙動。実 API は叩かず Drive 互換のモック fetch を使う（ch.05 §5.6）。
import { afterAll, describe, expect, it } from 'vitest';
import type { StorageAdapter } from '../../src/model/types';
import { GoogleDriveAdapter } from '../../src/adapters/GoogleDriveAdapter';
import { AuthError } from '../../src/adapters/errors';
import type { TokenProvider } from '../../src/adapters/oauth/tokenStore';
import { createGoogleDriveMock } from '../helpers/googleDriveMock';
import { runContract } from '../helpers/contract';

const tokens: TokenProvider = { getAccessToken: () => Promise.resolve('test-token') };
const realFetch = globalThis.fetch;

// make() は it ごとに呼ばれる。毎回新しいモック store とともに global.fetch を差し替える。
function makeDrive(): StorageAdapter {
  const mock = createGoogleDriveMock();
  globalThis.fetch = mock.fetch;
  return new GoogleDriveAdapter({ tokens });
}

afterAll(() => {
  globalThis.fetch = realFetch;
});

runContract('GoogleDriveAdapter (モック fetch)', makeDrive);

describe('GoogleDriveAdapter 固有挙動', () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  it('objects/ は内容アドレス指定＝重複作成しない（同名 2 回 put で 1 ファイル）', async () => {
    const mock = createGoogleDriveMock();
    globalThis.fetch = mock.fetch;
    const a = new GoogleDriveAdapter({ tokens });
    await a.put('objects/abc', enc.encode('x'));
    await a.put('objects/abc', enc.encode('x'));
    expect([...mock.store.keys()]).toEqual(['objects/abc']);
  });

  it('heads/ は可変＝既存ファイルを上書きできる（重複作成しない）', async () => {
    const mock = createGoogleDriveMock();
    globalThis.fetch = mock.fetch;
    const a = new GoogleDriveAdapter({ tokens });
    await a.put('heads/dev', enc.encode('a'));
    const id1 = mock.store.get('heads/dev')?.id;
    await a.put('heads/dev', enc.encode('b'));
    expect(dec.decode((await a.get('heads/dev')) as Uint8Array)).toBe('b');
    expect(mock.store.get('heads/dev')?.id).toBe(id1); // 同一ファイルを更新
    expect([...mock.store.keys()]).toEqual(['heads/dev']);
  });

  it('multipart で appDataFolder に作成し、往復でバイト一致（UTF-8）', async () => {
    const mock = createGoogleDriveMock();
    globalThis.fetch = mock.fetch;
    const a = new GoogleDriveAdapter({ tokens });
    await a.put('objects/xyz', enc.encode('こんにちは'));
    expect(mock.store.has('objects/xyz')).toBe(true);
    expect(dec.decode((await a.get('objects/xyz')) as Uint8Array)).toBe('こんにちは');
  });

  it('401 は token を強制 refresh して 1 回リトライする（GIS 無音再取得の自己回復）', async () => {
    const refreshing: TokenProvider = (() => {
      let refreshed = false;
      return {
        getAccessToken: (opts?: { forceRefresh?: boolean }) => {
          if (opts?.forceRefresh) refreshed = true;
          return Promise.resolve(refreshed ? 'fresh-token' : 'stale-token');
        },
      };
    })();
    const mock = createGoogleDriveMock({ requireAuth: true, validToken: 'fresh-token' });
    globalThis.fetch = mock.fetch;
    const a = new GoogleDriveAdapter({ tokens: refreshing });
    await a.put('objects/retry', enc.encode('v')); // stale→401→forceRefresh→fresh→作成
    expect(mock.store.has('objects/retry')).toBe(true);
    expect((await a.get('objects/retry')) !== null).toBe(true);
  });

  it('401（リトライ後も失効）は onAuthError＋AuthError', async () => {
    const mock = createGoogleDriveMock({ requireAuth: true, validToken: 'never' });
    globalThis.fetch = mock.fetch;
    let reauth = false;
    const a = new GoogleDriveAdapter({
      tokens: { getAccessToken: () => Promise.resolve('') }, // 常に無効トークン → 401
      onAuthError: () => {
        reauth = true;
      },
    });
    await expect(a.list('objects/')).rejects.toThrow(AuthError);
    expect(reauth).toBe(true);
  });

  it('list ウォーム後、既知 object の get・既存 put は findId（q=name）検索を出さない（Issue #27）', async () => {
    const mock = createGoogleDriveMock();
    let findCount = 0; // q=name='…'（findId のネットワーク検索）の回数
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (/[?&]q=name/.test(url)) findCount++;
      return mock.fetch(input as unknown as string, init);
    }) as unknown as typeof fetch;

    // セットアップ: 別アダプタでサーバ状態（object・head）を用意する。
    const seed = new GoogleDriveAdapter({ tokens });
    await seed.put('objects/aaa', enc.encode('1'));
    await seed.put('heads/dev', enc.encode('h'));

    // 計測対象: キャッシュ空の新インスタンス。list('heads/') で全 id をウォームする。
    const a = new GoogleDriveAdapter({ tokens });
    await a.list('heads/');
    const warmed = findCount; // list 自体は q=name を出さない
    expect(dec.decode((await a.get('objects/aaa')) as Uint8Array)).toBe('1'); // get は findId 不要
    await a.put('objects/aaa', enc.encode('1')); // 既存 object の put はスキップ（findId 不要）
    expect(findCount).toBe(warmed); // ウォーム後は q=name 検索が増えない
  });

  it('403 スコープ不足は AuthError（権限不足→再連携）', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'Insufficient Permission',
              errors: [{ reason: 'insufficientPermissions' }],
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
      )) as unknown as typeof fetch;
    let reauth = false;
    const a = new GoogleDriveAdapter({
      tokens,
      onAuthError: () => {
        reauth = true;
      },
    });
    await expect(a.put('objects/x', enc.encode('z'))).rejects.toThrow(AuthError);
    expect(reauth).toBe(true);
  });
});
