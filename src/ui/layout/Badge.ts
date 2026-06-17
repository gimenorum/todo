import type { State } from '../../model/types';
import { setTextIfChanged } from '../dom';
import { settingsBadge, showsSyncUi, tasksBadge } from '../../state/selectors';

// ナビのバッジ更新（ch.09 §9.6）。タスク=競合件数、設定=要再接続/エラー。
// 未連携時は一切出さない（同期系 UI 非表示の不変条件）。
export function updateNavBadges(root: HTMLElement, state: State): void {
  const show = showsSyncUi(state);
  for (const link of root.querySelectorAll<HTMLElement>('.nav-link')) {
    const badge = link.querySelector<HTMLElement>('.nav-badge');
    if (!badge) continue;
    if (!show) {
      badge.hidden = true;
      continue;
    }
    if (link.dataset.route === 'tasks') {
      const n = tasksBadge(state);
      if (n > 0) {
        setTextIfChanged(badge, String(n));
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    } else if (link.dataset.route === 'settings') {
      if (settingsBadge(state)) {
        setTextIfChanged(badge, '!');
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
  }
}
