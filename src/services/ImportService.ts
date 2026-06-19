// services/ImportService.ts — インポート（Phase 5 / ch.13）。
// タスクは「外部状態を 1 つの先端」としてマージエンジン（no-base / recency）で統合する。
// 設定は端末ごと設定への適用（connectedProvider は除外＝トークン依存のため上書きしない）。
import { merge3NoBase } from '../core';
import { snapshotFromTodos } from './syncLocalState';
import * as todoStore from '../store/todoStore';
import type { DeviceSettings, ImportData, Priority, Todo } from '../model/types';

const PRIORITIES: readonly Priority[] = ['none', 'low', 'med', 'high'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// 1 件の Todo として妥当か（不正な型は静かに通さず throw する＝黙ってデータを壊さない）。
function asTodo(v: unknown, i: number): Todo {
  if (!isObject(v)) throw new Error(`タスク[${i}] が不正です（オブジェクトではありません）。`);
  const id = v.id;
  const title = v.title;
  if (typeof id !== 'string' || id === '') throw new Error(`タスク[${i}] の id が不正です。`);
  if (typeof title !== 'string') throw new Error(`タスク[${i}] の title が不正です。`);
  const priority = PRIORITIES.includes(v.priority as Priority) ? (v.priority as Priority) : 'none';
  const dueDate = typeof v.dueDate === 'number' ? v.dueDate : null;
  const tags = Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : [];
  const num = (x: unknown, d: number): number => (typeof x === 'number' ? x : d);
  return {
    id,
    title,
    done: v.done === true,
    dueDate,
    priority,
    notes: typeof v.notes === 'string' ? v.notes : '',
    tags,
    order: typeof v.order === 'string' ? v.order : '',
    createdAt: num(v.createdAt, 0),
    updatedAt: num(v.updatedAt, 0),
    deleted: v.deleted === true,
    version: num(v.version, 1),
  };
}

// バックアップ（JSON 正本）を検証してパースする。不正は説明的な Error。
export function parse(text: string): ImportData {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('ファイルを読み取れませんでした（JSON として不正です）。');
  }
  if (!isObject(obj) || obj.format !== 'todo-pwa-export') {
    throw new Error('このアプリのバックアップファイルではありません。');
  }
  if (obj.v !== 1) throw new Error(`未対応のバージョンです（v=${String(obj.v)}）。`);
  const kind = obj.kind;
  if (kind !== 'tasks' && kind !== 'settings' && kind !== 'tasks+settings') {
    throw new Error('バックアップの種別が不正です。');
  }

  const data: ImportData = { kind };
  if (kind === 'tasks' || kind === 'tasks+settings') {
    if (!Array.isArray(obj.tasks)) throw new Error('タスクが含まれていません。');
    data.tasks = obj.tasks.map((t, i) => asTodo(t, i));
  }
  if (kind === 'settings' || kind === 'tasks+settings') {
    if (!isObject(obj.settings)) throw new Error('設定が含まれていません。');
    data.settings = obj.settings as unknown as DeviceSettings;
  }
  return data;
}

// インポートしたタスクを既存と統合する（no-base: 同 id は recency で採用、異 id は両立）。
// materialize（putTodos）まで行い、統合後の全件（tombstone 含む）を返す。push は呼び出し側が notifyEdited で乗せる。
export async function mergeTasks(imported: Todo[]): Promise<Todo[]> {
  const current = snapshotFromTodos(await todoStore.getAllTodos());
  const { mergedSnapshot } = merge3NoBase(current, snapshotFromTodos(imported));
  const merged = Object.values(mergedSnapshot.todos);
  await todoStore.putTodos(merged);
  return merged;
}

// 設定インポートの適用値（connectedProvider は除外＝連携状態はトークンに紐づくため上書きしない）。
export function sanitizeSettings(s: DeviceSettings): Partial<DeviceSettings> {
  const next: Partial<DeviceSettings> = {};
  if (s.autoSyncMode === 'manual' || s.autoSyncMode === 'interval') next.autoSyncMode = s.autoSyncMode;
  if (typeof s.autoSyncIntervalMs === 'number') next.autoSyncIntervalMs = s.autoSyncIntervalMs;
  if (typeof s.sidebarCollapsed === 'boolean') next.sidebarCollapsed = s.sidebarCollapsed;
  if (typeof s.language === 'string') next.language = s.language;
  return next;
}
