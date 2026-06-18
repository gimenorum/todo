# 05. ストレージアダプタ

> 要件トレース: requirements.md「ストレージアダプタ」「セキュリティ」「受け入れ基準」
> 状態: 実装済（Phase 1：IF+InMemory／Phase 2：Dropbox／Phase 3：Google Drive） ／ 実装フェーズ: 1（IF + InMemory）→ 2（Dropbox）→ 3（Drive）

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
objects/<hash>      … commit / snapshot を兼ねる（内容 SHA-256 / 不変・複数ライタ）
heads/<deviceId>    … advisory HEAD（端末ごと＝単一ライタ。可変。list して先端を再導出できる）
conflicts/<todoId>  … 未解決競合の共有マーカー（可変・複数ライタ。FieldConflict[] の JSON / Issue #29）
```

- `list('objects/')` で全オブジェクト、`list('heads/')` で各端末の HEAD ヒントを列挙。
- **キーの性質（重要）**: `objects/` は不変なので複数端末が書いても無害（同内容）。`heads/` は可変だが
  **端末ごと＝単一ライタ**で衝突しない。`conflicts/<todoId>` は**可変かつ複数端末が同一キーに書く**初の鍵空間で、
  この組み合わせは**同名ファイルを許す保存先（Google Drive appDataFolder）で重複作成を招く**（[§5.5](#)・
  Issue #29 フォローアップ）。アダプタは可変・複数ライタのキーについて**同名重複を 1 つに集約**し、読み取り側
  （`readAllMarkers`）も **(todoId,field) で dedup** して二重表示・データ重複を防ぐ。
- **`conflicts/<todoId>`（Issue #29）**: 未解決競合は自動マージで先端が単一化されるため DAG から再導出できない
  （[04 §4.5](./04-sync-engine.md)）。検出端末が当該 todo の `FieldConflict[]` を JSON で publish し、各端末は
  毎同期で `list('conflicts/')` して読む＝**未解決集合の権威**。解決時に delete して全端末へ伝播する。書き込み・
  読み取り・削除はすべて services 層（[`conflictMarkers`](../../src/services/conflictMarkers.ts)）が担い、core 同期
  エンジンは無変更。`list('objects/')`・`list('heads/')` には現れない別 prefix なので既存の先端導出に影響しない。
- 先端の正は常に**コミット集合からの再導出**（[04 §4.3](./04-sync-engine.md)）。`heads/` はヒント。
- **孤立先端の整合**: `loadCommits` は `heads/` 起点で辿る（[04 §4.6](./04-sync-engine.md)）。`heads/` 未更新の孤立先端は作成端末の次回同期で再 publish されて回収される。即時の peer 回復が要る場合のみ `list('objects/')` を併用して `heads/` を純ヒント化する（list コスト増）。

## 5.3 InMemory アダプタ（Phase 1・テスト用）

- 実体は `Map<string, Uint8Array>`。`list(prefix)` は前方一致。
- `putIfAbsent` を実装し、CAS 高速パスのテストにも使う。
- **遅延整合のシミュレート**（オプション）: `put` 直後に `list` へ反映されない遅延フラグを持たせ、テスト #2/#6 と Drive の一覧遅延整合（要件「ストレージアダプタ」）を現実に寄せる。

> 不変条件: InMemory はネットワークも永続も持たない純メモリ。これにより [16](./16-testing.md) の 6 シナリオが決定的・高速に回る。

## 5.4 Dropbox アダプタ（Phase 2）

- 認可: **PKCE / public client**、アクセスタイプは**アプリ専用フォルダ**（App folder＝最小権限 / 要件「ストレージアダプタ」, 要件「セキュリティ」）。PKCE 実装は `adapters/oauth/pkce.ts`。
- **必要 OAuth スコープ（最小権限）**: `files.metadata.read`（list）／`files.content.read`（download）／`files.content.write`（upload・delete）。`connectDropbox` が認可 URL の `scope` に**明示指定**する（未指定だとアプリの既定権限頼みになり付与漏れの原因になる）。
  - ⚠️ **Dropbox アプリの「Permissions」タブでも同じ権限を有効化（Submit）**しておくこと。有効化されていないとトークンに付与されず、各操作が **403 `missing_scope`** で失敗する。アダプタはこれを検出して `AuthError`（UI: `needs-reauth`＝「要再接続」）として扱い、再連携を促す。`account_info` 等の追加スコープは要求しない。
  - 権限を変更した場合は**いったん切断して再連携**（新しいスコープでトークンを再取得）する必要がある。
- API 対応:

| IF | Dropbox API | 備考 |
|---|---|---|
| `put` | `/files/upload`（mode=overwrite） | 同キー上書きでべき等 |
| `get` | `/files/download` | 404 は `null` |
| `list` | `/files/list_folder`（+ continue） | prefix=フォルダ |
| `delete` | `/files/delete_v2` | |

- **ブラウザ CORS 対策（content エンドポイント＝Dropbox の「cors-hack」）**: `content.dropboxapi.com`（`/files/download`・`/files/upload`）は CORS の **preflight を正しく返さない**。`Dropbox-API-Arg`／`Authorization` などの独自ヘッダや `application/octet-stream`（非安全リスト）Content-Type を付けると preflight が走り、応答に `Access-Control-Allow-Origin` が無く **CORS 失敗**（`TypeError: Failed to fetch`）する（dev・本番とも再現＝「同期エラー」の一因）。対策は Dropbox 公式の **cors-hack ＝ 3 点セットで「単純リクエスト」化**する:
  1. `arg` と `authorization`（値は `Bearer <token>`）を **URL クエリ**で渡す（独自ヘッダを使わない）。
  2. **`reject_cors_preflight=true`** を URL クエリに付ける（無いと URL パラメータ認証が無効になり **401「Invalid authorization value in HTTP header/URL parameter」**）。
  3. **Content-Type（download / upload で要件が異なる）**: **download は付けない**（本文が無く不要。`text/plain; charset=dropbox-cors-hack` を付けると download は **400「Bad Content-Type」** で拒否される。ヘッダ無し＝安全リスト＝preflight 不要）。**upload は `text/plain; charset=dropbox-cors-hack`**（MIME が `text/plain`＝CORS 安全リストで preflight を起こさず、Dropbox は `application/octet-stream` 相当として受理。**無いと upload は 400「Missing or empty HTTP Content-Type header」**）。
  RPC（`api.dropboxapi.com` の `list`/`delete`）は preflight を処理するため**ヘッダ方式のまま**。クエリに載るのは短命のアクセストークンのみ（HTTPS）。**この方式はブラウザ実機診断で確定**（download→**409 path/not_found＝認証 OK**、upload→**200**。生トークンのみ＝400「Invalid authorization value」）。**注意**: 一部ブラウザ（Firefox 等）は `text/plain;charset=…` を書き換えるため cors-hack が効かないことがある（Chromium 系は可）。その場合 upload はヘッダ方式（`Authorization`＋`Dropbox-API-Arg`＋`application/octet-stream`）でも 200 になる（実証済み）ので切替で回避可能。※ `files/get_temporary_link`＋`dl.dropboxusercontent.com` 直リンクは**リダイレクト連鎖で ACAO が付かず fetch 不可**のため代替に使えない。
- **content 操作の 401 リトライ**: `get`/`put` が **401** を返したら、トークンを**強制 refresh して URL を作り直し 1 回だけリトライ**する（`getAccessToken({ forceRefresh: true })`）。一過性のトークン状態（同一 sync で list は通るが content だけ 401）を自己回復する。2 回目も 401 なら `AuthError`（needs-reauth＝要再接続）に落として再連携を促す。
- リダイレクト URI は **`window.location.origin` を基準に動的生成**（オリジン非依存＝決定 #1）。本番オリジンをコードに固定しない。**Dropbox アプリへのリダイレクト URI 登録は Phase 2 にユーザーが実施**。Client ID（App key）は **ビルド時 env `VITE_DROPBOX_APP_KEY`** で供給する（PKCE public client ゆえ秘密ではない。決定 / [18](./18-open-questions.md) #3）。
- トークンは IndexedDB 保持（防御境界でない前提 / 要件「セキュリティ」・[14](./14-security.md)）。

## 5.5 Google Drive アダプタ（Phase 3）

- 領域: **appDataFolder**（アプリ専用・最小権限 / 要件「ストレージアダプタ」）。スコープは `https://www.googleapis.com/auth/drive.appdata` のみ。**追記専用＋一覧で先端導出**。
- 重複回避: **鍵（key）をそのままファイル名**にする（`objects/<hash>`・`heads/<deviceId>`・`conflicts/<todoId>`）。create 前に `files.list?q=name='…'` で存在確認し、`objects/` は内容アドレス指定＝不変なので既存ならスキップ（同名ファイルの**重複作成を避ける**）。`heads/` は可変なので既存ファイルを `media` 更新する。**一覧の遅延整合を許容**（要件「ストレージアダプタ」, 要件「実装フェーズ」）。
- **可変・複数ライタのキー（`conflicts/<todoId>`）の同名重複集約（Issue #29 フォローアップ）**: Drive は**同名ファイルを許可**し `files.list?q=name='…'` は**遅延整合**。各端末は自分の name→id キャッシュしか持たないため、別端末が作成した `conflicts/<todoId>` を検索でまだ発見できず**同名の 2 つ目を新規作成**しうる（`heads/` は端末ごと＝単一ライタなので起きない）。これを放置すると `list('conflicts/')` が同名を複数返し、`readAllMarkers` が同一 `(todoId,field)` を重複返却→ **`meta.conflicts` の二重化・マージ画面の入力欄二重化**（実報告: メモ欄が 2 つ）。対策として、可変・複数ライタのキー（`conflicts/` 接頭辞）では **`put` 時に同名の全 id を取得し先頭を更新・残りを削除して 1 ファイルへ集約**、**`delete` は同名を全削除**する。遅延整合で一瞬重複しても次回の put/delete で収束し、その間も読み取り側の dedup で UI/キャッシュは正しい。
- 認証は **`Authorization: Bearer` ヘッダ**（標準 CORS。Dropbox の cors-hack は不要）。**401 はトークンを強制 refresh して 1 回リトライ**し、なお 401 なら `AuthError`（needs-reauth）。403 のスコープ不足も `AuthError`（要再接続）。

