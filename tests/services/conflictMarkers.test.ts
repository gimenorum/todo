// conflictMarkers ヘルパの単体テスト（Issue #29）。任意キー keyspace conflicts/<todoId> の
// write→read→delete 往復と、todoId 単位のグループ化・破損マーカーのスキップを確認する。
import { describe, expect, it } from 'vitest';
import { InMemoryAdapter } from '../../src/adapters/InMemoryAdapter';
import {
  CONFLICTS_PREFIX,
  conflictKey,
  deleteMarker,
  readAllMarkers,
  writeMarkers,
} from '../../src/services/conflictMarkers';
import type { FieldConflict, StorageAdapter } from '../../src/model/types';

const conflicts: FieldConflict[] = [
  { todoId: 'a', field: 'title', base: 'b', left: 'x', right: 'y' },
  { todoId: 'a', field: 'notes', base: '', left: 'l', right: 'r' },
  { todoId: 'c', field: 'priority', base: 'low', left: 'high', right: 'med' },
];

describe('services/conflictMarkers', () => {
  it('write→read 往復で内容が一致し、todoId 単位にマーカーが分かれる', async () => {
    const adapter = new InMemoryAdapter();
    await writeMarkers(adapter, conflicts);

    // todo a と c の 2 マーカー。
    const keys = await adapter.list(CONFLICTS_PREFIX);
    expect(keys.sort()).toEqual([conflictKey('a'), conflictKey('c')]);

    const read = await readAllMarkers(adapter);
    expect(read).toHaveLength(3);
    expect(read).toEqual(expect.arrayContaining(conflicts));
  });

  it('delete で当該 todo のマーカーだけが消える', async () => {
    const adapter = new InMemoryAdapter();
    await writeMarkers(adapter, conflicts);
    await deleteMarker(adapter, 'a');

    const read = await readAllMarkers(adapter);
    expect(read.every((c) => c.todoId === 'c')).toBe(true);
    expect(read).toHaveLength(1);
  });

  it('破損したマーカーはスキップして同期を落とさない', async () => {
    const adapter = new InMemoryAdapter();
    await writeMarkers(adapter, conflicts);
    await adapter.put(conflictKey('a'), new TextEncoder().encode('{ not json'));

    const read = await readAllMarkers(adapter);
    expect(read.every((c) => c.todoId === 'c')).toBe(true); // a は壊れて無視、c は健全
  });

  it('delete は未存在でも冪等', async () => {
    const adapter = new InMemoryAdapter();
    await expect(deleteMarker(adapter, 'nope')).resolves.toBeUndefined();
  });

  // Issue #29 フォローアップ: Google Drive は同名ファイルを許可するため list が同名キーを複数返したり、
  // 単一マーカー JSON に重複が混入しうる。readAllMarkers は (todoId,field) で dedup して正規化する。

  it('単一マーカー JSON に重複が混入していても (todoId,field) で dedup する', async () => {
    const adapter = new InMemoryAdapter();
    const dup: FieldConflict[] = [
      { todoId: 'a', field: 'notes', base: '', left: 'l', right: 'r' },
      { todoId: 'a', field: 'notes', base: '', left: 'l', right: 'r' },
    ];
    await adapter.put(conflictKey('a'), new TextEncoder().encode(JSON.stringify(dup)));

    const read = await readAllMarkers(adapter);
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ todoId: 'a', field: 'notes' });
  });

  it('list が同名マーカーを複数返しても (todoId,field) で 1 件に正規化する（Drive 同名重複相当）', async () => {
    // Drive の「同名ファイル複数」を、list が同じキーを 2 回返す fake アダプタで模す。
    const bytes = new TextEncoder().encode(
      JSON.stringify([{ todoId: 'a', field: 'notes', base: '', left: 'l', right: 'r' }]),
    );
    const dupAdapter: StorageAdapter = {
      list: (prefix) =>
        Promise.resolve(prefix === CONFLICTS_PREFIX ? [conflictKey('a'), conflictKey('a')] : []),
      get: () => Promise.resolve(bytes),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };

    const read = await readAllMarkers(dupAdapter);
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ todoId: 'a', field: 'notes' });
  });
});
