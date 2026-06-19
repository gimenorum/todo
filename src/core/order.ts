// core/order.ts — フラクショナルインデックス（Phase 6 / 手動並べ替え）
//
// タスクの並び順 `Todo.order`（ch.03 §3.2）に使う文字列キーを生成する。
// キーは標準の文字列比較（lexicographic）で全順序になり、任意の 2 キーの「あいだ」に
// 何度でも新しいキーを差し込めるため、並べ替えで他項目を振り直さずに済む。
//
// 不変条件: 生成キーは末尾が最小桁 '0' にならない（あいだ計算が常に可能になるための前提）。

// 桁アルファベット（base-36・昇順）。文字列比較がそのまま大小比較になる。
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const MID = Math.floor(BASE / 2); // 中央桁（'i'）

function digitVal(ch: string): number {
  return DIGITS.indexOf(ch);
}

// 位置 i の桁値。末尾を超えた位置は下限（0）として扱う。
function digitAt(s: string, i: number): number {
  return i < s.length ? digitVal(s[i]) : 0;
}

// `lo` より確実に大きい最小級のキー（上限なし）。末尾は '0' にしない。
function keyAfter(lo: string): string {
  for (let i = lo.length - 1; i >= 0; i--) {
    const d = digitVal(lo[i]);
    if (d + 1 < BASE) return lo.slice(0, i) + DIGITS[d + 1];
  }
  // 全桁が最大（または空）→ 中央桁を 1 つ足して必ず大きくする。
  return lo + DIGITS[MID];
}

// lo < hi（lexicographic）のとき、あいだの 1 キーを返す。lo は '' （下限）を取りうる。
function strictMid(lo: string, hi: string): string {
  let i = 0;
  // 共通プレフィックス長を求める。lo < hi の前提で必ず分岐する位置に到達する。
  while (i <= hi.length && digitAt(lo, i) === digitAt(hi, i)) i++;
  // 共通部の実文字列は hi 側から取る（lo は hi より短くなり得るため）。
  const prefix = hi.slice(0, i);
  const dLo = digitAt(lo, i);
  const dHi = digitAt(hi, i);
  if (dHi - dLo >= 2) {
    // 桁に余裕あり → 中点の桁で打ち切り。
    return prefix + DIGITS[dLo + Math.floor((dHi - dLo) / 2)];
  }
  // 隣接（差 1）→ lo 側の桁を保ち、残りを lo より上（上限なし）へ。
  return prefix + DIGITS[dLo] + keyAfter(lo.slice(i + 1));
}

/**
 * a < 戻り値 < b を満たす並び順キーを返す。
 * - a=null: b より前（先頭側）に差し込むキー。
 * - b=null: a より後（末尾側）に差し込むキー。
 * - a=null かつ b=null: 単独要素の初期キー。
 * a >= b の不正な範囲は例外。
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null) {
    if (a >= b) throw new Error(`keyBetween: 不正な範囲 (${a} >= ${b})`);
    return strictMid(a, b);
  }
  if (a === null && b === null) return DIGITS[MID];
  if (a === null) return strictMid('', b!); // b より前
  return keyAfter(a); // a より後
}

/**
 * `prev`（無ければ null）の後ろに連続して `count` 個の昇順キーを生成する。
 * 既存タスクへの初期 order 一括付与（手動モード切替時のバックフィル）に使う。
 */
export function keysAfter(prev: string | null, count: number): string[] {
  const out: string[] = [];
  let cur = prev;
  for (let i = 0; i < count; i++) {
    cur = keyBetween(cur, null);
    out.push(cur);
  }
  return out;
}
