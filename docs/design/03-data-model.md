# 03. データモデル（型）

> 要件トレース: requirements.md「データモデル」「同期エンジン仕様」「受け入れ基準」
> 状態: 実装済（Phase 1） ／ 実装フェーズ: 0–1

`model/types.ts` に置く **型の単一の真実**。core・store・services・ui の全レイヤがここを参照する。
ここに載せるのは「型の骨子」であり実装ロジックではない（ロジックの擬似コードは [04](./04-sync-engine.md)）。

## 3.1 基本値の型

```ts
export type Uuid = string;       // crypto.randomUUID()
export type Hash = string;       // SHA-256 hex（64 桁・小文字）
export type Priority = 'none' | 'low' | 'med' | 'high';
export type Millis = number;     // Unix epoch ミリ秒
export type DeviceId = string;   // 端末ごとに一度だけ生成して永続
```

## 3.2 TODO 項目

要件「データモデル」の全フィールドを型化。編集のたびに `version` を +1 する。

```ts
export interface Todo {
  id: Uuid;
  title: string;
  done: boolean;
  dueDate: Millis | null;
  priority: Priority;
  notes: string;
  tags: string[];
  order: string;        // フラクショナルインデックス（v1 未使用・予約）
  createdAt: Millis;
  updatedAt: Millis;
  deleted: boolean;     // tombstone（物理削除しない）
  version: number;      // 編集ごとに +1
}
```

### マージ対象フィールド（設計判断）

3-way マージの対象は以下に限る。

```ts
export type TodoField =
  | 'title' | 'done' | 'dueDate' | 'priority' | 'notes' | 'tags' | 'deleted';
```

- `createdAt` … 作成時に固定で不変。マージ対象外。
- `order` … 手動並べ替え（**Phase 6**）のフラクショナルインデックス。`TodoField` には**含めず**（＝`FieldConflict` に出さない）、マージ時は**最近性（recency）= (updatedAt, version) で確定**する（→ [04 §4.5](./04-sync-engine.md)）。並べ替えの同時編集は競合扱いせず、新しい操作を採用（データ消失なし）。
- `updatedAt` / `version` … **メタ情報**。フィールド競合の対象にはせず、LCA が取れない場合の **タイブレーク** に使う（→ [04 §4.5](./04-sync-engine.md)）。
- `tags` … マージ対象だが**集合 3-way**で自動マージされ、**競合（`FieldConflict`）には現れない**（→ [04 §4.5](./04-sync-engine.md)・§3.4）。

> 設計判断の根拠: 要件はマージを「フィールド単位」とのみ規定。作成時刻・予約フィールド・メタを競合対象に含めると無意味な競合が増えるため、ユーザーが意味を持って編集する 7 フィールドに限定する。

## 3.3 スナップショットとオブジェクト

```ts
// スナップショット = ある時点の TODO 集合（内容アドレス指定で保存）
// メモリ表現は Record（O(1) アクセス）。直列化時は id 昇順配列に正規化する（→ 04 §4.1）。
export interface Snapshot {
  todos: Record<Uuid, Todo>;
}

// コミット（DAG ノード）
export interface Commit {
  parents: Hash[];      // 0=初期, 1=通常, 2+=マージ
  snapshot: Hash;       // Snapshot blob のハッシュ
  timestamp: Millis;
  deviceId: DeviceId;
}

// 保存されるオブジェクト（内容 SHA-256 がキー）
export type ObjectKind = 'commit' | 'snapshot';
export interface StoredObject {
  kind: ObjectKind;
  bytes: Uint8Array;    // 正規形シリアライズ済みバイト列
}
```

> **二重表現の注意**: `Snapshot.todos` はメモリでは `Record<Uuid, Todo>` だが、ハッシュの決定性のため**直列化時は id 昇順の配列に正規化**する（→ [04 §4.1](./04-sync-engine.md)）。
> **マージコミットは決定的**: `Commit` 型は `deviceId` を必須で持つ（メモリ表現）。ただし **parents≥2 のマージコミットでは blob（ハッシュ対象）から `deviceId` を除外し、`timestamp` は親由来（最大）**にする（→ [04 §4.1/§4.2](./04-sync-engine.md)）。マージの作成者/時刻が要る場合は content-addressed blob の外（ローカルメタのサイドカー）に置く。通常コミット（単一親）の blob は `deviceId`/`timestamp` を含む。

