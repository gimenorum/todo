import { describe, expect, it } from 'vitest';
import { buildPatch, parseFieldInput, type FieldChoice } from '../../src/ui/views/ConflictMergeView';
import type { FieldConflict, TodoField } from '../../src/model/types';

function fc(field: TodoField, left: unknown, right: unknown): FieldConflict {
  return { todoId: 't1', field, base: undefined, left, right };
}
function choices(entries: Array<[TodoField, FieldChoice]>): Map<TodoField, FieldChoice> {
  return new Map(entries);
}

describe('ui/ConflictMergeView buildPatch', () => {
  it('全フィールド left → 各 c.left を採用', () => {
    const conflicts = [fc('title', 'L', 'R'), fc('priority', 'low', 'high')];
    const ch = choices([
      ['title', { mode: 'left', editValue: 'L' }],
      ['priority', { mode: 'left', editValue: 'low' }],
    ]);
    expect(buildPatch(conflicts, ch, null)).toEqual({ title: 'L', priority: 'low' });
  });

  it('right を混在で採用（done は二値も左右で網羅）', () => {
    const conflicts = [fc('title', 'L', 'R'), fc('done', false, true)];
    const ch = choices([
      ['title', { mode: 'right', editValue: 'L' }],
      ['done', { mode: 'right', editValue: '' }],
    ]);
    expect(buildPatch(conflicts, ch, null)).toEqual({ title: 'R', done: true });
  });

  it('edit は型変換して採用（title / priority / tags / dueDate）', () => {
    const conflicts = [
      fc('title', 'L', 'R'),
      fc('priority', 'low', 'high'),
      fc('tags', ['a'], ['b']),
      fc('dueDate', 0, 1000),
    ];
    const ch = choices([
      ['title', { mode: 'edit', editValue: 'edited' }],
      ['priority', { mode: 'edit', editValue: 'med' }],
      ['tags', { mode: 'edit', editValue: '#x y, z' }],
      ['dueDate', { mode: 'edit', editValue: '2026-06-18' }],
    ]);
    const patch = buildPatch(conflicts, ch, null);
    expect(patch.title).toBe('edited');
    expect(patch.priority).toBe('med');
    expect(patch.tags).toEqual(['x', 'y', 'z']);
    expect(patch.dueDate).toBe(Date.parse('2026-06-18T00:00:00'));
  });

  it('choices 未設定のフィールドは left 既定', () => {
    expect(buildPatch([fc('title', 'L', 'R')], new Map(), null)).toEqual({ title: 'L' });
  });

  it('deleted 競合は二択で patch.deleted を確定（フィールド選択には現れない）', () => {
    const conflicts = [fc('deleted', false, true)];
    expect(buildPatch(conflicts, new Map(), 'apply-delete')).toEqual({ deleted: true });
    expect(buildPatch(conflicts, new Map(), 'keep-edit')).toEqual({ deleted: false });
  });
});

describe('ui/ConflictMergeView parseFieldInput', () => {
  it('dueDate は Millis|null', () => {
    expect(parseFieldInput('dueDate', '')).toBeNull();
    expect(parseFieldInput('dueDate', '2026-06-18')).toBe(Date.parse('2026-06-18T00:00:00'));
  });
  it('tags は正規化済み配列（# 除去・重複/空除去）', () => {
    expect(parseFieldInput('tags', '#a a, b')).toEqual(['a', 'b']);
  });
  it('done は boolean', () => {
    expect(parseFieldInput('done', 'true')).toBe(true);
    expect(parseFieldInput('done', '')).toBe(false);
  });
  it('title はそのまま', () => {
    expect(parseFieldInput('title', '  hi ')).toBe('  hi ');
  });
});
