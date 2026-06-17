// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ancestors, deriveHeads, lca, type CommitMap } from '../../src/core';
import type { Commit, Hash } from '../../src/model/types';

// 合成 DAG（hash は任意の文字列キー、snapshot/deviceId は未使用）。
function node(parents: Hash[], timestamp: number): Commit {
  return { parents, snapshot: '', timestamp, deviceId: '' };
}

function buildMap(entries: Record<Hash, Commit>): CommitMap {
  return new Map(Object.entries(entries));
}

describe('deriveHeads（ch.04 §4.3）', () => {
  it('単線では末尾 1 つが先端', () => {
    const m = buildMap({ A: node([], 1), B: node(['A'], 2), C: node(['B'], 3) });
    expect(deriveHeads(m)).toEqual(['C']);
  });

  it('fork では 2 先端（hash 昇順）', () => {
    const m = buildMap({ O: node([], 1), A: node(['O'], 2), B: node(['O'], 3) });
    expect(deriveHeads(m)).toEqual(['A', 'B']);
  });

  it('欠落親を持つ孤立コミットも先端', () => {
    const m = buildMap({ B: node(['missing'], 2) });
    expect(deriveHeads(m)).toEqual(['B']);
  });
});

describe('ancestors（ch.04 §4.4）', () => {
  it('自身を含む祖先集合を返す', () => {
    const m = buildMap({ A: node([], 1), B: node(['A'], 2), C: node(['B'], 3) });
    expect([...ancestors('C', m)].sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('lca（ch.04 §4.4）', () => {
  it('単純な fork の LCA は共通の親', () => {
    const m = buildMap({ O: node([], 1), A: node(['O'], 2), B: node(['O'], 3) });
    expect(lca('A', 'B', m)).toBe('O');
  });

  it('交差マージ（criss-cross）でも (timestamp,hash) で決定的に 1 つ選ぶ', () => {
    const m = buildMap({
      O: node([], 1),
      A: node(['O'], 2),
      B: node(['O'], 3),
      M1: node(['A', 'B'], 4),
      M2: node(['A', 'B'], 5),
      X: node(['M1'], 6),
      Y: node(['M2'], 7),
    });
    // 極大共通祖先は {A,B}（O は A の祖先なので除外）。timestamp 大の B を採用。
    expect(lca('X', 'Y', m)).toBe('B');
    expect(lca('Y', 'X', m)).toBe('B'); // 対称
  });

  it('系統が異なれば null（→ merge3NoBase フォールバック）', () => {
    const m = buildMap({ P: node([], 1), Q: node([], 2) });
    expect(lca('P', 'Q', m)).toBeNull();
  });
});
