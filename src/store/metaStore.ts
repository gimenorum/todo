import { getDb } from './db';
import { STORE, META_KEY } from '../model/constants';
import { newDeviceId } from '../model/ids';
import type { DeviceId, Hash, Millis } from '../model/types';

// advisory HEAD・lastSyncAt・deviceId（ch.06）。Phase 0 は deviceId のみ、
// Phase 2 で advisory HEAD（同期先端のヒント）と lastSyncAt を使う。

export async function getOrCreateDeviceId(): Promise<DeviceId> {
  const db = await getDb();
  const existing = (await db.get(STORE.meta, META_KEY.deviceId)) as DeviceId | undefined;
  if (existing) return existing;
  const id = newDeviceId();
  await db.put(STORE.meta, id, META_KEY.deviceId);
  return id;
}

export async function getLastSyncAt(): Promise<Millis | null> {
  const db = await getDb();
  return ((await db.get(STORE.meta, META_KEY.lastSyncAt)) as Millis | undefined) ?? null;
}

export async function setLastSyncAt(ts: Millis): Promise<void> {
  const db = await getDb();
  await db.put(STORE.meta, ts, META_KEY.lastSyncAt);
}

// advisory HEAD（ch.04 §4.3）。先端の正は常にコミット集合からの再導出なので、これは起動高速化のヒント。
export async function getHead(): Promise<Hash | null> {
  const db = await getDb();
  return ((await db.get(STORE.meta, META_KEY.head)) as Hash | undefined) ?? null;
}

export async function setHead(head: Hash): Promise<void> {
  const db = await getDb();
  await db.put(STORE.meta, head, META_KEY.head);
}
