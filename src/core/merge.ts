// core/merge.ts — フィールド単位 3-way マージ・競合検出（ch.04 §4.5・中核中の中核）
//
// base = LCA のスナップショット、left/right = 各先端のスナップショット。
// TODO ごと × フィールドごとに判定する。
//   - スカラ: 片側だけ変化→自動採用 / 両側別値→競合（暫定 left 保持）。
//   - tags: 集合 3-way（mergeSet）で常に自動マージ（競合に出さない）。
//   - deleted: 両側が異なる（edit vs delete）なら **競合**として扱う（自動解決しない）。
import type { FieldConflict, Snapshot, Todo, TodoField, Uuid } from '../model/types';

// 3-way マージ対象フィールド（createdAt/order/updatedAt/version は対象外）。
const TODO_FIELDS: readonly TodoField[] = [
  'title',
  'done',
  'dueDate',
  'priority',
  'notes',
  'tags',
  'deleted',
];

const SET_FIELDS: ReadonlySet<TodoField> = new Set<TodoField>(['tags']);

// 値等価。配列は要素集合で比較（tags 用）、それ以外は厳密等価。
export function valueEq(x: unknown, y: unknown): boolean {
  if (Array.isArray(x) && Array.isArray(y)) {
    const sx = new Set(x);
    const sy = new Set(y);
    if (sx.size !== sy.size) return false;
    for (const v of sx) if (!sy.has(v)) return false;
    return true;
  }
  return x === y;
}

export interface FieldMergeResult {
  value: unknown;
  conflict: FieldConflict | null;
}

// スカラフィールドの 3-way。片側だけ変化なら自動採用、両側別値なら競合（暫定 left）。
export function mergeField(
  b: unknown,
  l: unknown,
  r: unknown,
  field: TodoField,
  todoId: Uuid,
): FieldMergeResult {
  if (valueEq(l, r)) return { value: l, conflict: null }; // 両側同値（不変含む）
  if (valueEq(l, b)) return { value: r, conflict: null }; // right だけ変化
  if (valueEq(r, b)) return { value: l, conflict: null }; // left だけ変化
  return { value: l, conflict: { todoId, field, base: b, left: l, right: r } };
}

// 集合 3-way（tags）。base からの追加は和、削除は反映。競合は生まない。
export function mergeSet(
  b: readonly string[] | undefined,
  l: readonly string[],
  r: readonly string[],
): string[] {
  const B = new Set(b ?? []);
  const L = new Set(l);
  const R = new Set(r);
  const out = new Set<string>(B);
  for (const v of L) if (!B.has(v)) out.add(v); // left の追加
  for (const v of R) if (!B.has(v)) out.add(v); // right の追加
  for (const v of B) if (!L.has(v) || !R.has(v)) out.delete(v); // どちらかの削除を反映
  return Array.from(out).sort();
}

export interface TodoMergeResult {
  todo: Todo | null; // null = どちらの先端にも存在しない（マージ結果から除外）
  conflicts: FieldConflict[];
}

// TODO 単位の 3-way。存在の組み合わせ（add/edit/delete）を処理する。
export function mergeTodo(
  b: Todo | undefined,
  l: Todo | undefined,
  r: Todo | undefined,
): TodoMergeResult {
  // 片側のみ存在 → その側を採用（純粋追加 / 別項目は自動両立）。
  if (l && !r) return { todo: l, conflicts: [] };
  if (!l && r) return { todo: r, conflicts: [] };
  if (!l || !r) return { todo: null, conflicts: [] }; // 両側に無い（base のみ）

  const id = l.id;
  const conflicts: FieldConflict[] = [];
  // メタ・対象外フィールドは先に確定（competing しない）。
  const out: Todo = {
    ...l,
    id,
    createdAt: b?.createdAt ?? Math.min(l.createdAt, r.createdAt),
    updatedAt: Math.max(l.updatedAt, r.updatedAt),
    version: Math.max(l.version, r.version),
    order: l.order, // v1 未使用のため left 据え置き
  };

  for (const f of TODO_FIELDS) {
    if (f === 'deleted') {
      // edit vs delete: 両側で deleted が食い違うなら競合（自動解決しない）。
      out.deleted = l.deleted; // 暫定 left
      if (l.deleted !== r.deleted) {
        conflicts.push({
          todoId: id,
          field: 'deleted',
          base: b?.deleted,
          left: l.deleted,
          right: r.deleted,
        });
      }
      continue;
    }
    if (SET_FIELDS.has(f)) {
      out.tags = mergeSet(b?.tags, l.tags, r.tags);
      continue;
    }
    const res = mergeField(b?.[f], l[f], r[f], f, id);
    // 型安全のためフィールドごとに代入（値は mergeField が by-field で扱う）。
    assignField(out, f, res.value);
    if (res.conflict) conflicts.push(res.conflict);
  }

  return { todo: out, conflicts };
}

// スカラフィールドの代入（tags/deleted は呼び出し側で処理済み）。
function assignField(todo: Todo, field: TodoField, value: unknown): void {
  switch (field) {
    case 'title':
      todo.title = value as string;
      break;
    case 'notes':
      todo.notes = value as string;
      break;
    case 'done':
      todo.done = value as boolean;
      break;
    case 'dueDate':
      todo.dueDate = value as number | null;
      break;
    case 'priority':
      todo.priority = value as Todo['priority'];
      break;
    // tags / deleted はここに来ない。
  }
}

export interface MergeResult {
  mergedSnapshot: Snapshot;
  conflicts: FieldConflict[];
}

// スナップショット全体の 3-way。base が無い場合は merge3NoBase を使う（ch.04 §4.5）。
export function merge3(base: Snapshot | null, left: Snapshot, right: Snapshot): MergeResult {
  const ids = new Set<Uuid>();
  if (base) for (const id of Object.keys(base.todos)) ids.add(id);
  for (const id of Object.keys(left.todos)) ids.add(id);
  for (const id of Object.keys(right.todos)) ids.add(id);

  const todos: Record<Uuid, Todo> = {};
  const conflicts: FieldConflict[] = [];
  for (const id of ids) {
    const res = mergeTodo(base?.todos[id], left.todos[id], right.todos[id]);
    if (res.todo) {
      todos[id] = res.todo;
      for (const c of res.conflicts) conflicts.push(c);
    }
  }
  return { mergedSnapshot: { todos }, conflicts };
}

// base 不在のフォールバック。TODO 全体を (version 大, 次点 updatedAt 大, 最終 id) で採用。
export function resolveNoBase(l: Todo | undefined, r: Todo | undefined): Todo | null {
  if (!l) return r ?? null;
  if (!r) return l;
  if (l.version !== r.version) return l.version > r.version ? l : r;
  if (l.updatedAt !== r.updatedAt) return l.updatedAt > r.updatedAt ? l : r;
  return l.id <= r.id ? l : r; // 全順序の最終 tie-break（決定性）
}

export function merge3NoBase(left: Snapshot, right: Snapshot): MergeResult {
  const ids = new Set<Uuid>();
  for (const id of Object.keys(left.todos)) ids.add(id);
  for (const id of Object.keys(right.todos)) ids.add(id);

  const todos: Record<Uuid, Todo> = {};
  for (const id of ids) {
    const picked = resolveNoBase(left.todos[id], right.todos[id]);
    if (picked) todos[id] = picked;
  }
  return { mergedSnapshot: { todos }, conflicts: [] };
}
