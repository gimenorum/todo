import type { Store } from '../state/store';
import type { Route } from '../model/types';
import { parseHash, toHash } from './routes';

// hashchange を購読し、パース結果を State.route に反映（ch.07 の単一経路 / ch.08）。

export function startRouter(store: Store): void {
  const apply = (): void => store.setState({ route: parseHash(location.hash) });
  window.addEventListener('hashchange', apply);
  apply(); // 初期ルート
}

export function navigate(route: Route): void {
  const next = toHash(route);
  if (location.hash !== next) {
    location.hash = next;
  } else {
    // 同一ハッシュへの再遷移でも再描画したい場合に備える。
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

export function currentRoute(): Route {
  return parseHash(location.hash);
}
