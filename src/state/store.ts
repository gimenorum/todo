import type { State } from '../model/types';

// 状態の単一の真実 ＋ setState→render 一本道（ch.07）。
// ユーザー操作・（将来の）同期マージ・別タブ更新を、すべてこの単一経路に流す。

type Listener = (state: State) => void;
type Patch = Partial<State> | ((prev: State) => Partial<State>);

export interface Store {
  getState(): State;
  setState(patch: Patch): void;
  subscribe(listener: Listener): () => void;
}

export function createStore(initial: State): Store {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState(patch) {
      const part = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...part };
      // スナップショットを取ってから通知（購読中の解除に安全）。
      for (const listener of [...listeners]) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
