// services/syncLocalState.ts — core の LocalState と IndexedDB（objects/meta）を橋渡しする（ch.04・06）。
// 「materialized todos → 通常コミット」「syncOnce 後の複製/HEAD 永続」をここに集約する。
import {
  decodeCommit,
  hash,
  serializeCommit,
  serializeSnapshot,
  tryDecodeCommit,
  type LocalState,
} from '../core';
import * as objectStore from '../store/objectStore';
import { getHead, setHead } from '../store/metaStore';
import type { Clock, Commit, DeviceId, Hash, Snapshot, Todo, Uuid } from '../model/types';

function mustGet(map: Map<Hash, Uint8Array>, h: Hash): Uint8Array {
  const v = map.get(h);
  if (!v) throw new Error(`syncLocalState: object が複製にありません（${h}）`);
  return v;
}

// IDB から LocalState を組み立てる（objects 複製 ＋ advisory HEAD ＋ deviceId）。
// objects が空でも可（iOS のローカル消失からは heads/ 起点で回復 / ch.06 §6.4）。
export async function loadLocalState(deviceId: DeviceId): Promise<LocalState> {
  const objects = await objectStore.getAllObjects();
  const head = await getHead();
  return { objects, head, deviceId };
}

// syncOnce 後、複製に増えた blob のみ IDB へ書き、advisory HEAD を保存する。
export async function persistLocalState(local: LocalState, before: Set<Hash>): Promise<void> {
  const entries: objectStore.ObjectEntry[] = [];
  for (const [h, bytes] of local.objects) {
    if (before.has(h)) continue;
    entries.push({ hash: h, bytes, kind: tryDecodeCommit(bytes) ? 'commit' : 'snapshot' });
  }
  await objectStore.putObjects(entries);
  if (local.head) await setHead(local.head);
}

// materialized todos（tombstone を含む）から Snapshot を作る＝削除も同期される。
export function snapshotFromTodos(todos: Todo[]): Snapshot {
  const map: Record<Uuid, Todo> = {};
  for (const t of todos) map[t.id] = t;
  return { todos: map };
}

// 現在の materialized snapshot が先端と異なれば通常コミットを積む（Device.commit のサービス版）。
// 変更があれば true。local.objects / local.head をミューテートする。
export async function appendCommitIfChanged(
  local: LocalState,
  snapshot: Snapshot,
  clock: Clock,
): Promise<boolean> {
  const snapBytes = serializeSnapshot(snapshot);
  const snapHash = await hash(snapBytes);

  if (local.head) {
    const headCommit = decodeCommit(mustGet(local.objects, local.head));
    if (headCommit.snapshot === snapHash) return false; // 先端と同内容 → no-op
  } else if (Object.keys(snapshot.todos).length === 0) {
    return false; // 先端なし＆空 → 何も積まない
  }

  local.objects.set(snapHash, snapBytes);
  const parents = local.head ? [local.head] : [];
  const parentTs = parents.map((p) => decodeCommit(mustGet(local.objects, p)).timestamp);
  const commit: Commit = {
    parents,
    snapshot: snapHash,
    timestamp: clock.now(),
    deviceId: local.deviceId,
  };
  const commitBytes = serializeCommit(commit, parentTs);
  const commitHash = await hash(commitBytes);
  local.objects.set(commitHash, commitBytes);
  local.head = commitHash;
  return true;
}
