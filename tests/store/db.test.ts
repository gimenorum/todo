import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IDBPDatabase } from 'idb';
import { getDb, openWithTimeout } from '../../src/store/db';
import { DB_VERSION, STORE } from '../../src/model/constants';

// openWithTimeout のジェネリックは TodoDB に束縛されるが、テストではダミー接続で十分。
type FakeDb = IDBPDatabase<never>;
function fakeDb(): FakeDb {
  return { close: vi.fn() } as unknown as FakeDb;
}

describe('store/db openWithTimeout（ハング耐性 / Issue #63）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('速く解決する open は即返す（再試行しない）', async () => {
    const db = fakeDb();
    const open = vi.fn(() => Promise.resolve(db as never));
    await expect(openWithTimeout(open, 4000, 3)).resolves.toBe(db);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('1 回目がハングしても、タイムアウト後の再試行で解決すれば返す', async () => {
    vi.useFakeTimers();
    const db = fakeDb();
    let call = 0;
    const open = vi.fn(() => {
      call += 1;
      return call === 1 ? new Promise<never>(() => {}) : Promise.resolve(db as never);
    });
    const p = openWithTimeout(open, 4000, 3);
    await vi.advanceTimersByTimeAsync(4000); // 1 回目を打ち切り → 2 回目へ
    await expect(p).resolves.toBe(db);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('全試行がハングしたらタイムアウトで reject する（無限待ちにしない）', async () => {
    vi.useFakeTimers();
    const open = vi.fn(() => new Promise<never>(() => {}));
    const p = openWithTimeout(open, 4000, 3);
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(4000 * 3);
    await assertion;
    expect(open).toHaveBeenCalledTimes(3);
  });

  it('打ち切った試行が後から解決した接続は閉じる（リーク防止）', async () => {
    vi.useFakeTimers();
    const leaked = fakeDb();
    const good = fakeDb();
    let call = 0;
    let resolveLeaked: (db: never) => void = () => {};
    const open = vi.fn(() => {
      call += 1;
      if (call === 1) return new Promise<never>((r) => (resolveLeaked = r));
      return Promise.resolve(good as never);
    });
    const p = openWithTimeout(open, 4000, 3);
    await vi.advanceTimersByTimeAsync(4000); // 1 回目を打ち切り
    await expect(p).resolves.toBe(good);
    resolveLeaked(leaked as never); // 打ち切った接続が後から解決
    await Promise.resolve();
    expect(leaked.close).toHaveBeenCalledTimes(1);
  });
});

describe('store/db (v2 スキーマ)', () => {
  it('version は 2 で、objects/tokens を含む全ストアが存在', async () => {
    const db = await getDb();
    expect(DB_VERSION).toBe(2);
    expect(db.version).toBe(DB_VERSION);
    const names = Array.from(db.objectStoreNames);
    expect(names).toEqual(
      expect.arrayContaining([
        STORE.todos,
        STORE.settings,
        STORE.meta,
        STORE.objects,
        STORE.tokens,
      ]),
    );
  });

  it('objects は kind インデックスを持つ', async () => {
    const db = await getDb();
    const tx = db.transaction(STORE.objects, 'readonly');
    expect(Array.from(tx.store.indexNames)).toContain('kind');
  });
});
