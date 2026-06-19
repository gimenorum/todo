# 2026-06-19 画面初期表示の固着を修正（Issue #63）

## 日付
2026-06-19

## 依頼内容
- Issue #63「画面初期表示がうまくいかないことがある」（v1.0.0 / Safari Mac）を対応してほしい。
- 本人ヒアリングで確定した症状: 設定画面で **「読み込み中…」のまま固まる**、**再読込で直る**、間欠的。
  再現条件は「アプリのアップデート直後」または「クラウド連携を初めて行ったとき」。

## 対応概要
- 真因を特定: `main.ts` の `bootstrap()` は画面マウント（`aria-busy` 解除）の手前で
  `getDb()`＝`openDB()` を await する。**この IndexedDB オープンがハング（resolve も reject もしない）すると
  「読み込み中…」のまま固着**する（reject なら catch されて「再読込してください」画面になるため固着しない）。
  Issue 本文「直近のエラー: なし」＝ JS 例外ではない点とも整合。
  - 背景: WebKit のナビゲーション直後の初回 IndexedDB オープンが稀に応答しない／`DB_VERSION` 更新時に
    別タブ接続が upgrade を `blocked` する、等（いずれも再読込で解消＝報告と一致）。
- `src/store/db.ts` をハング耐性のあるオープンに変更:
  - `openDB` に `blocked`/`blocking`/`terminated` ハンドラを追加（`blocking` で自接続を閉じて相手の upgrade を通す）。
  - `openWithTimeout(open, 4000ms, 3回)` を新設。各試行をタイムアウトで打ち切って再試行し、
    遅延解決した接続は `close()` でリーク防止。全試行時間切れなら reject（→ 回復可能なエラー画面へ）。
  - `getDb()` は失敗時に `dbPromise=null` へ戻し、後続呼び出しで再試行可能にする。
  - 既存の `upgrade`・スキーマ・`STORE` キーは不変。
- テスト `tests/store/db.test.ts` に `openWithTimeout` の単体（即解決／ハング→再試行で解決／全ハングで reject／
  打ち切った接続を閉じる）を追加。既存 v2 スキーマ検証は維持。

## 決定事項
- 症状はクラッシュではなく「ブート前の IDB オープンでの無限待ち」と判断し、**オープンの堅牢化**に絞って対応。
- Service Worker の stale shell（`cache-strategies.ts`）は「古いが動くアプリ」になり“固着”にはならないため**今回スコープ外**（必要なら別 Issue）。
- OAuth コールバックが初回描画より後に走る件も別事象としてスコープ外。
- タイムアウト 4s × 3 回（最大 ~12s で回復可能エラーへ）を既定とする。

## 成果物
- 変更: `src/store/db.ts`、`tests/store/db.test.ts`、`docs/design/06-local-store.md`。
- 追加: 本履歴ファイル。
- 検証: `npm run typecheck` / `lint` / `test` / `build`（緑）。
