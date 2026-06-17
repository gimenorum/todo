// core/objects.ts — blob のエンコード/デコードと鍵生成（ch.04 §4.3 / ch.05 §5.2）
//
// 鍵空間（全アダプタ共通）:
//   objects/<hash>    … commit / snapshot を兼ねる（内容 SHA-256 / 不変）
//   heads/<deviceId>  … advisory HEAD（端末ごとのヒント）
import type { Commit, DeviceId, Hash, Snapshot, Todo, Uuid } from '../model/types';

const decoder = new TextDecoder();

export function objKey(h: Hash): string {
  return `objects/${h}`;
}

export function headKey(deviceId: DeviceId): string {
  return `heads/${deviceId}`;
}

export type DecodedObject =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'commit'; commit: Commit };

// 正規形バイト列（serialize.ts の出力）をデコードする。kind で種別判別。
export function decodeObject(bytes: Uint8Array): DecodedObject {
  const obj = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
  if (obj.kind === 'snapshot') return { kind: 'snapshot', snapshot: toSnapshot(obj) };
  if (obj.kind === 'commit') return { kind: 'commit', commit: toCommit(obj) };
  throw new TypeError(`decodeObject: 未知の kind です（${String(obj.kind)}）`);
}

export function decodeSnapshot(bytes: Uint8Array): Snapshot {
  const d = decodeObject(bytes);
  if (d.kind !== 'snapshot') throw new TypeError('decodeSnapshot: snapshot ではありません');
  return d.snapshot;
}

export function decodeCommit(bytes: Uint8Array): Commit {
  const d = decodeObject(bytes);
  if (d.kind !== 'commit') throw new TypeError('decodeCommit: commit ではありません');
  return d.commit;
}

// commit でなければ null（種別判別ヘルパ。混在 blob からの抽出に使う）。
export function tryDecodeCommit(bytes: Uint8Array): Commit | null {
  try {
    const d = decodeObject(bytes);
    return d.kind === 'commit' ? d.commit : null;
  } catch {
    return null;
  }
}

// 直列化時は id 昇順配列。メモリ表現は Record<Uuid, Todo> に戻す。
function toSnapshot(obj: Record<string, unknown>): Snapshot {
  const arr = (obj.todos as Todo[] | undefined) ?? [];
  const todos: Record<Uuid, Todo> = {};
  for (const t of arr) todos[t.id] = t;
  return { todos };
}

// マージコミット blob は deviceId 非格納（ch.04 §4.2）。デコード時は '' を補い、
// 権威ある deviceId が必要ならサイドカーに置く（Phase 1 では未使用）。
function toCommit(obj: Record<string, unknown>): Commit {
  return {
    parents: (obj.parents as Hash[] | undefined) ?? [],
    snapshot: obj.snapshot as Hash,
    timestamp: (obj.timestamp as number | undefined) ?? 0,
    deviceId: (obj.deviceId as DeviceId | undefined) ?? '',
  };
}
