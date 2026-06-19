import type { State, Todo, TodoSyncStatus, Uuid } from '../model/types';

// State からの派生（ch.07 §7.4）。再計算は単純に保つ（メモ化は必要時のみ）。

// 表示順: 未完了 → 完了、その中で期日昇順（null は後ろ）、最後に作成日時昇順。
export function compareTodos(a: Todo, b: Todo): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate - b.dueDate;
  }
  return a.createdAt - b.createdAt;
}

export function visibleTodos(state: State): Todo[] {
  return state.todos.filter((t) => !t.deleted).sort(compareTodos);
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
