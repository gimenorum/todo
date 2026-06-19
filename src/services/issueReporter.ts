// services/issueReporter.ts — 不具合報告（Issue #57）。
// 案 A: GitHub の新規 Issue 画面をプレフィルして開く URL を組み立てる（ログイン中の利用者名義で起票・
// トークン不要・CSP 変更不要・送信前に確認可）。直近エラーは「記録するだけ」でメモリ保持し、報告時に
// 本文へ要約する（自動送信はしない＝プライバシー）。タスク本文など個人データは載せない。

export interface ErrorInfo {
  message: string;
  stack?: string;
  source: string; // 'error' | 'unhandledrejection' | 'bootstrap' など
  at: number; // epoch ms
}

export const REPORT_REPO_URL = 'https://github.com/gimenorum/todo';

const MAX_RECENT = 5; // 直近エラーの保持件数
const MAX_BODY = 6000; // URL 長対策（本文の上限・概算）
const recent: ErrorInfo[] = [];

// グローバルエラーハンドラ等から呼ぶ。記録のみ（送信しない）。
export function recordError(info: { message: string; stack?: string; source: string }): void {
  recent.push({ message: info.message, stack: info.stack, source: info.source, at: Date.now() });
  while (recent.length > MAX_RECENT) recent.shift();
}

export function recentErrors(): ErrorInfo[] {
  return recent.slice();
}

export function clearErrors(): void {
  recent.length = 0;
}

function formatErrors(errors: ErrorInfo[]): string {
  if (errors.length === 0) return 'なし';
  return errors
    .map((e) => {
      const when = new Date(e.at).toISOString();
      const head = `- [${e.source}] ${when}\n  ${e.message}`;
      const stack = e.stack
        ? `\n\n\`\`\`\n${e.stack.split('\n').slice(0, 12).join('\n')}\n\`\`\``
        : '';
      return head + stack;
    })
    .join('\n\n');
}

// 報告用のプレフィル URL（issues/new?title=...&body=...&labels=bug）。純関数。
export function buildIssueUrl(input: {
  version: string;
  route: string;
  userAgent: string;
  errors: ErrorInfo[];
}): string {
  const title = `アプリの不具合 (v${input.version})`;
  const body0 = [
    '## 不具合の内容',
    '（ここに状況を記入してください）',
    '',
    '## 再現手順',
    '1. ',
    '',
    '---',
    '### 環境（自動入力）',
    `- バージョン: v${input.version}`,
    `- 画面: ${input.route}`,
    `- ブラウザ: ${input.userAgent}`,
    '',
    '### 直近のエラー（自動入力・個人データは含みません）',
    '',
    formatErrors(input.errors),
  ].join('\n');
  const body = body0.length > MAX_BODY ? `${body0.slice(0, MAX_BODY)}\n…(省略)` : body0;

  const params = new URLSearchParams({ title, body, labels: 'bug' });
  return `${REPORT_REPO_URL}/issues/new?${params.toString()}`;
}
