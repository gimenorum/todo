// 型の単一の真実（ch.03）。core・store・services・state・ui の全レイヤがここを参照する。
// ここに置くのは「型の骨子」であり実装ロジックではない。

// ---- 3.1 基本値の型 ----
export type Uuid = string; // crypto.randomUUID()
export type Hash = string; // SHA-256 hex（64 桁・小文字）
export type Priority = 'none' | 'low' | 'med' | 'high';
export type Millis = number; // Unix epoch ミリ秒
export type DeviceId = string; // 端末ごとに一度だけ生成して永続

// 時刻注入（ch.16 §16.1）。services/tests は core へ時刻を注入し、
// core/sync は Date.now() を直呼びしない（決定性のため）。
export interface Clock {
  now(): Millis;
}

// ---- 3.2 TODO 項目 ----
export interface Todo {
  id: Uuid;
  title: string;
  done: boolean;
  dueDate: Millis | null;
  priority: Priority;
  notes: string;
  tags: string[];
  order: string; // フラクショナルインデックス（手動並べ替え / Phase 6・recency 同期・競合化しない）
  createdAt: Millis;
  updatedAt: Millis;
  deleted: boolean; // tombstone（物理削除しない）
  version: number; // 編集ごとに +1
}

// 3-way マージ対象フィールド（createdAt/order/updatedAt/version は対象外）。
export type TodoField =
  | 'title'
  | 'done'
  | 'dueDate'
  | 'priority'
  | 'notes'
  | 'tags'
  | 'deleted';

// ---- 3.3 スナップショットとオブジェクト ----
// スナップショット = ある時点の TODO 集合（内容アドレス指定で保存）。
// メモリ表現は Record（O(1)）。直列化時は id 昇順配列に正規化する（ch.04 §4.1）。
export interface Snapshot {
  todos: Record<Uuid, Todo>;
}

// コミット（DAG ノード）。parents 0=初期 / 1=通常 / 2+=マージ。
export interface Commit {
  parents: Hash[];
  snapshot: Hash; // Snapshot blob のハッシュ
  timestamp: Millis;
  deviceId: DeviceId;
}

export type ObjectKind = 'commit' | 'snapshot';

// 保存されるオブジェクト（内容 SHA-256 がキー）。
export interface StoredObject {
  kind: ObjectKind;
  bytes: Uint8Array; // 正規形シリアライズ済みバイト列
}

// ---- 3.4 マージ結果と競合 ----
export interface FieldConflict {
  todoId: Uuid;
  field: TodoField;
  base: unknown; // 基準値（LCA 由来。取得不可なら undefined）
  left: unknown; // この端末
  right: unknown; // 相手
}

export interface SyncResult {
  mergedSnapshot: Snapshot; // 自動マージ後（競合フィールドは left を暫定保持）
  newHead: Hash | null; // 同期後の先端（マージ有無は picked で判定。コミットが無ければ null）
  conflicts: FieldConflict[]; // 未解決の競合（per-todo / per-field）
  picked: { base: Hash | null; left: Hash; right: Hash } | null; // 観測用メタ
}

// ---- 3.5 ストレージアダプタ共通インターフェース（実装は Phase 1+） ----
export interface StorageAdapter {
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>; // べき等
  delete(key: string): Promise<void>;
  putIfAbsent?(key: string, bytes: Uint8Array): Promise<boolean>; // CAS は任意の最適化
}

// ---- 3.5.1 OAuth トークン（Phase 2 / ch.05・06・14） ----
// 連携プロバイダ（DeviceSettings.connectedProvider の 'none' を除いた実保存先）。
export type SyncProvider = 'dropbox' | 'gdrive';

// OAuth トークン。tokens ストア（store/tokenStore）に provider ごとに保持する。
// 防御境界ではない前提（ch.14）。refreshToken は token_access_type=offline 指定時のみ得られる。
export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Millis; // アクセストークン失効時刻（epoch ms）。無ければ無期限扱い。
  accountId?: string;
}

// ---- 3.6 端末ごと設定（同期しない） ----
export interface DeviceSettings {
  autoSyncMode: 'manual' | 'interval';
  autoSyncIntervalMs: number; // interval のときのみ有効（既定 300_000 = 5 分）
  sidebarCollapsed: boolean; // PC サイドバー折り畳み（UI 設定）
  sortMode: 'auto' | 'manual'; // タスク一覧の並び（auto=自動整列 / manual=手動並べ替え。同期しない）
  connectedProvider: 'none' | 'dropbox' | 'gdrive';
  language?: string; // 後で
}

// ---- 3.7 同期ステータスとアプリ状態 ----
export type GlobalSyncStatus =
  | 'unlinked' // 未連携＝同期系 UI を一切出さない（Phase 0 は常にこれ）
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'error'
  | 'needs-reauth';

export type TodoSyncStatus = 'synced' | 'unpushed' | 'conflict';

export interface State {
  todos: Todo[]; // materialize 済みリスト（表示順ソート済）。tombstone は含めない。
  settings: DeviceSettings;
  global: GlobalSyncStatus;
  lastSyncAt: Millis | null;
  perTodoStatus: Record<Uuid, TodoSyncStatus>;
  conflicts: FieldConflict[]; // ナビのバッジ等の源
  banner: string | null; // 一時バナー（online 復帰通知など / ch.11 §11.3）。無ければ null。
  route: Route; // 現在ルート（ch.08）
}

// ---- 3.8 エクスポート / インポート（Phase 5 / ch.13） ----
// JSON 正本スキーマ。バージョン付き・全フィールド・無損失往復。tasks は tombstone/version 込みで保持する。
export interface ExportFileV1 {
  format: 'todo-pwa-export';
  v: 1;
  kind: 'tasks' | 'settings' | 'tasks+settings';
  exportedAt: Millis;
  tasks?: Todo[];
  settings?: DeviceSettings;
}

// 受け渡し用ファイル記述子（DOM 非依存＝services は中身だけ作り、保存は ui/download が担う）。
export interface FileDescriptor {
  filename: string;
  mime: string;
  text: string;
}

// エクスポート要求（UI → actions）。'all' は tasks+settings（JSON 正本）。
export interface ExportRequest {
  kind: 'tasks' | 'settings' | 'all';
  format: 'json' | 'md' | 'csv';
}

// パース済みインポートデータ（previewImport → commitImport）。
export interface ImportData {
  kind: 'tasks' | 'settings' | 'tasks+settings';
  tasks?: Todo[];
  settings?: DeviceSettings;
}

// ---- ルート（ch.08） ----
export type Route =
  | { name: 'tasks' }
  | { name: 'todo'; id: Uuid }
  | { name: 'settings' }
  | { name: 'merge'; id: Uuid }; // Phase 4
