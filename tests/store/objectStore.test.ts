import { describe, expect, it } from 'vitest';
import {
  getAllObjects,
  getObject,
  listObjectHashes,
  putObject,
  putObjects,
} from '../../src/store/objectStore';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('store/objectStore (fake-indexeddb)', () => {
  it('putObject → getObject 往復', async () => {
    await putObject('hash-a', enc.encode('alpha'), 'snapshot');
    const got = await getObject('hash-a');
    expect(got).not.toBeNull();
    expect(dec.decode(got as Uint8Array)).toBe('alpha');
  });

  it('未存在は null', async () => {
    expect(await getObject('does-not-exist')).toBeNull();
  });

  it('putObjects（一括）と getAllObjects / listObjectHashes', async () => {
    await putObjects([
      { hash: 'h1', bytes: enc.encode('1'), kind: 'commit' },
      { hash: 'h2', bytes: enc.encode('2'), kind: 'snapshot' },
    ]);
    const all = await getAllObjects();
    expect(all.get('h1')).toBeDefined();
    expect(dec.decode(all.get('h2') as Uint8Array)).toBe('2');
    expect(await listObjectHashes()).toEqual(expect.arrayContaining(['h1', 'h2']));
  });
});
