// ui/tagInput.ts — チップ式タグ入力（Issue #65）。
// 既存タグは候補ポップアップから選択、未知タグはテキスト入力＋Enter/スペース/カンマで追加。
// 各タグはチップ（× で削除）。候補ソースは呼び出し側が渡す（一覧の全タグ＝distinctTags 想定）。
import { el } from './dom';
import { parseTags } from './format';

export interface TagInput {
  el: HTMLElement;
  getTags(): string[];
  destroy(): void;
}

// 候補: 全タグから付与済みを除き、query（大小無視・部分一致）で絞る。最大 max 件。
export function filterTags(
  all: readonly string[],
  current: readonly string[],
  query: string,
  max = 8,
): string[] {
  const used = new Set(current);
  const q = query.trim().toLowerCase();
  const out: string[] = [];
  for (const t of all) {
    if (used.has(t)) continue;
    if (q !== '' && !t.toLowerCase().includes(q)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function createTagInput(initial: readonly string[], getCandidates: () => string[]): TagInput {
  const root = el('div', { class: 'tag-input' });
  const text = el('input', {
    class: 'tag-input-text',
    attrs: {
      type: 'text',
      placeholder: 'タグを追加…',
      'aria-label': 'タグを追加',
      autocomplete: 'off',
      role: 'combobox',
      'aria-expanded': 'false',
    },
  });
  const listId = `tag-input-${Math.random().toString(36).slice(2, 8)}`;
  const list = el('ul', { class: 'tag-suggest-list', attrs: { role: 'listbox', id: listId } });
  list.hidden = true;
  text.setAttribute('aria-controls', listId);
  root.append(text, list);

  let tags: string[] = [];
  for (const t of initial) if (!tags.includes(t)) tags.push(t);
  let items: string[] = [];
  let active = -1;
  let open = false;

  function renderChips(): void {
    root.querySelectorAll('.tag-chip').forEach((n) => n.remove());
    for (const tag of tags) {
      const chip = el('span', { class: 'tag-chip' });
      chip.append(el('span', { class: 'tag-chip-label', text: tag }));
      const rm = el('button', {
        class: 'tag-chip-remove',
        text: '×',
        attrs: { type: 'button', 'aria-label': `${tag} を削除` },
      });
      rm.addEventListener('click', () => {
        removeTag(tag);
        text.focus();
      });
      chip.append(rm);
      root.insertBefore(chip, text);
    }
  }

  function addTag(raw: string): void {
    for (const t of parseTags(raw)) if (!tags.includes(t)) tags.push(t);
    text.value = '';
    renderChips();
    renderSuggestions();
  }
  function removeTag(tag: string): void {
    tags = tags.filter((t) => t !== tag);
    renderChips();
    renderSuggestions();
  }

  function show(): void {
    open = true;
    list.hidden = false;
    text.setAttribute('aria-expanded', 'true');
  }
  function close(): void {
    open = false;
    list.hidden = true;
    active = -1;
    text.setAttribute('aria-expanded', 'false');
    text.removeAttribute('aria-activedescendant');
  }
  function setActive(i: number): void {
    active = i;
    const children = Array.from(list.children);
    children.forEach((li, idx) => li.classList.toggle('is-active', idx === active));
    if (active >= 0) {
      text.setAttribute('aria-activedescendant', `${listId}-${active}`);
      children[active]?.scrollIntoView({ block: 'nearest' });
    } else {
      text.removeAttribute('aria-activedescendant');
    }
  }
  function position(): void {
    const rect = text.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const spaceBelow = vh - rect.bottom;
    const needed = Math.min(list.scrollHeight || 200, 240);
    list.classList.toggle('is-above', spaceBelow < needed && rect.top > spaceBelow);
  }
  function renderSuggestions(): void {
    items = filterTags(getCandidates(), tags, text.value);
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
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        addTag(tag);
        text.focus();
      });
      li.addEventListener('mousemove', () => setActive(i));
      list.append(li);
    });
    setActive(-1);
    show();
    position();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ',') {
      // タグ確定（候補ハイライト中はそれ、無ければ入力中テキスト）。フォーム送信はさせない。
      if (open && active >= 0) {
        e.preventDefault();
        addTag(items[active]);
      } else if (text.value.trim() !== '') {
        e.preventDefault();
        addTag(text.value);
      } else if (e.key === ',') {
        e.preventDefault();
      }
    } else if (e.key === ' ') {
      if (text.value.trim() !== '') {
        e.preventDefault();
        addTag(text.value);
      }
    } else if (e.key === 'Backspace') {
      if (text.value === '' && tags.length > 0) {
        e.preventDefault();
        removeTag(tags[tags.length - 1]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) renderSuggestions();
      else setActive(Math.min(active + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      if (open) {
        e.preventDefault();
        setActive(Math.max(active - 1, 0));
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        close();
      }
    }
  }
  function onInput(): void {
    renderSuggestions();
  }
  function onFocus(): void {
    renderSuggestions();
  }
  function onBlur(): void {
    // 候補タップ時に一瞬 blur しても、フォーカスがコンポーネント内に戻っていれば閉じない
    // （選択直後に残りの候補を出し続けるため。iOS で候補が消える問題の対策）。
    setTimeout(() => {
      const a = document.activeElement;
      if (a !== text && !root.contains(a)) close();
    }, 0);
  }
  function onRootClick(e: MouseEvent): void {
    if (e.target === root) text.focus();
  }
  function onDocPointerDown(e: PointerEvent): void {
    if (!root.contains(e.target as Node)) close();
  }
  const reposition = (): void => {
    if (open) position();
  };

  text.addEventListener('keydown', onKeydown);
  text.addEventListener('input', onInput);
  text.addEventListener('focus', onFocus);
  text.addEventListener('blur', onBlur);
  root.addEventListener('click', onRootClick);
  document.addEventListener('pointerdown', onDocPointerDown);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  window.visualViewport?.addEventListener('resize', reposition);

  renderChips();

  return {
    el: root,
    getTags: () => [...tags],
    destroy(): void {
      text.removeEventListener('keydown', onKeydown);
      text.removeEventListener('input', onInput);
      text.removeEventListener('focus', onFocus);
      text.removeEventListener('blur', onBlur);
      root.removeEventListener('click', onRootClick);
      document.removeEventListener('pointerdown', onDocPointerDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
    },
  };
}
