import type { State, Todo } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { cloneTemplate, el, qs, renderKeyedList, setTextIfChanged } from '../dom';
import { formatDate } from '../format';
import { showsSyncUi, visibleTodos } from '../../state/selectors';
import { PRIORITY_LABEL } from '../../model/constants';

// TODO 一覧（主画面）。id キー差分更新でフォーカス/スクロールを維持（ch.07・08）。
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

  const empty = el('p', {
    class: 'empty',
    text: 'タスクはありません。上の入力欄から追加できます。',
  });
  const list = el('ul', { class: 'todo-list' });
  root.append(form, empty, list);

  const nodeMap = new Map<string, HTMLElement>();
  let currentState: State | null = null;

  function createItem(todo: Todo): HTMLElement {
    const node = cloneTemplate('tmpl-todo-item');
    node.dataset.id = todo.id;
    const done = qs<HTMLInputElement>(node, '.todo-done');
    done.addEventListener('change', () => void ctx.actions.toggleDone(todo.id, done.checked));
    const open = qs<HTMLButtonElement>(node, '.todo-open');
    open.addEventListener('click', () => ctx.navigate({ name: 'todo', id: todo.id }));
    const resolve = qs<HTMLButtonElement>(node, '.todo-resolve');
    resolve.addEventListener('click', () => ctx.navigate({ name: 'merge', id: todo.id }));
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

  return {
    el: root,
    update(state: State) {
      currentState = state;
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
}
