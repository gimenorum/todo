// core/serialize.ts — 決定的シリアライズ（ch.04 §4.1）
//
// 内容アドレス指定の土台。**同内容は必ず同バイト列**になるよう正規化する。
//   - オブジェクトのキーは辞書順ソート、undefined は除去。
//   - 数値は有限値のみ許可（NaN/Infinity は投げる）、-0 は 0 に正規化。
//   - Snapshot.todos は id 昇順の配列に正規化。
//   - 正規形にスキーマバージョン `v` を埋め込む。
//   - **マージコミット（parents≥2）の blob は parents＋snapshot の純関数**
//     （deviceId 非格納・timestamp=親 timestamp の最大）→ 同時同期でも単一先端へ収束。
import type { Commit, Millis, Snapshot } from '../model/types';

const encoder = new TextEncoder();

// 辞書順キー・undefined 除去・数値正規化を施した正規形を返す（再帰）。
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      const v = src[k];
      if (v !== undefined) out[k] = canonicalize(v);
    }
    return out;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`serialize: 非有限数は不可です（${String(value)}）`);
    }
    return value === 0 ? 0 : value; // -0 → 0
  }
  return value; // string / boolean / null
}

function utf8(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(canonicalize(value)));
}

// id 昇順で全順序を与える比較（hash/uuid いずれも文字列）。
function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// スナップショット = ある時点の TODO 集合。todos は id 昇順配列へ正規化する。
export function serializeSnapshot(snap: Snapshot): Uint8Array {
  const todos = Object.values(snap.todos).slice().sort(byId);
  return utf8({ v: 1, kind: 'snapshot', todos });
}

// コミット。parents≥2（マージ）は deviceId を含めず、timestamp=親 timestamp の最大で決定的に導出。
// 通常コミット（単一親 / 初期）は timestamp・deviceId を含める。
export function serializeCommit(
  commit: Commit,
  parentTimestamps: readonly Millis[],
): Uint8Array {
  const parents = commit.parents.slice().sort();
  if (commit.parents.length >= 2) {
    const timestamp = parentTimestamps.length
      ? Math.max(...parentTimestamps)
      : commit.timestamp;
    return utf8({ v: 1, kind: 'commit', parents, snapshot: commit.snapshot, timestamp });
  }
  return utf8({
    v: 1,
    kind: 'commit',
    parents,
    snapshot: commit.snapshot,
    timestamp: commit.timestamp,
    deviceId: commit.deviceId,
  });
}
