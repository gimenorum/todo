import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/ui/components/TextDiff';

describe('ui/components/TextDiff diffLines', () => {
  it('同一文字列は全行 common', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nc');
    expect(d.every((l) => l.type === 'common')).toBe(true);
    expect(d.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('末尾に追加された行は add', () => {
    expect(diffLines('a\nb', 'a\nb\nc')).toEqual([
      { type: 'common', text: 'a' },
      { type: 'common', text: 'b' },
      { type: 'add', text: 'c' },
    ]);
  });

  it('中間の削除された行は del', () => {
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual([
      { type: 'common', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'common', text: 'c' },
    ]);
  });

  it('一行置換は del + add（前後は common）', () => {
    expect(diffLines('keep\nold\nkeep2', 'keep\nnew\nkeep2')).toEqual([
      { type: 'common', text: 'keep' },
      { type: 'del', text: 'old' },
      { type: 'add', text: 'new' },
      { type: 'common', text: 'keep2' },
    ]);
  });

  it('共通行が無ければ左を全 del・右を全 add', () => {
    const d = diffLines('x\ny', 'p\nq');
    expect(d.filter((l) => l.type === 'del').map((l) => l.text)).toEqual(['x', 'y']);
    expect(d.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['p', 'q']);
    expect(d.some((l) => l.type === 'common')).toBe(false);
  });

  it('空文字 vs 非空は片側のみ', () => {
    expect(diffLines('', 'hello')).toEqual([
      { type: 'del', text: '' },
      { type: 'add', text: 'hello' },
    ]);
  });
});
