// DOM 生成・差分更新ヘルパ（ch.07 §7.2/§7.3）。
// 文字列連結による DOM 生成・innerHTML は使わない。ユーザー由来テキストは textContent。

export function cloneTemplate(id: string): HTMLElement {
  const tmpl = document.getElementById(id);
  if (!(tmpl instanceof HTMLTemplateElement)) {
    throw new Error(`template not found: #${id}`);
  }
  const first = tmpl.content.firstElementChild;
  if (!first) throw new Error(`template is empty: #${id}`);
  return first.cloneNode(true) as HTMLElement;
}

interface ElOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  return node;
}

export function qs<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`element not found: ${selector}`);
  return node as T;
}

// textContent を「変わったときだけ」書き換える（不要な DOM 変更・ちらつきを避ける）。
export function setTextIfChanged(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export interface KeyedListOptions<T> {
  container: HTMLElement;
  items: T[];
  getKey: (item: T) => string;
  create: (item: T) => HTMLElement;
  update: (node: HTMLElement, item: T) => void;
  nodeMap: Map<string, HTMLElement>;
}

/**
 * id キー差分更新（ch.07 §7.2）。既存ノードは再生成せず属性のみ更新するため、
 * 入力中のフォーカス・キャレット・スクロール位置が保たれる（受け入れ基準）。
 */
export function renderKeyedList<T>(o: KeyedListOptions<T>): void {
  const { container, items, getKey, create, update, nodeMap } = o;
  const nextKeys = new Set(items.map(getKey));

  // 1) 削除: 新リストに無いノードを除去。
  for (const [key, node] of nodeMap) {
    if (!nextKeys.has(key)) {
      node.remove();
      nodeMap.delete(key);
    }
  }

  // 2) 追加/更新 + 並び順を最小限の移動で反映。
  let prev: Element | null = null;
  for (const item of items) {
    const key = getKey(item);
    let node = nodeMap.get(key);
    if (!node) {
      node = create(item);
      nodeMap.set(key, node);
    }
    update(node, item);

    const desired: Element | null = prev
      ? prev.nextElementSibling
      : container.firstElementChild;
    if (node !== desired) {
      container.insertBefore(node, desired);
    }
    prev = node;
  }
}
