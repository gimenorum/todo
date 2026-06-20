import { describe, expect, it, vi } from 'vitest';
import { createNotificationScheduler } from '../../src/services/NotificationScheduler';
import type { Permission } from '../../src/services/notify';
import type { Millis, Todo, Uuid } from '../../src/model/types';
import { makeTodo } from '../helpers/factories';

// マイクロタスクを十分に流して、check()（fire-and-forget な runCheck）の await を解決させる。
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// テスト用ハーネス。notify は表示成否（boolean）を返す。setNotifyResult で切替可能。
function harness(opts: {
  todos: Todo[];
  now: () => Millis;
  permission?: Permission;
  notified?: Record<Uuid, Millis>;
}) {
  let notifyResult = true;
  const notify = vi.fn((_title: string, _options?: NotificationOptions) =>
    Promise.resolve(notifyResult),
  );
  let saved: Record<Uuid, Millis> = { ...(opts.notified ?? {}) };
  const sched = createNotificationScheduler({
    getTodos: () => opts.todos,
    notify,
    getPermission: () => opts.permission ?? 'granted',
    loadNotified: () => Promise.resolve({ ...(opts.notified ?? {}) }),
    saveNotified: (m) => {
      saved = m;
      return Promise.resolve();
    },
    now: opts.now,
    intervalMs: 1000,
  });
  return {
    sched,
    notify,
    getSaved: () => saved,
    setNotifyResult: (b: boolean) => {
      notifyResult = b;
    },
  };
}

async function startAndSettle(sched: { start: () => void }): Promise<void> {
  sched.start();
  await settle();
}

const DUE = 10_000_000;
const HOUR = 3_600_000;

describe('services/NotificationScheduler', () => {
  it('fireAt 前は発火せず、跨いだら 1 回だけ発火する', async () => {
    let t = DUE - HOUR - 1; // fireAt(=DUE-HOUR) の直前
    const todo = makeTodo({ id: 'a', title: '牛乳', dueDate: DUE, notifyBeforeMs: HOUR });
    const { sched, notify } = harness({ todos: [todo], now: () => t });
    await startAndSettle(sched);
    expect(notify).not.toHaveBeenCalled();

    t = DUE - HOUR + 5; // fireAt を跨ぐ
    sched.check();
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]?.body).toBe('牛乳');

    sched.check(); // 二度は鳴らさない
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
    sched.stop();
  });

  it('期日経過後は発火しない（取りこぼしは許容）', async () => {
    const todo = makeTodo({ id: 'a', dueDate: DUE, notifyBeforeMs: HOUR });
    const { sched, notify } = harness({ todos: [todo], now: () => DUE + 1 });
    await startAndSettle(sched);
    sched.check();
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it('done / deleted / 期日なし / 通知なし はスキップ', async () => {
    const now = () => DUE - HOUR + 5;
    const todos = [
      makeTodo({ id: 'done', done: true, dueDate: DUE, notifyBeforeMs: HOUR }),
      makeTodo({ id: 'del', deleted: true, dueDate: DUE, notifyBeforeMs: HOUR }),
      makeTodo({ id: 'nodue', dueDate: null, notifyBeforeMs: HOUR }),
      makeTodo({ id: 'nonotify', dueDate: DUE, notifyBeforeMs: null }),
    ];
    const { sched, notify } = harness({ todos, now });
    await startAndSettle(sched);
    sched.check();
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it('権限が granted 以外なら発火しない', async () => {
    const todo = makeTodo({ id: 'a', dueDate: DUE, notifyBeforeMs: HOUR });
    const { sched, notify } = harness({
      todos: [todo],
      now: () => DUE - HOUR + 5,
      permission: 'denied',
    });
    await startAndSettle(sched);
    sched.check();
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it('既に同じ fireAt を通知済みなら鳴らさない', async () => {
    const todo = makeTodo({ id: 'a', dueDate: DUE, notifyBeforeMs: HOUR });
    const { sched, notify } = harness({
      todos: [todo],
      now: () => DUE - HOUR + 5,
      notified: { a: DUE - HOUR }, // この fireAt は通知済み
    });
    await startAndSettle(sched);
    sched.check();
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it('fireAt が変化（期日/リード変更）したら再発火する', async () => {
    const todo = makeTodo({ id: 'a', dueDate: DUE, notifyBeforeMs: HOUR });
    // 旧 fireAt は別値で通知済み → 現在の fireAt(=DUE-HOUR) は未通知。
    const { sched, notify, getSaved } = harness({
      todos: [todo],
      now: () => DUE - HOUR + 5,
      notified: { a: DUE - 2 * HOUR },
    });
    await startAndSettle(sched);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getSaved().a).toBe(DUE - HOUR); // 新しい fireAt を保存
    sched.stop();
  });

  it('通知失敗(false)は記録せず、次回 true で再発火・記録する', async () => {
    const todo = makeTodo({ id: 'a', dueDate: DUE, notifyBeforeMs: HOUR });
    const h = harness({ todos: [todo], now: () => DUE - HOUR + 5 });
    h.setNotifyResult(false);
    await startAndSettle(h.sched);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.getSaved().a).toBeUndefined(); // 失敗時は未記録

    h.setNotifyResult(true);
    h.sched.check();
    await settle();
    expect(h.notify).toHaveBeenCalledTimes(2); // 再試行で再発火
    expect(h.getSaved().a).toBe(DUE - HOUR); // 成功して記録
    h.sched.stop();
  });

  it('定期チェックでも fireAt 跨ぎを検知する', async () => {
    vi.useFakeTimers();
    try {
      let t = DUE - HOUR - 1;
      const todo = makeTodo({ id: 'a', dueDate: DUE, notifyBeforeMs: HOUR });
      const { sched, notify } = harness({ todos: [todo], now: () => t });
      sched.start();
      await vi.advanceTimersByTimeAsync(0); // loadNotified 解決＋初回 check（未発火）
      expect(notify).not.toHaveBeenCalled();
      t = DUE - HOUR + 5;
      await vi.advanceTimersByTimeAsync(1000); // interval 1 周 → 発火
      expect(notify).toHaveBeenCalledTimes(1);
      sched.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
