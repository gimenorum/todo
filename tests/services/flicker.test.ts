import { describe, expect, it, vi } from 'vitest';
import { createFlicker } from '../../src/services/SyncService';
import type { GlobalSyncStatus } from '../../src/model/types';

describe('createFlicker（ちらつき抑制 / ch.09 §9.2）', () => {
  it('400ms 未満で完了 → syncing を出さず最終状態のみ', () => {
    vi.useFakeTimers();
    try {
      const calls: GlobalSyncStatus[] = [];
      const f = createFlicker((s) => calls.push(s));
      f.start();
      vi.advanceTimersByTime(100);
      f.end('idle');
      vi.runAllTimers();
      expect(calls).toEqual(['idle']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('400ms 超 → syncing 点灯、点灯後 最低 500ms 維持して最終状態', () => {
    vi.useFakeTimers();
    try {
      const calls: GlobalSyncStatus[] = [];
      const f = createFlicker((s) => calls.push(s));
      f.start();
      vi.advanceTimersByTime(400); // syncing 点灯
      expect(calls).toEqual(['syncing']);
      vi.advanceTimersByTime(100); // 点灯から 100ms
      f.end('idle'); // remain = 500 - 100 = 400ms
      expect(calls).toEqual(['syncing']);
      vi.advanceTimersByTime(400);
      expect(calls).toEqual(['syncing', 'idle']);
    } finally {
      vi.useRealTimers();
    }
  });
});
