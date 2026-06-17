import { describe, expect, it } from 'vitest';
import { renderKeyedList } from '../../src/ui/dom';

interface Item {
  id: string;
  label: string;
}

function setup() {
  const container = document.createElement('ul');
  document.body.replaceChildren(container);
  const nodeMap = new Map<string, HTMLElement>();

  const create = (it: Item): HTMLElement => {
    const li = document.createElement('li');
    li.dataset.id = it.id;
    li.appendChild(document.createElement('input'));
    return li;
  };
  const update = (node: HTMLElement, it: Item): void => {
    const input = node.querySelector('input');
    if (input && input.value !== it.label) input.value = it.label;
  };
  const ids = (): string[] =>
    [...container.children].map((c) => (c as HTMLElement).dataset.id ?? '');
  const run = (items: Item[]): void =>
    renderKeyedList({ container, items, getKey: (i) => i.id, create, update, nodeMap });

  return { container, nodeMap, ids, run };
}

describe('ui/renderKeyedList', () => {
  it('adds, updates, and removes by key', () => {
    const { container, ids, run } = setup();
    run([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    expect(ids()).toEqual(['a', 'b']);

    run([{ id: 'b', label: 'B2' }]);
    expect(ids()).toEqual(['b']);
    expect(container.querySelector('input')?.value).toBe('B2');
  });

  it('reorders without recreating nodes', () => {
    const { ids, run, nodeMap } = setup();
    run([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    const aNode = nodeMap.get('a');
    run([
      { id: 'b', label: 'B' },
      { id: 'a', label: 'A' },
    ]);
    expect(ids()).toEqual(['b', 'a']);
    expect(nodeMap.get('a')).toBe(aNode); // 同一ノードを再利用
  });

  it('preserves focus when surrounding items change (focused node stays put)', () => {
    // 既存ノードは再生成されず、位置が変わらないノードは触らないため、
    // 周囲の追加/更新/削除があってもフォーカスが保たれる（受け入れ基準）。
    const { run, nodeMap } = setup();
    run([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    const input = nodeMap.get('a')?.querySelector('input');
    input?.focus();
    expect(document.activeElement).toBe(input);

    // 末尾に追加・他項目を更新しても先頭 'a' は不動 → フォーカス維持
    run([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B2' },
      { id: 'c', label: 'C' },
    ]);
    expect(document.activeElement).toBe(input);

    // 末尾を削除しても 'a' は不動 → フォーカス維持
    run([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B2' },
    ]);
    expect(document.activeElement).toBe(input);
  });
});
