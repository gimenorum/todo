import { describe, expect, it } from 'vitest';
import { getDb } from '../../src/store/db';
import { DB_VERSION, STORE } from '../../src/model/constants';

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
