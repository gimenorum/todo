import { describe, expect, it } from 'vitest';
import { parseHash, toHash } from '../../src/router/routes';
import type { Route } from '../../src/model/types';

describe('router/routes', () => {
  it('parses known routes', () => {
    expect(parseHash('')).toEqual({ name: 'tasks' });
    expect(parseHash('#/')).toEqual({ name: 'tasks' });
    expect(parseHash('#/tasks')).toEqual({ name: 'tasks' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
    expect(parseHash('#/todo/abc')).toEqual({ name: 'todo', id: 'abc' });
    expect(parseHash('#/todo/abc/merge')).toEqual({ name: 'merge', id: 'abc' });
  });

  it('falls back to tasks for unknown routes', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'tasks' });
    expect(parseHash('#/todo')).toEqual({ name: 'tasks' }); // id 欠落
  });

  it('round-trips through toHash', () => {
    const routes: Route[] = [
      { name: 'tasks' },
      { name: 'settings' },
      { name: 'todo', id: '1' },
      { name: 'merge', id: '2' },
    ];
    for (const r of routes) expect(parseHash(toHash(r))).toEqual(r);
  });
});
