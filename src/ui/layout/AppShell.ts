import type { State } from '../../model/types';
import type { UiContext, ViewController } from '../context';
import { el } from '../dom';
import { createTaskListView } from '../views/TaskListView';
import { createTodoEditView } from '../views/TodoEditView';
import { createSettingsView } from '../views/SettingsView';
import { createConflictMergeView } from '../views/ConflictMergeView';
import { createStatusIndicator } from './StatusIndicator';
import { updateNavBadges } from './Badge';

// トップレベルは「タスク」「設定」の 2 つのみ（ch.08）。「同期」専用タブは作らない。
type NavTarget = 'tasks' | 'settings';

function buildNav(kind: 'sidebar' | 'tabs'): HTMLElement {
  const nav = el('nav', {
    class: kind === 'sidebar' ? 'app-nav app-nav-sidebar' : 'app-nav app-nav-tabs',
  });
  const items: Array<{ route: NavTarget; href: string; label: string; icon: string }> = [
    { route: 'tasks', href: '#/tasks', label: 'タスク', icon: '☑' },
    { route: 'settings', href: '#/settings', label: '設定', icon: '⚙' },
  ];
  for (const it of items) {
    const a = el('a', { class: 'nav-link', attrs: { href: it.href, 'data-route': it.route } });
    a.append(
      el('span', { class: 'nav-icon', text: it.icon, attrs: { 'aria-hidden': 'true' } }),
      el('span', { class: 'nav-label', text: it.label }),
      // バッジ要素は用意するが Phase 0 は常に非表示（未連携 / ch.09）。
      el('span', { class: 'nav-badge', attrs: { hidden: '' } }),
    );
    nav.append(a);
  }
  return nav;
}

function activeTab(state: State): NavTarget {
  return state.route.name === 'settings' ? 'settings' : 'tasks';
}

function updateNavActive(root: HTMLElement, state: State): void {
  const active = activeTab(state);
  for (const a of root.querySelectorAll<HTMLAnchorElement>('.nav-link')) {
    if (a.dataset.route === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function routeKey(state: State): string {
  const r = state.route;
  return r.name === 'todo' || r.name === 'merge' ? `${r.name}:${r.id}` : r.name;
}

function createViewFor(state: State, ctx: UiContext): ViewController {
  switch (state.route.name) {
    case 'settings':
      return createSettingsView(ctx);
    case 'todo':
      return createTodoEditView(ctx, state.route.id);
    case 'merge':
      return createConflictMergeView(ctx, state.route.id); // 暫定競合解決（Phase 2）
    case 'tasks':
    default:
      return createTaskListView(ctx);
  }
}

export function createAppShell(ctx: UiContext): {
  el: HTMLElement;
  update(state: State): void;
} {
  const root = el('div', { class: 'app-shell' });

  const header = el('header', { class: 'app-header' });
  const toggle = el('button', {
    class: 'sidebar-toggle',
    text: '☰',
    attrs: { type: 'button', 'aria-label': 'サイドバーの折り畳み' },
  });
  toggle.addEventListener('click', () => {
    const collapsed = !ctx.store.getState().settings.sidebarCollapsed;
    void ctx.actions.changeSettings({ sidebarCollapsed: collapsed });
  });
  header.append(toggle, el('h1', { class: 'app-title', text: 'TODO' }));
  const status = createStatusIndicator();
  header.append(status.el);

  // online 復帰などの一時バナー（State.banner / ch.11 §11.3）。
  const banner = el('div', { class: 'app-banner', attrs: { role: 'status', hidden: '' } });

  const bodyEl = el('div', { class: 'app-body' });
  const sidebar = buildNav('sidebar');
  const main = el('main', { class: 'app-main' });
  bodyEl.append(sidebar, main);

  const tabs = buildNav('tabs');
  root.append(header, banner, bodyEl, tabs);

  let current: ViewController | null = null;
  let currentKey = '';

  function ensureView(state: State): void {
    const key = routeKey(state);
    if (current && key === currentKey) return;
    current?.destroy?.();
    current = createViewFor(state, ctx);
    currentKey = key;
    main.replaceChildren(current.el);
  }

  return {
    el: root,
    update(state: State) {
      root.classList.toggle('sidebar-collapsed', state.settings.sidebarCollapsed);
      updateNavActive(root, state);
      updateNavBadges(root, state);
      status.update(state);
      if (state.banner) {
        banner.textContent = state.banner;
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
      ensureView(state);
      current?.update(state);
    },
  };
}
