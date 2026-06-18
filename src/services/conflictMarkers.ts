// services/conflictMarkers.ts — 未解決競合をリモートで端末間共有する「共有マーカー」I/O（Issue #29）。
//
// 背景: 競合は検出端末の SyncService.activeConflicts（メモリ）＋ローカル IDB（Issue #26）にだけ存在し、
// リモートには push されない。競合時も left 採用の自動マージで先端は単一化されるため、相手端末は
// tips.length===1 で競合を再導出できず「解決する」が出ない（Issue #29「競合が他端末に同期されない」）。
//
// 対策: 未解決競合の集合をリモートの小さな keyspace `conflicts/<todoId>` に publish し、各端末が毎同期で読む。
// core（merge3／heads 導出／自動マージ）は一切変更せず、読み書き削除をすべて services 層に閉じる。
// StorageAdapter の list/get/put/delete は任意キーに汎用対応（既存 objects/・heads/ と同じ扱い）。
import type { FieldConflict, StorageAdapter, Uuid } from '../model/types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// マーカーキーは todo 単位。per-todo にするのは解決（delete）が todo 単位で起きるため。
export const CONFLICTS_PREFIX = 'conflicts/';

export function conflictKey(todoId: Uuid): string {
  return `${CONFLICTS_PREFIX}${todoId}`;
}

// 未解決競合を todoId でグループ化し、各 conflicts/<todoId> に FieldConflict[] の JSON を put（べき等）。
// 検出端末が呼ぶ。put は上書きなので、再衝突（同 todoId が別値で再検出）でも正しく書き直される。
export async function writeMarkers(
  adapter: StorageAdapter,
  conflicts: FieldConflict[],
): Promise<void> {
  const byTodo = new Map<Uuid, FieldConflict[]>();
  for (const c of conflicts) {
    const list = byTodo.get(c.todoId);
    if (list) list.push(c);
    else byTodo.set(c.todoId, [c]);
  }
  for (const [todoId, list] of byTodo) {
    await adapter.put(conflictKey(todoId), encoder.encode(JSON.stringify(list)));
  }
}

// リモートの全マーカーを読み、FieldConflict[] に平坦化する。これを「権威ある現在の未解決集合」とする。
// 壊れた/空のマーカーは握りつぶしてスキップ（同期全体を落とさない）。
export async function readAllMarkers(adapter: StorageAdapter): Promise<FieldConflict[]> {
  const keys = await adapter.list(CONFLICTS_PREFIX);
  const out: FieldConflict[] = [];
  for (const key of keys) {
    const bytes = await adapter.get(key);
    if (!bytes) continue;
    try {
      const parsed = JSON.parse(decoder.decode(bytes)) as FieldConflict[];
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch {
      // 破損マーカーは無視（次回 writeMarkers で正しい内容に上書きされる）。
      continue;
    }
  }
  return out;
}

// 当該 todo のマーカーを削除する（解決を全端末へ伝播）。adapter.delete は未存在でも冪等。
export async function deleteMarker(adapter: StorageAdapter, todoId: Uuid): Promise<void> {
  await adapter.delete(conflictKey(todoId));
}
