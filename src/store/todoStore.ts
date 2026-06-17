import { getDb } from './db';
import { STORE } from '../model/constants';
import type { Todo, Uuid } from '../model/types';

// materialize 済み TODO（表示の正）。アプリは常にここを読み書きする（ch.06・オフライン動作）。

export async function getAllTodos(): Promise<Todo[]> {
  const db = await getDb();
  return db.getAll(STORE.todos);
}

export async function getTodo(id: Uuid): Promise<Todo | undefined> {
  const db = await getDb();
  return db.get(STORE.todos, id);
}

export async function putTodo(todo: Todo): Promise<void> {
  const db = await getDb();
  await db.put(STORE.todos, todo);
}

export async function putTodos(todos: Todo[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE.todos, 'readwrite');
  await Promise.all([...todos.map((t) => tx.store.put(t)), tx.done]);
}

// 物理削除（GC 用途）。通常の削除は putTodo({ deleted: true }) の tombstone で表す。
export async function hardDeleteTodo(id: Uuid): Promise<void> {
  const db = await getDb();
  await db.delete(STORE.todos, id);
}
