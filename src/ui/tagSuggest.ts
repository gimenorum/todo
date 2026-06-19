// ui/tagSuggest.ts — タグ入力のオートコンプリート（Issue #65）。
// スペース区切りテキスト入力はそのままに、既存タグの候補ポップアップを足す。
// 配置は入力欄にアンカーし、下に余白が無いとき（モバイルの仮想キーボード等）は上に自動フリップ。
import { el } from './dom';
import { parseTags } from './format';

const SEP = /[\s,]/;

// キャレット位置の「編集中トークン」の境界とテキスト（キャレットまで）。
export function activeToken(value: string, caret: number): { start: number; end: number; text: string } {
  let start = caret;
  while (start > 0 && !SEP.test(value[start - 1])) start--;
  let end = caret;
  while (end < value.length && !SEP.test(value[end])) end++;
  return { start, end, text: value.slice(start, caret) };
}

// 入力済みタグを除外し、token（大小無視・部分一致）で候補を絞る。最大 max 件。
export function filterCandidates(
  all: readonly string[],
  value: string,
  token: string,
  max = 8,
): string[] {
  const used = new Set(parseTags(value));
  const q = token.toLowerCase();
  const out: string[] = [];
  for (const t of all) {
    if (used.has(t)) continue;
    if (q !== '' && !t.toLowerCase().includes(q)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// 選択タグで編集中トークンを置換し、末尾に空白を入れて次のタグへ。
export function applySelection(
  value: string,
  caret: number,
  tag: string,
): { value: string; caret: number } {
  const { start, end } = activeToken(value, caret);
  const head = value.slice(0, start) + tag + ' ';
  const tail = value.slice(end).replace(/^[\s,]+/, ''); // 二重区切りを避ける
  return { value: head + tail, caret: head.length };
}

export interface TagSuggest {
  destroy(): void;
}

// 入力欄にオートコンプリートを付与する。input は position:relative のラッパ直下にある前提。
export function attachTagSuggest(
  input: HTMLInputElement,
  getCandidates: () => string[],
): TagSuggest {
  const wrap = input.parentElement ?? input;
  const listId = `tag-suggest-${Math.random().toString(36).slice(2, 8)}`;
  const list = el('ul', {
    class: 'tag-suggest-list',
    attrs: { role: 'listbox', id: listId },
  });
  list.hidden = true;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  input.setAttribute('autocomplete', 'off');
  wrap.append(list);

  let open = false;
  let items: string[] = [];
  let active = -1;

  function show(): void {
    open = true;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function close(): void {
    open = false;
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function setActive(i: number): void {
    active = i;
    const children = Array.from(list.children);
    children.forEach((li, idx) => li.classList.toggle('is-active', idx === active));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `${listId}-${active}`);
      children[active]?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function choose(i: number): void {
    const tag = items[i];
    if (tag == null) return;
    const caret = input.selectionStart ?? input.value.length;
    const res = applySelection(input.value, caret, tag);
    input.value = res.value;
    input.setSelectionRange(res.caret, res.caret);
    input.focus();
    render(); // 選択後は候補を更新（選んだタグを除外）。
  }

  function position(): void {
    const rect = input.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const spaceBelow = vh - rect.bottom;
    const needed = Math.min(list.scrollHeight || 200, 240);
    // 下が足りず、上の方が広いときだけ上に反転。
    list.classList.toggle('is-above', spaceBelow < needed && rect.top > spaceBelow);
  }

  function render(): void {
    const caret = input.selectionStart ?? input.value.length;
    const tok = activeToken(input.value, caret);
    items = filterCandidates(getCandidates(), input.value, tok.text);
    list.replaceChildren();
    if (items.length === 0) {
      close();
      return;
    }
    items.forEach((tag, i) => {
      const li = el('li', {
        class: 'tag-suggest-option',
        text: tag,
        attrs: { role: 'option', id: `${listId}-${i}` },
      });
      // pointerdown（click より前）で選択し、入力欄の blur 前に確定させる。
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        choose(i);
      });
      li.addEventListener('mousemove', () => setActive(i));
      list.append(li);
    });
    setActive(-1);
    show();
    position();
  }

  function onInput(): void {
    render();
  }
  function onFocus(): void {
    render();
  }
  function onKeydown(e: KeyboardEvent): void {
    if (!open) {
      if (e.key === 'ArrowDown') render();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(active + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === 'Enter') {
      if (active >= 0) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
  function onBlur(): void {
    // オプションの pointerdown を取りこぼさないよう次フレームで閉じる。
    setTimeout(close, 0);
  }
  function onDocPointerDown(e: PointerEvent): void {
    if (!wrap.contains(e.target as Node)) close();
  }
  const reposition = (): void => {
    if (open) position();
  };

  input.addEventListener('input', onInput);
  input.addEventListener('focus', onFocus);
  input.addEventListener('keydown', onKeydown);
  input.addEventListener('blur', onBlur);
  document.addEventListener('pointerdown', onDocPointerDown);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  window.visualViewport?.addEventListener('resize', reposition);

  return {
    destroy(): void {
      input.removeEventListener('input', onInput);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('keydown', onKeydown);
      input.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerdown', onDocPointerDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      list.remove();
    },
  };
}
