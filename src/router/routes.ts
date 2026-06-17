import type { Route } from '../model/types';

// ハッシュルート（#/...）。History API は使わない＝GitHub Pages で 404 にならない（ch.08）。

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const seg = path.split('/').filter(Boolean); // '#/todo/<id>' → ['todo','<id>']

  if (seg.length === 0 || seg[0] === 'tasks') return { name: 'tasks' };
  if (seg[0] === 'settings') return { name: 'settings' };
  if (seg[0] === 'todo' && seg[1]) {
    if (seg[2] === 'merge') return { name: 'merge', id: seg[1] }; // Phase 4
    return { name: 'todo', id: seg[1] };
  }
  return { name: 'tasks' }; // 未知ルートはタスク一覧へフォールバック
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'tasks':
      return '#/tasks';
    case 'settings':
      return '#/settings';
    case 'todo':
      return `#/todo/${route.id}`;
    case 'merge':
      return `#/todo/${route.id}/merge`;
  }
}
