# 04. 同期エンジン（core）

> 要件トレース: requirements.md「同期エンジン仕様」「受け入れ基準」「テストすべき並行シナリオ」
> 状態: 実装済（Phase 1） ／ 実装フェーズ: 1（最重要・先行完成）

本章はプロジェクトの中核。`core/` の各関数を「入出力／不変条件／計算量／擬似コード／対応テスト番号」で記述する。
**擬似コードの粒度**: 不変条件と分岐網羅は明示し、データ構造操作の些末は省略する（実 TS は書かない）。

関数構成（依存は下から上）:

```
serialize.ts → hash.ts → objects.ts → dag.ts → merge.ts → sync.ts
```

## 4.1 決定的シリアライズ（serialize.ts）

内容アドレス指定の土台。**同内容は必ず同バイト列**になるよう正規化する（要件「同期エンジン仕様」）。

方針:
- JSON ベース。ただし **オブジェクトのキーを辞書順にソート**。
- `Snapshot.todos` は **id 昇順の配列**に変換（[03 §3.3](./03-data-model.md) の二重表現）。
- 数値は有限値のみ許可（`NaN`/`Infinity` は禁止＝投げる）、`-0` は `0` に正規化。
- `undefined` フィールドは除去。
- UTF-8 で `Uint8Array` 化。
- 正規形に **スキーマバージョン `v`** を埋め込む（将来のフォーマット変更で blob 不変性を保つ）。

```
canonicalize(value):
  if value is array:  return value.map(canonicalize)
  if value is object: out = {}; for k in sortKeysAsc(value):
                        if value[k] !== undefined: out[k] = canonicalize(value[k])
                      return out
  if value is number: assert isFinite(value); return value === 0 ? 0 : value   // -0 → 0
  return value                                                                 // string/bool/null

serializeSnapshot(snap):
  arr = sortBy(values(snap.todos), t => t.id).map(canonicalize)
  return utf8Encode(JSON.stringify({ v: 1, kind: 'snapshot', todos: arr }))
```

### コミットの直列化（通常／マージで分岐）

**マージコミット（parents≥2）の blob は入力の純関数**にする＝`deviceId` を blob に入れず、`timestamp` は親 timestamp の最大で決定的に導出する。これにより 2 端末が同じ先端を各自マージしても**同一バイト列＝同一ハッシュ**になり、dedup されて単一先端に収束する（§4.6・収束の核心）。通常コミット（単一親）は従来どおり `deviceId`/`timestamp` を含めてよい（マージ合戦は主にマージコミットで起きるため）。

```
serializeCommit(commit, parentTimestamps):
  base = { v:1, kind:'commit', parents: sortAsc(commit.parents), snapshot: commit.snapshot }
  if commit.parents.length >= 2:                 // マージ＝決定的（deviceId は blob に入れない）
    body = { ...base, timestamp: max(parentTimestamps) }
  else:                                          // 通常コミット
    body = { ...base, timestamp: commit.timestamp, deviceId: commit.deviceId }
  return utf8Encode(JSON.stringify(canonicalize(body)))
```

> 不変条件: `serialize(x)` はキー順・プロパティ挿入順に依存しない（同値オブジェクト→同バイト列）。**マージコミット blob は `parents`＋`snapshot` の純関数**（deviceId 非格納・timestamp=親最大）。対応テスト: serialize 決定性テスト・収束テスト（[16](./16-testing.md)）。

## 4.2 ハッシュと再ハッシュ検証（hash.ts）

```
hash(bytes):           // SHA-256 → 64 桁 hex 小文字
  return toHex(await crypto.subtle.digest('SHA-256', bytes))

verify(key, bytes):    // 読み込み時の整合性検証（要件「同期エンジン仕様」・受け入れ基準）
  if hash(bytes) !== key: throw IntegrityError(key)
```

> 不変条件: ストレージから取得した全 blob は **使用前に再ハッシュ検証**する。不一致なら `IntegrityError` を投げ、その blob は捨てて再取得する。
> **`verify` は取得した blob バイト列をそのまま再ハッシュ**して key と照合する（`Commit` オブジェクトから再直列化しない）。マージコミットの blob には `deviceId` が無いため、検証で齟齬は生じない。**`deviceId` はハッシュ/blob から除外**し、保持が必要なら content-addressed blob の外（メモリ上の `Commit` またはローカルメタのサイドカー）に置く（§4.1・[03 §3.4](./03-data-model.md)）。対応テスト: 再ハッシュ検証テスト（改竄バイト列で `IntegrityError`／マージコミット blob も対象）。

