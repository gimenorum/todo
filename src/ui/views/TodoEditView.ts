import type { Priority, State, Uuid } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { el, qs } from '../dom';
import { findTodo } from '../../state/selectors';
import { PRIORITIES, PRIORITY_LABEL } from '../../model/constants';
import { fromDateInputValue, parseTags, toDateInputValue } from '../format';

// 個別編集（全フィールド）。Phase 0 は単独編集のため、編集中の再描画はしない（入力保持）。
export function createTodoEditView(ctx: UiContext, id: Uuid): ViewController {
  const root = el('section', { class: 'todo-edit-view' });

  const header = el('div', { class: 'view-header' });
  header.append(
    el('a', { class: 'btn btn-secondary', text: '← 戻る', attrs: { href: '#/tasks' } }),
    el('h2', { class: 'view-title', text: 'タスクを編集' }),
  );
  root.append(header);

  const current = findTodo(ctx.store.getState(), id);
  if (!current) {
    root.append(el('p', { class: 'empty', text: 'タスクが見つかりません。' }));
    return { el: root, update() {} };
  }

  const form = el('form', { class: 'todo-form' });

  const doneField = el('label', { class: 'field field-inline' });
  const done = el('input', { class: 'f-done', attrs: { type: 'checkbox' } });
  done.checked = current.done;
  doneField.append(done, el('span', { text: '完了にする' }));

  const titleField = el('div', { class: 'field' });
  const title = el('input', { class: 'f-title', attrs: { type: 'text' } });
  title.value = current.title;
  titleField.append(el('label', { text: 'タイトル' }), title);

  const dueField = el('div', { class: 'field' });
  const due = el('input', { class: 'f-due', attrs: { type: 'date' } });
  due.value = toDateInputValue(current.dueDate);
  dueField.append(el('label', { text: '期日' }), due);

  const prField = el('div', { class: 'field' });
  const priority = el('select', { class: 'f-priority' });
  for (const p of PRIORITIES) {
    const opt = el('option', { text: PRIORITY_LABEL[p], attrs: { value: p } });
    if (p === current.priority) opt.selected = true;
    priority.append(opt);
  }
  prField.append(el('label', { text: '優先度' }), priority);

  const tagField = el('div', { class: 'field' });
  const tags = el('input', {
    class: 'f-tags',
    attrs: { type: 'text', placeholder: 'タグ（スペース区切り）' },
  });
  tags.value = current.tags.join(' ');
  tagField.append(el('label', { text: 'タグ' }), tags);

  const notesField = el('div', { class: 'field' });
  const notes = el('textarea', { class: 'f-notes', attrs: { rows: '4' } });
  notes.value = current.notes;
  notesField.append(el('label', { text: 'メモ' }), notes);

  const formActions = el('div', { class: 'form-actions' });
  const del = el('button', { class: 'btn btn-danger', text: '削除', attrs: { type: 'button' } });
  const save = el('button', { class: 'btn', text: '保存', attrs: { type: 'submit' } });
  del.addEventListener('click', () => {
    void ctx.actions.deleteTodo(id).then(() => ctx.navigate({ name: 'tasks' }));
  });
  formActions.append(del, save);

  form.append(doneField, titleField, dueField, prField, tagField, notesField, formActions);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void ctx.actions
      .editTodo(id, {
        title: title.value.trim(),
        done: done.checked,
        dueDate: fromDateInputValue(due.value),
        priority: priority.value as Priority,
        notes: notes.value,
        tags: parseTags(tags.value),
      })
      .then(() => ctx.navigate({ name: 'tasks' }));
  });

  root.append(form);

  // 入力欄にフォーカスを当て、すぐ編集できるように。
  queueMicrotask(() => qs<HTMLInputElement>(form, '.f-title').focus());

  return {
    el: root,
    update(_state: State) {
      // Phase 0 は再描画しない（フォーム編集中の入力を保持）。
    },
  };
}
