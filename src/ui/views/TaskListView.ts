import type { State, Todo } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { cloneTemplate, el, qs, renderKeyedList, setTextIfChanged } from '../dom';
import { formatDate } from '../format';
import { showsSyncUi, visibleTodos } from '../../state/selectors';
import { PRIORITY_LABEL } from '../../model/constants';

// TODO 一覧（主画面）。id キー差分更新でフォーカス/スクロールを維持（ch.07・08）。
// 手動並べ替え（Phase 6）: 「並び: 自動/手動」トグルと、手動時のドラッグ（Pointer Events）。
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

  // 並びモードのトグル（自動 ⇄ 手動）。
  const toolbar = el('div', { class: 'list-toolbar' });
  const sortToggle = el('button', { class: 'sort-toggle', attrs: { type: 'button' } });
  sortToggle.addEventListener('click', () => {
    const cur = currentState?.settings.sortMode ?? 'auto';
    void ctx.actions.setSortMode(cur === 'manual' ? 'auto' : 'manual');
  });
  toolbar.append(sortToggle);

  const empty = el('p', {
    class: 'empty',
    text: 'タスクはありません。上の入力欄から追加できます。',
  });
  const list = el('ul', { class: 'todo-list' });
  root.append(form, toolbar, empty, list);

  const nodeMap = new Map<string, HTMLElement>();
  let currentState: State | null = null;

  // ---- ドラッグ状態（Pointer Events） ----
  let dragging = false;
  let dragEl: HTMLElement | null = null;
  let dragId: string | null = null;

  function onMove(e: PointerEvent): void {
    if (!dragEl) return;
    const y = e.clientY;
    const items = Array.from(list.querySelectorAll<HTMLElement>('.todo-item'));
    // 同じ完了状態のグループ内だけで並べ替える（完了は下に保つ）。
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

  function onUp(e: PointerEvent): void {
    const handle = e.currentTarget as HTMLElement;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* 既に解放済みなら無視 */
    }
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    const el2 = dragEl;
    const id = dragId;
    dragEl = null;
    dragId = null;
    dragging = false;
    if (!el2 || !id) return;
    el2.classList.remove('dragging');
    // 確定位置の前後（同グループのみ）から order を決める。
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
      if (currentState) view.update(currentState); // ドラッグ中に保留した再描画を反映。
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
      if (currentState?.settings.sortMode !== 'manual') return; // 手動モード時のみ。
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      dragEl = node;
      dragId = todo.id;
      node.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
    return node;
  }

  function updateItem(node: HTMLElement, todo: Todo): void {
    node.classList.toggle('done', todo.done);
    const done = qs<HTMLInputElement>(node, '.todo-done');
    if (done.checked !== todo.done) done.checked = todo.done;
    setTextIfChanged(qs(node, '.todo-title'), todo.title || '(無題)');
    setTextIfChanged(qs(node, '.todo-due'), todo.dueDate !== null ? formatDate(todo.dueDate) : '');
    const pr = qs(node, '.todo-priority');
    setTextIfChanged(pr, todo.priority !== 'none' ? PRIORITY_LABEL[todo.priority] : '');
    pr.className = `todo-priority pri-${todo.priority}`;
    setTextIfChanged(
      qs(node, '.todo-tags'),
      todo.tags.length ? todo.tags.map((t) => `#${t}`).join(' ') : '',
    );

    // per-todo 同期ステータス（連携済みのみ / ch.09 §9.3）。
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

  const view: ViewController = {
    el: root,
    update(state: State) {
      currentState = state;
      const manual = state.settings.sortMode === 'manual';
      sortToggle.textContent = `並び: ${manual ? '手動' : '自動'}`;
      sortToggle.setAttribute('aria-pressed', String(manual));
      list.classList.toggle('manual', manual);
      if (dragging) return; // ドラッグ中は DOM を触らない（drop 後に反映）。
      const todos = visibleTodos(state);
      empty.hidden = todos.length > 0;
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
