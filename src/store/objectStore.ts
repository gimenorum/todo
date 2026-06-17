import { getDb } from './db';
import { STORE } from '../model/constants';
import type { Hash, ObjectKind } from '../model/types';

// content-addressed オブジェクト（commit/snapshot blob）のローカル複製（ch.06 §6.1/§6.2）。
// 同期エンジンの LocalState.objects（Map<Hash, Uint8Array>）を IndexedDB と往復させる土台。
// 表示の正は materialize 済み todos ストアであり、ここは同期の内部状態。

export interface ObjectEntry {
  hash: Hash;
  bytes: Uint8Array;
  kind: ObjectKind;
}

export async function getObject(hash: Hash): Promise<Uint8Array | null> {
  const db = await getDb();
  const rec = await db.get(STORE.objects, hash);
  return rec ? rec.bytes : null;
}

export async function putObject(hash: Hash, bytes: Uint8Array, kind: ObjectKind): Promise<void> {
  const db = await getDb();
  await db.put(STORE.objects, { hash, kind, bytes }); // keyPath='hash' なのでキーは指定しない
}

export async function putObjects(entries: ObjectEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(STORE.objects, 'readwrite');
  await Promise.all([
    ...entries.map((e) => tx.store.put({ hash: e.hash, kind: e.kind, bytes: e.bytes })),
    tx.done,
  ]);
}

// 起動時に LocalState を再構築する（iOS でローカル消失していれば空 Map／ch.06 §6.4）。
export async function getAllObjects(): Promise<Map<Hash, Uint8Array>> {
  const db = await getDb();
  const all = await db.getAll(STORE.objects);
  const map = new Map<Hash, Uint8Array>();
  for (const rec of all) map.set(rec.hash, rec.bytes);
  return map;
}

export async function listObjectHashes(): Promise<Hash[]> {
  const db = await getDb();
  return (await db.getAllKeys(STORE.objects)) as Hash[];
}
