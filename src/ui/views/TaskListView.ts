import type { ListFilter, SortBy, State, Todo } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { cloneTemplate, el, qs, renderKeyedList, setTextIfChanged } from '../dom';
import { formatDateTime } from '../format';
import { activeFilterCount, distinctTags, showsSyncUi, visibleTodos } from '../../state/selectors';
import { PRIORITY_LABEL } from '../../model/constants';

const SORT_OPTIONS: ReadonlyArray<[SortBy, string]> = [
  ['due', '期限'],
  ['priority', '優先度'],
  ['title', 'タイトル'],
  ['category', 'タグ'],
  ['manual', '手動'],
];
const DUE_OPTIONS: ReadonlyArray<[ListFilter['due'], string]> = [
  ['all', 'すべて'],
  ['overdue', '期限切れ'],
  ['today', '今日'],
  ['week', '今週'],
  ['none', '期限なし'],
];
const PRIORITY_OPTIONS: ReadonlyArray<[ListFilter['priority'], string]> = [
  ['all', 'すべて'],
  ['high', '高'],
  ['med', '中'],
  ['low', '低'],
  ['none', 'なし'],
];

function buildSelect(cls: string, options: ReadonlyArray<[string, string]>): HTMLSelectElement {
  const sel = el('select', { class: cls });
  for (const [value, label] of options) {
    const opt = el('option', { text: label, attrs: { value } });
    sel.append(opt);
  }
  return sel;
}

