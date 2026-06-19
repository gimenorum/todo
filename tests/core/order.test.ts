// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { keyBetween, keysAfter } from '../../src/core';

describe('keyBetween フラクショナルインデックス（ch.03 §3.2 / Phase 6）', () => {
  it('両端 null → 単独要素の初期キー', () => {
    const k = keyBetween(null, null);
    expect(typeof k).toBe('string');
    expect(k.length).toBeGreaterThan(0);
  });

  it('b より前（a=null）に差し込むキーは b より小さい', () => {
    const k = keyBetween(null, 'i');
    expect(k < 'i').toBe(true);
  });

  it('a より後（b=null）に差し込むキーは a より大きい', () => {
    const k = keyBetween('i', null);
    expect(k > 'i').toBe(true);
  });

  it('隣接 2 値のあいだに厳密に入る', () => {
    const a = keyBetween(null, null); // 'i'
    const b = keyBetween(a, null); // a より後
    const mid = keyBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('同じ隙間への連続挿入でも常に厳密順序を保つ（左詰め）', () => {
    const lo = keyBetween(null, null);
    const hi = keyBetween(lo, null);
    const inserted: string[] = [];
    let prev = lo;
    for (let i = 0; i < 50; i++) {
      const k = keyBetween(prev, hi);
      expect(prev < k).toBe(true);
      expect(k < hi).toBe(true);
      inserted.push(k);
      prev = k;
    }
    // 生成順 = 昇順
    const sorted = [...inserted].sort();
    expect(inserted).toEqual(sorted);
  });

  it('先頭への連続挿入（a=null）でも降順に小さくなり続ける', () => {
    let hi = keyBetween(null, null);
    for (let i = 0; i < 50; i++) {
      const k = keyBetween(null, hi);
      expect(k < hi).toBe(true);
      hi = k;
    }
  });

  it('a >= b の不正な範囲は例外', () => {
    expect(() => keyBetween('j', 'i')).toThrow();
    expect(() => keyBetween('i', 'i')).toThrow();
  });

  it('ランダムな順序操作でも全順序が壊れない', () => {
    // 末尾追加 → 任意位置への差し込みを繰り返し、ソート一貫性を確認。
    const keys = keysAfter(null, 5);
    for (let n = 0; n < 200; n++) {
      const sorted = [...keys].sort();
      const i = n % (sorted.length + 1);
      const a = i === 0 ? null : sorted[i - 1];
      const b = i === sorted.length ? null : sorted[i];
      const k = keyBetween(a, b);
      if (a !== null) expect(a < k).toBe(true);
      if (b !== null) expect(k < b).toBe(true);
      keys.push(k);
    }
  });
});

describe('keysAfter 一括バックフィル', () => {
  it('指定個数を昇順で生成する', () => {
    const ks = keysAfter(null, 5);
    expect(ks).toHaveLength(5);
    expect([...ks].sort()).toEqual(ks);
  });

  it('prev の後ろに生成する（すべて prev より大きい）', () => {
    const ks = keysAfter('i', 3);
    for (const k of ks) expect(k > 'i').toBe(true);
    expect([...ks].sort()).toEqual(ks);
  });
});