## 4.3 先端導出（dag.ts）

「どのコミットの親でもないコミット」を先端とする（要件「同期エンジン仕様」）。**advisory HEAD は使わずに**コミット集合から常に再計算できる＝CAS 非依存の核心（受け入れ基準）。

```
deriveHeads(commitMap):                 // commitMap: Map<Hash, Commit>
  referenced = ∅
  for c in commitMap.values: referenced ∪= c.parents
  return [ h for h in commitMap.keys if h ∉ referenced ]
```

計算量 O(N + E)（N=コミット数, E=親参照数）。

> 先端が 0 個＝空、1 個＝単線、2 個以上＝fork（分岐、§4.5 へ）。対応テスト: #2（fork）, #6（古い状態からの上書き）。

## 4.4 祖先探索と LCA（dag.ts）

2 先端の最近共通祖先を求める。**到達可能性（祖先集合）**で極大共通祖先を選ぶ。

```
ancestors(head, commitMap):            // 自身を含む祖先集合（depth は持たない）
  seen = ∅; stack = [head]
  while stack: h = pop(stack)
    if h ∈ seen: continue
    seen.add(h)
    for p in commitMap[h].parents: push(stack, p)
  return seen                           // Set<Hash>

lca(a, b, commitMap):
  A = ancestors(a, commitMap); B = ancestors(b, commitMap)
  common = A ∩ B
  if common is empty: return null        // → §4.5 のフォールバック（merge3NoBase）
  // 極大共通祖先: 他の共通祖先 D が存在して C ∈ ancestors(D) なら C を除外
  maximal = [ C in common
              if not ∃ D in common where D ≠ C and C ∈ ancestors(D, commitMap) ]
  // 残った極大集合の中で全順序の tie-break
  return argmax(maximal, key = C => [ commitMap[C].timestamp, C ])  // (timestamp, hash)
```

計算量: 極大判定で共通祖先ごとに `ancestors` を引くため O(k·(N+E))（k=共通祖先数）。

> **決定性の要**: 交差マージ（criss-cross）で極大共通祖先が複数あり得る。tie-break を `(timestamp, hash)` の全順序に固定し、端末順・取得順に依存させない。`common` が空（系統が異なる）なら `null` を返し、§4.5 でフィールド単位フォールバックに落とす。
> **時計ずれの注記**: これは「timestamp 上で最も新しい極大共通祖先」であり位相的に一意な LCA とは限らない。時計が大きくずれた環境では最良でない base を選び**無用な競合**が出得るが、**決定性・収束・データ非消失は保たれる**（tie-break が hash を含むため timestamp 欠落でも一意）。

## 4.5 フィールド単位 3-way マージ（merge.ts・中核中の中核）

base = LCA のスナップショット、left/right = 各先端のスナップショット。**TODO ごと × フィールドごと**に判定する（要件「同期エンジン仕様」）。

### 値等価とスカラの決定表

比較は参照比較（`==`）でなく**値等価ヘルパ `valueEq`** を使う（配列＝要素集合の等価、プリミティブ＝厳密等価）。これが無いと配列フィールド（tags）が毎回「変化」と判定され誤って競合化する。

```
valueEq(x, y):
  if x and y are arrays: return asSet(x) == asSet(y)   // 要素集合で比較
  return x === y                                       // プリミティブは厳密等価
```

`b/l/r` = base/left/right のそのフィールド値。スカラフィールド（tags 以外）の判定:

| base→left | base→right | 結果 |
|---|---|---|
| 不変 | 不変 | base（変化なし） |
| 変化 | 不変 | **left を自動採用** |
| 不変 | 変化 | **right を自動採用** |
| 変化（`valueEq(l,r)`） | 変化（同値） | その値（実質非競合） |
| 変化（`!valueEq(l,r)`） | 変化（異値） | **競合** → `FieldConflict` に積む。`mergedSnapshot` には暫定で left を保持 |

```
mergeField(b, l, r, field, todoId):
  if valueEq(l, r):          return { value: l, conflict: null }     // 両側同値（不変含む）
  if valueEq(l, b):          return { value: r, conflict: null }     // right だけ変化
  if valueEq(r, b):          return { value: l, conflict: null }     // left だけ変化
  // 両側が base と異なり、かつ互いに異なる → 競合
  return { value: l, conflict: { todoId, field, base: b, left: l, right: r } }
```

### 集合フィールド（tags）の 3-way（competing しない）