| IF | Drive API | 備考 |
|---|---|---|
| `put` | `files.create`（multipart, parent=appDataFolder）／既存 `heads/` は `files.update`(uploadType=media) | 事前に `name='…'` を `files.list` で確認＝べき等化・重複回避。`conflicts/`（可変・複数ライタ）は同名全 id を取得し先頭更新・残り削除で 1 ファイルへ集約 |
| `get` | `files.get(alt=media)` | 名前→id 解決を挟む（404 は null） |
| `list` | `files.list(spaces=appDataFolder)` | 全件取得→`name.startsWith(prefix)` で絞り。遅延整合あり |
| `delete` | `files.delete` | 名前→id 解決。未存在は冪等 |

### 5.5.1 OAuth＝GIS トークンモデル（設計前提の改訂 / Phase 3）

> **当初想定（[14 §14.1](./14-security.md)「PKCE / public client」）の改訂**: 設計当初は Dropbox 同様の **PKCE public client（リフレッシュトークンで継続）** を想定していたが、**Google は「ウェブ アプリケーション」クライアントだと PKCE でも `client_secret` を要求**し、**バックエンド無しの静的 PWA ではリフレッシュトークンを安全に得られない**。そこで Drive は **Google Identity Services（GIS）のトークンモデル**を採用する（2026-06-18 決定）。

