# 2026-06-17 ブランチ運用ガード（マージ元制限）の追加

## 日付
2026-06-17

## 依頼内容
- ブランチ保護として以下を適用したい:
  - `main` へは `develop` または `hotfix/*` からのみマージ可。
  - `develop` へは `feature/*` からのみマージ可（厳格。hotfix→develop は塞ぐ）。
  - `main` / `develop` への直接コミット不可（PR 必須）。管理者も保護対象（bypass 不可）。

## 対応概要
- GitHub のブランチ保護/Ruleset には「PR の source ブランチ制限」機能が無いため、
  **PR の base/head を検査する workflow `.github/workflows/branch-policy.yml`** を追加し、
  これを必須ステータスチェックにして機械強制する方針とした。
  - `main` ← `develop` / `hotfix/*`、`develop` ← `feature/*` を許可、他は fail。
  - PR の中身は checkout せず、ブランチ名のみ検査（secrets 不使用＝安全）。
- 直接コミット禁止・force-push 禁止・必須チェック・管理者を含む bypass 禁止・マージコミットのみ、は
  リポジトリのブランチ保護設定（UI）で適用する（API では設定不可のためユーザーが実施）。
- 本 workflow は `feature/branch-policy → develop → main` の Git Flow で投入する。

## 決定事項
- マージ元制限は CI ガード（必須チェック）で実現する。
- `develop` の許可元は `feature/*` のみ（厳格）。hotfix の develop 反映が必要な場合は、
  内容を `feature/*` に載せて回すか、一時的にガードを調整する運用とする。
- ブランチ保護は管理者も対象（完全に直 push 不可）。

## 成果物
- 新規: `.github/workflows/branch-policy.yml`
- 新規: `docs/history/2026-06-17-branch-policy-guard.md`（本履歴）
