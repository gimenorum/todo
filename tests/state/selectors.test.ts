import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  compareByDue,
  distinctTags,
  findTodo,
  matchesFilter,
  perTodoStatusOf,
  settingsBadge,
  tasksBadge,
  visibleTodos,
} from '../../src/state/selectors';
import type { ListFilter, State, Todo } from '../../src/model/types';
import { DEFAULT_FILTER, DEFAULT_SETTINGS } from '../../src/model/constants';

function todo(p: Partial<Todo>): Todo {
  return {
    id: p.id ?? 'x',
    title: p.title ?? '',
    done: p.done ?? false,
    dueDate: p.dueDate ?? null,
    notifyBeforeMs: p.notifyBeforeMs ?? null,
    priority: p.priority ?? 'none',
    notes: p.notes ?? '',
    tags: p.tags ?? [],
    order: p.order ?? '',
    createdAt: p.createdAt ?? 0,
    updatedAt: p.updatedAt ?? 0,
    deleted: p.deleted ?? false,
    version: p.version ?? 1,
  };
}

function stateWith(todos: Todo[]): State {
  return {
    todos,
    settings: { ...DEFAULT_SETTINGS },
    global: 'unlinked',
    lastSyncAt: null,
    perTodoStatus: {},
    conflicts: [],
    banner: null,
    route: { name: 'tasks' },
  };
}