## 3.4 マージ結果と競合

要件「同期エンジン仕様」：出力に「自動マージ結果」と「未解決の競合リスト（項目 id・フィールド単位の左右の値・基準値）」を含める。

```ts
export interface FieldConflict {
  todoId: Uuid;
  field: TodoField;
  base: unknown;        // 基準値（LCA 由来。取得不可なら undefined）
  left: unknown;        // この端末
  right: unknown;       // 相手
}

export interface SyncResult {
  mergedSnapshot: Snapshot;     // 自動マージ後（競合フィールドは left を暫定保持）
  newHead: Hash | null;         // 同期後の先端（マージ有無は picked で判定。コミットが無ければ null）
  conflicts: FieldConflict[];   // 未解決の競合（per-todo / per-field）
  picked: { base: Hash | null; left: Hash; right: Hash } | null; // 観測用メタ（base/left/right。マージ時のみ）
}
```

`FieldConflict.left/right/base` の `unknown` は、UI 側で `field` に応じて型を絞る。対応表（**`tags` は集合マージで競合化しないため含めない**）:

| field | 値の型 |
|---|---|
| `title` `notes` | `string` |
| `done` `deleted` | `boolean` |
| `dueDate` | `Millis \| null` |
| `priority` | `Priority` |

> `tags` は [04 §4.5](./04-sync-engine.md) の集合 3-way（`mergeSet`）で自動マージされ、`FieldConflict` には現れない。`SyncResult.picked` は [16](./16-testing.md) のテストが LCA 選択（base）を検証するために用いる。

## 3.5 ストレージアダプタ共通インターフェース

要件「ストレージアダプタ」。詳細実装は [05](./05-storage-adapter.md)。

```ts
export interface StorageAdapter {
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;   // べき等
  delete(key: string): Promise<void>;
  // CAS は任意の最適化。未対応アダプタは undefined。
  putIfAbsent?(key: string, bytes: Uint8Array): Promise<boolean>;
}
```

## 3.6 端末ごと設定（同期しない）

要件「同期の設定・タイミング」：設定は端末ごとにローカル保存し、TODO データには載せない。

```ts
export interface DeviceSettings {
  autoSyncMode: 'manual' | 'interval';
  autoSyncIntervalMs: number;          // interval のときのみ有効（既定 300_000 = 5 分 / 18-open-questions #9）
  sidebarCollapsed: boolean;           // PC サイドバー折り畳み（UI 設定）
  sortMode: 'auto' | 'manual';         // 一覧の並び（auto=自動整列 / manual=手動並べ替え。Phase 6・端末ごと＝同期しない）
  connectedProvider: 'none' | 'dropbox' | 'gdrive';
  language?: string;                   // 後で
}
```

## 3.7 同期ステータスとアプリ状態

要件「UI / DOM 更新の方針」「ステータス表示」。アプリ状態は「単一の真実」として 1 か所に持つ（→ [07](./07-state-and-dom.md)）。

```ts
export type GlobalSyncStatus =
  | 'unlinked'      // 未連携＝同期系 UI を一切出さない
  | 'idle'          // 連携済み・静か（最終同期時刻のみ）
  | 'syncing'       // 400ms 超のみ表示・最低 500ms 維持
  | 'offline'
  | 'error'
  | 'needs-reauth';

export type TodoSyncStatus = 'synced' | 'unpushed' | 'conflict';

export interface State {
  todos: Todo[];                          // materialize 済みリスト（表示順ソート済）
  settings: DeviceSettings;
  global: GlobalSyncStatus;
  lastSyncAt: Millis | null;
  perTodoStatus: Record<Uuid, TodoSyncStatus>;
  conflicts: FieldConflict[];             // ナビのバッジ等の源
  route: Route;                           // 現在ルート（→ 08）
}
```

## 3.8 関連する不変条件

- スナップショットの正規化（id 昇順）により「同内容→同ハッシュ」が成立（受け入れ基準の前提）。
- マージコミットは blob から `deviceId` を除外＝決定的で、同時同期でも単一先端へ収束（→ [04 §4.1/§4.6](./04-sync-engine.md)）。
- `deleted` を `TodoField` に含めることで「edit vs delete」をフィールド競合として扱える（→ [04 §4.5](./04-sync-engine.md)・受け入れ基準）。
- 設定（`DeviceSettings`）は TODO の型系統と完全に分離。同期データに載らない（受け入れ基準）。
