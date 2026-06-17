import type { DeviceSettings, Priority } from './types';

// IndexedDB（ch.06）。
export const DB_NAME = 'todo-db';
export const DB_VERSION = 1;

export const STORE = {
  todos: 'todos',
  settings: 'settings',
  meta: 'meta',
} as const;

export const META_KEY = {
  deviceId: 'deviceId',
  lastSyncAt: 'lastSyncAt',
} as const;

// settings store 内の単一レコードキー。
export const SETTINGS_KEY = 'device-settings';

// 優先度（ch.03）。
export const PRIORITIES: readonly Priority[] = ['none', 'low', 'med', 'high'];

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'なし',
  low: '低',
  med: '中',
  high: '高',
};

// 端末ごと設定の既定値（ch.03 §3.6 / 18-open-questions #9）。
export const DEFAULT_SETTINGS: DeviceSettings = {
  autoSyncMode: 'interval',
  autoSyncIntervalMs: 300_000, // 5 分
  sidebarCollapsed: false,
  connectedProvider: 'none',
};

// レスポンシブ切替（~768px / ch.08）。styles のメディアクエリと一致させる。
export const BREAKPOINT_PX = 768;

// タブ間同期チャネル名（Phase 2 で使用 / ch.06）。
export const BROADCAST_CHANNEL = 'todo-sync';
