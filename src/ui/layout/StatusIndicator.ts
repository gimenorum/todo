import type { State } from '../../model/types';
import { el, setTextIfChanged } from '../dom';
import { showsSyncUi } from '../../state/selectors';
import { formatTime } from '../format';

// ヘッダ隅の全体同期ステータス（ch.09 §9.2）。未連携時は描画しない。
// ちらつき抑制（400/500ms）は services 側で state.global を制御するため、ここは素直に描画する。
// needs-reauth のときはタップ/Enter で設定画面へ誘導する（onActivate / Issue #41）。
export function createStatusIndicator(
  onActivate?: () => void,
): { el: HTMLElement; update(state: State): void } {
  const root = el('span', {
    class: 'sync-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });

  // 操作可能（needs-reauth）なときだけ誘導を発火する。state はハンドラ内で持たず update でフラグ管理。
  let actionable = false;
  const activate = (): void => {
    if (actionable) onActivate?.();
  };
  root.addEventListener('click', activate);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  });

  function label(state: State): string {
    switch (state.global) {
      case 'syncing':
        return '同期中…';
      case 'offline':
        return 'オフライン';
      case 'error':
        return '同期エラー';
      case 'needs-reauth':
        return '要再連携';
      case 'idle':
        return state.lastSyncAt !== null ? `最終同期 ${formatTime(state.lastSyncAt)}` : '同期できます';
      default:
        return '';
    }
  }

  return {
    el: root,
    update(state) {
      const show = showsSyncUi(state);
      root.hidden = !show;
      actionable = show && state.global === 'needs-reauth' && onActivate !== undefined;
      root.className = `sync-status status-${state.global}${actionable ? ' status-actionable' : ''}`;
      if (actionable) {
        root.setAttribute('role', 'button');
        root.setAttribute('tabindex', '0');
        root.setAttribute('title', '設定を開いて再連携');
      } else {
        root.setAttribute('role', 'status');
        root.removeAttribute('tabindex');
        root.removeAttribute('title');
      }
      setTextIfChanged(root, show ? label(state) : '');
    },
  };
}
