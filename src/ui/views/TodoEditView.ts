import type { Priority, State, Uuid } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { el, qs } from '../dom';
import { distinctTags, findTodo, perTodoStatusOf, showsSyncUi } from '../../state/selectors';
import { NOTIFY_OPTIONS, PRIORITIES, PRIORITY_LABEL } from '../../model/constants';
import { fromDateTimeInputValues, toDateInputValue, toTimeInputValue } from '../format';
import { getPermission, notificationsSupported, requestNotificationPermission } from '../../services/notify';
import { createTagInput } from '../tagInput';

// 個別編集（全フィールド）。Phase 0 は単独編集のため、編集中の再描画はしない（入力保持）。
export function createTodoEditView(ctx: UiContext, id: Uuid): ViewController {
  const root = el('section', { class: 'todo-edit-view' });

  const header = el('div', { class: 'view-header' });
  header.append(
    el('a', { class: 'btn btn-secondary', text: '← 戻る', attrs: { href: '#/tasks' } }),
    el('h2', { class: 'view-title', text: 'タスクを編集' }),
  );
  root.append(header);

  // 競合（要解決）のあるタスクは、気づかず編集して（Git 的に）ツリーが伸びる懸念があるため、
  // 編集画面でも「同期エラー」を明示し解決画面へ誘導する（Issue #45）。編集自体はブロックしない。
  const conflictNote = el('div', {
    class: 'edit-conflict-note',
    attrs: { role: 'alert', hidden: '' },
  });
  const resolveBtn = el('button', {
    class: 'btn btn-danger',
    text: '同期エラーを解決',
    attrs: { type: 'button' },
  });
  resolveBtn.addEventListener('click', () => ctx.navigate({ name: 'merge', id }));
  conflictNote.append(
    el('span', { text: 'このタスクは同期エラーがあります。編集前に解決してください。' }),
    resolveBtn,
  );
  root.append(conflictNote);

  // 表示判定は一覧（TaskListView）の per-todo 同期ステータスと同条件。
  const refreshConflict = (s: State): void => {
    conflictNote.hidden = !(showsSyncUi(s) && perTodoStatusOf(s, id) === 'conflict');
  };
  refreshConflict(ctx.store.getState());

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

  // 期日は日付＋時刻（時刻は任意）。時刻を空にすると日付のみ扱い（従来互換 / Issue #71）。
  const dueField = el('div', { class: 'field' });
  const due = el('input', { class: 'f-due', attrs: { type: 'date' } });
  due.value = toDateInputValue(current.dueDate);
  const dueTime = el('input', { class: 'f-due-time', attrs: { type: 'time' } });
  dueTime.value = toTimeInputValue(current.dueDate);
  const dueRow = el('div', { class: 'due-datetime' });
  dueRow.append(due, dueTime);
  dueField.append(el('label', { text: '期日' }), dueRow);

  const prField = el('div', { class: 'field' });
  const priority = el('select', { class: 'f-priority' });
  for (const p of PRIORITIES) {
    const opt = el('option', { text: PRIORITY_LABEL[p], attrs: { value: p } });
    if (p === current.priority) opt.selected = true;
    priority.append(opt);
  }
  prField.append(el('label', { text: '優先度' }), priority);

  // 期日・優先度は 1 行に横並び（2 カラム）でそろえる（Issue #48）。
  const dueprRow = el('div', { class: 'field-row' });
  dueprRow.append(dueField, prField);

  // 通知タイミング（期日の何分/時間/日前に通知するか / Issue #71）。
  const notifyField = el('div', { class: 'field' });
  const notify = el('select', { class: 'f-notify' });
  for (const [ms, label] of NOTIFY_OPTIONS) {
    const value = ms === null ? '' : String(ms);
    const opt = el('option', { text: label, attrs: { value } });
    if (ms === current.notifyBeforeMs) opt.selected = true;
    notify.append(opt);
  }
  // 通知の制約（アプリ稼働中のみ）と権限状態に応じた導線を表示する。
  const notifyHelp = el('div', { class: 'field-help' });
  const renderNotifyHelp = (): void => {
    notifyHelp.replaceChildren();
    if (!notificationsSupported()) {
      notify.disabled = true;
      notifyHelp.append(el('p', { text: 'お使いの環境では通知を利用できません。' }));
      return;
    }
    notify.disabled = false;
    notifyHelp.append(
      el('p', {
        text: '通知はアプリを開いている間のみ届きます。アプリを完全に終了している間は通知されません。',
      }),
    );
    const perm = getPermission();
    if (perm === 'default') {
      const enable = el('button', {
        class: 'btn btn-secondary btn-sm',
        text: '通知を有効にする',
        attrs: { type: 'button' },
      });
      enable.addEventListener('click', () => void requestNotificationPermission().then(renderNotifyHelp));
      notifyHelp.append(enable);
    } else if (perm === 'denied') {
      notifyHelp.append(
        el('p', {
          class: 'field-help-warn',
          text: '通知がブロックされています。ブラウザ/OS のこのサイトの設定から通知を「許可」に変更してください（アプリからは再許可できません）。',
        }),
      );
    }
  };
  renderNotifyHelp();
  notifyField.append(el('label', { text: '通知' }), notify, notifyHelp);

  // 設定（権限）変更が即反映されるよう、フォーカス/前面復帰で再評価する。
  const onFocus = (): void => renderNotifyHelp();
  const onVisible = (): void => {
    if (!document.hidden) renderNotifyHelp();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);

  // チップ式タグ入力（既存タグは候補から、未知タグは入力で追加 / Issue #65）。
  const tagField = el('div', { class: 'field' });
  const tagInput = createTagInput(current.tags, () => distinctTags(ctx.store.getState().todos));
  tagField.append(el('label', { text: 'タグ' }), tagInput.el);

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

  form.append(doneField, titleField, dueprRow, notifyField, tagField, notesField, formActions);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const notifyBeforeMs = notify.value === '' ? null : Number(notify.value);
    // 通知を有効にして保存したのに未許可なら、ユーザー操作内で許可を要求する。
    if (notifyBeforeMs !== null && getPermission() === 'default') {
      void requestNotificationPermission();
    }
    void ctx.actions
      .editTodo(id, {
        title: title.value.trim(),
        done: done.checked,
        dueDate: fromDateTimeInputValues(due.value, dueTime.value),
        notifyBeforeMs,
        priority: priority.value as Priority,
        notes: notes.value,
        tags: tagInput.getTags(),
      })
      .then(() => ctx.navigate({ name: 'tasks' }));
  });

  root.append(form);

  // 入力欄にフォーカスを当て、すぐ編集できるように。
  queueMicrotask(() => qs<HTMLInputElement>(form, '.f-title').focus());

  return {
    el: root,
    update(state: State) {
      // フォームは再描画しない（編集中の入力を保持）が、競合バナーの表示/非表示のみ反映する。
      refreshConflict(state);
    },
    destroy() {
      tagInput.destroy(); // タグ入力の window/document リスナを後始末。
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
