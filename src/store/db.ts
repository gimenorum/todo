import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, STORE } from '../model/constants';
import type { Todo } from '../model/types';

// ch.06 のオブジェクトストア。Phase 0 は todos/settings/meta のみ
//（objects/tokens は同期導入 Phase 2 で追加）。
interface TodoDB extends DBSchema {
  todos: {
    key: string;
    value: Todo;
    // deleted は boolean で IndexedDB のキーに使えないため、表示フィルタは
    // メモリ側（selectors）で行う。索引は数値フィールドのみ。
    indexes: { updatedAt: number; dueDate: number };
  };
  settings: { key: string; value: unknown };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<TodoDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<TodoDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TodoDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE.todos)) {
          const todos = db.createObjectStore(STORE.todos, { keyPath: 'id' });
          todos.createIndex('updatedAt', 'updatedAt');
          todos.createIndex('dueDate', 'dueDate');
        }
        if (!db.objectStoreNames.contains(STORE.settings)) {
          db.createObjectStore(STORE.settings);
        }
        if (!db.objectStoreNames.contains(STORE.meta)) {
          db.createObjectStore(STORE.meta);
        }
      },
    });
  }
  return dbPromise;
}
