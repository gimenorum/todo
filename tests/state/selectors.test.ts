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
    expect(compareTodos(todo({ done: false }), todo({ done: true }))).toBeLessThan(0);
  });

  it('locates a todo by id', () => {
    const s = stateWith([todo({ id: 'a' }), todo({ id: 'b' })]);
    expect(findTodo(s, 'b')?.id).toBe('b');
    expect(findTodo(s, 'z')).toBeUndefined();
  });

  it('manual モードは done を保ちつつグループ内を order 昇順（Phase 6）', () => {
    const base = stateWith([
      todo({ id: 'c', order: 'm', createdAt: 1 }),
      todo({ id: 'a', order: 'g', createdAt: 2 }),
      todo({ id: 'doneItem', done: true, order: 'b', createdAt: 3 }),
      todo({ id: 'b', order: 'i', createdAt: 4 }),
    ]);
    const s: State = { ...base, settings: { ...base.settings, sortMode: 'manual' } };
    // 未完了は order 昇順（g<i<m）、完了は末尾。期日や作成順ではなく order で並ぶ。
    expect(visibleTodos(s).map((t) => t.id)).toEqual(['a', 'b', 'c', 'doneItem']);
  });

  it('auto モードは order を無視して従来の自動整列のまま', () => {
    const s = stateWith([
      todo({ id: 'late', order: 'a', dueDate: 2000 }),
      todo({ id: 'early', order: 'z', dueDate: 1000 }),
    ]);
    // sortMode は既定 auto。order が逆でも期日順。
    expect(visibleTodos(s).map((t) => t.id)).toEqual(['early', 'late']);
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
