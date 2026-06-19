import type { Store } from './store';
import type { DeviceSettings, ExportRequest, FileDescriptor, ImportData, Uuid } from '../model/types';
import type { TodoDraft, TodoPatch } from '../services/TodoService';
import * as todoSvc from '../services/TodoService';
import * as settingsSvc from '../services/SettingsService';
import * as ExportService from '../services/ExportService';
import * as ImportService from '../services/ImportService';
import * as issueReporter from '../services/issueReporter';
import { keyBetween, keysAfter } from '../core';
import { visibleTodos } from './selectors';

// UI が呼ぶアクション。services で永続してから setState する（ui→state→services→store / ch.01）。

// 同期ランタイム（composition root が実装）への橋渡し。state は services を直接駆動せず
// この facade を介す（連携の有無やライフサイクルは root が握る）。
export interface SyncBridge {
  notifyEdited(): void; // 編集後の push をスケジュール（未連携なら no-op）
  syncNow(): Promise<void>;
  connectDropbox(): Promise<void>;
  connectGoogle(): Promise<void>;
  disconnect(): Promise<void>;
  resolveConflict(id: Uuid, patch: TodoPatch): Promise<void>;
  reloadFromLocal(): Promise<void>;
  applyIntervalChange(): void; // 設定変更時に interval を貼り直す
  // ローカルデータの削除系（Issue #38）。いずれも最後に再読込して状態を作り直す。
  deleteLocalData(): Promise<void>; // ① 削除のみ（能動的な再取得はしない）
  refetchFromCloud(): Promise<void>; // ② 削除して取り直す（事前 best-effort push）
  factoryReset(): Promise<void>; // ③ 連携解除＋全消し＋設定既定化
}

export interface Actions {
  addTodo(draft: TodoDraft): Promise<Uuid>;
  editTodo(id: Uuid, patch: TodoPatch): Promise<void>;
  toggleDone(id: Uuid, done: boolean): Promise<void>;
  deleteTodo(id: Uuid): Promise<void>;
  changeSettings(patch: Partial<DeviceSettings>): Promise<void>;
  // 手動並べ替え（Phase 6）。
  setSortMode(mode: 'auto' | 'manual'): Promise<void>; // 並びモード切替（手動化時は order をバックフィル）
  reorderTodo(id: Uuid, beforeId: Uuid | null, afterId: Uuid | null): Promise<void>; // 前後の id から order を確定
  connectDropbox(): Promise<void>;
  connectGoogle(): Promise<void>;
  disconnect(): Promise<void>;
  syncNow(): Promise<void>;
  resolveConflict(id: Uuid, patch: TodoPatch): Promise<void>;
  // ローカルデータの削除系（Issue #38）。
  deleteLocalData(): Promise<void>;
  refetchFromCloud(): Promise<void>;
  factoryReset(): Promise<void>;
  // エクスポート/インポート（Phase 5 / ch.13）。
  exportData(req: ExportRequest): Promise<FileDescriptor>;
  previewImport(text: string): ImportData; // パース＋検証のみ（UI が確認サマリに使う）
  commitImport(data: ImportData): Promise<void>; // タスクはマージ、設定は適用
  // 不具合報告（Issue #57）。GitHub 新規 Issue 画面のプレフィル URL を返す（read-only）。
  reportProblemUrl(): string;
}

export function createActions(store: Store, bridge: SyncBridge): Actions {
  return {
    async addTodo(draft) {
      // 既に order 付きタスクがあれば末尾に追加（手動並びの一貫性）。無ければ '' （pristine）。
      const orders = store.getState().todos.map((t) => t.order).filter((o) => o !== '');
      const order = orders.length ? keyBetween(orders.reduce((a, b) => (a > b ? a : b)), null) : '';
      const todo = await todoSvc.createTodo({ ...draft, order });
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

    async setSortMode(mode) {
      // 手動へ切替時、order 未設定が混在していれば現在の表示順を初期値として一括付与（並びが飛ばない）。
      if (mode === 'manual') {
        const visible = visibleTodos(store.getState());
        if (visible.some((t) => t.order === '')) {
          const keys = keysAfter(null, visible.length);
          const updated = new Map<Uuid, (typeof visible)[number]>();
          for (let i = 0; i < visible.length; i++) {
            const next = await todoSvc.updateTodo(visible[i].id, { order: keys[i] });
            if (next) updated.set(next.id, next);
          }
          store.setState((s) => ({ todos: s.todos.map((t) => updated.get(t.id) ?? t) }));
          bridge.notifyEdited();
        }
      }
      const next = await settingsSvc.updateSettings({ sortMode: mode });
      store.setState({ settings: next });
    },

    async reorderTodo(id, beforeId, afterId) {
      const todos = store.getState().todos;
      const before = beforeId ? todos.find((t) => t.id === beforeId) : undefined;
      const after = afterId ? todos.find((t) => t.id === afterId) : undefined;
      // 未設定（空）の隣接は開いた境界（null）として扱う。
      const a = before && before.order ? before.order : null;
      const b = after && after.order ? after.order : null;
      const next = await todoSvc.updateTodo(id, { order: keyBetween(a, b) });
      if (!next) return;
      store.setState((s) => ({ todos: s.todos.map((t) => (t.id === id ? next : t)) }));
      bridge.notifyEdited();
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

    async resolveConflict(id, patch) {
      await bridge.resolveConflict(id, patch);
    },

    async deleteLocalData() {
      await bridge.deleteLocalData();
    },

    async refetchFromCloud() {
      await bridge.refetchFromCloud();
    },

    async factoryReset() {
      await bridge.factoryReset();
    },

    async exportData(req) {
      const now = Date.now();
      if (req.kind === 'settings') {
        return ExportService.buildSettingsJson(await settingsSvc.loadSettings(), now);
      }
      const todos = await todoSvc.listAll(); // tombstone 込み（JSON 正本は無損失）
      if (req.kind === 'all') {
        return ExportService.buildAllJson(todos, await settingsSvc.loadSettings(), now);
      }
      switch (req.format) {
        case 'md':
          return ExportService.buildTasksMarkdown(todos, now);
        case 'csv':
          return ExportService.buildTasksCsv(todos, now);
        default:
          return ExportService.buildTasksJson(todos, now);
      }
    },

    previewImport(text) {
      return ImportService.parse(text);
    },

    reportProblemUrl() {
      return issueReporter.buildIssueUrl({
        version: __APP_VERSION__,
        route: store.getState().route.name,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        errors: issueReporter.recentErrors(),
      });
    },

    async commitImport(data) {
      if (data.tasks) {
        // マージエンジン経由で統合 → materialize 済みを state へ。次同期で push（未連携なら no-op）。
        const merged = await ImportService.mergeTasks(data.tasks);
        store.setState({ todos: merged.filter((t) => !t.deleted) });
        bridge.notifyEdited();
      }
      if (data.settings) {
        const next = await settingsSvc.updateSettings(ImportService.sanitizeSettings(data.settings));
        store.setState({ settings: next });
        bridge.applyIntervalChange();
      }
    },
  };
}
