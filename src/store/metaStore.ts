import { getDb } from './db';
import { STORE, META_KEY } from '../model/constants';
import { newDeviceId } from '../model/ids';
import type { DeviceId, Millis } from '../model/types';

// advisory HEAD・lastSyncAt・deviceId（ch.06）。Phase 0 は deviceId のみ使用。

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
