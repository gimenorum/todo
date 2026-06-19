import { getDb } from './db';
import { STORE, META_KEY } from '../model/constants';
import { getOrCreateDeviceId } from './metaStore';

// ローカルデータのクリア（Issue #38）。端末内のタスク・同期キャッシュ（objects / meta の同期キー）を消す。
// deviceId は保持（DAG 著者性のため）。settings・tokens は残す（連携を維持＝クラウドから取り直せる）。
// クラウド（リモート）側のデータには一切触れない。
export async function clearLocalData(): Promise<void> {
  const deviceId = await getOrCreateDeviceId(); // 退避（meta クリア後に書き戻す）
  const db = await getDb();
  await db.clear(STORE.todos);
  await db.clear(STORE.objects);
  await db.clear(STORE.meta); // head / lastSyncAt / conflicts / pendingConflictDeletes / deviceId を一掃
  await db.put(STORE.meta, deviceId, META_KEY.deviceId); // deviceId だけ書き戻す
}
