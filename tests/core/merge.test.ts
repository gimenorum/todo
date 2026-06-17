// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { merge3NoBase, mergeField, mergeSet, mergeTodo } from '../../src/core';
import { makeTodo, seedSnapshot } from '../helpers/factories';

describe('mergeField スカラ 3-way 決定表（ch.04 §4.5）', () => {
  it('両側不変 → base', () => {
    expect(mergeField('x', 'x', 'x', 'title', 't')).toEqual({ value: 'x', conflict: null });
  });
  it('left だけ変化 → left を採用', () => {
    expect(mergeField('x', 'y', 'x', 'title', 't')).toEqual({ value: 'y', conflict: null });
  });
  it('right だけ変化 → right を採用', () => {
    expect(mergeField('x', 'x', 'z', 'title', 't')).toEqual({ value: 'z', conflict: null });
  });
  it('両側が同じ値に変化 → その値（非競合）', () => {
    expect(mergeField('x', 'y', 'y', 'title', 't')).toEqual({ value: 'y', conflict: null });
  });
  it('両側が別値に変化 → 競合（暫定 left）', () => {
    const res = mergeField('x', 'y', 'z', 'title', 't');
    expect(res.value).toBe('y');
    expect(res.conflict).toEqual({ todoId: 't', field: 'title', base: 'x', left: 'y', right: 'z' });
  });
});

describe('mergeSet 集合 3-way（tags / ch.04 §4.5）', () => {
  it('両側の追加は和（競合なし）', () => {
    expect(mergeSet(['a'], ['a', 'b'], ['a', 'c'])).toEqual(['a', 'b', 'c']);
  });
  it('片側の削除は反映される', () => {
    expect(mergeSet(['a', 'b'], ['a'], ['a', 'b'])).toEqual(['a']);
  });
  it('並び順の違いだけなら不変', () => {
    expect(mergeSet(['a', 'b'], ['b', 'a'], ['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('mergeTodo の存在規則（ch.04 §4.5）', () => {
  it('edit vs delete は deleted 競合（自動解決しない・編集版を暫定保持）', () => {
    const base = makeTodo({ id: 'x', title: 'orig', deleted: false });
    const left = makeTodo({ id: 'x', title: 'edited', deleted: false, version: 2 }); // alive かつ内容編集
    const right = makeTodo({ id: 'x', title: 'orig', deleted: true, version: 2 }); // 削除（内容保持）
    const res = mergeTodo(base, left, right);
    expect(res.todo?.title).toBe('edited'); // 片側のみ内容編集 → 自動採用
    expect(res.todo?.deleted).toBe(false); // 暫定 alive（編集版を残す＝一覧から消さない）
    expect(res.conflicts).toEqual([
      { todoId: 'x', field: 'deleted', base: false, left: false, right: true },
    ]);
  });

  it('delete vs 未編集 → 削除を自動適用（競合なし）', () => {
    const base = makeTodo({ id: 'x', title: 'orig' });
    const left = makeTodo({ id: 'x', title: 'orig', deleted: true, version: 2 }); // 削除（内容保持）
    const right = makeTodo({ id: 'x', title: 'orig' }); // 未編集
    const res = mergeTodo(base, left, right);
    expect(res.conflicts).toEqual([]);
    expect(res.todo?.deleted).toBe(true);
  });

  it('resurrect vs 未編集 → 復活を自動適用（競合なし）', () => {
    const base = makeTodo({ id: 'x', title: 'orig', deleted: true });
    const left = makeTodo({ id: 'x', title: 'orig', deleted: false, version: 2 }); // 復活（内容保持）
    const right = makeTodo({ id: 'x', title: 'orig', deleted: true }); // 未編集（削除のまま）
    const res = mergeTodo(base, left, right);
    expect(res.conflicts).toEqual([]);
    expect(res.todo?.deleted).toBe(false);
  });

  it('delete vs delete は tombstone（競合なし）', () => {
    const base = makeTodo({ id: 'x', deleted: false });
    const left = makeTodo({ id: 'x', deleted: true, version: 2 });
    const right = makeTodo({ id: 'x', deleted: true, version: 2 });
    const res = mergeTodo(base, left, right);
    expect(res.todo?.deleted).toBe(true);
    expect(res.conflicts).toEqual([]);
  });

  it('片側のみ存在（純粋追加）はその側を採用', () => {
    const left = makeTodo({ id: 'x', title: 'new' });
    const res = mergeTodo(undefined, left, undefined);
    expect(res.todo?.title).toBe('new');
    expect(res.conflicts).toEqual([]);
  });
});

describe('merge3NoBase フォールバック（ch.04 §4.5）', () => {
  it('base 不在は (version 大) で side を採用', () => {
    const left = seedSnapshot([makeTodo({ id: 'x', title: 'L', version: 2 })]);
    const right = seedSnapshot([makeTodo({ id: 'x', title: 'R', version: 3 })]);
    const res = merge3NoBase(left, right);
    expect(res.mergedSnapshot.todos['x'].title).toBe('R');
    expect(res.conflicts).toEqual([]);
  });
});
