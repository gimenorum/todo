import type { Store } from './store';
import type { DeviceSettings, Uuid } from '../model/types';
import type { TodoDraft, TodoPatch } from '../services/TodoService';
import * as todoSvc from '../services/TodoService';
import * as settingsSvc from '../services/SettingsService';

// UI が呼ぶアクション。services で永続してから setState する（ui→state→services→store / ch.01）。

export interface Actions {
  addTodo(draft: TodoDraft): Promise<Uuid>;
  editTodo(id: Uuid, patch: TodoPatch): Promise<void>;
  toggleDone(id: Uuid, done: boolean): Promise<void>;
  deleteTodo(id: Uuid): Promise<void>;
  changeSettings(patch: Partial<DeviceSettings>): Promise<void>;
}

export function createActions(store: Store): Actions {
  return {
    async addTodo(draft) {
      const todo = await todoSvc.createTodo(draft);
      store.setState((s) => ({ todos: [...s.todos, todo] }));
      return todo.id;
    },

    async editTodo(id, patch) {
      const next = await todoSvc.updateTodo(id, patch);
      if (!next) return;
      store.setState((s) => ({
        todos: next.deleted
          ? s.todos.filter((t) => t.id !== id)
          : s.todos.map((t) => (t.id === id ? next : t)),
      }));
    },

    async toggleDone(id, done) {
      const next = await todoSvc.updateTodo(id, { done });
      if (!next) return;
      store.setState((s) => ({ todos: s.todos.map((t) => (t.id === id ? next : t)) }));
    },

    async deleteTodo(id) {
      await todoSvc.softDeleteTodo(id);
      store.setState((s) => ({ todos: s.todos.filter((t) => t.id !== id) }));
    },

    async changeSettings(patch) {
      const next = await settingsSvc.updateSettings(patch);
      store.setState({ settings: next });
    },
  };
}
