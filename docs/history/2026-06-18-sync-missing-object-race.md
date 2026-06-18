# 2026-06-18 自動同期の「同期エラー」を解消（部分書き込みレース / v0.2.1）

## 日付
2026-06-18

## 依頼内容
- ローカル版（localhost）と公開版（GitHub Pages）で相互に同期チェック中、「片方でタスクを編集すると、
  もう片方で『同期エラー』と表示される。手動同期は問題なく動く」。**0.2.1 として修正**してほしい。

## 対応概要
- **原因（部分書き込みレース）**: 同期は content-addressed で commit / snapshot / head を**別々の PUT**で書く
  （オブジェクト先・HEAD 最後）。Dropbox 等はファイル間の可視化順序を保証しないため、別端末（A）の push 途中に
  自動 pull（既定 `autoSyncMode='interval'`／5 分）を走らせた端末（B）が「head・commit は見えるが snapshot blob は
  未着」の瞬間を踏み得る。`loadRemoteCommits` は欠落コミットを既にスキップ（孤立先端→無害）するのに対し、
  **`snapshotOf` だけが snapshot blob 欠落で throw** していた → 汎用 `error` に落ち「同期エラー」。しかも `error` は
  次の成功まで**stickする**ため、一度踏むと最大 5 分表示が残る。手動同期は伝播完了後に走るので成功する（症状と一致）。
- **修正（pull をリモート未伝播に対して寛容化）**:
  - `src/core/sync.ts`: 回復可能エラー `MissingObjectError`(hash, kind) を追加。`snapshotOf` は snapshot blob が
    リモートに無いとき（`adapter.get` が null）これを投げる。`resolveSnapshotTolerant` で捕捉して「未伝播の先端」を
    **除外**。`syncOnce` は先端解決を寛容化し、(a) 解決できた先端が無ければローカル据え置きで no-op、(b) 1 つなら従来どおり、
    (c) 複数なら解決できた先端だけで畳み込み（base の snapshot 未着時はその先端を次回に回す）。`verify` 失敗・内部不整合は
    対象外＝従来どおり投げる。
  - `src/core/index.ts`: `MissingObjectError` を公開。
  - `src/services/SyncService.ts`: 防御的に `MissingObjectError` を idle 扱い（`console.debug`）。通常は `syncOnce` 内で
    握りつぶされ throw されないが、二重の安全網として受ける。
- **テスト**:
  - `tests/core/scenarios.test.ts`: 「相手先端の snapshot 未着 → throw せず据え置き、伝播後に取り込む」「自端末の編集を
    保持しつつ未伝播の相手先端だけ次回に回す」の 2 本（`adapter.delete(objKey(snapshot))` でレースを再現）。
  - `tests/services/syncService.test.ts`: 「相手先端の snapshot 未伝播でも『同期エラー』にせず idle」（status=idle・未取り込み →
    伝播後に materialize）。
- 設計書 `docs/design/04-sync-engine.md` §4.6 不変条件に「未伝播の先端を握りつぶす（部分書き込みレース）」を追記、
  §4.8 表に 1 行追加。

## 決定事項
- リリース版（公開版）に影響する不具合のため **`hotfix/sync-missing-object-race`（main から分岐）** で対応し、
  PATCH `0.2.1` に上げる（ch.15 §15.3「フェーズ途中/後のバグ修正は hotfix で PATCH」）。main 反映後に develop へ取り込む。
- 寛容化の対象は **「リモートにオブジェクトがまだ無い」場合のみ**。改竄/破損（`verify` 失敗）や内部不整合は引き続き
  surfaced（握りつぶさない）。
- 書き込み順序（snapshot を commit より先に PUT 等）の入れ替えは**今回は見送り**。読み手側の寛容化だけで
  ユーザー可視の不具合（「同期エラー」固着）は解消し、収束する。将来のウィンドウ縮小策として注記に留める。

## 成果物
- 変更: `src/core/sync.ts`、`src/core/index.ts`、`src/services/SyncService.ts`、`package.json`（0.2.0→0.2.1）、
  `docs/design/04-sync-engine.md`
- テスト: `tests/core/scenarios.test.ts`、`tests/services/syncService.test.ts`
- 新規: `docs/history/2026-06-18-sync-missing-object-race.md`（本ファイル）
