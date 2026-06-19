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

// 初回オープンが応答しないこと（WebKit のナビゲーション直後ハング等）への保険。
// これを超えても解決しなければ再試行し、全試行が時間切れなら reject する（無限「読み込み中…」回避 / Issue #63）。
const OPEN_TIMEOUT_MS = 4000;
const OPEN_ATTEMPTS = 3;

function openOnce(): Promise<IDBPDatabase<TodoDB>> {
  return openDB<TodoDB>(DB_NAME, DB_VERSION, {
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
    // 別タブ等が旧バージョンを掴んでいて upgrade できない。タイムアウト再試行に委ねる。
    blocked() {
      console.warn('[db] open blocked by another connection');
    },
    // 自分が他コンテキストの新しい upgrade を妨げている。閉じて相手を通す（多重タブのハング回避）。
    blocking() {
      void closeDb();
    },
    // 接続が異常終了したらメモを破棄し、次回は再オープンする。
    terminated() {
      dbPromise = null;
    },
  });
}

// 指定時間内に解決しなければ拒否（元の Promise は捨てる＝呼び出し側で後始末する）。
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

// ハング耐性のあるオープン。各試行をタイムアウトで打ち切り、応答すれば返す。
// 遅れて解決した接続はリークしないよう閉じる。全試行が失敗なら最後のエラーで reject。
export async function openWithTimeout(
  open: () => Promise<IDBPDatabase<TodoDB>>,
  timeoutMs = OPEN_TIMEOUT_MS,
  attempts = OPEN_ATTEMPTS,
): Promise<IDBPDatabase<TodoDB>> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const p = open();
    try {
      return await withTimeout(p, timeoutMs);
    } catch (err) {
      lastErr = err;
      // 打ち切った試行が後から解決しても二重接続を残さない。
      void p.then((db) => db.close()).catch(() => undefined);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('IndexedDB open failed');
}

export function getDb(): Promise<IDBPDatabase<TodoDB>> {
  if (!dbPromise) {
    dbPromise = openWithTimeout(openOnce).catch((err: unknown) => {
      dbPromise = null; // 失敗のメモ化を残さない（次回呼び出しで再試行できる）。
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  return dbPromise;
}

async function closeDb(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  try {
    (await p)?.close();
  } catch {
    /* 既に閉じている等は無視 */
  }
}
