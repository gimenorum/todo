# 2026-06-17 設計判断の確定を設計書へ反映

## 日付
2026-06-17

## 依頼内容
- `docs/design/18-open-questions.md` に残していた要決定事項について、ユーザーが決定を確定。これを設計書へ反映する。
  - #1 本番オリジン: 固定せず**オリジン非依存**で実装（manifest 相対 `scope`/`start_url`、OAuth は `window.location.origin`、CSP は保存先ドメイン＋`'self'`）。リダイレクト URI 登録は Phase 2/3 にユーザーが実施。
  - #6 edit vs delete: `deleted` をフィールド競合として扱う。競合 UI は「**編集版を残す／削除を適用**」の二択。
  - #7 tags: 集合 3-way。
  - #8 LCA tie-break: `(timestamp, hash)` の全順序。
  - #9 既定値: 自動同期 pull = 5 分、編集後 push デバウンス = 2 秒。

## 対応概要
- 一時ブランチ `design/todo-pwa` 上で、以下の設計書を更新。
  - `12-pwa-sw-csp.md`: manifest を相対・オリジン非依存に。CSP を「保存先 FQDN＋`'self'`（自オリジンは `'self'` で吸収）」に。
  - `05-storage-adapter.md`: Dropbox/Drive の OAuth リダイレクトを `window.location.origin` 基準に。登録は Phase 2/3 にユーザー。
  - `15-build-deploy-ci.md`: Vite `base` を相対（`./`）＝オリジン/サブパス非依存に。
  - `04-sync-engine.md` §4.5: edit vs delete・tags・LCA tie-break を「推奨→確定」に。edit vs delete の UI 二択を明記。
  - `10-conflict-ui.md`: edit vs delete を「編集版を残す／削除を適用」の二択として明記（Phase 2 暫定・Phase 4 本実装とも）。
  - `11-sync-triggers.md`: 既定値（pull 5 分・push デバウンス 2 秒）を明記。
  - `03-data-model.md`: `autoSyncIntervalMs` の既定（5 分）を補足。
  - `18-open-questions.md`: 「確定済み（#1,#2,#6,#7,#8,#9）」と「未決（残: #3,#4,#5,#10,#11,#12）」に再編。
  - `README.md`: 章一覧の 18 の状態を更新。
- 本履歴を設計書更新と同一コミットに含める（CLAUDE.md 方針）。

## 決定事項
- 本番オリジンは固定せず、オリジン非依存（manifest 相対・OAuth `window.location.origin`・CSP 保存先＋`'self'`・Vite `base` 相対）で実装する。OAuth リダイレクト URI のプロバイダ登録は Phase 2/3 にユーザーが実施。
- edit vs delete は `deleted` のフィールド競合として扱い、UI は「編集版を残す／削除を適用」の二択。
- tags は集合 3-way、LCA tie-break は `(timestamp, hash)` の全順序。
- 同期既定値は pull 5 分・push デバウンス 2 秒。
- 残課題: Dropbox/Google の Client ID 発行とリダイレクト URI 登録（Phase 2/3）、CSP の保存先 FQDN 列挙、アイコン一式、SW の skipWaiting 採否、多言語（Phase 6）。

## 成果物
- 更新: `docs/design/03-data-model.md`, `04-sync-engine.md`, `05-storage-adapter.md`, `10-conflict-ui.md`, `11-sync-triggers.md`, `12-pwa-sw-csp.md`, `15-build-deploy-ci.md`, `18-open-questions.md`, `README.md`
- 新規: `docs/history/2026-06-17-design-decisions.md`（本履歴）