describe('state/selectors', () => {
  it('filters out tombstones', () => {
    const s = stateWith([todo({ id: 'a' }), todo({ id: 'b', deleted: true })]);
    expect(visibleTodos(s).map((t) => t.id)).toEqual(['a']);
  });

  it('sorts incomplete first, then due asc (null last), then createdAt', () => {
    const s = stateWith([
      todo({ id: 'done', done: true, createdAt: 1 }),
      todo({ id: 'noDue', dueDate: null, createdAt: 5 }),
      todo({ id: 'late', dueDate: 2000, createdAt: 1 }),
      todo({ id: 'early', dueDate: 1000, createdAt: 1 }),
    ]);
    expect(visibleTodos(s).map((t) => t.id)).toEqual(['early', 'late', 'noDue', 'done']);
  });

  it('orders incomplete before complete', () => {
    expect(compareByDue(todo({ done: false }), todo({ done: true }))).toBeLessThan(0);
  });

  it('locates a todo by id', () => {
    const s = stateWith([todo({ id: 'a' }), todo({ id: 'b' })]);
    expect(findTodo(s, 'b')?.id).toBe('b');
    expect(findTodo(s, 'z')).toBeUndefined();
  });

  it('manual 並びは done を保ちつつグループ内を order 昇順（Phase 6）', () => {
    const base = stateWith([
      todo({ id: 'c', order: 'm', createdAt: 1 }),
      todo({ id: 'a', order: 'g', createdAt: 2 }),
      todo({ id: 'doneItem', done: true, order: 'b', createdAt: 3 }),
      todo({ id: 'b', order: 'i', createdAt: 4 }),
    ]);
    const s: State = { ...base, settings: { ...base.settings, sortBy: 'manual' } };
    expect(visibleTodos(s).map((t) => t.id)).toEqual(['a', 'b', 'c', 'doneItem']);
  });

  it('due 並び（既定）は order を無視して期日順', () => {
    const s = stateWith([
      todo({ id: 'late', order: 'a', dueDate: 2000 }),
      todo({ id: 'early', order: 'z', dueDate: 1000 }),
    ]);
    expect(visibleTodos(s).map((t) => t.id)).toEqual(['early', 'late']);
  });

  it('priority 並びは高→中→低→なし', () => {
    const base = stateWith([
      todo({ id: 'none', priority: 'none' }),
      todo({ id: 'high', priority: 'high' }),
      todo({ id: 'low', priority: 'low' }),
      todo({ id: 'med', priority: 'med' }),
    ]);
    const s: State = { ...base, settings: { ...base.settings, sortBy: 'priority' } };
    expect(visibleTodos(s).map((t) => t.id)).toEqual(['high', 'med', 'low', 'none']);
  });

  it('title 並びは日本語ロケール昇順', () => {
    const base = stateWith([
      todo({ id: 'c', title: 'りんご' }),
      todo({ id: 'a', title: 'あんず' }),
      todo({ id: 'b', title: 'みかん' }),
    ]);
    const s: State = { ...base, settings: { ...base.settings, sortBy: 'title' } };
    expect(visibleTodos(s).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('category 並びは先頭タグ昇順・タグ無しは後ろ', () => {
    const base = stateWith([
      todo({ id: 'notag', tags: [] }),
      todo({ id: 'work', tags: ['work'] }),
      todo({ id: 'buy', tags: ['buy'] }),
    ]);
    const s: State = { ...base, settings: { ...base.settings, sortBy: 'category' } };
    expect(visibleTodos(s).map((t) => t.id)).toEqual(['buy', 'work', 'notag']);
  });
});

describe('state/selectors 絞り込み（Phase 6）', () => {
  // 2026-06-19 12:00 を「今」として固定。
  const now = new Date('2026-06-19T12:00:00').getTime();
  const day = 86_400_000;
  const f = (p: Partial<ListFilter> = {}): ListFilter => ({ ...DEFAULT_FILTER, ...p });

  it('matchesFilter 期限バケツ（overdue/today/week/none）', () => {
    const overdue = todo({ dueDate: now - 2 * day });
    const todayTask = todo({ dueDate: now });
    const soon = todo({ dueDate: now + 3 * day });
    const noDue = todo({ dueDate: null });
    expect(matchesFilter(overdue, f({ due: 'overdue' }), now)).toBe(true);
    expect(matchesFilter(todayTask, f({ due: 'overdue' }), now)).toBe(false);
    expect(matchesFilter(todayTask, f({ due: 'today' }), now)).toBe(true);
    expect(matchesFilter(soon, f({ due: 'today' }), now)).toBe(false);
    expect(matchesFilter(soon, f({ due: 'week' }), now)).toBe(true);
    expect(matchesFilter(overdue, f({ due: 'week' }), now)).toBe(false);
    expect(matchesFilter(noDue, f({ due: 'none' }), now)).toBe(true);
    expect(matchesFilter(todayTask, f({ due: 'none' }), now)).toBe(false);
  });

  it('matchesFilter 優先度・タグ・タイトル（部分一致・大小無視）', () => {
    const t = todo({ priority: 'high', tags: ['buy', 'home'], title: '牛乳を買う' });
    expect(matchesFilter(t, f({ priority: 'high' }), now)).toBe(true);
    expect(matchesFilter(t, f({ priority: 'low' }), now)).toBe(false);
    expect(matchesFilter(t, f({ tag: 'home' }), now)).toBe(true);
    expect(matchesFilter(t, f({ tag: 'work' }), now)).toBe(false);
    expect(matchesFilter(t, f({ title: '牛乳' }), now)).toBe(true);
    expect(matchesFilter(t, f({ title: 'パン' }), now)).toBe(false);
  });

  it('matchesFilter は AND（全条件一致のみ）', () => {
    const t = todo({ priority: 'high', tags: ['buy'], title: '牛乳', dueDate: now });
    expect(matchesFilter(t, f({ priority: 'high', tag: 'buy', due: 'today' }), now)).toBe(true);
    expect(matchesFilter(t, f({ priority: 'high', tag: 'work' }), now)).toBe(false);
  });

  it('visibleTodos はフィルタ適用後に並べる', () => {
    const base = stateWith([
      todo({ id: 'a', priority: 'high', dueDate: 1000 }),
      todo({ id: 'b', priority: 'low', dueDate: 500 }),
      todo({ id: 'c', priority: 'high', dueDate: 2000 }),
    ]);
    const s: State = { ...base, settings: { ...base.settings, filter: f({ priority: 'high' }) } };
    expect(visibleTodos(s).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('activeFilterCount は既定から外れた軸数', () => {
    expect(activeFilterCount(f())).toBe(0);
    expect(activeFilterCount(f({ priority: 'high' }))).toBe(1);
    expect(activeFilterCount(f({ priority: 'high', tag: 'x', title: ' ' }))).toBe(2); // 空白のみは無効
    expect(activeFilterCount(f({ due: 'today', title: '牛乳' }))).toBe(2);
  });

  it('distinctTags は一覧の全タグを昇順・重複なしで（tombstone 除外）', () => {
    const tags = distinctTags([
      todo({ id: 'a', tags: ['work', 'home'] }),
      todo({ id: 'b', tags: ['home', 'buy'] }),
      todo({ id: 'c', tags: ['gone'], deleted: true }),
    ]);
    expect(tags).toEqual(['buy', 'home', 'work']);
  });
});

describe('state/selectors（Phase 2 同期系）', () => {
  it('tasksBadge は一覧と同じ perTodoStatus の conflict 件数（todo 単位）', () => {
    const s: State = {
      ...stateWith([]),
      perTodoStatus: { a: 'conflict', b: 'conflict', c: 'synced' },
    };
    expect(tasksBadge(s)).toBe(2);
  });

  it('tasksBadge は残留マーカー（perTodoStatus に無い conflicts）を数えない（一覧と一致 / Issue #52）', () => {
    // 削除済み/未 materialize の todo にマーカーが残り conflicts には居るが、一覧（perTodoStatus）には出ない。
    const s: State = {
      ...stateWith([]),
      perTodoStatus: { a: 'conflict' },
      conflicts: [
        { todoId: 'a', field: 'title', base: 0, left: 1, right: 2 },
        { todoId: 'z', field: 'done', base: false, left: true, right: false }, // 残留マーカー
      ],
    };
    expect(tasksBadge(s)).toBe(1);
  });

  it('settingsBadge は needs-reauth / error で true', () => {
    expect(settingsBadge({ ...stateWith([]), global: 'needs-reauth' })).toBe(true);
    expect(settingsBadge({ ...stateWith([]), global: 'error' })).toBe(true);
    expect(settingsBadge({ ...stateWith([]), global: 'idle' })).toBe(false);
  });

  it('perTodoStatusOf は perTodoStatus を引く', () => {
    const s: State = { ...stateWith([]), perTodoStatus: { a: 'conflict' } };
    expect(perTodoStatusOf(s, 'a')).toBe('conflict');
    expect(perTodoStatusOf(s, 'z')).toBeUndefined();
  });
});
