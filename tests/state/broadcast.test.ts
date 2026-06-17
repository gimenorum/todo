// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBroadcast, type TabMessage } from '../../src/state/broadcast';

// 同名インスタンス間で同期配信する最小 BroadcastChannel スタブ（自分自身には届かない）。
class FakeBC {
  static channels = new Map<string, Set<FakeBC>>();
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    const set = FakeBC.channels.get(name) ?? new Set<FakeBC>();
    set.add(this);
    FakeBC.channels.set(name, set);
  }
  postMessage(data: unknown): void {
    for (const c of FakeBC.channels.get(this.name) ?? []) {
      if (c !== this) c.onmessage?.({ data });
    }
  }
  close(): void {
    FakeBC.channels.get(this.name)?.delete(this);
  }
}

describe('state/broadcast', () => {
  const orig = globalThis.BroadcastChannel;
  beforeAll(() => {
    globalThis.BroadcastChannel = FakeBC as unknown as typeof BroadcastChannel;
  });
  afterAll(() => {
    globalThis.BroadcastChannel = orig;
  });

  it('別インスタンスへ配信し、自分自身には届かない', () => {
    const got: TabMessage[] = [];
    const recv = createBroadcast((m) => got.push(m));
    const send = createBroadcast(() => {});
    send.post({ type: 'todos-changed' });
    expect(got).toEqual([{ type: 'todos-changed' }]);
    recv.close();
    send.close();
  });
});
