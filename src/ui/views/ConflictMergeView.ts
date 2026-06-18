import type { FieldConflict, Priority, State, Todo, TodoField, Uuid } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { el } from '../dom';
import { findTodo } from '../../state/selectors';
import { formatDate, fromDateInputValue, parseTags, toDateInputValue } from '../format';
import { PRIORITIES, PRIORITY_LABEL } from '../../model/constants';
import { renderTextDiff } from '../components/TextDiff';

// 競合解決 UI（WinMerge ライク / ch.10 §10.2・Phase 4）。
// 左=この端末 / 右=相手 の 2 ペインをフィールド単位に並べ、選択 or 直接編集で解決する。
// 確定で「フィールド単位の解決値を持つ patch」を作り、SyncService の updateTodo→runOnce 経路で
// マージコミットへ確定する（収束は Phase 2 の実績経路を流用 / SyncService.resolveConflict）。

const FIELD_LABEL: Record<TodoField, string> = {
  title: 'タイトル',
  done: '完了',
  dueDate: '期日',
  priority: '優先度',
  notes: 'メモ',
  tags: 'タグ',
  deleted: '削除',
};

// 一致表示する内容フィールド（競合していないものを muted で並べる / §10.2）。
const AGREE_FIELDS: readonly TodoField[] = ['title', 'done', 'dueDate', 'priority', 'notes', 'tags'];

// 解決アクションに渡す patch（services の TodoPatch と構造同一。ui→services 依存を持たないため
// model/types の Todo からローカル定義する / 依存方向 ch.01）。
type MergePatch = Partial<
  Pick<Todo, 'title' | 'done' | 'dueDate' | 'priority' | 'notes' | 'tags' | 'deleted'>
>;

export type EditMode = 'left' | 'right' | 'edit';
export interface FieldChoice {
  mode: EditMode;
  editValue: string; // edit 時の入力文字列（型変換は parseFieldInput が担う）
}
export type DeletedDecision = 'keep-edit' | 'apply-delete';

function showValue(field: TodoField, value: unknown): string {
  if (field === 'done') return value ? '完了' : '未完了';
  if (field === 'deleted') return value ? '削除' : '有効';
  if (field === 'dueDate')
    return value === null || value === undefined ? '(なし)' : formatDate(value as number);
  if (field === 'priority') return PRIORITY_LABEL[value as Priority] ?? String(value);
  if (field === 'tags') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return arr.length ? arr.join(' ') : '(なし)';
  }
  const s = value === null || value === undefined ? '' : String(value);
  return s === '' ? '(空)' : s;
}

// edit 入力の初期文字列（left 値を入力欄の形式へ）。
function editSeed(field: TodoField, left: unknown): string {
  if (field === 'dueDate') return toDateInputValue((left as number | null) ?? null);
  if (field === 'tags') return Array.isArray(left) ? (left as string[]).join(' ') : '';
  if (field === 'priority') return String(left ?? 'none');
  return left === null || left === undefined ? '' : String(left);
}

// edit 入力文字列 → フィールド型の値。
export function parseFieldInput(field: TodoField, value: string): unknown {
  switch (field) {
    case 'dueDate':
      return fromDateInputValue(value);
    case 'tags':
      return parseTags(value);
    case 'priority':
      return value as Priority;
    case 'done':
      return value === 'true' || value === 'done';
    case 'deleted':
      return value === 'true';
    default:
      return value; // title / notes
  }
}

// 型安全のためフィールドごとに代入（unknown を MergePatch の各キーへ寄せる）。
function assignPatch(patch: MergePatch, field: TodoField, value: unknown): void {
  switch (field) {
    case 'title':
      patch.title = value as string;
      break;
    case 'notes':
      patch.notes = value as string;
      break;
    case 'done':
      patch.done = value as boolean;
      break;
    case 'dueDate':
      patch.dueDate = value as number | null;
      break;
    case 'priority':
      patch.priority = value as Priority;
      break;
    case 'tags':
      patch.tags = value as string[];
      break;
    case 'deleted':
      patch.deleted = value as boolean;
      break;
  }
}

// 選択状態 → 解決 patch（純関数・テスト対象）。left/right は競合の生値、edit は parseFieldInput。
export function buildPatch(
  conflicts: FieldConflict[],
  choices: Map<TodoField, FieldChoice>,
  deletedDecision: DeletedDecision | null,
): MergePatch {
  const patch: MergePatch = {};
  for (const c of conflicts) {
    if (c.field === 'deleted') continue; // deleted は二択で別処理
    const ch = choices.get(c.field);
    const value =
      !ch || ch.mode === 'left'
        ? c.left
        : ch.mode === 'right'
          ? c.right
          : parseFieldInput(c.field, ch.editValue);
    assignPatch(patch, c.field, value);
  }
  if (deletedDecision) patch.deleted = deletedDecision === 'apply-delete';
  return patch;
}

