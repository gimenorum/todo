import { newUuid } from '../model/ids';
import * as todoStore from '../store/todoStore';
import type { Todo, Uuid } from '../model/types';

// core・store を編成するオーケストレーション層（ch.01）。
// Phase 0 はローカル永続のみ（同期は Phase 1+ で services に追加）。

export type TodoDraft = Pick<Todo, 'title'> &
  Partial<Pick<Todo, 'done' | 'dueDate' | 'priority' | 'notes' | 'tags'>>;

export type TodoPatch = Partial<
  Pick<Todo, 'title' | 'done' | 'dueDate' | 'priority' | 'notes' | 'tags' | 'deleted'>
>;

export async function listAll(): Promise<Todo[]> {
  return todoStore.getAllTodos();
}

export async function createTodo(draft: TodoDraft): Promise<Todo> {
  const now = Date.now();
  const todo: Todo = {
    id: newUuid(),
    title: draft.title,
    done: draft.done ?? false,
    dueDate: draft.dueDate ?? null,
    priority: draft.priority ?? 'none',
    notes: draft.notes ?? '',
    tags: draft.tags ?? [],
    order: '', // v1 未使用（予約）
    createdAt: now,
    updatedAt: now,
    deleted: false,
    version: 1,
  };
  await todoStore.putTodo(todo);
  return todo;
}

// 編集のたびに version を +1（ch.03）。updatedAt も更新。
export async function updateTodo(id: Uuid, patch: TodoPatch): Promise<Todo | undefined> {
  const current = await todoStore.getTodo(id);
  if (!current) return undefined;
  const next: Todo = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
    version: current.version + 1,
  };
  await todoStore.putTodo(next);
  return next;
}

// 削除は tombstone（物理削除しない / ch.03・同期の前提）。
export async function softDeleteTodo(id: Uuid): Promise<Todo | undefined> {
  return updateTodo(id, { deleted: true });
}
