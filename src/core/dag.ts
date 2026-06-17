// core/dag.ts — 先端導出・祖先探索・LCA（ch.04 §4.3 / §4.4）
//
// advisory HEAD は使わず、コミット集合から常に再計算する＝CAS 非依存の核心。
import type { Commit, Hash } from '../model/types';

export type CommitMap = Map<Hash, Commit>;

// 文字列ハッシュの全順序比較。
export function compareHash(a: Hash, b: Hash): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 「どのコミットの親でもないコミット」を先端とする。結果は hash 昇順で安定化。
export function deriveHeads(commitMap: CommitMap): Hash[] {
  const referenced = new Set<Hash>();
  for (const c of commitMap.values()) {
    for (const p of c.parents) referenced.add(p);
  }
  const heads: Hash[] = [];
  for (const h of commitMap.keys()) {
    if (!referenced.has(h)) heads.push(h);
  }
  return heads.sort(compareHash);
}

// 自身を含む祖先集合（depth は持たない）。欠落親（孤立）は無視して止まる。
export function ancestors(head: Hash, commitMap: CommitMap): Set<Hash> {
  const seen = new Set<Hash>();
  const stack: Hash[] = [head];
  while (stack.length) {
    const h = stack.pop() as Hash;
    if (seen.has(h)) continue;
    seen.add(h);
    const c = commitMap.get(h);
    if (c) for (const p of c.parents) stack.push(p);
  }
  return seen;
}

// 2 先端の最近共通祖先。極大共通祖先を (timestamp 大, hash 大) の全順序で一意化する。
// 共通祖先が無い（系統が異なる）なら null（呼び出し側で merge3NoBase にフォールバック）。
export function lca(a: Hash, b: Hash, commitMap: CommitMap): Hash | null {
  const A = ancestors(a, commitMap);
  const B = ancestors(b, commitMap);
  const common: Hash[] = [];
  for (const h of A) if (B.has(h)) common.push(h);
  if (common.length === 0) return null;

  // 極大共通祖先: 他の共通祖先 D が存在して C が D の（真の）祖先なら C を除外。
  const ancCache = new Map<Hash, Set<Hash>>();
  const ancOf = (h: Hash): Set<Hash> => {
    let s = ancCache.get(h);
    if (!s) {
      s = ancestors(h, commitMap);
      ancCache.set(h, s);
    }
    return s;
  };
  const maximal = common.filter((c) => {
    for (const d of common) {
      if (d === c) continue;
      if (ancOf(d).has(c)) return false; // C は D の祖先 → 極大でない
    }
    return true;
  });

  // 全順序の tie-break: timestamp 大、同点は hash 大を採る（決定性の要）。
  let best = maximal[0];
  for (let i = 1; i < maximal.length; i++) {
    if (lessForLca(best, maximal[i], commitMap)) best = maximal[i];
  }
  return best;
}

// cur < cand（cand の方が「新しい/大きい」）なら true。
function lessForLca(cur: Hash, cand: Hash, m: CommitMap): boolean {
  const tc = m.get(cur)?.timestamp ?? 0;
  const td = m.get(cand)?.timestamp ?? 0;
  if (tc !== td) return tc < td;
  return compareHash(cur, cand) < 0;
}
