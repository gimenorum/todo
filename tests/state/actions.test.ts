import { describe, expect, it, vi } from 'vitest';
import { createActions, type SyncBridge } from '../../src/state/actions';
import { createStore, type Store } from '../../src/state/store';
import { visibleTodos } from '../../src/state/selectors';
import { DEFAULT_SETTINGS } from '../../src/model/constants';
import type { State } from '../../src/model/types';
import * as todoStore from '../../src/store/todoStore';
import * as settingsStore from '../../src/store/settingsStore';

function baseState(): State {
  return {
    todos: [],
    settings: { ...DEFAULT_SETTINGS },
    global: 'unlinked',
    lastSyncAt: null,
    perTodoStatus: {},
    conflicts: [],
    banner: null,
    route: { name: 'tasks' },
  };
}

function stubBridge(): SyncBridge {
  return {
    notifyEdited: vi.fn(),
    syncNow: vi.fn(() => Promise.resolve()),
    connectDropbox: vi.fn(() => Promise.resolve()),
    connectGoogle: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    resolveConflict: vi.fn(() => Promise.resolve()),
    reloadFromLocal: vi.fn(() => Promise.resolve()),
    applyIntervalChange: vi.fn(),
    deleteLocalData: vi.fn(() => Promise.resolve()),
    refetchFromCloud: vi.fn(() => Promise.resolve()),
    factoryReset: vi.fn(() => Promise.resolve()),
  };
}

async function freshActions(): Promise<{ store: Store; actions: ReturnType<typeof createActions> }> {
  // IDB をクリアして決定的に（fake-indexeddb はファイル内で永続するため）。
  for (const t of await todoStore.getAllTodos()) await todoStore.hardDeleteTodo(t.id);
  await settingsStore.saveSettings({ ...DEFAULT_SETTINGS });
  const store = createStore(baseState());
  return { store, actions: createActions(store, stubBridge()) };
}

describe('actions 手動並べ替え（Phase 6）', () => {
  it('addTodo は order なし環境では空 order（pristine / auto 既定）', async () => {
    const { store, actions } = await freshActions();
    await actions.addTodo({ title: 'a' });
    await actions.addTodo({ title: 'b' });
    expect(store.getState().todos.every((t) => t.order === '')).toBe(true);
  });

  it('setSortMode(manual) は現在の表示順を初期 order として一括付与し、以後は order で並ぶ', async () => {
    const { store, actions } = await freshActions();
    // 期日で自動整列される 3 件（early→late→noDue）。
    await actions.addTodo({ title: 'noDue' });
    await actions.addTodo({ title: 'late', dueDate: 2000 });
    await actions.addTodo({ title: 'early', dueDate: 1000 });

    await actions.setSortMode('manual');
    const s = store.getState();
    expect(s.settings.sortMode).toBe('manual');
    // 全件に order が付与され、表示順は切替時点（自動順）のまま。
    expect(s.todos.every((t) => t.order !== '')).toBe(true);
    expect(visibleTodos(s).map((t) => t.title)).toEqual(['early', 'late', 'noDue']);
  });

  it('reorderTodo は前後の id のあいだに差し込み、並びが入れ替わる', async () => {
    const { store, actions } = await freshActions();
    const id1 = await actions.addTodo({ title: 't1' });
    const id2 = await actions.addTodo({ title: 't2' });
    const id3 = await actions.addTodo({ title: 't3' });
    await actions.setSortMode('manual');
    // 初期: t1, t2, t3。t3 を先頭（t1 の前）へ移動。
    await actions.reorderTodo(id3, null, id1);
    expect(visibleTodos(store.getState()).map((t) => t.id)).toEqual([id3, id1, id2]);

    // t1 を末尾（t2 の後）へ移動 → t3, t2, t1。
    await actions.reorderTodo(id1, id2, null);
    expect(visibleTodos(store.getState()).map((t) => t.id)).toEqual([id3, id2, id1]);
  });

  it('manual 確定後の addTodo は末尾 order を得て一番下に並ぶ', async () => {
    const { store, actions } = await freshActions();
    await actions.addTodo({ title: 't1' });
    await actions.addTodo({ title: 't2' });
    await actions.setSortMode('manual');
    const newId = await actions.addTodo({ title: 't3' });
    const got = store.getState().todos.find((t) => t.id === newId);
    expect(got?.order).not.toBe('');
    expect(visibleTodos(store.getState()).map((t) => t.title)).toEqual(['t1', 't2', 't3']);
  });
});
