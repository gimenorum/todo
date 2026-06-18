// SyncService の結線テスト。リモートは InMemoryAdapter、別端末は core の Device ハーネス、
// この端末は実 services + store（fake-indexeddb）で表現する。Phase 1 の収束/競合と同じ seam を検証。
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAdapter } from '../../src/adapters/InMemoryAdapter';
import { createSyncService, type SyncOutcome } from '../../src/services/SyncService';
import * as todoStore from '../../src/store/todoStore';
import { getDb } from '../../src/store/db';
import { STORE } from '../../src/model/constants';
import { fixedClock, makeDevice, makeTodo } from '../helpers/factories';
import { decodeCommit, objKey } from '../../src/core';
import type { GlobalSyncStatus, StorageAdapter } from '../../src/model/types';

async function clearDb(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.clear(STORE.todos),
    db.clear(STORE.objects),
    db.clear(STORE.meta),
    db.clear(STORE.settings),
    db.clear(STORE.tokens),
  ]);
}

beforeEach(clearDb);

describe('services/SyncService', () => {
  it('ローカル todo を push し、outcome に反映される', async () => {
    const remote = new InMemoryAdapter();
    const outcomes: SyncOutcome[] = [];
    const statuses: GlobalSyncStatus[] = [];
    const svc = createSyncService({
      adapter: remote,
      deviceId: 'A',
      clock: fixedClock(),
      onOutcome: (o) => outcomes.push(o),
      onStatus: (s) => statuses.push(s),
    });
    await todoStore.putTodo(makeTodo({ id: 't1', title: 'Hello' }));
    await svc.runOnce();

    const last = outcomes.at(-1);
    expect(last?.todos.map((t) => t.id)).toContain('t1');
    expect(last?.conflicts).toEqual([]);
    expect(last?.perTodoStatus['t1']).toBe('synced');
    expect(typeof last?.lastSyncAt).toBe('number');
    expect(statuses.at(-1)).toBe('idle');
    expect((await remote.list('heads/')).length).toBe(1);
    expect((await remote.list('objects/')).length).toBeGreaterThanOrEqual(2); // commit + snapshot
  });

  it('リモートの変更を pull して materialize する', async () => {
    const remote = new InMemoryAdapter();
    const clock = fixedClock();
    const B = makeDevice('B', clock);
    await B.commit((todos) => {
      todos['t2'] = makeTodo({ id: 't2', title: 'FromB' });
    });
    await B.sync(remote);

    const outcomes: SyncOutcome[] = [];
    const svc = createSyncService({
      adapter: remote,
      deviceId: 'A',
      clock,
      onOutcome: (o) => outcomes.push(o),
      onStatus: () => {},
    });
    await svc.runOnce();

    expect(outcomes.at(-1)?.todos.find((t) => t.id === 't2')?.title).toBe('FromB');
    expect((await todoStore.getTodo('t2'))?.title).toBe('FromB'); // ローカルにも materialize
  });

  it('同一フィールド競合を検出し、暫定解決で消える', async () => {
    const remote = new InMemoryAdapter();
    const clock = fixedClock();
    const B = makeDevice('B', clock);
    await B.commit((todos) => {
      todos['t1'] = makeTodo({ id: 't1', title: 'base' });
    });
    await B.sync(remote);

    const outcomes: SyncOutcome[] = [];
    const svc = createSyncService({
      adapter: remote,
      deviceId: 'A',
      clock,
      onOutcome: (o) => outcomes.push(o),
      onStatus: () => {},
    });
    await svc.runOnce(); // A が base を pull

    // B は title=Y に編集して同期
    await B.commit((todos) => {
      todos['t1'] = { ...todos['t1'], title: 'Y', version: 2 };
    });
    await B.sync(remote);

    // A はローカルで title=X に編集してから同期 → 競合
    const cur = await todoStore.getTodo('t1');
    await todoStore.putTodo({ ...cur!, title: 'X', version: 2 });
    await svc.runOnce();

    let last = outcomes.at(-1);
    expect(last?.conflicts.some((c) => c.todoId === 't1' && c.field === 'title')).toBe(true);
    expect(last?.perTodoStatus['t1']).toBe('conflict');

    // 解決（相手の値 title=Y を採用する patch）→ 競合が消える
    await svc.resolveConflict('t1', { title: 'Y' });
    last = outcomes.at(-1);
    expect(last?.conflicts).toEqual([]);
    expect(last?.perTodoStatus['t1']).toBe('synced');
  });

  it('相手先端の snapshot 未伝播でも「同期エラー」にせず idle（部分書き込みレース / hotfix 0.2.1）', async () => {
    const remote = new InMemoryAdapter();
    const clock = fixedClock();
    const B = makeDevice('B', clock);
    await B.commit((todos) => {
      todos['t9'] = makeTodo({ id: 't9', title: 'FromB' });
    });
    await B.sync(remote);

    // B の最新 snapshot blob だけがまだ伝播していない状況を模す（commit/head は可視）。
    const bCommit = decodeCommit((await remote.get(objKey(B.head!)))!);
    const snapKey = objKey(bCommit.snapshot);
    const snapBytes = (await remote.get(snapKey))!;
    await remote.delete(snapKey);

    const outcomes: SyncOutcome[] = [];
    const statuses: GlobalSyncStatus[] = [];
    const svc = createSyncService({
      adapter: remote,
      deviceId: 'A',
      clock,
      onOutcome: (o) => outcomes.push(o),
      onStatus: (s) => statuses.push(s),
    });

    await svc.runOnce(); // 未伝播 → throw せず idle、t9 はまだ取り込まれない
    expect(statuses.at(-1)).toBe('idle');
    expect(await todoStore.getTodo('t9')).toBeUndefined();

    await remote.put(snapKey, snapBytes); // 伝播完了
    await svc.runOnce();
    expect(statuses.at(-1)).toBe('idle');
    expect((await todoStore.getTodo('t9'))?.title).toBe('FromB');
  });

  it('アダプタが投げると status=error（outcome は出ない）', async () => {
    const throwing: StorageAdapter = {
      list: () => Promise.reject(new Error('boom')),
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    const outcomes: SyncOutcome[] = [];
    const statuses: GlobalSyncStatus[] = [];
    const svc = createSyncService({
      adapter: throwing,
      deviceId: 'A',
      clock: fixedClock(),
      onOutcome: (o) => outcomes.push(o),
      onStatus: (s) => statuses.push(s),
    });
    await svc.runOnce();
    expect(statuses.at(-1)).toBe('error');
    expect(outcomes).toEqual([]);
  });
});
