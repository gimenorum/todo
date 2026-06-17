// @vitest-environment node
//
// 要件「テストすべき並行シナリオ」の 6 本（ch.16 §16.2）。
// すべて InMemory 上で決定的に。各テストは「セットアップ → syncOnce を両端末で
// 交互に実行 → SyncResult（mergedSnapshot / conflicts / picked）を assert」。
import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncResult } from '../../src/model/types';
import { Device, establishCommonBase } from '../helpers/device';
import { fixedClock, makeDevice, makeTodo } from '../helpers/factories';
import { newAdapter } from '../helpers/storage';

let A: Device;
let B: Device;

beforeEach(() => {
  const clock = fixedClock(); // 全端末で共有＝単調増加で決定的
  A = makeDevice('A', clock);
  B = makeDevice('B', clock);
});

describe('6 並行シナリオ（ch.16 §16.2）', () => {
  it('#1 別々の項目を編集 → 両方残る・競合 0', async () => {
    const adapter = newAdapter();
    await establishCommonBase(adapter, [A, B]); // 空の base
    await A.commit((t) => (t['x'] = makeTodo({ id: 'x', title: 'X' })));
    await B.commit((t) => (t['y'] = makeTodo({ id: 'y', title: 'Y' })));
    await A.sync(adapter);
    const res = await B.sync(adapter);

    expect(res.conflicts).toEqual([]);
    expect(Object.keys(res.mergedSnapshot.todos).sort()).toEqual(['x', 'y']);
  });

  it('#2 同一 parent からの同時 commit（fork）→ LCA 3-way で一貫・決定的', async () => {
    const adapter = newAdapter();
    const base = await establishCommonBase(adapter, [A, B], (t) => {
      t['x'] = makeTodo({ id: 'x', title: 'orig' });
    });
    await A.commit((t) => (t['x'].priority = 'high'));
    await B.commit((t) => (t['x'].dueDate = 999));
    await A.sync(adapter);
    const res = await B.sync(adapter);

    expect(res.conflicts).toEqual([]);
    expect(res.picked?.base).toBe(base); // LCA が共通 base を正しく選ぶ
    expect(res.mergedSnapshot.todos['x'].priority).toBe('high');
    expect(res.mergedSnapshot.todos['x'].dueDate).toBe(999);
    // 2 度目の同期は新規マージなし（picked=null）で同一先端に留まる。
    const again = await B.sync(adapter);
    expect(again.picked).toBeNull();
    expect(again.newHead).toBe(res.newHead);
  });

  it('#3 同一 TODO の異なるフィールド → 自動マージ・競合 0', async () => {
    const adapter = newAdapter();
    await establishCommonBase(adapter, [A, B], (t) => {
      t['x'] = makeTodo({ id: 'x', title: 'orig', notes: '' });
    });
    await A.commit((t) => (t['x'].title = 'A-title'));
    await B.commit((t) => (t['x'].notes = 'B-notes'));
    await A.sync(adapter);
    const res = await B.sync(adapter);

    expect(res.conflicts).toEqual([]);
    expect(res.mergedSnapshot.todos['x'].title).toBe('A-title');
    expect(res.mergedSnapshot.todos['x'].notes).toBe('B-notes');
  });

  it('#4 同一 TODO の同じフィールドを別値 → 競合検出・自動解決しない', async () => {
    const adapter = newAdapter();
    await establishCommonBase(adapter, [A, B], (t) => {
      t['x'] = makeTodo({ id: 'x', title: 'orig' });
    });
    await A.commit((t) => (t['x'].title = 'A-title'));
    await B.commit((t) => (t['x'].title = 'B-title'));
    await A.sync(adapter);
    const res = await B.sync(adapter);

    expect(res.conflicts).toHaveLength(1);
    const c = res.conflicts[0];
    expect(c.todoId).toBe('x');
    expect(c.field).toBe('title');
    expect(c.base).toBe('orig');
    expect([c.left, c.right].sort()).toEqual(['A-title', 'B-title']);
    // 暫定値は left（competing の片側）を保持。
    expect(res.mergedSnapshot.todos['x'].title).toBe(c.left);
  });

  it('#5 片方が編集・他方が削除（edit vs delete）→ deleted 競合', async () => {
    const adapter = newAdapter();
    await establishCommonBase(adapter, [A, B], (t) => {
      t['x'] = makeTodo({ id: 'x', title: 'orig' });
    });
    await A.commit((t) => (t['x'].title = 'edited'));
    await B.commit((t) => (t['x'].deleted = true));
    await A.sync(adapter);
    const res = await B.sync(adapter);

    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].field).toBe('deleted');
    expect([res.conflicts[0].left, res.conflicts[0].right].sort()).toEqual([false, true]);
    // 編集版が残り（黙って消えない）、TODO はマージ結果に存在する。
    expect(res.mergedSnapshot.todos['x']).toBeDefined();
    expect(res.mergedSnapshot.todos['x'].title).toBe('edited');
  });

  it('#6 古い状態からの上書き → deriveHeads で検出・マージで変更が消えない', async () => {
    const adapter = newAdapter();
    await establishCommonBase(adapter, [A, B], (t) => {
      t['x'] = makeTodo({ id: 'x', title: 'orig', notes: '' });
    });
    // A は新しい状態を publish。
    await A.commit((t) => (t['x'].title = 'new'));
    await A.sync(adapter);
    // B は古い base のまま別フィールドを編集（pull せず上書き的に commit）。
    await B.commit((t) => (t['x'].notes = 'from-old'));
    const res = await B.sync(adapter);

    expect(res.conflicts).toEqual([]);
    expect(res.mergedSnapshot.todos['x'].title).toBe('new'); // A の変更が残る
    expect(res.mergedSnapshot.todos['x'].notes).toBe('from-old'); // B の変更も残る
  });
});