// TODO 一覧（主画面）。id キー差分更新でフォーカス/スクロールを維持（ch.07・08）。
// 並び替え（5 択）＋絞り込み（4 軸 / Phase 6）、手動時のみ Pointer Events ドラッグ。
export function createTaskListView(ctx: UiContext): ViewController {
  const root = el('section', { class: 'task-list-view' });

  // 追加フォーム
  const form = el('form', { class: 'add-todo' });
  const input = el('input', {
    class: 'add-todo-input',
    attrs: {
      type: 'text',
      placeholder: '新しいタスク…',
      'aria-label': '新しいタスク',
      autocomplete: 'off',
    },
  });
  const submit = el('button', { class: 'add-todo-submit', text: '追加', attrs: { type: 'submit' } });
  form.append(input, submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    void ctx.actions.addTodo({ title }).then(() => {
      input.value = '';
      input.focus();
    });
  });

  // ツールバー: 並び替え select ＋「絞り込み」トグル（有効件数バッジ）。
  const toolbar = el('div', { class: 'list-toolbar' });
  const sortWrap = el('label', { class: 'sort-field' });
  sortWrap.append(el('span', { class: 'field-label', text: '並び' }));
  const sortSelect = buildSelect('sort-select', SORT_OPTIONS);
  sortWrap.append(sortSelect);
  sortSelect.addEventListener('change', () => void ctx.actions.setSortBy(sortSelect.value as SortBy));
  const filterToggle = el('button', {
    class: 'filter-toggle',
    attrs: { type: 'button', 'aria-expanded': 'false' },
  });
  const filterToggleLabel = el('span', { text: '絞り込み' });
  const filterBadge = el('span', { class: 'filter-badge', attrs: { hidden: 'hidden' } });
  filterToggle.append(filterToggleLabel, filterBadge);
  toolbar.append(sortWrap, filterToggle);

  // 絞り込みパネル（折りたたみ）。
  const panel = el('div', { class: 'filter-panel', attrs: { hidden: 'hidden' } });
  const search = el('input', {
    class: 'filter-search',
    attrs: { type: 'search', placeholder: 'タイトルで検索…', 'aria-label': 'タイトルで検索' },
  });
  const catWrap = el('label', { class: 'filter-field' });
  catWrap.append(el('span', { class: 'field-label', text: 'タグ' }));
  const catSelect = el('select', { class: 'filter-category' });
  catWrap.append(catSelect);
  const priWrap = el('label', { class: 'filter-field' });
  priWrap.append(el('span', { class: 'field-label', text: '優先度' }));
  const priSelect = buildSelect('filter-priority', PRIORITY_OPTIONS);
  priWrap.append(priSelect);
  const dueWrap = el('label', { class: 'filter-field' });
  dueWrap.append(el('span', { class: 'field-label', text: '期限' }));
  const dueSelect = buildSelect('filter-due', DUE_OPTIONS);
  dueWrap.append(dueSelect);
  const clearBtn = el('button', { class: 'filter-clear', text: 'クリア', attrs: { type: 'button' } });
  const fields = el('div', { class: 'filter-fields' });
  fields.append(catWrap, priWrap, dueWrap, clearBtn);
  panel.append(search, fields);

  // 絞り込み中インジケータ（有効時に常時表示）。
  const activeBar = el('div', { class: 'filter-active', attrs: { hidden: 'hidden' } });
  const activeText = el('span', { class: 'filter-active-text' });
  const activeClear = el('button', {
    class: 'filter-active-clear',
    text: 'クリア',
    attrs: { type: 'button' },
  });
  activeBar.append(activeText, activeClear);

  let filterOpen = false;
  let openInitialized = false;
  filterToggle.addEventListener('click', () => {
    filterOpen = !filterOpen;
    syncPanel();
  });
  function syncPanel(): void {
    panel.hidden = !filterOpen;
    filterToggle.setAttribute('aria-expanded', String(filterOpen));
  }
  search.addEventListener('input', () => void ctx.actions.setFilter({ title: search.value }));
  catSelect.addEventListener('change', () =>
    void ctx.actions.setFilter({ tag: catSelect.value === '' ? null : catSelect.value }),
  );
  priSelect.addEventListener('change', () =>
    void ctx.actions.setFilter({ priority: priSelect.value as ListFilter['priority'] }),
  );
  dueSelect.addEventListener('change', () =>
    void ctx.actions.setFilter({ due: dueSelect.value as ListFilter['due'] }),
  );
  clearBtn.addEventListener('click', () => void ctx.actions.clearFilter());
  activeClear.addEventListener('click', () => void ctx.actions.clearFilter());

  const empty = el('p', {
    class: 'empty',
    text: 'タスクはありません。上の入力欄から追加できます。',
  });
  const list = el('ul', { class: 'todo-list' });
  root.append(form, toolbar, panel, activeBar, empty, list);

  const nodeMap = new Map<string, HTMLElement>();
  let currentState: State | null = null;
  let lastTagsKey = '';

  // ---- ドラッグ状態（Pointer Events） ----
  let dragging = false;
  let dragEl: HTMLElement | null = null;
  let dragId: string | null = null;
  let dragHandle: HTMLElement | null = null;
  let dragPointerId = -1;

  // ドラッグ中の move/up は window で受ける（ノードを DOM 移動するとポインタキャプチャが外れて
  // 要素ローカルだと以降の move/up を取りこぼし、先頭まで動かせなくなるため）。
  function endDrag(): void {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (dragHandle && dragPointerId !== -1) {
      try {
        dragHandle.releasePointerCapture(dragPointerId);
      } catch {
        /* 既に解放済みなら無視 */
      }
    }
    dragHandle = null;
    dragPointerId = -1;
  }

  function onMove(e: PointerEvent): void {
    if (!dragEl) return;
    // ボタン/指が離れていれば（up の取りこぼし対策）ドロップ確定する。これにより
    // 「押していないのにカーソル移動だけで並び替わる」状態を防ぐ。
    if (e.buttons === 0) {
      onUp(e);
      return;
    }
    const y = e.clientY;
    const items = Array.from(list.querySelectorAll<HTMLElement>('.todo-item'));
    const isDone = dragEl.classList.contains('done');
    const group = items.filter((n) => n !== dragEl && n.classList.contains('done') === isDone);
    let placed = false;
    for (const sib of group) {
      const rect = sib.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        list.insertBefore(dragEl, sib);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const last = group[group.length - 1];
      if (last) list.insertBefore(dragEl, last.nextElementSibling);
    }
  }

  function onUp(_e: PointerEvent): void {
    endDrag();
    const el2 = dragEl;
    const id = dragId;
    dragEl = null;
    dragId = null;
    dragging = false;
    if (!el2 || !id) return;
    el2.classList.remove('dragging');
    const isDone = el2.classList.contains('done');
    const prev = el2.previousElementSibling as HTMLElement | null;
    const next = el2.nextElementSibling as HTMLElement | null;
    const beforeId =
      prev && prev.classList.contains('todo-item') && prev.classList.contains('done') === isDone
        ? (prev.dataset.id ?? null)
        : null;
    const afterId =
      next && next.classList.contains('todo-item') && next.classList.contains('done') === isDone
        ? (next.dataset.id ?? null)
        : null;
    void ctx.actions.reorderTodo(id, beforeId, afterId).then(() => {
      if (currentState) view.update(currentState);
    });
  }

  function createItem(todo: Todo): HTMLElement {
    const node = cloneTemplate('tmpl-todo-item');
    node.dataset.id = todo.id;
    const done = qs<HTMLInputElement>(node, '.todo-done');
    done.addEventListener('change', () => void ctx.actions.toggleDone(todo.id, done.checked));
    const open = qs<HTMLButtonElement>(node, '.todo-open');
    open.addEventListener('click', () => ctx.navigate({ name: 'todo', id: todo.id }));
    const resolve = qs<HTMLButtonElement>(node, '.todo-resolve');
    resolve.addEventListener('click', () => ctx.navigate({ name: 'merge', id: todo.id }));
    const handle = qs<HTMLButtonElement>(node, '.todo-drag-handle');
    handle.addEventListener('pointerdown', (e) => {
      if (currentState?.settings.sortBy !== 'manual') return; // 手動モード時のみ。
      if (e.pointerType === 'mouse' && e.button !== 0) return; // 主ボタンのみ。
      e.preventDefault();
      if (dragging) endDrag(); // 念のため前のドラッグを後始末。
      dragging = true;
      dragEl = node;
      dragId = todo.id;
      node.classList.add('dragging');
      // タッチのスクロール奪取を防ぐためキャプチャは best-effort（move/up の正は window）。
      dragHandle = handle;
      dragPointerId = e.pointerId;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* 未対応なら無視 */
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
    return node;
  }

  function updateItem(node: HTMLElement, todo: Todo): void {
    node.classList.toggle('done', todo.done);
    const done = qs<HTMLInputElement>(node, '.todo-done');
    if (done.checked !== todo.done) done.checked = todo.done;
    setTextIfChanged(qs(node, '.todo-title'), todo.title || '(無題)');
    setTextIfChanged(qs(node, '.todo-due'), todo.dueDate !== null ? formatDateTime(todo.dueDate) : '');
    const pr = qs(node, '.todo-priority');
    setTextIfChanged(pr, todo.priority !== 'none' ? PRIORITY_LABEL[todo.priority] : '');
    pr.className = `todo-priority pri-${todo.priority}`;
    setTextIfChanged(
      qs(node, '.todo-tags'),
      todo.tags.length ? todo.tags.map((t) => `#${t}`).join(' ') : '',
    );

    const linked = currentState ? showsSyncUi(currentState) : false;
    const st = currentState ? currentState.perTodoStatus[todo.id] : undefined;
    const badge = qs(node, '.todo-sync-badge');
    const resolve = qs<HTMLButtonElement>(node, '.todo-resolve');
    if (linked && st) {
      badge.hidden = false;
      badge.className = `todo-sync-badge sync-${st}`;
      setTextIfChanged(badge, st === 'conflict' ? '要解決' : st === 'unpushed' ? '未同期' : '同期済');
      resolve.hidden = st !== 'conflict';
    } else {
      badge.hidden = true;
      resolve.hidden = true;
    }
  }

  // カテゴリ select の選択肢を一覧のタグから組み直す（変化時のみ）。
  function syncCategoryOptions(tags: string[], selected: string | null): void {
    const key = tags.join('');
    if (key !== lastTagsKey) {
      lastTagsKey = key;
      catSelect.replaceChildren();
      catSelect.append(el('option', { text: 'すべて', attrs: { value: '' } }));
      for (const t of tags) catSelect.append(el('option', { text: t, attrs: { value: t } }));
    }
    const want = selected ?? '';
    if (catSelect.value !== want) catSelect.value = want;
  }

  const view: ViewController = {
    el: root,
    update(state: State) {
      currentState = state;
      const { sortBy, filter } = state.settings;

      // 並び替え・各フィルタの現在値を反映（入力中のキャレットを壊さないよう差分のみ）。
      if (sortSelect.value !== sortBy) sortSelect.value = sortBy;
      if (priSelect.value !== filter.priority) priSelect.value = filter.priority;
      if (dueSelect.value !== filter.due) dueSelect.value = filter.due;
      if (search.value !== filter.title) search.value = filter.title;
      syncCategoryOptions(distinctTags(state.todos), filter.tag);

      // 絞り込みバッジ・インジケータ・初期展開。
      const count = activeFilterCount(filter);
      if (count > 0) {
        filterBadge.hidden = false;
        setTextIfChanged(filterBadge, String(count));
      } else {
        filterBadge.hidden = true;
      }
      activeBar.hidden = count === 0;
      if (count > 0) setTextIfChanged(activeText, `絞り込み中（${count} 件）`);
      if (!openInitialized) {
        openInitialized = true;
        filterOpen = count > 0; // 有効な絞り込みがあれば最初から開く。
        syncPanel();
      }

      // 手動並びのときだけドラッグハンドルを出す。
      list.classList.toggle('manual', sortBy === 'manual');
      if (dragging) return; // ドラッグ中は DOM を触らない。
      const todos = visibleTodos(state);
      empty.hidden = todos.length > 0;
      setTextIfChanged(
        empty,
        count > 0
          ? '条件に一致するタスクはありません。絞り込みを変えてください。'
          : 'タスクはありません。上の入力欄から追加できます。',
      );
      renderKeyedList({
        container: list,
        items: todos,
        getKey: (t) => t.id,
        create: createItem,
        update: updateItem,
        nodeMap,
      });
    },
  };
  return view;
}
