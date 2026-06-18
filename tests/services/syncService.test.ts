// SyncService の結線テスト。リモートは InMemoryAdapter、別端末は core の Device ハーネス、
// この端末は実 services + store（fake-indexeddb）で表現する。Phase 1 の収束/競合と同じ seam を検証。
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAdapter } from '../../src/adapters/InMemoryAdapter';
import { createSyncService, type SyncOutcome } from '../../src/services/SyncService';
import * as todoStore from '../../src/store/todoStore';
import { getDb } from '../../src/store/db';
import { STORE } from '../../src/model/constants';
import { fixedClock, makeDevice, makeTodo } from '../helpers/factories';
import { getPendingConflictDeletes } from '../../src/store/metaStore';
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

  it('競合は永続され、別インスタンスの restoreConflicts で復元される（リロード相当 / Issue #26）', async () => {
    const remote = new InMemoryAdapter();
    const clock = fixedClock();
    const B = makeDevice('B', clock);
    await B.commit((todos) => {
      todos['t1'] = makeTodo({ id: 't1', title: 'base' });
    });
    await B.sync(remote);

    const svc1 = createSyncService({
      adapter: remote,
      deviceId: 'A',
      clock,
      onOutcome: () => {},
      onStatus: () => {},
    });
    await svc1.runOnce(); // A が base を pull

    await B.commit((todos) => {
      todos['t1'] = { ...todos['t1'], title: 'Y', version: 2 };
    });
    await B.sync(remote);

    const cur = await todoStore.getTodo('t1');
    await todoStore.putTodo({ ...cur!, title: 'X', version: 2 });
    await svc1.runOnce(); // 競合検出 → IDB へ永続されるはず

    // リロード相当：activeConflicts を持たない新インスタンスで restoreConflicts → 競合が戻る。
    const restored: SyncOutcome[] = [];
    const svc2 = createSyncService({
      adapter: remote,
      deviceId: 'A',
      clock,
      onOutcome: (o) => restored.push(o),
      onStatus: () => {},
    });
    await svc2.restoreConflicts();

    const last = restored.at(-1);
    expect(last?.conflicts.some((c) => c.todoId === 't1' && c.field === 'title')).toBe(true);
    expect(last?.perTodoStatus['t1']).toBe('conflict');
  });

  it('解決後は競合が永続から消え、restoreConflicts で蘇らない（Issue #26）', async () => {
    const remote = new InMemoryAdapter();
    const clock = fixedClock();
    const B = makeDevice('B', clock);
    await B.commit((todos) => {
      todos['t1'] = makeTodo({ id: 't1', title: 'base' });
    });
    await B.sync(remote);

    const svc1 = createSyncService({
      adapter: remote,
      deviceId: 'A',
      clock,
      onOutcome: () => {},
      onStatus: () => {},
    });
    await svc1.runOnce();

    await B.commit((todos) => {
      todos['t1'] = { ...todos['t1'], title: 'Y', version: 2 };
    });
    await B.sync(remote);

    const cur = await todoStore.getTodo('t1');
    await todoStore.putTodo({ ...cur!, title: 'X', version: 2 });
    await svc1.runOnce(); // 競合
    await svc1.resolveConflict('t1', { title: 'Y' }); // 解決 → 永続も空に

    const restored: SyncOutcome[] = [];
    const svc2 = createSyncService({
      adapter: remote,
      deviceId: 'A',
      clock,
      onOutcome: (o) => restored.push(o),
      onStatus: () => {},
    });
    await svc2.restoreConflicts();

    // 競合は空なので outcome は emit されない（復元するものが無い）。
    expect(restored).toEqual([]);
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

  // --- Issue #29: 競合を共有マーカー（conflicts/<todoId>）で他端末にも表示する ---

  // 端末 A（実 services）で t1 の title 競合を作る共通セットアップ。戻り値は A の outcome 配列。
  // B（core Device）が base→Y、A はローカルで X に編集して競合検出（マーカー publish）まで行う。
  async function setupTitleConflict(
    remote: StorageAdapter,
    clock: ReturnType<typeof fixedClock>,
  ): Promise<{ svcA: ReturnType<typeof createSyncService>; outcomes: SyncOutcome[] }> {
    const B = makeDevice('B', clock);
    await B.commit((todos) => {
      todos['t1'] = makeTodo({ id: 't1', title: 'base' });
    });
    await B.sync(remote);

    const outcomes: SyncOutcome[] = [];
    const svcA = createSyncService({
      adapter: remote,
      deviceId: 'A',
      clock,
      onOutcome: (o) => outcomes.push(o),
      onStatus: () => {},
    });
    await svcA.runOnce(); // A が base を pull

    await B.commit((todos) => {
      todos['t1'] = { ...todos['t1'], title: 'Y', version: 2 };
    });
    await B.sync(remote);

    const cur = await todoStore.getTodo('t1');
    await todoStore.putTodo({ ...cur!, title: 'X', version: 2 });
    await svcA.runOnce(); // 競合検出 → マーカー publish
    return { svcA, outcomes };
  }

  it('#29: 競合が共有マーカー経由で別端末にも表示される', async () => {
    const remote = new InMemoryAdapter();
    const clock = fixedClock();
    const { outcomes } = await setupTitleConflict(remote, clock);

    const aConflicts = outcomes.at(-1)!.conflicts;
    expect(aConflicts.some((c) => c.todoId === 't1' && c.field === 'title')).toBe(true);
    expect((await remote.list('conflicts/')).length).toBe(1); // マーカーがリモートに publish 済み

    // 別端末 C（ローカル空）を同じリモートで起動 → マーカー経由で同じ競合が見える。
    await clearDb();
    const cOutcomes: SyncOutcome[] = [];
    const svcC = createSyncService({
      adapter: remote,
      deviceId: 'C',
      clock,
      onOutcome: (o) => cOutcomes.push(o),
      onStatus: () => {},
    });
    await svcC.runOnce();

    const cLast = cOutcomes.at(-1)!;
    expect(cLast.conflicts).toEqual(aConflicts); // A と同一の競合集合
    expect(cLast.perTodoStatus['t1']).toBe('conflict');
  });

  it('#29: 保留中に別 todo を編集してもマーカーは残る（黙って消えない / sticky）', async () => {
    const remote = new InMemoryAdapter();
    const clock = fixedClock();
    const { svcA, outcomes } = await setupTitleConflict(remote, clock);
    expect(outcomes.at(-1)!.conflicts.some((c) => c.todoId === 't1')).toBe(true);

    // 別 todo を編集して同期 → t1 の競合マーカーは残り続ける。
    await todoStore.putTodo(makeTodo({ id: 't2', title: 'other' }));
    await svcA.runOnce();

    expect(outcomes.at(-1)!.conflicts.some((c) => c.todoId === 't1')).toBe(true);
    expect((await remote.list('conflicts/')).length).toBe(1);
  });

  it('#29: 解決がマーカー削除で別端末にも伝播する', async () => {
    const remote = new InMemoryAdapter();
    const clock = fixedClock();
    const { svcA, outcomes } = await setupTitleConflict(remote, clock);

    await svcA.resolveConflict('t1', { title: 'Y' });
    expect(outcomes.at(-1)!.conflicts).toEqual([]);
    expect((await remote.list('conflicts/')).length).toBe(0); // マーカー削除済み

    // 別端末 C（ローカル空）でも競合は出ない。
    await clearDb();
    const cOutcomes: SyncOutcome[] = [];
    const svcC = createSyncService({
      adapter: remote,
      deviceId: 'C',
      clock,
      onOutcome: (o) => cOutcomes.push(o),
      onStatus: () => {},
    });
    await svcC.runOnce();

    expect(cOutcomes.at(-1)!.conflicts).toEqual([]);
    expect(cOutcomes.at(-1)!.perTodoStatus['t1']).toBe('synced');
  });

  it('#29: マーカー削除が失敗しても保留に残り、次回同期で確実に削除される', async () => {
    const inner = new InMemoryAdapter();
    let failDeletesLeft = 1; // 最初の conflicts/ 削除だけ失敗させる（オフライン/transient 模擬）。
    const remote: StorageAdapter = {
      list: (p) => inner.list(p),
      get: (k) => inner.get(k),
      put: (k, b) => inner.put(k, b),
      delete: (k) => {
        if (k.startsWith('conflicts/') && failDeletesLeft > 0) {
          failDeletesLeft--;
          return Promise.reject(new Error('offline'));
        }
        return inner.delete(k);
      },
    };
    const clock = fixedClock();
    const { svcA } = await setupTitleConflict(remote, clock);
    expect((await inner.list('conflicts/')).length).toBe(1);

    // 解決時の削除は失敗 → マーカーは残り、保留集合に t1 が積まれる。
    await svcA.resolveConflict('t1', { title: 'Y' });
    expect((await inner.list('conflicts/')).length).toBe(1);
    expect(await getPendingConflictDeletes()).toContain('t1');

    // 次回同期（削除成功）→ マーカーが消え、保留集合が空になる。
    await svcA.runOnce();
    expect((await inner.list('conflicts/')).length).toBe(0);
    expect(await getPendingConflictDeletes()).toEqual([]);
  });

  it('#29: 競合する解決は再衝突として再検出され収束に向かう', async () => {
    const remote = new InMemoryAdapter();
    const clock = fixedClock();
    const B = makeDevice('B', clock);
    await B.commit((todos) => {
      todos['t1'] = makeTodo({ id: 't1', title: 'base' });
    });
    await B.sync(remote);

    const outcomes: SyncOutcome[] = [];
    const svcA = createSyncService({
      adapter: remote,
      deviceId: 'A',
      clock,
      onOutcome: (o) => outcomes.push(o),
      onStatus: () => {},
    });
    await svcA.runOnce();

    // B: title=Y。A: title=X → 競合。
    await B.commit((todos) => {
      todos['t1'] = { ...todos['t1'], title: 'Y', version: 2 };
    });
    await B.sync(remote);
    const cur = await todoStore.getTodo('t1');
    await todoStore.putTodo({ ...cur!, title: 'X', version: 2 });
    await svcA.runOnce(); // 競合（X vs Y）

    // A は Z に解決（マーカー削除）。B は A の解決を pull せず W に別解決（B 先端 Y の子）。
    // B は publish のみ（sync すると A の解決を取り込んで自分でマージしてしまい、分岐が作れない）。
    await svcA.resolveConflict('t1', { title: 'Z' });
    await B.commit((todos) => {
      todos['t1'] = { ...todos['t1'], title: 'W', version: 3 };
    });
    await B.publish(remote);

    // A 再同期 → Z と W が再衝突として再検出され、両端末に新マーカーが出る。
    await svcA.runOnce();
    const last = outcomes.at(-1)!;
    const c = last.conflicts.find((x) => x.todoId === 't1' && x.field === 'title');
    expect(c).toBeDefined();
    expect([c!.left, c!.right].sort()).toEqual(['W', 'Z']);
    expect((await remote.list('conflicts/')).length).toBe(1);
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