describe('削除の自動適用（ch.04 §4.5）', () => {
  it('削除 vs 未編集（別項目を編集）→ x は競合なしで削除適用・追加も残る', async () => {
    const adapter = newAdapter();
    await establishCommonBase(adapter, [A, B], (t) => {
      t['x'] = makeTodo({ id: 'x', title: 'orig' });
    });
    await A.commit((t) => (t['x'].deleted = true)); // A: x を削除（内容は保持）
    await B.commit((t) => (t['y'] = makeTodo({ id: 'y', title: 'Y' }))); // B: x は触らず別項目追加
    await A.sync(adapter);
    const res = await B.sync(adapter); // fork → マージ

    expect(res.picked).not.toBeNull(); // マージが発生
    expect(res.conflicts).toEqual([]); // x は競合にならない（編集が無いため削除を自動適用）
    expect(res.mergedSnapshot.todos['x'].deleted).toBe(true); // 削除が適用
    expect(res.mergedSnapshot.todos['y']).toBeDefined(); // B の追加も残る
  });
});

describe('CAS 非依存（ch.16 §16.3 / 受け入れ基準）', () => {
  it('putIfAbsent を無効化しても fork は正しくマージされる', async () => {
    const adapter = newAdapter({ cas: false });
    expect(adapter.putIfAbsent).toBeUndefined();
    await establishCommonBase(adapter, [A, B], (t) => {
      t['x'] = makeTodo({ id: 'x', title: 'orig' });
    });
    await A.commit((t) => (t['x'].title = 'A-title'));
    await B.commit((t) => (t['x'].title = 'B-title'));
    await A.sync(adapter);
    const res = await B.sync(adapter);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].field).toBe('title');
  });
});

describe('一覧の遅延整合でも fork を吸収（ch.05 §5.3）', () => {
  it('list 遅延中は単一先端、flush 後に fork を検出してマージ', async () => {
    const adapter = newAdapter({ lazyList: true });
    await A.commit((t) => (t['x'] = makeTodo({ id: 'x', title: 'orig' })));
    await A.sync(adapter);
    adapter.flush(); // base を可視化
    await B.sync(adapter); // B が base を取得

    await A.commit((t) => (t['x'].title = 'new'));
    await B.commit((t) => (t['x'].notes = 'note'));
    await A.publish(adapter); // A の先端は list からは未だ不可視（遅延）

    const r1 = await B.sync(adapter);
    expect(r1.picked).toBeNull(); // A の先端が見えない → 単一先端（マージ無し）

    adapter.flush(); // 遅延解消
    const r2 = await B.sync(adapter);
    expect(r2.picked).not.toBeNull(); // fork を検出 → マージ
    expect(r2.conflicts).toEqual([]);
    expect(r2.mergedSnapshot.todos['x'].title).toBe('new');
    expect(r2.mergedSnapshot.todos['x'].notes).toBe('note');
  });
});

// SyncResult の形を固定（観測用メタを含む）。
describe('SyncResult の不変条件', () => {
  it('マージ時は picked（base/left/right）と newHead を返す', async () => {
    const adapter = newAdapter();
    await establishCommonBase(adapter, [A, B], (t) => {
      t['x'] = makeTodo({ id: 'x', title: 'orig' });
    });
    await A.commit((t) => (t['x'].title = 'A-title'));
    await B.commit((t) => (t['x'].title = 'B-title'));
    await A.sync(adapter);
    const res: SyncResult = await B.sync(adapter);
    expect(res.newHead).not.toBeNull();
    expect(res.picked).not.toBeNull();
    expect(res.picked?.left).not.toBe(res.picked?.right);
  });
});
