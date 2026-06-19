import type { DeviceSettings, ListFilter, Priority } from './types';

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
  conflicts: 'conflicts', // 未解決の競合の永続（リロードで消えないように / Issue #26）
  // 解決済みだがリモートのマーカー削除がまだ確認できていない todoId 集合（確認付きリトライ / Issue #29）。
  pendingConflictDeletes: 'pendingConflictDeletes',
  // 通知済み記録（端末ローカル・非同期対象 / Issue #71）。Record<Uuid, Millis>（通知した fireAt）。
  notifiedFires: 'notifiedFires',
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

// 一覧の絞り込み既定（無効＝全表示 / Phase 6）。クリアにも使う。
export const DEFAULT_FILTER: ListFilter = {
  due: 'all',
  priority: 'all',
  tag: null,
  title: '',
};

// 端末ごと設定の既定値（ch.03 §3.6 / 18-open-questions #9）。
export const DEFAULT_SETTINGS: DeviceSettings = {
  autoSyncMode: 'interval',
  autoSyncIntervalMs: 300_000, // 5 分
  sidebarCollapsed: false,
  sortBy: 'due',
  filter: { ...DEFAULT_FILTER },
  connectedProvider: 'none',
};

// 期日が近づいたら通知（Issue #71）。「期日の何ミリ秒前に通知するか」の選択肢。
// null=通知しない（既定）。5 分刻み（5〜55 分）→ 1 時間刻み（1〜23 時間）→ 1 日刻み（1 日＝最大）。
function buildNotifyOptions(): ReadonlyArray<readonly [number | null, string]> {
  const out: Array<readonly [number | null, string]> = [[null, '通知しない']];
  for (let m = 5; m <= 55; m += 5) out.push([m * 60_000, `${m}分前`]);
  for (let h = 1; h <= 23; h += 1) out.push([h * 3_600_000, `${h}時間前`]);
  out.push([86_400_000, '1日前']);
  return out;
}
export const NOTIFY_OPTIONS: ReadonlyArray<readonly [number | null, string]> = buildNotifyOptions();

// 通知スケジューラの定期チェック間隔（Issue #71 / ch.19）。
export const NOTIFY_CHECK_INTERVAL_MS = 30_000; // 30 秒

// レスポンシブ切替（~768px / ch.08）。styles のメディアクエリと一致させる。
export const BREAKPOINT_PX = 768;

// タブ間同期チャネル名（Phase 2 で使用 / ch.06）。
export const BROADCAST_CHANNEL = 'todo-sync';

// 同期トリガの既定値（ch.11 §11.2 / 18.1 #9）と全体ステータスのちらつき抑制（ch.09 §9.2）。
export const PUSH_DEBOUNCE_MS = 2_000; // 編集後 push のデバウンス（2 秒）
export const SYNCING_SHOW_DELAY_MS = 400; // この時間を超えて初めて 'syncing' を表示
export const SYNCING_MIN_VISIBLE_MS = 500; // 'syncing' を最低限維持する時間（ちらつき防止）
