import { getDb } from './db';
import { STORE } from '../model/constants';
import type { StoredToken, SyncProvider } from '../model/types';

// OAuth トークンの永続（ch.06 §6.1・ch.14）。provider ごとに 1 レコード。
// 端末ごと設定と同様に「同期しない」（保存先には書き出さない）。

export async function getToken(provider: SyncProvider): Promise<StoredToken | null> {
  const db = await getDb();
  return (await db.get(STORE.tokens, provider)) ?? null;
}

export async function putToken(provider: SyncProvider, token: StoredToken): Promise<void> {
  const db = await getDb();
  await db.put(STORE.tokens, token, provider);
}

export async function deleteToken(provider: SyncProvider): Promise<void> {
  const db = await getDb();
  await db.delete(STORE.tokens, provider);
}
