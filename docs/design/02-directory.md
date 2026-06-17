# 02. ディレクトリ / モジュール構成

> 要件トレース: requirements.md「技術スタック」「同期エンジン仕様」「ローカルストア」
> 状態: 一部実装済（Phase 0 範囲） ／ 実装フェーズ: 全体

[01 アーキテクチャ](./01-architecture.md) のレイヤを、具体的な `src/` ツリーに落とす。各ファイルは単一責務を保ち、レイヤ規約表（§1.3）の依存方向を守る。

## 2.1 `src/` ツリー

```
src/
  main.ts                     … エントリ。app 初期化・ルーター起動・SW 登録
  model/
    types.ts                  … Todo, Snapshot, Commit, StoredObject, State 等（型の単一の真実）
    constants.ts              … priority 値, DB 名, ストアキー prefix, 既定設定値
    ids.ts                    … UUID 生成 / deviceId 取得・生成
  core/                       … ★ UI 非依存・純 TS 同期エンジン（Phase 1 で完結）
    serialize.ts              … 決定的シリアライズ（キー順正規化・正規形）
    hash.ts                   … SHA-256（crypto.subtle ラッパ）・再ハッシュ検証
    objects.ts                … blob/commit のエンコード/デコード・種別判別
    dag.ts                    … 先端導出・祖先探索・LCA
    merge.ts                  … フィールド単位 3-way マージ・競合検出
    sync.ts                   … syncOnce()（pull/merge/push の純粋オーケストレーション部）
    index.ts                  … 公開 API の barrel（core の境界）
  adapters/
    StorageAdapter.ts         … 共通 IF（list/get/put/delete 型）
    InMemoryAdapter.ts        … テスト用（Phase 1）
    DropboxAdapter.ts         … PKCE OAuth・アプリ専用フォルダ（Phase 2）
    GoogleDriveAdapter.ts     … appDataFolder・追記専用（Phase 3）
    oauth/
      pkce.ts                 … PKCE（code_verifier/challenge, S256）
      tokenStore.ts           … トークンの IndexedDB 保持
  store/                      … IndexedDB（idb）ローカル永続
    db.ts                     … スキーマ定義・openDB・マイグレーション
    todoStore.ts              … materialize 済み TODO リストの CRUD
    objectStore.ts            … commit/blob ローカル複製の get/put/list
    settingsStore.ts          … 端末ごと設定（同期しない）
    metaStore.ts              … advisory HEAD キャッシュ・lastSyncAt・deviceId
  services/
    SyncService.ts            … core を駆動。local↔remote 双方向・競合を state へ反映
    SyncScheduler.ts          … 5 トリガ・デバウンス・online 復帰・visibility
    ExportService.ts          … JSON/Markdown/CSV 生成
    ImportService.ts          … 取り込み（タスク=マージ / 設定=適用）
  state/
    store.ts                  … setState→render 単一経路・observable/pub-sub
    selectors.ts              … 派生（競合件数・全体ステータス導出）
    broadcast.ts              … BroadcastChannel ラッパ（タブ間）
  router/
    router.ts                 … ハッシュルーター（パース・購読・遷移）
    routes.ts                 … ルート定義表
  ui/
    layout/                   … AppShell, Sidebar, BottomTabs, StatusIndicator, Badge
    views/                    … TaskListView, TodoEditView, SettingsView, ConflictMergeView
    components/               … TodoItem, FieldDiff, TextDiff, MergePreview
    templates/                … <template> 群（Phase 0 は index.html に集約。複雑化したらここへ分離）
    dom.ts                    … template クローン・textContent ヘルパ・keyed リスト差分
  pwa/
    registerSW.ts             … SW 登録・更新通知
    installPrompt.ts          … beforeinstallprompt の取り扱い
  sw/
    sw.ts                     … 手書き SW（別ビルド入力）
    cache-strategies.ts       … precache / runtime 戦略

public/
  manifest.webmanifest        … name/scope/start_url/icons/display
  icons/                      … 各サイズ
index.html                    … CSP <meta>・<template> 群・ルートマウント点
styles/
  *.css                       … 素の CSS（レイヤ別）
tests/
  core/                       … 同期エンジン単体（6 シナリオを含む）
  adapters/                   … 契約テスト（全アダプタ共通の振る舞い検証）
  helpers/                    … makeDevice(), fixedClock(), seedSnapshot()
```

## 2.2 ディレクトリの責務（要約）

| ディレクトリ | 責務 | フェーズ |
|---|---|---|
| `model/` | 全レイヤが参照する型・定数。実行時依存ゼロ | 0 |
| `core/` | 同期の正しさ。純粋関数のみ | 1 |
| `adapters/` | リモート I/O を `list/get/put/delete` に正規化 | 1（IF/InMemory）→2→3 |
| `store/` | ローカル永続（materialized リスト・オブジェクト複製・設定・メタ） | 0（todos）→2（objects） |
| `services/` | core・store・adapters を編成。トリガ管理・入出力 | 1→2→5 |
| `state/` | アプリ状態の単一の真実・購読 | 0 |
| `router/` | URL ハッシュ ⇄ 画面状態 | 0 |
| `ui/` | DOM 生成・差分更新・画面 | 0→（10 は 4） |
| `pwa/` `sw/` | インストール・オフライン | 0 |

## 2.3 命名・構造の規約

- **1 ファイル 1 責務**。`core/` の各ファイルは「serialize / hash / objects / dag / merge / sync」と段階で分け、依存は概ね下から上（`merge` は `dag`・`objects` に依存、`sync` は全てを編成）。
- **core の公開境界は `core/index.ts`（barrel）**。他レイヤは個別ファイルでなく barrel 経由で import する。
- **`tests/core/` は `core/`・`model/`・`tests/helpers/` のみに依存する**（不変条件）。実アダプタ（Dropbox/Drive）・store・ui・idb には直接・間接とも依存させない。テスト用 InMemory は `tests/helpers/storage.ts` 経由で供給し、`tests/core` から `src/adapters` を直接 import しない。これが「core は UI 非依存」をテスト側からも保証する。
- `<template>` を基本とし（Phase 0 は `index.html` に集約、複雑化したら `ui/templates/` へ分離）、文字列連結での DOM 生成を禁止（→ [07](./07-state-and-dom.md)・`innerHTML` 不使用）。

## 2.4 関連する不変条件

- 「`core/` は `model/` 以外に依存しない」を §1.5 の ESLint で強制（→ [15](./15-build-deploy-ci.md)）。
- 「`tests/core/` の import 範囲は core+model のみ」をテストの配置と lint で担保。
