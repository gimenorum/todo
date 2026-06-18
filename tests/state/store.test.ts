import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../../src/state/store';
import type { State } from '../../src/model/types';
import { DEFAULT_SETTINGS } from '../../src/model/constants';

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

describe('state/store', () => {
  it('returns the initial state', () => {
    const store = createStore(baseState());
    expect(store.getState().global).toBe('unlinked');
  });

  it('merges partial patches and notifies subscribers', () => {
    const store = createStore(baseState());
    const seen = vi.fn();
    store.subscribe(seen);
    store.setState({ lastSyncAt: 123 });
    expect(store.getState().lastSyncAt).toBe(123);
    expect(store.getState().global).toBe('unlinked'); // 他フィールドは保持
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('supports updater-function patches', () => {
    const store = createStore(baseState());
    store.setState((s) => ({ lastSyncAt: (s.lastSyncAt ?? 0) + 1 }));
    store.setState((s) => ({ lastSyncAt: (s.lastSyncAt ?? 0) + 1 }));
    expect(store.getState().lastSyncAt).toBe(2);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore(baseState());
    const seen = vi.fn();
    const off = store.subscribe(seen);
    off();
    store.setState({ lastSyncAt: 5 });
    expect(seen).not.toHaveBeenCalled();
  });
});
