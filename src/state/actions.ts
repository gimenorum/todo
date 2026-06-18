import type { Store } from './store';
import type { DeviceSettings, Uuid } from '../model/types';
import type { TodoDraft, TodoPatch } from '../services/TodoService';
import type { ConflictChoice } from '../services/SyncService';
import * as todoSvc from '../services/TodoService';
import * as settingsSvc from '../services/SettingsService';

// UI が呼ぶアクション。services で永続してから setState する（ui→state→services→store / ch.01）。

// 同期ランタイム（composition root が実装）への橋渡し。state は services を直接駆動せず
// この facade を介す（連携の有無やライフサイクルは root が握る）。
export interface SyncBridge {
  notifyEdited(): void; // 編集後の push をスケジュール（未連携なら no-op）
  syncNow(): Promise<void>;
  connectDropbox(): Promise<void>;
  connectGoogle(): Promise<void>;
  disconnect(): Promise<void>;
  resolveConflict(id: Uuid, choice: ConflictChoice): Promise<void>;
  reloadFromLocal(): Promise<void>;
  applyIntervalChange(): void; // 設定変更時に interval を貼り直す
}

export interface Actions {
  addTodo(draft: TodoDraft): Promise<Uuid>;
  editTodo(id: Uuid, patch: TodoPatch): Promise<void>;
  toggleDone(id: Uuid, done: boolean): Promise<void>;
  deleteTodo(id: Uuid): Promise<void>;
  changeSettings(patch: Partial<DeviceSettings>): Promise<void>;
  connectDropbox(): Promise<void>;
  connectGoogle(): Promise<void>;
  disconnect(): Promise<void>;
  syncNow(): Promise<void>;
  resolveConflict(id: Uuid, choice: ConflictChoice): Promise<void>;
}

export function createActions(store: Store, bridge: SyncBridge): Actions {
  return {
    async addTodo(draft) {
      const todo = await todoSvc.createTodo(draft);
      store.setState((s) => ({ todos: [...s.todos, todo] }));
      bridge.notifyEdited();
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
      bridge.notifyEdited();
    },

    async toggleDone(id, done) {
      const next = await todoSvc.updateTodo(id, { done });
      if (!next) return;
      store.setState((s) => ({ todos: s.todos.map((t) => (t.id === id ? next : t)) }));
      bridge.notifyEdited();
    },

    async deleteTodo(id) {
      await todoSvc.softDeleteTodo(id);
      store.setState((s) => ({ todos: s.todos.filter((t) => t.id !== id) }));
      bridge.notifyEdited();
    },

    async changeSettings(patch) {
      const next = await settingsSvc.updateSettings(patch);
      store.setState({ settings: next });
      bridge.applyIntervalChange();
    },

    async connectDropbox() {
      await bridge.connectDropbox();
    },

    async connectGoogle() {
      await bridge.connectGoogle();
    },

    async disconnect() {
      await bridge.disconnect();
    },

    async syncNow() {
      await bridge.syncNow();
    },

    async resolveConflict(id, choice) {
      await bridge.resolveConflict(id, choice);
    },
  };
}
