import { afterEach, describe, expect, it } from 'vitest';
import {
  activeToken,
  applySelection,
  attachTagSuggest,
  filterCandidates,
} from '../../src/ui/tagSuggest';

describe('tagSuggest 純粋ヘルパ（Issue #65）', () => {
  it('activeToken は末尾キャレットのトークンを返す', () => {
    expect(activeToken('home wor', 8)).toEqual({ start: 5, end: 8, text: 'wor' });
  });
  it('activeToken は中間キャレットでも境界を取る', () => {
    // "home wor|k" → トークン "work"、text はキャレットまで "wor"
    expect(activeToken('home work', 8)).toEqual({ start: 5, end: 9, text: 'wor' });
  });
  it('activeToken は空入力で空トークン', () => {
    expect(activeToken('', 0)).toEqual({ start: 0, end: 0, text: '' });
  });

  it('filterCandidates は部分一致（大小無視）で絞り、使用済みを除外', () => {
    const all = ['work', 'workout', 'home', 'buy'];
    expect(filterCandidates(all, 'wor', 'wor')).toEqual(['work', 'workout']);
    // 'work' は入力済み → 除外、'workout' は残る
    expect(filterCandidates(all, 'work wo', 'wo')).toEqual(['workout']);
  });
  it('filterCandidates は空トークンで使用済み以外の全件（最大件数）', () => {
    const all = ['a', 'b', 'c'];
    expect(filterCandidates(all, '', '')).toEqual(['a', 'b', 'c']);
    expect(filterCandidates(all, 'a ', '')).toEqual(['b', 'c']);
    expect(filterCandidates(['t1', 't2', 't3'], '', '', 2)).toEqual(['t1', 't2']);
  });

  it('applySelection はトークンを置換し末尾に空白を足す', () => {
    expect(applySelection('home wor', 8, 'work')).toEqual({ value: 'home work ', caret: 10 });
  });
  it('applySelection は後続を二重区切りにしない', () => {
    // "wor| home" のトークンを work に
    expect(applySelection('wor home', 3, 'work')).toEqual({ value: 'work home', caret: 5 });
  });
});

describe('tagSuggest DOM 動作（jsdom）', () => {
  let input: HTMLInputElement;
  let wrap: HTMLElement;
  let destroy: () => void;

  function setup(candidates: string[]): void {
    document.body.innerHTML = '';
    wrap = document.createElement('div');
    wrap.className = 'tag-suggest';
    input = document.createElement('input');
    input.type = 'text';
    wrap.append(input);
    document.body.append(wrap);
    ({ destroy } = attachTagSuggest(input, () => candidates));
  }

  function listEl(): HTMLElement {
    return wrap.querySelector('.tag-suggest-list') as HTMLElement;
  }
  function options(): string[] {
    return Array.from(listEl().querySelectorAll('.tag-suggest-option')).map((n) => n.textContent ?? '');
  }

  afterEach(() => destroy?.());

  it('フォーカスで既存タグ候補が出る', () => {
    setup(['work', 'home', 'buy']);
    input.value = '';
    input.dispatchEvent(new Event('focus'));
    expect(listEl().hidden).toBe(false);
    expect(options()).toEqual(['work', 'home', 'buy']);
  });

  it('入力中トークンで候補を絞る', () => {
    setup(['work', 'workout', 'home']);
    input.value = 'ho';
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new Event('input'));
    expect(options()).toEqual(['home']);
  });

  it('候補クリックで入力値が「タグ＋空白」に更新され、選んだタグは候補から消える', () => {
    setup(['work', 'home']);
    input.value = '';
    input.dispatchEvent(new Event('focus'));
    const first = listEl().querySelector('.tag-suggest-option') as HTMLElement;
    first.dispatchEvent(new Event('pointerdown')); // work を選択
    expect(input.value).toBe('work ');
    // 再表示の候補は work を除外
    expect(options()).toEqual(['home']);
  });

  it('使用済みタグはフォーカス時の候補から除外', () => {
    setup(['work', 'home', 'buy']);
    input.value = 'home ';
    input.setSelectionRange(5, 5);
    input.dispatchEvent(new Event('focus'));
    expect(options()).toEqual(['work', 'buy']);
  });

  it('Escape で閉じる', () => {
    setup(['work']);
    input.value = '';
    input.dispatchEvent(new Event('focus'));
    expect(listEl().hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(listEl().hidden).toBe(true);
  });

  it('候補が無ければ閉じる', () => {
    setup(['work']);
    input.value = 'zzz';
    input.setSelectionRange(3, 3);
    input.dispatchEvent(new Event('input'));
    expect(listEl().hidden).toBe(true);
  });
});
