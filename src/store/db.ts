import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, STORE } from '../model/constants';
import type { ObjectKind, StoredToken, Todo } from '../model/types';

// ch.06 のオブジェクトストア。Phase 0 は todos/settings/meta、
// Phase 2 で objects（content-addressed blob 複製）と tokens（OAuth トークン）を追加（v1→v2）。
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
  // content-addressed オブジェクト（commit/snapshot blob）の複製。キーは内容ハッシュ。
  objects: {
    key: string;
    value: { hash: string; kind: ObjectKind; bytes: Uint8Array };
    indexes: { kind: string };
  };
  // OAuth トークン（provider をキーに 1 レコード）。同期しない。
  tokens: { key: string; value: StoredToken };
}

let dbPromise: Promise<IDBPDatabase<TodoDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<TodoDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TodoDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // contains ガードで冪等に。v1→v2 では objects/tokens のみ追加され、既存ストアは不変。
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
        if (!db.objectStoreNames.contains(STORE.objects)) {
          const objects = db.createObjectStore(STORE.objects, { keyPath: 'hash' });
          objects.createIndex('kind', 'kind');
        }
        if (!db.objectStoreNames.contains(STORE.tokens)) {
          db.createObjectStore(STORE.tokens);
        }
      },
    });
  }
  return dbPromise;
}
