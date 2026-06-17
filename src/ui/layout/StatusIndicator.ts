import type { State } from '../../model/types';
import { el, setTextIfChanged } from '../dom';
import { showsSyncUi } from '../../state/selectors';
import { formatTime } from '../format';

// ヘッダ隅の全体同期ステータス（ch.09 §9.2）。未連携時は描画しない。
// ちらつき抑制（400/500ms）は services 側で state.global を制御するため、ここは素直に描画する。
export function createStatusIndicator(): { el: HTMLElement; update(state: State): void } {
  const root = el('span', {
    class: 'sync-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
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
        return '要再接続';
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
      root.className = `sync-status status-${state.global}`;
      setTextIfChanged(root, show ? label(state) : '');
    },
  };
}