export function createConflictMergeView(ctx: UiContext, id: Uuid): ViewController {
  const root = el('section', { class: 'merge-view' });

  // 解決中フラグ: 確定〜navigate の間に runOnce 由来で conflicts が空になっても完了表示へ切り替えない。
  let resolving = false;
  let showingDone = false;

  // フォームの状態（クロージャに保持＝再描画でキャレットを失わない / §10.5）。
  const choices = new Map<TodoField, FieldChoice>();
  let deletedDecision: DeletedDecision | null = null;
  let formConflicts: FieldConflict[] = [];
  let previewEl: HTMLElement | null = null;

  function header(): HTMLElement {
    const h = el('div', { class: 'view-header' });
    h.append(
      el('a', { class: 'btn btn-secondary', text: '← 戻る', attrs: { href: '#/tasks' } }),
      el('h2', { class: 'view-title', text: '同期の不具合を解決' }),
    );
    return h;
  }

  function renderDone(): void {
    showingDone = true;
    root.replaceChildren(
      header(),
      el('p', { class: 'empty', text: 'この項目の未解決の競合はありません。' }),
    );
  }

  function inputFor(field: TodoField, left: unknown): HTMLElement {
    if (field === 'notes') {
      const t = el('textarea', { class: 'merge-input', attrs: { rows: '3' } });
      t.value = editSeed(field, left);
      return t;
    }
    if (field === 'dueDate') {
      const i = el('input', { class: 'merge-input', attrs: { type: 'date' } });
      i.value = editSeed(field, left);
      return i;
    }
    if (field === 'priority') {
      const s = el('select', { class: 'merge-input' });
      for (const p of PRIORITIES) {
        const opt = el('option', { text: PRIORITY_LABEL[p], attrs: { value: p } });
        if (p === left) opt.selected = true;
        s.append(opt);
      }
      return s;
    }
    const i = el('input', {
      class: 'merge-input',
      attrs: field === 'tags' ? { type: 'text', placeholder: 'タグ（スペース区切り）' } : { type: 'text' },
    });
    i.value = editSeed(field, left);
    return i;
  }

  function readInput(node: HTMLElement): string {
    if (
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement
    ) {
      return node.value;
    }
    return '';
  }

  function paneRadio(name: string, value: EditMode, tag: string, valueText: string): {
    label: HTMLElement;
    radio: HTMLInputElement;
  } {
    const label = el('label', { class: `merge-pane merge-${value}` });
    const radio = el('input', { attrs: { type: 'radio', name } });
    radio.value = value;
    label.append(
      radio,
      el('span', { class: 'merge-pane-tag', text: tag }),
      el('span', { class: 'merge-val', text: valueText }),
    );
    return { label, radio };
  }

  function buildFieldRow(c: FieldConflict): HTMLElement {
    const li = el('li', { class: 'merge-field merge-conflict' });
    li.append(el('span', { class: 'merge-field-name', text: FIELD_LABEL[c.field] }));

    const name = `merge-${c.field}`;
    const panes = el('div', { class: 'merge-panes' });
    const left = paneRadio(name, 'left', 'この端末', showValue(c.field, c.left));
    const right = paneRadio(name, 'right', '相手', showValue(c.field, c.right));
    left.radio.checked = true; // 既定 left＝この端末を保持（データ消失なし / §10.5）
    left.radio.addEventListener('change', () => setMode(c.field, 'left'));
    right.radio.addEventListener('change', () => setMode(c.field, 'right'));
    panes.append(left.label, right.label);
    li.append(panes);

    // メモは行単位テキスト差分を併置（§10.3）。
    if (c.field === 'notes') {
      li.append(renderTextDiff(String(c.left ?? ''), String(c.right ?? '')));
    }

    // 直接編集（done は二値で left/right が網羅するため省略）。
    if (c.field !== 'done') {
      const editLabel = el('label', { class: 'merge-pane merge-edit' });
      const editRadio = el('input', { attrs: { type: 'radio', name } });
      editRadio.value = 'edit';
      const input = inputFor(c.field, c.left);
      editLabel.append(
        editRadio,
        el('span', { class: 'merge-pane-tag', text: '編集' }),
        input,
      );
      li.append(editLabel);

      editRadio.addEventListener('change', () => setMode(c.field, 'edit'));
      const onEdit = (): void => {
        editRadio.checked = true;
        const ch = choices.get(c.field);
        if (ch) {
          ch.mode = 'edit';
          ch.editValue = readInput(input);
        }
        renderPreview();
      };
      input.addEventListener('input', onEdit);
      input.addEventListener('change', onEdit);
    }

    return li;
  }

  function buildAgreeRow(field: TodoField, todo: Todo): HTMLElement {
    const li = el('li', { class: 'merge-field merge-agree' });
    li.append(el('span', { class: 'merge-field-name', text: FIELD_LABEL[field] }));
    li.append(el('span', { class: 'merge-val muted', text: showValue(field, todo[field]) }));
    return li;
  }

  function buildDeletedChoice(): HTMLElement {
    const wrap = el('div', { class: 'merge-deleted' });
    const name = 'merge-deleted';
    const keep = el('label', { class: 'merge-pane' });
    const keepRadio = el('input', { attrs: { type: 'radio', name } });
    keepRadio.value = 'keep-edit';
    keepRadio.checked = true;
    keep.append(keepRadio, el('span', { text: '編集版を残す' }));
    const del = el('label', { class: 'merge-pane' });
    const delRadio = el('input', { attrs: { type: 'radio', name } });
    delRadio.value = 'apply-delete';
    del.append(delRadio, el('span', { text: '削除を適用' }));
    keepRadio.addEventListener('change', () => {
      deletedDecision = 'keep-edit';
      renderPreview();
    });
    delRadio.addEventListener('change', () => {
      deletedDecision = 'apply-delete';
      renderPreview();
    });
    wrap.append(keep, del);
    return wrap;
  }

  function setMode(field: TodoField, mode: EditMode): void {
    const ch = choices.get(field);
    if (ch) ch.mode = mode;
    renderPreview();
  }

  function renderPreview(): void {
    if (!previewEl) return;
    const patch = buildPatch(formConflicts, choices, deletedDecision) as Record<string, unknown>;
    const dl = el('dl', { class: 'merge-preview-list' });
    for (const c of formConflicts) {
      if (c.field === 'deleted') continue;
      dl.append(
        el('dt', { text: FIELD_LABEL[c.field] }),
        el('dd', { text: showValue(c.field, patch[c.field]) }),
      );
    }
    if (deletedDecision) {
      dl.append(
        el('dt', { text: FIELD_LABEL.deleted }),
        el('dd', { text: deletedDecision === 'apply-delete' ? '削除を適用' : '編集版を残す' }),
      );
    }
    previewEl.replaceChildren(
      el('h3', { class: 'merge-preview-title', text: 'マージ結果プレビュー' }),
      dl,
    );
  }

  function buildForm(conflicts: FieldConflict[], state: State): void {
    formConflicts = conflicts;
    choices.clear();
    deletedDecision = null;
    const todo = findTodo(state, id);
    const title = todo?.title || '(無題)';

    root.replaceChildren();
    root.append(header());

    const hasDeleted = conflicts.some((c) => c.field === 'deleted');
    if (hasDeleted) {
      root.append(
        el('p', {
          class: 'muted',
          text: `「${title}」は片方で削除、もう片方で編集されました。どちらを適用しますか？`,
        }),
      );
      deletedDecision = 'keep-edit';
      root.append(buildDeletedChoice());
    } else {
      root.append(
        el('p', {
          class: 'muted',
          text: `「${title}」で変更が衝突しました。フィールドごとに採用する値を選ぶか、直接編集してください。`,
        }),
      );
      const list = el('ul', { class: 'merge-fields' });
      const conflicting = new Set(conflicts.map((c) => c.field));
      for (const c of conflicts) {
        choices.set(c.field, { mode: 'left', editValue: editSeed(c.field, c.left) });
        list.append(buildFieldRow(c));
      }
      if (todo) {
        for (const f of AGREE_FIELDS) {
          if (!conflicting.has(f)) list.append(buildAgreeRow(f, todo));
        }
      }
      root.append(list);
    }

    previewEl = el('div', { class: 'merge-preview' });
    root.append(previewEl);
    renderPreview();

    const actions = el('div', { class: 'form-actions' });
    const confirm = el('button', { class: 'btn', text: 'マージを確定', attrs: { type: 'button' } });
    confirm.addEventListener('click', () => {
      resolving = true;
      const patch = buildPatch(formConflicts, choices, deletedDecision);
      void ctx.actions.resolveConflict(id, patch).then(() => ctx.navigate({ name: 'tasks' }));
    });
    actions.append(confirm);
    root.append(actions);
  }

  // 初期構築（TodoEditView 方式: 本体で 1 回だけ。update は原則フォームを触らない）。
  const state0 = ctx.store.getState();
  const conflicts0 = state0.conflicts.filter((c) => c.todoId === id);
  if (conflicts0.length === 0) renderDone();
  else buildForm(conflicts0, state0);

  return {
    el: root,
    update(state: State) {
      if (resolving || showingDone) return;
      // 解決中でなく、当該項目の競合が（他タブ等で）消えていれば完了表示へ。
      // 競合がある間はフォーム・入力・キャレットを温存する（再構築しない / §10.5）。
      if (!state.conflicts.some((c) => c.todoId === id)) renderDone();
    },
  };
}
