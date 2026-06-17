# 05. ストレージアダプタ

> 要件トレース: requirements.md「ストレージアダプタ」「セキュリティ」「受け入れ基準」
> 状態: ドラフト ／ 実装フェーズ: 1（IF + InMemory）→ 2（Dropbox）→ 3（Drive）

同期エンジン（[04](./04-sync-engine.md)）が要求するのは 4 つの操作だけ。保存先の違いはこの IF の裏に隠す。

## 5.1 共通インターフェース

```ts
interface StorageAdapter {
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;   // べき等
  delete(key: string): Promise<void>;
  putIfAbsent?(key, bytes): Promise<boolean>;            // CAS（任意の最適化 / 要件「同期エンジン仕様」）
}
```

> **正しさは `list/get/put/delete` だけで成立**する（受け入れ基準）。`putIfAbsent`（CAS）は、対応する保存先で advisory HEAD 更新を高速化する**任意の最適化**にすぎず、未対応でも全機能が動く。

## 5.2 鍵空間（キー設計）

全アダプタ共通のキー規約。`objects/` は内容アドレス指定で不変・べき等。

```
objects/<hash>      … commit / snapshot を兼ねる（内容 SHA-256 / 不変）
heads/<deviceId>    … advisory HEAD（端末ごと。list して先端を再導出できる）
```

- `list('objects/')` で全オブジェクト、`list('heads/')` で各端末の HEAD ヒントを列挙。
- 先端の正は常に**コミット集合からの再導出**（[04 §4.3](./04-sync-engine.md)）。`heads/` はヒント。
- **孤立先端の整合**: `loadCommits` は `heads/` 起点で辿る（[04 §4.6](./04-sync-engine.md)）。`heads/` 未更新の孤立先端は作成端末の次回同期で再 publish されて回収される。即時の peer 回復が要る場合のみ `list('objects/')` を併用して `heads/` を純ヒント化する（list コスト増）。

## 5.3 InMemory アダプタ（Phase 1・テスト用）

- 実体は `Map<string, Uint8Array>`。`list(prefix)` は前方一致。
- `putIfAbsent` を実装し、CAS 高速パスのテストにも使う。
- **遅延整合のシミュレート**（オプション）: `put` 直後に `list` へ反映されない遅延フラグを持たせ、テスト #2/#6 と Drive の一覧遅延整合（要件「ストレージアダプタ」）を現実に寄せる。

> 不変条件: InMemory はネットワークも永続も持たない純メモリ。これにより [16](./16-testing.md) の 6 シナリオが決定的・高速に回る。

## 5.4 Dropbox アダプタ（Phase 2）

- 認可: **PKCE / public client**、スコープは**アプリ専用フォルダ**（最小権限 / 要件「ストレージアダプタ」, 要件「セキュリティ」）。PKCE 実装は `adapters/oauth/pkce.ts`。
- API 対応:

| IF | Dropbox API | 備考 |
|---|---|---|
| `put` | `/files/upload`（mode=overwrite） | 同キー上書きでべき等 |
| `get` | `/files/download` | 404 は `null` |
| `list` | `/files/list_folder`（+ continue） | prefix=フォルダ |
| `delete` | `/files/delete_v2` | |

- リダイレクト URI は **`window.location.origin` を基準に動的生成**（オリジン非依存＝決定 #1）。本番オリジンをコードに固定しない。**Dropbox アプリへのリダイレクト URI 登録は Phase 2 にユーザーが実施**。Client ID は [18](./18-open-questions.md) #3。
- トークンは IndexedDB 保持（防御境界でない前提 / 要件「セキュリティ」・[14](./14-security.md)）。

## 5.5 Google Drive アダプタ（Phase 3）

- 領域: **appDataFolder**（最小権限 / 要件「ストレージアダプタ」）。**追記専用＋一覧で先端導出**。
- 重複回避: **内容ハッシュをファイル名**にし、create 前に存在確認（無ければ create）。**一覧の遅延整合を許容**（要件「ストレージアダプタ」, 要件「実装フェーズ」）。
- OAuth リダイレクトは `window.location.origin` 基準（オリジン非依存＝決定 #1）。**登録は Phase 3 にユーザーが実施**。Client ID は [18](./18-open-questions.md) #4。

| IF | Drive API | 備考 |
|---|---|---|
| `put` | `files.create`（multipart, parent=appDataFolder） | 事前に名前一致を `files.list` で確認＝べき等化 |
| `get` | `files.get(alt=media)` | 名前→id 解決を挟む |
| `list` | `files.list(spaces=appDataFolder)` | 遅延整合あり |
| `delete` | `files.delete` | |

> 一覧が遅延整合でも、fork はマージで吸収しデータ消失しない（要件「実装フェーズ」）。これは「先端をコミット集合から再導出する」設計（[04](./04-sync-engine.md)）が支える。

## 5.6 契約テスト（contract test）

全アダプタが満たすべき振る舞いを**共通スイート**にして `tests/adapters/` で共有する。

- `put` のべき等性（同キー二度書きで状態不変）。
- `get` 未存在は `null`。
- `list(prefix)` は前方一致のみ返す。
- `put`→`get` 往復でバイト列一致。
- （対応時）`putIfAbsent` は既存キーで `false`。

> InMemory は本スイートで full green。Dropbox/Drive は実 API 統合のため、契約テストはモック／録画で代替し、手動 E2E を併用（[16](./16-testing.md)）。

## 5.7 拡張ポイント（今回は実装不要 / 要件「ストレージアダプタ」）

S3 / WebDAV は同じ `StorageAdapter` IF で後から追加できる（Phase 6 任意）。`list/get/put/delete` に対応できれば core は無変更。
