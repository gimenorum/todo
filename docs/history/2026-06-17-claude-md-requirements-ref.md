# 2026-06-17 CLAUDE.md に要件定義・設計書への参照を追加

## 日付
2026-06-17

## 依頼内容
- 実装着手前に、`CLAUDE.md` から `docs/requirements.md` を参照する旨を明記し、コミットする。

## 対応概要
- `CLAUDE.md` に「参照ドキュメント」セクションを新設。
  - 要件定義（正本）`docs/requirements.md` へのリンクと内容概要を記載。
  - 設計書目次 `docs/design/README.md` へのリンクも併記。
- 既存3セクション（プロジェクト概要／言語規約／履歴管理ルール）の文言は変更せず、追記のみ。
- 本履歴を作業ファイル（`CLAUDE.md`）と同一コミットに含めて `main` へ直コミット（push なし）。

## 決定事項
- 要件は `docs/requirements.md` を正本とし、実装・設計の判断時は常にこれを参照する。
- 本コミットは設計フェーズと同じく `main` へ直接行い、今回は push しない。

## 成果物
- 更新: `CLAUDE.md`（「参照ドキュメント」セクションを追加）
- 新規: `docs/history/2026-06-17-claude-md-requirements-ref.md`（本履歴）