- **方式**: `google.accounts.oauth2.initTokenClient`（外部スクリプト `https://accounts.google.com/gsi/client` を遅延ロード）で **アクセストークンのみ（約 1 時間）** を取得。**リフレッシュトークンは無い**。`client_secret` は使わない（Client ID は public）。実装は `src/adapters/oauth/gis.ts`。
- **更新**: 失効間際/失効後は GIS の **無音再取得（`prompt: ''`）** で取り直す。セッションが切れて無音取得できない場合は `AuthError`→`needs-reauth`（UI で再接続）。＝Dropbox の「失効間際 refresh」に対応するが、手段が refresh token ではなく GIS 再取得（`googleTokenProvider`）。
- **コールバック**: ポップアップで **in-page 完結**するため、Dropbox の `?code=` リダイレクト経路（`completeOAuthRedirect`）は通らない（衝突しない）。
- **Google 側の登録（ユーザーが Phase 3 に実施 / [18](./18-open-questions.md) #4）**: 「ウェブ アプリケーション」OAuth クライアントを作成し、**承認済み JavaScript 生成元**に dev と本番オリジンを登録（**リダイレクト URI ではなく JS 生成元**）。Google Drive API を有効化。Client ID は **ビルド時 env `VITE_GOOGLE_CLIENT_ID`** で供給。設定手順は [`docs/setup-google-drive.md`](../setup-google-drive.md)。

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

