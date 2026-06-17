import { describe, expect, it } from 'vitest';
import {
  compareTodos,
  findTodo,
  perTodoStatusOf,
  settingsBadge,
  tasksBadge,
  visibleTodos,
} from '../../src/state/selectors';
import type { State, Todo } from '../../src/model/types';
import { DEFAULT_SETTINGS } from '../../src/model/constants';

function todo(p: Partial<Todo>): Todo {
  return {
    id: p.id ?? 'x',
    title: p.title ?? '',
    done: p.done ?? false,
    dueDate: p.dueDate ?? null,
    priority: p.priority ?? 'none',
    notes: p.notes ?? '',
    tags: p.tags ?? [],
    order: '',
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
    expect(compareTodos(todo({ done: false }), todo({ done: true }))).toBeLessThan(0);
  });

  it('locates a todo by id', () => {
    const s = stateWith([todo({ id: 'a' }), todo({ id: 'b' })]);
    expect(findTodo(s, 'b')?.id).toBe('b');
    expect(findTodo(s, 'z')).toBeUndefined();
  });
});

describe('state/selectors（Phase 2 同期系）', () => {
  it('tasksBadge は競合のある todo 件数（フィールド数ではなく todo 単位）', () => {
    const s: State = {
      ...stateWith([]),
      conflicts: [
        { todoId: 'a', field: 'title', base: 0, left: 1, right: 2 },
        { todoId: 'a', field: 'notes', base: 0, left: 1, right: 2 },
        { todoId: 'b', field: 'done', base: false, left: true, right: false },
      ],
    };
    expect(tasksBadge(s)).toBe(2);
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
