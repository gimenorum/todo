# 2026-06-19 期日入力の横幅が効かない不具合を修正（CSS 詳細度 / Issue #48 追随）

## 日付
2026-06-19

## 依頼内容
- v0.4.9 リリース後、実機（iPhone Safari）で「タスクを編集」画面の**期日が横幅いっぱいのまま**で、
  #48 の幅是正が効いていないとの報告（スクリーンショット）。優先度（select）は意図どおり狭くなっている。

## 対応概要
- 原因: CSS の**詳細度**。共有ルール `input[type='date']`（詳細度 0,1,1）の `width: 100%` が、
  追加した `.f-due`（クラス＝0,1,0）の `width: auto` より強く、期日だけ 100% 幅で上書きされていた。
  一方 `.f-priority`（0,1,0）は `select`（0,0,1）に勝つため、優先度は正しく狭くなっていた。
- 修正（`styles/components.css`）: 期日の上書きを `input[type='date'].f-due`（詳細度 0,2,1）に変更し、
  共有ルールに確実に勝たせる。`.f-priority` は据え置き。
- hotfix 扱いのため `package.json` version を 0.4.9 → 0.4.10 に bump。

## 決定事項
- v0.4.9 の #48 対応の積み残し（期日のみ未適用）を hotfix で是正。挙動・データモデルは無変更（CSS のみ）。
- 期日の幅指定はセレクタの詳細度を要素＋クラス＋属性（0,2,1）に上げて共有ルールに勝たせる方針とする。

## 成果物
- 変更: `styles/components.css`
- 変更: `package.json`（version 0.4.9 → 0.4.10）
- 新規: `docs/history/2026-06-19-due-width-specificity-fix.md`（本ファイル）

## 追記（2026-06-19）PR #50 レビュー NG 反映：要件取り違えの是正（狭幅 → フル幅で統一）

### 依頼内容
- PR #50 にオーナーが NG レビュー: 「期日、優先度はタイトルなどほかの入力項目の幅に合わせて下さい」。
- 当初 #48 の「横幅がおかしい」は“狭くしたい”ではなく、**他の入力欄（タイトル/タグ/メモ＝フル幅）と不揃いなのが
  おかしい**という意図だった。これまでの実装（中身相当の狭幅化）は逆方向だったため是正する。

### 対応概要（`styles/components.css` のみ）
- 狭幅化の上書き `input[type='date'].f-due, .f-priority { width:auto; max-width:100%; align-self:flex-start }` を**削除**。
  → 期日・優先度は共有ルール `width:100%` に従い、タイトル等と**同じフル幅**になる。
- `select` の `min-width: 7em`（狭幅前提）を削除。カスタム矢印（`appearance:none` ＋ chevron）は #48 コメント
  （Mac Safari の OS 依存見た目）対策として維持。
- 期日の値を左寄せ（他の左寄せ項目に合わせる）: `input[type='date']::-webkit-date-and-time-value { text-align:left; margin:0 }`。

### 決定事項
- #48 の最終方針は「期日・優先度を**他の入力欄と同じフル幅にそろえる**（＋日付値は左寄せ）」。狭幅化は採用しない。
- バージョンは 0.4.10 のまま（PR #50 未マージ）。本修正は同ブランチ `hotfix/due-width-specificity` に追加コミット。
- 実機 iOS Safari の最終見た目はデプロイ後に要確認。

### 成果物（追記分）
- 変更: `styles/components.css`