## 5.8 アダプタ内キャッシュで差分 push にする（Issue #27 / 性能）

同期 1 回の体感の遅さは、コア同期エンジン（[04](./04-sync-engine.md) `pushReachable`）が到達可能な全 object を毎回 `put` し直すこと自体ではなく、**アダプタの「1 操作あたりのネットワーク往復」が過大**なことが主因だった。`StorageAdapter` IF とコア同期エンジン（収束ロジック）は**不変**のまま、各アダプタ内部のキャッシュだけで「差分のみ」に縮める（収束テストの回帰リスクを負わない）。

- **Google Drive — name→id キャッシュ**（`idCache: Map<name, fileId>`）。Drive の fileId は不変で `heads/` も PATCH で id 据え置きのため安全。
  - `list()` は取得した**全ファイル**（prefix フィルタ前）を `idCache` に入れる。同期開始の `list('heads/')` は q 無しの全件取得なので、**全 object の id がここで無料でウォーム**される。
  - `findId()` はキャッシュ命中なら即返し、ミス時のみネットワーク検索（`q=name='…'`）して結果をキャッシュ。⇒ `get` は 2→1 リクエスト、既存 `objects/` の `put` は 0 リクエストでスキップ。
  - `createMultipart()` は作成 id を、`delete()` は除去をキャッシュへ反映。ミスは常にネットワークへフォールバックするため**正しさは保持**（重複作成防止の現挙動も維持）。
- **Dropbox — 既知 object 集合**（`knownObjects: Set<key>`、事前 list は使わない）。`objects/*` は内容アドレス指定＝不変。
  - `put(key)`: `key` が `objects/` 始まりかつ既知なら**アップロードを省略**。実アップロード成功後に集合へ追加。`heads/*` は可変なので**常にアップロード**。
  - `get(key)`: 非 null（=サーバに在る）の `objects/*` を集合へ追加。`delete(key)`: 集合から除去。
  - 集合は pull の `get` と最初の `put` で自然に育ち、同一セッションの 2 回目以降の同期は既存 object を 0 アップロードでスキップ。`objects/*` は不変かつエンジンは削除しないため**偽陽性は起きない**（集合に無ければ必ずアップロード＝フォールバック安全）。
- 観測結果（store 状態）は不変なので契約テストはそのまま緑。往復削減は呼び出し回数の回帰防止テストで固定する（Drive: ウォーム後に `q=name` を出さない／Dropbox: 同一 `objects/*` の 2 回目 `put` で `files/upload` を出さない）。
