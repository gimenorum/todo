// state/broadcast.ts — タブ間同期の BroadcastChannel ラッパ（ch.06 §6.3）。
// 「変わった」通知のみでペイロードは載せない。受信側は services 経由で IDB を読み直す
//（state は idb を直接触らない / ch.01）。
import { BROADCAST_CHANNEL } from '../model/constants';

export type TabMessage =
  | { type: 'todos-changed' } // todos ストア更新 → 再 materialize
  | { type: 'status' } // 同期ステータス変更
  | { type: 'conflicts' }; // 競合集合変更

export interface Broadcast {
  post(msg: TabMessage): void;
  close(): void;
}

export function createBroadcast(onMessage: (msg: TabMessage) => void): Broadcast {
  const channel = new BroadcastChannel(BROADCAST_CHANNEL);
  channel.onmessage = (ev: MessageEvent) => onMessage(ev.data as TabMessage);
  return {
    post(msg) {
      channel.postMessage(msg);
    },
    close() {
      channel.close();
    },
  };
}