`tags` は**集合 3-way**で自動マージし、**競合に出さない**（確定 / [18 #7](./18-open-questions.md)）。base からの「追加」は和、「削除」は反映する。

```
mergeSet(b, l, r):                       // b/l/r は配列（集合とみなす）。常に competing なし
  B = asSet(b ?? []); L = asSet(l); R = asSet(r)
  added   = (L − B) ∪ (R − B)            // どちらかが足したもの
  removed = (B − L) ∪ (B − R)            // どちらかが消したもの
  return sortedArray((B ∪ added) − removed)
```

### TODO の存在（add / edit / delete）

`deleted`（tombstone）も `TodoField` の一つ（[03 §3.2](./03-data-model.md)）。存在の組み合わせ:

| left | right | 規則 |
|---|---|---|
| 追加（base に無い） | 無し | left を採用（別項目は自動 / 要件「同期エンジン仕様」） |
| 無し | 追加（base に無い） | right を採用 |
| 同 id を両側で新規追加（base 無し） | — | base を「空 Todo 相当」としてフィールド 3-way |
| edit（**alive 側に内容編集あり**） | delete（`deleted: true`） | **`deleted` の競合**として扱う（自動解決しない）。暫定は alive（編集版を残す＝一覧から消さない）。UI は「編集版を残す／削除を適用」の二択（[10](./10-conflict-ui.md)） |
| delete | 未編集（alive 側に内容編集なし） | **削除を自動適用**（片側だけが `deleted` を変更＝通常の片側変更。競合にしない） |
| resurrect（base が `deleted`） | 未編集（削除のまま） | **復活を自動適用**（片側変更。競合にしない） |
| delete | delete | 削除（tombstone を残す） |
| edit | edit | フィールドごとに下記分岐 |

```
SET_FIELDS     = { 'tags' }                       // 集合マージ対象
CONTENT_FIELDS = TodoField − { 'deleted' }        // 内容フィールド（deleted は存在/削除の別扱い）

mergeTodo(b, l, r):
  // どちらかが存在しない（base にも無い純粋追加）は上表で確定
  // 両側に存在する場合（b は無くてもよい）:
  out = {}; conflicts = []
  // 1) 内容フィールド（deleted 以外）を 3-way
  for f in CONTENT_FIELDS:
    if f in SET_FIELDS:
      out[f] = mergeSet(b?[f], l[f], r[f])          // 競合を生まない（tags）
    else:
      res = mergeField(b?[f], l[f], r[f], f, id)
      out[f] = res.value
      if res.conflict: conflicts.push(res.conflict)
  // 2) deleted を決定（edit vs delete のみ競合 / 片側変更は自動採用）
  bd = b?.deleted ?? false
  if l.deleted == r.deleted:
    out.deleted = l.deleted                         // both tombstone / both alive
  else:
    alive = (l.deleted ? r : l)                     // deleted=false の側
    if contentChangedVsBase(b, alive):              // alive 側に内容編集あり＝ edit vs delete
      out.deleted = false                           // 編集版を残す（一覧から消さない）
      conflicts.push({ todoId: id, field: 'deleted', base: bd, left: l.deleted, right: r.deleted })
    else:                                           // delete / resurrect vs 未編集
      out.deleted = (l.deleted != bd ? l.deleted : r.deleted)   // base から変化した側を自動採用
  // メタはタイブレーク用に最大を採る（競合対象にしない）
  out.version   = max(l.version, r.version)
  out.updatedAt = max(l.updatedAt, r.updatedAt)
  out.createdAt = b?.createdAt ?? min(l.createdAt, r.createdAt)
  out.order     = l.order    // v1 未使用のため left 据え置き
  return { todo: out, conflicts }

// alive 側が base から内容（deleted 以外）を変えたか。base 不在は新規＝編集とみなす（安全側）
contentChangedVsBase(b, side):
  if b is null: return true
  return ∃ f in CONTENT_FIELDS: not valueEq(b[f], side[f])

merge3(base, left, right):
  result = {}; conflicts = []
  for id in union(ids(base), ids(left), ids(right)):
    { todo, conflicts: fc } = mergeTodo(base[id], left[id], right[id])
    result[id] = todo; conflicts ∪= fc
  return { mergedSnapshot: { todos: result }, conflicts }
```

> 不変条件: `tags` は `mergeSet` を通るため **`FieldConflict` には現れない**（[03 §3.4](./03-data-model.md) の値型表から除外）。スカラのみが競合し得る。対応テスト: #3（別フィールド自動）, #4（同フィールド競合）, tags 集合マージテスト（[16](./16-testing.md)）。

### LCA が取れない場合のフォールバック（merge3NoBase）

`lca(...) == null`（系統が異なり base が無い）のとき、フィールド単位 3-way はできない。TODO 全体を **`(version 大, 次点 updatedAt 大)`** で side 採用する。スナップショット版を `merge3NoBase`、その per-todo 版を `resolveNoBase` と呼ぶ（§4.6 から `merge3NoBase` を使用）。

```
resolveNoBase(l, r):                     // per-todo
  if l is null: return r
  if r is null: return l
  if l.version != r.version:     return l.version > r.version ? l : r
  if l.updatedAt != r.updatedAt: return l.updatedAt > r.updatedAt ? l : r
  return l.id <= r.id ? l : r            // 全順序の最終 tie-break（決定性）

merge3NoBase(left, right):               // snapshot 全体に resolveNoBase を適用
  result = {}
  for id in union(ids(left), ids(right)):
    result[id] = resolveNoBase(left[id], right[id])
  return { mergedSnapshot: { todos: result }, conflicts: [] }
```

### 設計判断（確定）

- **edit vs delete**（確定 / [18 #6](./18-open-questions.md)）: 「削除を勝たせる」のでなく **`deleted` フィールドの競合**として扱う。**ただし競合化するのは「片側が削除・他方が内容編集」の場合のみ**。片側が削除しもう片側が当該 TODO を未編集なら、通常の片側変更として **削除を自動適用**する（同様に「復活 vs 未編集」は復活を自動適用）。これにより無用な競合を避けつつ、編集が削除で黙って消える事態を防ぐ。競合時の暫定は **alive（編集版）を保持**（一覧から消さない・hash 順非依存）。UI は **「編集版を残す／削除を適用」の二択**（[10](./10-conflict-ui.md)）。根拠＝受け入れ基準「黙って失われない」に最も忠実。対応テスト: #5、削除 vs 未編集の自動適用テスト（[16](./16-testing.md)）。
- **tags（配列）**（確定 / [18 #7](./18-open-questions.md)）: **集合 3-way**（`mergeSet`）。単純値比較だと並びの違いで無用な競合が出るため採らない。
- **LCA tie-break**（確定 / [18 #8](./18-open-questions.md)）: 極大共通祖先を `(timestamp, hash)` の全順序で一意化（§4.4）。
- **メタ（version/updatedAt）**: 競合対象にせず最大値を採る。タイブレーク専用。

## 4.6 sync 本体と書き込み順序（sync.ts / services）

要件「同期エンジン仕様」：**オブジェクトを先に書き、advisory HEAD 更新は最後**。途中失敗は孤立オブジェクトが残るだけ（無害・GC 可）。

`loadCommits` は **`heads/` 起点（＋ローカル複製）**でコミットを集める（[05 §5.2](./05-storage-adapter.md)・[06](./06-local-store.md) と一貫）。各 blob は `verify` で再ハッシュ検証（§4.2）。

```
syncOnce(adapter, local):
  // 1) コミット集合を集める（heads/ を起点に親を辿る＋ローカル複製。各 blob は verify）
  remote = loadCommits(adapter)
  all    = merge(local.commits, remote)
  heads  = deriveHeads(all)                       // §4.3（advisory HEAD は使わない）

  picked = null
  // 2) 先端が 1 つ以下ならマージ不要
  if heads.length <= 1:
    target = heads[0] ?? local.head
  else:
    // 3) 2 先端をマージ（3 つ以上は先端ソート順に 2 つずつ畳み込み）
    base = lca(heads[0], heads[1], all)
    snaps = { b: base ? snapshotOf(base) : null, l: snapshotOf(heads[0]), r: snapshotOf(heads[1]) }
    { mergedSnapshot, conflicts } = base ? merge3(snaps.b, snaps.l, snaps.r)
                                         : merge3NoBase(snaps.l, snaps.r)     // §4.5 フォールバック
    picked = { base, left: heads[0], right: heads[1] }
    // マージコミットは決定的: deviceId を入れず、timestamp = 親 timestamp の最大（§4.1）
    snapHash = await adapter.put(objKey(hash(serializeSnapshot(mergedSnapshot))), ...)         // ① オブジェクト先
    mergeCommit = { parents: heads, snapshot: snapHash }
    target = await adapter.put(objKey(hash(serializeCommit(mergeCommit, timestampsOf(heads)))), ...)

  // 4) target から到達可能な未送信オブジェクトを push（put はべき等）
  await pushReachableObjects(adapter, reachableFrom(target, all))   // ② べき等
  // 5) advisory HEAD は最後（ヒントの更新＝heads/ 配下）
  await writeAdvisoryHead(adapter, target)                          // ③ 最後
  // newHead は同期後の先端（target）。マージ有無は picked（マージ時のみ非 null）で判定する。
  return { mergedSnapshot, newHead: target, conflicts, picked }
```

`reachableFrom(target, all)` は target から辿れる **commit 群＋それぞれの snapshot blob** を含む（commit だけでなく参照する snapshot も push 対象）。

> 不変条件:
> - `put` は **べき等**（同キー＝同内容なので再実行しても安全）。
> - **マージコミット blob は `parents`＋`snapshot` の純関数**（deviceId 非格納・timestamp=親最大 / §4.1）。よって 2 端末が同じ fork を各自マージしても**同一ハッシュに dedup**され、同時同期でも**単一先端へ収束**する（マージ合戦が起きない）。
> - **孤立先端の回復**: オブジェクトは書けたが `heads/` 未更新の先端は、`heads/` ベースのロードでは他端末から即座には見えない。これは**作成端末の次回同期でローカル複製から再導出・再 publish して回収**される。その端末が失われた場合は未 publish 扱いで許容（advisory HEAD 未前進＝確定データの消失なし）。
>   - 代替: 即時の peer 回復が要るなら `loadCommits` で `list('objects/')` も併用し `heads/` を純ヒント化できる（list コスト増）。
> - **未伝播の先端を握りつぶす（部分書き込みレース）**: 別端末は commit / snapshot / head を**別々の PUT** で書き、保存先はファイル間の可視化順序を保証しない（Dropbox 等の eventual consistency）。pull がその途中を踏み「head・commit は見えるが snapshot blob は未着」の瞬間に当たると、その先端の `snapshotOf` は **`MissingObjectError`（回復可能）** を投げる。pull 側はこれを**捕捉してその先端を除外**し（「同期エラー」として表に出さない）、ローカルを据え置いて**次回 pull で取り込む**（`loadRemoteCommits` の孤立先端スキップと同方針）。base（共通祖先）の snapshot 未着時も同様に当該マージを次回に回す。`verify` 失敗（改竄/破損）や内部不整合はこの寛容化の対象外＝従来どおり投げる。手動同期は伝播完了後に走るため成功する。
> - 3 先端以上は「2 つずつ畳み込み」で順に解消（畳み込み順は先端集合のソート順に固定して決定性を保つ）。

## 4.7 GC / squash（Phase 6・方針のみ）

要件「同期エンジン仕様」：履歴は残す。オフライン端末が親として参照し得るコミットは消さない。サイズが問題のときだけ古い履歴を base に squash し、**孤立 blob のみ** GC。

- 到達可能集合 = 全先端から辿れる commit/snapshot。**それ以外の blob だけ**が GC 候補。
- squash = 古い履歴を 1 つの base コミットに畳み、古い parents を切り離す（他端末未取り込みのリスクに注意書きを添える）。
- Phase 6（任意）のため擬似コード粒度は低めとし、実装時に詳細化する。

## 4.8 不変条件まとめ（受け入れ基準との対応）

| 不変条件 | 根拠（要件 / 受け入れ基準） | 担保する節 |
|---|---|---|
| 同内容→同ハッシュ（決定的シリアライズ） | 要件「同期エンジン仕様」 | §4.1 |
| マージコミットは決定的＝同時同期でも単一先端へ収束 | （設計／②） | §4.1, §4.6 |
| 読み込み時に再ハッシュ検証（deviceId は blob 外） | 受け入れ基準 | §4.2 |
| 先端はコミット集合から再導出（CAS 非依存） | 受け入れ基準 | §4.3, §4.6 |
| 未伝播の remote オブジェクトは pull で握りつぶす（同期エラーにしない・次回収束） | （設計／部分書き込みレース対策 0.2.1） | §4.6 |
| 同一フィールド両側別値のみ競合・自動解決しない | 要件「同期エンジン仕様」・受け入れ基準 | §4.5 |
| 別項目／片側変更・tags は自動両立 | 要件「同期エンジン仕様」・受け入れ基準 | §4.5 |
| オブジェクト先・HEAD 後（途中失敗は無害） | 要件「同期エンジン仕様」 | §4.6 |
| tie-break は全順序で決定的 | （設計） | §4.4, §4.5 |
