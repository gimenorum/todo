// @vitest-environment node
//
// アダプタ契約テスト（ch.05 §5.6）。全アダプタが満たすべき振る舞いを共通スイート化する。
// Phase 1 では InMemory が full green。Dropbox/Drive はモック/録画＋手動 E2E で代替（ch.16 §16.5）。
import { describe, expect, it } from 'vitest';
import type { StorageAdapter } from '../../src/model/types';
import { InMemoryAdapter } from '../../src/adapters/InMemoryAdapter';

const enc = new TextEncoder();
const dec = new TextDecoder();

function runContract(name: string, make: () => StorageAdapter): void {
  describe(`アダプタ契約: ${name}`, () => {
    it('put → get でバイト列が一致（往復）', async () => {
      const a = make();
      await a.put('objects/abc', enc.encode('hello'));
      const got = await a.get('objects/abc');
      expect(got).not.toBeNull();
      expect(dec.decode(got as Uint8Array)).toBe('hello');
    });

    it('未存在の get は null', async () => {
      const a = make();
      expect(await a.get('objects/none')).toBeNull();
    });

    it('put はべき等（同キー二度書きで状態が壊れない）', async () => {
      const a = make();
      await a.put('objects/x', enc.encode('v1'));
      await a.put('objects/x', enc.encode('v1'));
      expect(dec.decode((await a.get('objects/x')) as Uint8Array)).toBe('v1');
      expect(await a.list('objects/')).toEqual(['objects/x']);
    });

    it('list は前方一致のみ返す', async () => {
      const a = make();
      await a.put('objects/a', enc.encode('1'));
      await a.put('objects/b', enc.encode('2'));
      await a.put('heads/dev', enc.encode('h'));
      expect(await a.list('objects/')).toEqual(['objects/a', 'objects/b']);
      expect(await a.list('heads/')).toEqual(['heads/dev']);
    });

    it('delete で消える', async () => {
      const a = make();
      await a.put('objects/x', enc.encode('1'));
      await a.delete('objects/x');
      expect(await a.get('objects/x')).toBeNull();
      expect(await a.list('objects/')).toEqual([]);
    });
  });
}

runContract('InMemoryAdapter', () => new InMemoryAdapter());

describe('putIfAbsent（CAS / 任意の最適化）', () => {
  it('既存キーでは false、未存在では true', async () => {
    const a = new InMemoryAdapter({ cas: true });
    expect(await a.putIfAbsent?.('objects/x', enc.encode('1'))).toBe(true);
    expect(await a.putIfAbsent?.('objects/x', enc.encode('2'))).toBe(false);
    // 既存値は上書きされない。
    expect(dec.decode((await a.get('objects/x')) as Uint8Array)).toBe('1');
  });

  it('cas=false なら putIfAbsent を提供しない（未対応アダプタの表現）', () => {
    const a = new InMemoryAdapter({ cas: false });
    expect(a.putIfAbsent).toBeUndefined();
  });
});
