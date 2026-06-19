import { beforeEach, describe, expect, it } from 'vitest';
import { mergeTasks, parse, sanitizeSettings } from '../../src/services/ImportService';
import { buildAllJson, buildTasksJson } from '../../src/services/ExportService';
import * as todoStore from '../../src/store/todoStore';
import { getDb } from '../../src/store/db';
import { STORE, DEFAULT_SETTINGS } from '../../src/model/constants';
import type { Todo } from '../../src/model/types';

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

async function clearDb(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE.todos);
}
beforeEach(clearDb);

describe('services/ImportService parse', () => {
  it('正規のバックアップ（タスク）をパースできる', () => {
    const text = buildTasksJson([todo({ id: 'a', title: 'A', version: 2 })], 0).text;
    const data = parse(text);
    expect(data.kind).toBe('tasks');
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks?.[0]).toMatchObject({ id: 'a', title: 'A', version: 2 });
  });

  it('タスク＋設定をパースできる', () => {
    const text = buildAllJson([todo({ id: 'a' })], DEFAULT_SETTINGS, 0).text;
    const data = parse(text);
    expect(data.kind).toBe('tasks+settings');
    expect(data.tasks).toHaveLength(1);
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('不正な JSON は説明的に throw', () => {
    expect(() => parse('{ not json')).toThrow();
  });

  it('別アプリ/別バージョンのファイルは弾く', () => {
    expect(() => parse(JSON.stringify({ format: 'other', v: 1, kind: 'tasks' }))).toThrow();
    expect(() => parse(JSON.stringify({ format: 'todo-pwa-export', v: 2, kind: 'tasks' }))).toThrow();
  });
});

describe('services/ImportService mergeTasks（no-base / recency）', () => {
  it('同 id は version の大、異 id は両立、tombstone は recency で resurrect しない', async () => {
    await todoStore.putTodos([
      todo({ id: 'a', title: 'A-existing', version: 2 }),
      todo({ id: 'b', title: 'B-existing', version: 5 }),
      todo({ id: 'd', title: 'D-only-existing', version: 1 }),
      todo({ id: 'e', title: 'E-alive', version: 3, deleted: false }),
    ]);

    const merged = await mergeTasks([
      todo({ id: 'a', title: 'A-imported', version: 5 }), // version 大 → 採用
      todo({ id: 'b', title: 'B-imported', version: 1 }), // version 小 → 不採用
      todo({ id: 'c', title: 'C-only-imported', version: 1 }), // 異 id → 追加
      todo({ id: 'e', title: 'E-tombstone', version: 1, deleted: true }), // 旧い tombstone → 無視
    ]);

    const byId = Object.fromEntries(merged.map((t) => [t.id, t]));
    expect(byId.a.title).toBe('A-imported');
    expect(byId.b.title).toBe('B-existing');
    expect(byId.c.title).toBe('C-only-imported');
    expect(byId.d.title).toBe('D-only-existing');
    expect(byId.e.deleted).toBe(false); // 新しい alive 版が残り、古い tombstone で消えない

    // materialize されている（store に反映）。
    const stored = await todoStore.getAllTodos();
    expect(stored.find((t) => t.id === 'a')?.title).toBe('A-imported');
    expect(stored.find((t) => t.id === 'c')).toBeTruthy();
  });
});

describe('services/ImportService sanitizeSettings', () => {
  it('connectedProvider は適用対象から除外する', () => {
    const out = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      connectedProvider: 'dropbox',
      autoSyncMode: 'manual',
    });
    expect(out).not.toHaveProperty('connectedProvider');
    expect(out.autoSyncMode).toBe('manual');
  });
});
