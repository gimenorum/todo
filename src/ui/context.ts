import type { Store } from '../state/store';
import type { Actions } from '../state/actions';
import type { Route, State } from '../model/types';

// PWA インストール導線（pwa/ が構造的に満たす。ui→pwa の依存は持たない）。
export interface InstallController {
  canInstall(): boolean;
  promptInstall(): Promise<void>;
  onChange(cb: () => void): void;
  readonly isIOS: boolean;
  readonly isStandalone: boolean;
}

// UI 各ビューに渡す依存（ui は state・router・model のみに依存 / ch.01）。
export interface UiContext {
  store: Store;
  actions: Actions;
  navigate: (route: Route) => void;
  install: InstallController;
  // ビルド時 env で接続可能な保存先（連携ボタンの出し分けに使う）。services の isXConfigured を root で評価。
  providers: { dropbox: boolean; gdrive: boolean };
}

// 各ビューの共通形（生成時に DOM を組み立て、update(state) で差分反映）。
export interface ViewController {
  el: HTMLElement;
  update(state: State): void;
  destroy?(): void;
}
