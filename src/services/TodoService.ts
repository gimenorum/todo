import { newUuid } from '../model/ids';
import * as todoStore from '../store/todoStore';
import type { Todo, Uuid } from '../model/types';

// core・store を編成するオーケストレーション層（ch.01）。
// Phase 0 はローカル永続のみ（同期は Phase 1+ で services に追加）。

export type TodoDraft = Pick<Todo, 'title'> &
  Partial<Pick<Todo, 'done' | 'dueDate' | 'notifyBeforeMs' | 'priority' | 'notes' | 'tags' | 'order'>>;

export type TodoPatch = Partial<
  Pick<
    Todo,
    'title' | 'done' | 'dueDate' | 'notifyBeforeMs' | 'priority' | 'notes' | 'tags' | 'deleted' | 'order'
  >
>;

// 旧レコード（notifyBeforeMs を持たない）を安全に補完する（Issue #71）。
// 直列化は undefined を落とすため、読み出し・materialize 時に常に null 以上へ正規化する。
export function withNotifyDefault(t: Todo): Todo {
  return (t.notifyBeforeMs ?? null) === t.notifyBeforeMs ? t : { ...t, notifyBeforeMs: null };
}

export async function listAll(): Promise<Todo[]> {
  return (await todoStore.getAllTodos()).map(withNotifyDefault);
}

export async function createTodo(draft: TodoDraft): Promise<Todo> {
  const now = Date.now();
  const todo: Todo = {
    id: newUuid(),
    title: draft.title,
    done: draft.done ?? false,
    dueDate: draft.dueDate ?? null,
    notifyBeforeMs: draft.notifyBeforeMs ?? null,
    priority: draft.priority ?? 'none',
    notes: draft.notes ?? '',
    tags: draft.tags ?? [],
    order: draft.order ?? '', // 手動並べ替え用。未指定は '' （Phase 6・手動モード切替時にバックフィル）
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
