import { describe, expect, it } from 'vitest';
import {
  buildAllJson,
  buildSettingsJson,
  buildTasksCsv,
  buildTasksJson,
  buildTasksMarkdown,
} from '../../src/services/ExportService';
import { DEFAULT_SETTINGS } from '../../src/model/constants';
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

const NOW = Date.UTC(2026, 5, 19, 12, 0, 0);

describe('services/ExportService', () => {
  it('JSON 正本は tombstone/version 込みで無損失（往復で一致）', () => {
    const todos = [
      todo({ id: 'a', title: 'alive', version: 3 }),
      todo({ id: 'b', title: 'gone', deleted: true, version: 7 }),
    ];
    const d = buildTasksJson(todos, NOW);
    expect(d.mime).toBe('application/json');
    expect(d.filename).toMatch(/\.json$/);
    const parsed = JSON.parse(d.text);
    expect(parsed.format).toBe('todo-pwa-export');
    expect(parsed.v).toBe(1);
    expect(parsed.kind).toBe('tasks');
    expect(parsed.tasks).toEqual(todos); // tombstone も version もそのまま
  });

  it('設定 JSON / 全体 JSON が種別と中身を持つ', () => {
    const s = buildSettingsJson(DEFAULT_SETTINGS, NOW);
    expect(JSON.parse(s.text).kind).toBe('settings');
    expect(JSON.parse(s.text).settings).toEqual(DEFAULT_SETTINGS);

    const all = buildAllJson([todo({ id: 'a' })], DEFAULT_SETTINGS, NOW);
    const allParsed = JSON.parse(all.text);
    expect(allParsed.kind).toBe('tasks+settings');
    expect(allParsed.tasks).toHaveLength(1);
    expect(allParsed.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('Markdown はチェックリスト（tombstone を除外）', () => {
    const d = buildTasksMarkdown(
      [
        todo({ id: 'a', title: '買い物', done: false }),
        todo({ id: 'b', title: '完了済み', done: true }),
        todo({ id: 'c', title: '消した', deleted: true }),
      ],
      NOW,
    );
    expect(d.mime).toBe('text/markdown');
    expect(d.text).toContain('- [ ] 買い物');
    expect(d.text).toContain('- [x] 完了済み');
    expect(d.text).not.toContain('消した'); // tombstone は出さない
  });

  it('CSV はヘッダ＋行、カンマ/引用符はエスケープ、tombstone を除外', () => {
    const d = buildTasksCsv(
      [
        todo({ id: 'a', title: 'a,b "c"', tags: ['x', 'y'] }),
        todo({ id: 'z', title: '消した', deleted: true }),
      ],
      NOW,
    );
    expect(d.mime).toBe('text/csv');
    const lines = d.text.trim().split('\n');
    expect(lines[0]).toBe('id,title,done,dueDate,priority,notes,tags');
    expect(lines[1]).toContain('"a,b ""c"""'); // カンマと " を含むセルは引用＋"" エスケープ
    expect(lines[1]).toContain('x;y'); // tags は ; 区切り
    expect(d.text).not.toContain('消した');
  });
});
