import { beforeEach, describe, expect, it } from 'vitest';
import { clearLocalData } from '../../src/store/resetStore';
import * as todoStore from '../../src/store/todoStore';
import * as objectStore from '../../src/store/objectStore';
import * as tokenStore from '../../src/store/tokenStore';
import * as settingsStore from '../../src/store/settingsStore';
import {
  getConflicts,
  getHead,
  getLastSyncAt,
  getOrCreateDeviceId,
  getPendingConflictDeletes,
  setConflicts,
  setHead,
  setLastSyncAt,
  setPendingConflictDeletes,
} from '../../src/store/metaStore';
import { getDb } from '../../src/store/db';
import { STORE, DEFAULT_SETTINGS } from '../../src/model/constants';
import type { Todo } from '../../src/model/types';

function todo(p: Partial<Todo>): Todo {
  return {
    id: p.id ?? 'x',
    title: p.title ?? '',
    done: false,
    dueDate: null,
    notifyBeforeMs: null,
    priority: 'none',
    notes: '',
    tags: [],
    order: '',
    createdAt: 0,
    updatedAt: 0,
    deleted: false,
    version: 1,
  };
}

async function clearAll(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.clear(STORE.todos),
    db.clear(STORE.objects),
    db.clear(STORE.meta),
    db.clear(STORE.settings),
    db.clear(STORE.tokens),
  ]);
}
beforeEach(clearAll);

describe('store/resetStore clearLocalData（Issue #38）', () => {
  it('todos/objects と meta の同期キーを消し、deviceId・settings・tokens は残す', async () => {
    const deviceId = await getOrCreateDeviceId(); // 生成して退避
    await todoStore.putTodos([todo({ id: 'a' })]);
    await objectStore.putObjects([{ hash: 'h1', bytes: new Uint8Array([1, 2]), kind: 'snapshot' }]);
    await setHead('h1');
    await setLastSyncAt(123);
    await setConflicts([{ todoId: 'a', field: 'title', base: 0, left: 1, right: 2 }]);
    await setPendingConflictDeletes(['z']);
    await settingsStore.saveSettings({ ...DEFAULT_SETTINGS, autoSyncMode: 'manual' });
    await tokenStore.putToken('dropbox', { accessToken: 'tok' });

    await clearLocalData();

    // 消えるもの
    expect(await todoStore.getAllTodos()).toEqual([]);
    expect((await objectStore.getAllObjects()).size).toBe(0);
    expect(await getHead()).toBeNull();
    expect(await getLastSyncAt()).toBeNull();
    expect(await getConflicts()).toEqual([]);
    expect(await getPendingConflictDeletes()).toEqual([]);

    // 残るもの
    expect(await getOrCreateDeviceId()).toBe(deviceId); // 同じ deviceId を保持（再生成されない）
    expect((await settingsStore.loadSettings()).autoSyncMode).toBe('manual');
    expect(await tokenStore.getToken('dropbox')).toEqual({ accessToken: 'tok' });
  });
});
