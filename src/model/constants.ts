import type { DeviceSettings, Priority } from './types';

// IndexedDB（ch.06）。
export const DB_NAME = 'todo-db';
export const DB_VERSION = 2; // Phase 2 で objects/tokens ストアを追加（v1→v2）。

export const STORE = {
  todos: 'todos',
  settings: 'settings',
  meta: 'meta',
  objects: 'objects', // content-addressed blob のローカル複製（ch.06 §6.1 / Phase 2）
  tokens: 'tokens', // OAuth トークン（provider ごと / Phase 2）
} as const;

export const META_KEY = {
  deviceId: 'deviceId',
  lastSyncAt: 'lastSyncAt',
  head: 'head', // advisory HEAD のローカル保持（ch.04 §4.3 / Phase 2）
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

// 同期トリガの既定値（ch.11 §11.2 / 18.1 #9）と全体ステータスのちらつき抑制（ch.09 §9.2）。
export const PUSH_DEBOUNCE_MS = 2_000; // 編集後 push のデバウンス（2 秒）
export const SYNCING_SHOW_DELAY_MS = 400; // この時間を超えて初めて 'syncing' を表示
export const SYNCING_MIN_VISIBLE_MS = 500; // 'syncing' を最低限維持する時間（ちらつき防止）
