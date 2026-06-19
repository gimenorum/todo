import { afterEach, describe, expect, it } from 'vitest';
import { createTagInput, filterTags } from '../../src/ui/tagInput';

describe('filterTags（Issue #65）', () => {
  it('付与済みを除外し、query で大小無視の部分一致', () => {
    const all = ['work', 'workout', 'home', 'buy'];
    expect(filterTags(all, [], 'wor')).toEqual(['work', 'workout']);
    expect(filterTags(all, ['work'], 'wo')).toEqual(['workout']);
  });
  it('空 query は付与済み以外の全件（最大件数）', () => {
    expect(filterTags(['a', 'b', 'c'], ['b'], '')).toEqual(['a', 'c']);
    expect(filterTags(['a', 'b', 'c'], [], '', 2)).toEqual(['a', 'b']);
  });
});

describe('createTagInput DOM（jsdom）', () => {
  let api: ReturnType<typeof createTagInput>;
  let root: HTMLElement;
  let text: HTMLInputElement;

  function setup(initial: string[], candidates: string[]): void {
    document.body.innerHTML = '';
    api = createTagInput(initial, () => candidates);
    root = api.el;
    document.body.append(root);
    text = root.querySelector('.tag-input-text') as HTMLInputElement;
  }
  function chips(): string[] {
    return Array.from(root.querySelectorAll('.tag-chip-label')).map((n) => n.textContent ?? '');
  }
  function options(): string[] {
    return Array.from(root.querySelectorAll('.tag-suggest-option')).map((n) => n.textContent ?? '');
  }

  afterEach(() => api?.destroy());

  it('初期タグがチップで表示され getTags に反映', () => {
    setup(['home', 'buy'], ['home', 'buy', 'work']);
    expect(chips()).toEqual(['home', 'buy']);
    expect(api.getTags()).toEqual(['home', 'buy']);
  });

  it('テキスト＋Enter で新規タグを追加', () => {
    setup([], ['work']);
    text.value = 'newtag';
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(api.getTags()).toEqual(['newtag']);
    expect(text.value).toBe('');
  });

  it('スペースで確定', () => {
    setup([], []);
    text.value = 'abc';
    text.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(api.getTags()).toEqual(['abc']);
  });

  it('候補をクリックでチップ追加、付与済みは候補から消える', () => {
    setup([], ['work', 'home']);
    text.dispatchEvent(new Event('focus'));
    expect(options()).toEqual(['work', 'home']);
    const first = root.querySelector('.tag-suggest-option') as HTMLElement;
    first.dispatchEvent(new Event('pointerdown'));
    expect(api.getTags()).toEqual(['work']);
    expect(options()).toEqual(['home']); // 残り候補
  });

  it('入力で候補を絞り込む', () => {
    setup([], ['work', 'workout', 'home']);
    text.value = 'ho';
    text.dispatchEvent(new Event('input'));
    expect(options()).toEqual(['home']);
  });

  it('× でチップ削除', () => {
    setup(['home', 'buy'], []);
    const removeBtns = root.querySelectorAll('.tag-chip-remove');
    (removeBtns[0] as HTMLElement).click(); // home を削除
    expect(api.getTags()).toEqual(['buy']);
  });

  it('空入力で Backspace は末尾チップを削除', () => {
    setup(['a', 'b'], []);
    text.value = '';
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(api.getTags()).toEqual(['a']);
  });

  it('重複タグは追加しない', () => {
    setup(['home'], ['home']);
    text.value = 'home';
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(api.getTags()).toEqual(['home']);
  });
});
