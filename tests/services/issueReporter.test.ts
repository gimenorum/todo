import { afterEach, describe, expect, it } from 'vitest';
import {
  REPORT_REPO_URL,
  buildIssueUrl,
  clearErrors,
  recentErrors,
  recordError,
  type ErrorInfo,
} from '../../src/services/issueReporter';

afterEach(clearErrors);

function err(p: Partial<ErrorInfo>): ErrorInfo {
  return { message: p.message ?? 'boom', stack: p.stack, source: p.source ?? 'error', at: p.at ?? 0 };
}

function bodyOf(url: string): string {
  return new URLSearchParams(url.split('?')[1]).get('body') ?? '';
}

describe('services/issueReporter buildIssueUrl', () => {
  it('issues/new URL を生成し title/body/labels をエンコードする', () => {
    const url = buildIssueUrl({ version: '0.4.11', route: 'tasks', userAgent: 'UA/1.0', errors: [] });
    expect(url.startsWith(`${REPORT_REPO_URL}/issues/new?`)).toBe(true);
    const qs = new URLSearchParams(url.split('?')[1]);
    expect(qs.get('labels')).toBe('bug');
    expect(qs.get('title')).toContain('0.4.11');
    expect(qs.get('body')).toContain('0.4.11');
    expect(qs.get('body')).toContain('tasks');
    expect(qs.get('body')).toContain('UA/1.0');
  });

  it('特殊文字（&・#・改行・日本語）が壊れず往復する', () => {
    const url = buildIssueUrl({
      version: '1.0.0',
      route: 'settings',
      userAgent: 'A&B #1\n日本語',
      errors: [],
    });
    expect(bodyOf(url)).toContain('A&B #1\n日本語');
  });

  it('直近エラーを本文に含む（無ければ「なし」）', () => {
    expect(bodyOf(buildIssueUrl({ version: '1', route: 'tasks', userAgent: 'x', errors: [] }))).toContain(
      'なし',
    );
    const withErr = buildIssueUrl({
      version: '1',
      route: 'tasks',
      userAgent: 'x',
      errors: [err({ message: 'X happened', source: 'error' })],
    });
    expect(bodyOf(withErr)).toContain('X happened');
  });

  it('body は上限で切り詰める', () => {
    const url = buildIssueUrl({
      version: '1',
      route: 'tasks',
      userAgent: 'x',
      errors: [err({ message: 'm', stack: 'x'.repeat(20000) })],
    });
    const body = bodyOf(url);
    expect(body.length).toBeLessThanOrEqual(6100);
    expect(body).toContain('…(省略)');
  });
});

describe('services/issueReporter recordError/recentErrors', () => {
  it('直近 5 件だけ保持する（古いものは押し出す）', () => {
    for (let i = 0; i < 8; i++) recordError({ message: `e${i}`, source: 'error' });
    const r = recentErrors();
    expect(r).toHaveLength(5);
    expect(r[0].message).toBe('e3');
    expect(r[4].message).toBe('e7');
  });
});
