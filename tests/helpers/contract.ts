// tests/helpers/contract.ts — アダプタ契約スイート（ch.05 §5.6）。
// 全アダプタが満たすべき振る舞いを共通化し、InMemory・Dropbox(モック) で再利用する。
import { describe, expect, it } from 'vitest';
import type { StorageAdapter } from '../../src/model/types';

const enc = new TextEncoder();
const dec = new TextDecoder();

// make() は it ごとに呼ばれ、独立した状態のアダプタを返すこと。
export function runContract(name: string, make: () => StorageAdapter): void {
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
