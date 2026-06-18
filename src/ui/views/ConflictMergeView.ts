import type { FieldConflict, State, TodoField, Uuid } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { el } from '../dom';
import { findTodo } from '../../state/selectors';
import { formatDate } from '../format';
import { PRIORITY_LABEL } from '../../model/constants';

// 暫定競合解決（ch.10 §10.4 / Phase 2）。フィールド単位の選択・差分表示・プレビューは Phase 4。
// per-todo で二択（通常: こちら/もう一方、deleted: 編集版を残す/削除を適用）。

const FIELD_LABEL: Record<TodoField, string> = {
  title: 'タイトル',
  done: '完了',
  dueDate: '期日',
  priority: '優先度',
  notes: 'メモ',
  tags: 'タグ',
  deleted: '削除',
};

function showValue(field: TodoField, value: unknown): string {
  if (field === 'done') return value ? '完了' : '未完了';
  if (field === 'deleted') return value ? '削除' : '有効';
  if (field === 'dueDate') return value === null || value === undefined ? '(なし)' : formatDate(value as number);
  if (field === 'priority') return PRIORITY_LABEL[value as keyof typeof PRIORITY_LABEL] ?? String(value);
  const s = value === null || value === undefined ? '' : String(value);
  return s === '' ? '(空)' : s;
}

export function createConflictMergeView(ctx: UiContext, id: Uuid): ViewController {
  const root = el('section', { class: 'merge-view' });

  function resolve(choice: 'left' | 'right' | 'keep-edit' | 'apply-delete'): void {
    void ctx.actions.resolveConflict(id, choice).then(() => ctx.navigate({ name: 'tasks' }));
  }

  function render(state: State): void {
    root.replaceChildren();

    const header = el('div', { class: 'view-header' });
    header.append(
      el('a', { class: 'btn btn-secondary', text: '← 戻る', attrs: { href: '#/tasks' } }),
      el('h2', { class: 'view-title', text: '同期の不具合を解決' }),
    );
    root.append(header);

    const conflicts: FieldConflict[] = state.conflicts.filter((c) => c.todoId === id);
    if (conflicts.length === 0) {
      root.append(el('p', { class: 'empty', text: 'この項目の未解決の競合はありません。' }));
      return;
    }

    const todo = findTodo(state, id);
    root.append(
      el('p', { class: 'muted', text: `「${todo?.title || '(無題)'}」で変更が衝突しました。どちらを採用しますか？` }),
    );

    const list = el('ul', { class: 'merge-fields' });
    for (const c of conflicts) {
      const li = el('li', { class: 'merge-field' });
      li.append(el('span', { class: 'merge-field-name', text: FIELD_LABEL[c.field] }));
      li.append(el('span', { class: 'merge-val merge-left', text: `こちら: ${showValue(c.field, c.left)}` }));
      li.append(el('span', { class: 'merge-val merge-right', text: `もう一方: ${showValue(c.field, c.right)}` }));
      list.append(li);
    }
    root.append(list);

    const actions = el('div', { class: 'form-actions' });
    if (conflicts.some((c) => c.field === 'deleted')) {
      const keep = el('button', { class: 'btn', text: '編集版を残す', attrs: { type: 'button' } });
      const del = el('button', { class: 'btn btn-danger', text: '削除を適用', attrs: { type: 'button' } });
      keep.addEventListener('click', () => resolve('keep-edit'));
      del.addEventListener('click', () => resolve('apply-delete'));
      actions.append(keep, del);
    } else {
      const left = el('button', { class: 'btn', text: 'こちらを採用', attrs: { type: 'button' } });
      const right = el('button', { class: 'btn btn-secondary', text: 'もう一方を採用', attrs: { type: 'button' } });
      left.addEventListener('click', () => resolve('left'));
      right.addEventListener('click', () => resolve('right'));
      actions.append(left, right);
    }
    root.append(actions);
  }

  return {
    el: root,
    update(state: State) {
      render(state);
    },
  };
}
