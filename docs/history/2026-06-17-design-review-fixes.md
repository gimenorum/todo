# 2026-06-17 設計レビュー結果の設計書反映

## 日付
2026-06-17

## 依頼内容
- `design/todo-pwa` 上の設計書一式に対するレビュー結果を、設計ドキュメントの修正として反映する（実装は Phase 0 着手前のため行わない）。
- 最優先（①②⑤）と整合・健全性（③④⑦）、および軽微指摘。各修正に伴い相互参照・18-open-questions・各章「不変条件」表・README を整合。
- 追加調整: ⑦ は本文中の行番号参照も含め完全アンカー化（live ドキュメントのみ。history は不改変）／② は hash/blob 限定（Commit 型は deviceId 必須のまま serializeCommit のみ分岐）／③ は極大共通祖先の判定を擬似コードで具体化。

## 対応概要
- **① tags の集合 3-way（バグ修正）**: `04 §4.5` に値等価 `valueEq`（配列＝要素集合）と `mergeSet` を導入し、`mergeTodo` で tags を集合マージへ分岐。`03 §3.4` の `FieldConflict` 値型表から tags を除外。`16` に tags 集合マージの単体テストを追加。
- **② マージコミットの決定化（収束）**: `04 §4.1` の `serializeCommit` を parents 数で分岐し、parents≥2 の blob は deviceId 非格納・timestamp=親最大に。`§4.2` に「取得 blob をそのまま再ハッシュ＝齟齬なし／deviceId は blob 外」を明記。`03 §3.3`/`00 用語集` に注記。`§4.6` のマージコミット生成・不変条件に収束を反映。`16` に収束テストを追加。
- **③ LCA は極大共通祖先**: `04 §4.4` の `ancestors` を集合化（depth 廃止）、`lca` を極大共通祖先（他の共通祖先の祖先を除外）＋ `(timestamp, hash)` tie-break に。時計ずれ・計算量の注記を追加。
- **④ heads/ ロードと回復の整合**: `04 §4.6` の回復記述を「孤立先端は作成端末の再 publish で回収（objects/ 走査は代替）」に修正し、`05 §5.2`・`06 §6.4` に整合注記。
- **⑤ requirements デプロイ節**: 本番オリジン固定をやめ、オリジン非依存（manifest 相対・OAuth は window.location.origin・CSP は保存先＋'self'）に修正。テスト#5 を「競合検出（編集版を残す／削除を適用）」に。
- **⑦ 要件トレースの完全アンカー化**: live ドキュメント（design 全章・requirements）の行番号参照（L◯◯）をすべて requirements のセクション名参照へ置換（本文・トレース見出し・不変条件表・README サマリ・00 索引・18）。`docs/history/` は不改変。
- **軽微**: `13 §13.2` インポートを no-base recency に修正、`SyncResult.picked` を `04 §4.6` 戻り値へ、`merge3NoBase`/`resolveNoBase` に命名統一、`reachableFrom` の snapshot blob 注記、`14 §14.2` に暗号化×内容アドレスの注記。
- `18` に「18.4 レビュー反映による設計改訂」を追記。

## 決定事項
- マージ対象の配列フィールド（tags）は集合 3-way で自動マージし、競合に出さない。
- マージコミットは blob から deviceId を除外・timestamp は親最大＝決定的にし、同時同期でも単一先端へ収束させる（deviceId が要る場合は blob 外サイドカー）。
- LCA は極大共通祖先を `(timestamp, hash)` で一意化。時計ずれ時は無用競合があり得るが収束・非消失は保つ。
- 孤立先端は作成端末の再 publish で回収（heads/ 起点ロードに整合。即時 peer 回復は objects/ 走査が代替）。
- 本番オリジンは固定せずオリジン非依存。要件本文もこれに合わせる。
- 設計書の要件参照は行番号でなくセクション名（live ドキュメントのみ。履歴は不改変）。

## 成果物
- 更新（設計書）: `docs/design/00`〜`18`（README 含む）の該当章、特に `03`/`04`/`05`/`06`/`13`/`14`/`16`/`18`。
- 更新（要件）: `docs/requirements.md`（デプロイ節・テスト#5）。
- 新規（証跡）: `docs/history/2026-06-17-design-review-fixes.md`（本履歴）。
