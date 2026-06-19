import type { ListFilter, SortBy, State, Todo, TodoSyncStatus, Uuid } from '../model/types';
import { DEFAULT_FILTER, PRIORITIES } from '../model/constants';

// State からの派生（ch.07 §7.4）。再計算は単純に保つ（メモ化は必要時のみ）。

// ---- 並び替え（Phase 6）。どの並びも「完了は下」（done 第1キー）を保つ。 ----

// 期限の小なり比較（null は後ろ）。
function dueThenCreated(a: Todo, b: Todo): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate - b.dueDate;
  }
  return a.createdAt - b.createdAt;
}

// 既定（従来の自動）: 期日昇順（null 後）→ 作成順。
export function compareByDue(a: Todo, b: Todo): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  return dueThenCreated(a, b);
}

// 優先度: 高→中→低→なし、次に期限・作成順。
export function compareByPriority(a: Todo, b: Todo): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  // PRIORITIES = [none, low, med, high]。降順にしたいので index の大きい方を前へ。
  const w = (t: Todo) => PRIORITIES.indexOf(t.priority);
  if (w(a) !== w(b)) return w(b) - w(a);
  return dueThenCreated(a, b);
}

// タイトル: 日本語ロケール昇順、次に作成順。
export function compareByTitle(a: Todo, b: Todo): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const c = a.title.localeCompare(b.title, 'ja');
  return c !== 0 ? c : a.createdAt - b.createdAt;
}

// カテゴリ（先頭タグ）: タグ昇順、タグ無しは後ろ、次に期限・作成順。
export function compareByCategory(a: Todo, b: Todo): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const ta = a.tags[0] ?? '';
  const tb = b.tags[0] ?? '';
  if (ta !== tb) {
    if (ta === '') return 1;
    if (tb === '') return -1;
    return ta.localeCompare(tb, 'ja');
  }
  return dueThenCreated(a, b);
}

// 手動並び（Phase 6）: グループ内は order 昇順（保険に createdAt）。
export function compareByOrder(a: Todo, b: Todo): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  return a.createdAt - b.createdAt;
}

export function comparatorFor(sortBy: SortBy): (a: Todo, b: Todo) => number {
  switch (sortBy) {
    case 'manual':
      return compareByOrder;
    case 'priority':
      return compareByPriority;
    case 'title':
      return compareByTitle;
    case 'category':
      return compareByCategory;
    default:
      return compareByDue;
  }
}

// ---- 絞り込み（Phase 6・4 軸 AND）。now 基準で期限バケツを判定（純粋・テスト可能）。 ----

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function matchesDue(todo: Todo, due: ListFilter['due'], now: number): boolean {
  if (due === 'all') return true;
  if (due === 'none') return todo.dueDate === null;
  if (todo.dueDate === null) return false;
  const start = startOfDay(now);
  const dayMs = 86_400_000;
  if (due === 'overdue') return todo.dueDate < start;
  if (due === 'today') return todo.dueDate >= start && todo.dueDate < start + dayMs;
  // week: 今日〜+7 日（期限切れは含めない）。
  return todo.dueDate >= start && todo.dueDate < start + 7 * dayMs;
}

export function matchesFilter(todo: Todo, f: ListFilter, now: number): boolean {
  if (!matchesDue(todo, f.due, now)) return false;
  if (f.priority !== 'all' && todo.priority !== f.priority) return false;
  if (f.tag !== null && !todo.tags.includes(f.tag)) return false;
  if (f.title !== '' && !todo.title.toLowerCase().includes(f.title.toLowerCase())) return false;
  return true;
}

// 既定値から外れている軸の数（絞り込みバッジ用）。
export function activeFilterCount(f: ListFilter): number {
  let n = 0;
  if (f.due !== DEFAULT_FILTER.due) n++;
  if (f.priority !== DEFAULT_FILTER.priority) n++;
  if (f.tag !== DEFAULT_FILTER.tag) n++;
  if (f.title.trim() !== '') n++;
  return n;
}

// 一覧に存在するタグ一覧（カテゴリ選択肢用・昇順・重複なし）。tombstone は除く。
export function distinctTags(todos: Todo[]): string[] {
  const set = new Set<string>();
  for (const t of todos) if (!t.deleted) for (const tag of t.tags) set.add(tag);
  return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
}

export function visibleTodos(state: State): Todo[] {
  const { sortBy, filter } = state.settings;
  const now = Date.now();
  return state.todos
    .filter((t) => !t.deleted && matchesFilter(t, filter, now))
    .sort(comparatorFor(sortBy));
}

export function findTodo(state: State, id: Uuid): Todo | undefined {
  return state.todos.find((t) => t.id === id);
}

export function conflictCount(state: State): number {
  return state.conflicts.length;
}

// 未連携時は同期系 UI を一切出さない（受け入れ基準 / ch.09）。Phase 0 は常に false。
export function showsSyncUi(state: State): boolean {
  return state.global !== 'unlinked';
}

// タスクタブのバッジ＝一覧に「要解決」を出す todo 件数。一覧（TaskListView）と同じ perTodoStatus を
// 唯一のソースにして数える（生きているタスクのみ）。state.conflicts はリモートマーカー全件で、削除済み/
// 未 materialize の残留マーカーを含みうるため、これを直接数えると一覧の行数より多く出る（Issue #52）。
export function tasksBadge(state: State): number {
  return Object.values(state.perTodoStatus).filter((s) => s === 'conflict').length;
}

// 設定タブのバッジ＝要再接続/エラー時に出す（ch.09 §9.6）。
export function settingsBadge(state: State): boolean {
  return state.global === 'needs-reauth' || state.global === 'error';
}

// 個別 TODO の同期ステータス（無ければ undefined）。
export function perTodoStatusOf(state: State, id: Uuid): TodoSyncStatus | undefined {
  return state.perTodoStatus[id];
}
