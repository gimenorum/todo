// @vitest-environment node
//
// アダプタ契約テスト（ch.05 §5.6）。共通スイートは tests/helpers/contract.ts に集約し、
// InMemory（本ファイル）と Dropbox モック（dropbox.test.ts）で再利用する。
import { describe, expect, it } from 'vitest';
import { InMemoryAdapter } from '../../src/adapters/InMemoryAdapter';
import { runContract } from '../helpers/contract';

const enc = new TextEncoder();
const dec = new TextDecoder();

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
