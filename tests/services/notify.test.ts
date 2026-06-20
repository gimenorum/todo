import { afterEach, describe, expect, it, vi } from 'vitest';
import { showNotification } from '../../src/services/notify';

// jsdom には Notification が無いので、テストごとにグローバルを差し替える。
type NotifMock = ReturnType<typeof vi.fn> & { permission: NotificationPermission };

function setNotification(permission: NotificationPermission): NotifMock {
  const ctor = vi.fn() as unknown as NotifMock;
  ctor.permission = permission;
  (globalThis as unknown as { Notification: unknown }).Notification = ctor;
  return ctor;
}

afterEach(() => {
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  vi.restoreAllMocks();
});

describe('services/notify showNotification', () => {
  it('権限が granted 以外なら false を返し、何も呼ばない', async () => {
    const ctor = setNotification('default');
    const ok = await showNotification('t', { body: 'b' });
    expect(ok).toBe(false);
    expect(ctor).not.toHaveBeenCalled();
  });

  it('granted ならまず new Notification() で表示し true（SW があっても優先）', async () => {
    const ctor = setNotification('granted');
    const swShow = vi.fn();
    (navigator as unknown as { serviceWorker: unknown }).serviceWorker = {
      ready: Promise.resolve({ showNotification: swShow }),
    };
    const ok = await showNotification('タイトル', { body: '本文' });
    expect(ok).toBe(true);
    expect(ctor).toHaveBeenCalledWith('タイトル', { body: '本文' });
    expect(swShow).not.toHaveBeenCalled(); // SW にはフォールバックしない
  });

  it('new Notification() が throw する環境では SW にフォールバックして true', async () => {
    const ctor = setNotification('granted');
    ctor.mockImplementation(() => {
      throw new TypeError('Illegal constructor');
    });
    const swShow = vi.fn(() => Promise.resolve());
    (navigator as unknown as { serviceWorker: unknown }).serviceWorker = {
      ready: Promise.resolve({ showNotification: swShow }),
    };
    const ok = await showNotification('t', { body: 'b' });
    expect(ok).toBe(true);
    expect(swShow).toHaveBeenCalledWith('t', { body: 'b' });
  });

  it('new Notification() が throw かつ SW 無しなら false', async () => {
    const ctor = setNotification('granted');
    ctor.mockImplementation(() => {
      throw new TypeError('Illegal constructor');
    });
    // serviceWorker 未定義（afterEach で削除済み）。
    const ok = await showNotification('t');
    expect(ok).toBe(false);
  });
});
