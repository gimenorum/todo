import { describe, expect, it, vi } from 'vitest';
import { createSyncScheduler } from '../../src/services/SyncScheduler';
import type { SyncService } from '../../src/services/SyncService';
import type { DeviceSettings } from '../../src/model/types';

function mockSync(runOnce: () => Promise<void>): SyncService {
  return {
    runOnce,
    resolveConflict: () => Promise.resolve(),
    reloadFromLocal: () => Promise.resolve([]),
    restoreConflicts: () => Promise.resolve(),
  };
}

const manual: DeviceSettings = {
  autoSyncMode: 'manual',
  autoSyncIntervalMs: 300_000,
  sidebarCollapsed: false,
  connectedProvider: 'dropbox',
};
const interval: DeviceSettings = { ...manual, autoSyncMode: 'interval', autoSyncIntervalMs: 1000 };

describe('services/SyncScheduler', () => {
  it('notifyEdited は 2 秒デバウンスして 1 回だけ走る', () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(() => Promise.resolve());
      const s = createSyncScheduler({ sync: mockSync(run), getSettings: () => manual });
      s.notifyEdited();
      s.notifyEdited(); // デバウンスで畳まれる
      vi.advanceTimersByTime(1999);
      expect(run).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('interval モードで定期実行し、stop で止まる', async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(() => Promise.resolve());
      const s = createSyncScheduler({ sync: mockSync(run), getSettings: () => interval });
      s.start();
      // Async 版で各 tick 間にマイクロタスクを流す（syncing が tick 毎に解除され、dedup で畳まれない）。
      await vi.advanceTimersByTimeAsync(3000);
      expect(run).toHaveBeenCalledTimes(3);
      s.stop();
      await vi.advanceTimersByTimeAsync(3000);
      expect(run).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('多重実行を末尾 1 回に畳む（pendingRerun / ch.11 §11.4）', async () => {
    let resolveRun!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => (resolveRun = r)));
    const s = createSyncScheduler({ sync: mockSync(run), getSettings: () => manual });
    void s.syncNow(); // 1 回目開始（未解決のまま）
    void s.syncNow(); // 実行中 → pendingRerun
    void s.syncNow(); // 実行中 → pendingRerun のまま
    expect(run).toHaveBeenCalledTimes(1);
    resolveRun(); // 1 回目完了 → 末尾 1 回だけ再実行
    await new Promise((r) => setTimeout(r, 0));
    expect(run).toHaveBeenCalledTimes(2);
  });
});
