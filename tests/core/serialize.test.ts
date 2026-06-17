// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hash, serializeCommit, serializeSnapshot } from '../../src/core';
import type { Commit, Todo } from '../../src/model/types';
import { makeTodo } from '../helpers/factories';

const dec = new TextDecoder();

describe('serialize 決定性（ch.04 §4.1）', () => {
  it('オブジェクトのキー挿入順が違っても同一バイト列・同一ハッシュ', async () => {
    const a: Todo = makeTodo({ id: 'x', title: 'T', tags: ['a', 'b'], priority: 'high' });
    // 同値だがキーの並びを入れ替えたオブジェクト。
    const scrambled = {
      version: 1,
      id: 'x',
      deleted: false,
      updatedAt: 0,
      createdAt: 0,
      order: '',
      tags: ['a', 'b'],
      notes: '',
      priority: 'high',
      dueDate: null,
      done: false,
      title: 'T',
    } as Todo;

    const sa = serializeSnapshot({ todos: { x: a } });
    const sb = serializeSnapshot({ todos: { x: scrambled } });
    expect(dec.decode(sa)).toBe(dec.decode(sb));
    expect(await hash(sa)).toBe(await hash(sb));
  });

  it('-0 は 0 に正規化される', () => {
    const z = serializeSnapshot({ todos: { x: makeTodo({ id: 'x', dueDate: 0 }) } });
    const negZ = serializeSnapshot({ todos: { x: makeTodo({ id: 'x', dueDate: -0 }) } });
    expect(dec.decode(z)).toBe(dec.decode(negZ));
  });

  it('非有限数（NaN）は投げる', () => {
    expect(() => serializeSnapshot({ todos: { x: makeTodo({ id: 'x', dueDate: NaN }) } })).toThrow();
  });

  it('id 昇順に正規化されるため、todos の挿入順に依存しない', async () => {
    const t1 = makeTodo({ id: 'aaa', title: '1' });
    const t2 = makeTodo({ id: 'bbb', title: '2' });
    const s1 = serializeSnapshot({ todos: { aaa: t1, bbb: t2 } });
    const s2 = serializeSnapshot({ todos: { bbb: t2, aaa: t1 } });
    expect(await hash(s1)).toBe(await hash(s2));
  });

  it('マージコミット blob は deviceId 非格納・timestamp=親最大の純関数（収束の核心）', () => {
    const base: Commit = { parents: ['h1', 'h2'], snapshot: 'snap', timestamp: 0, deviceId: 'A' };
    const other: Commit = { parents: ['h2', 'h1'], snapshot: 'snap', timestamp: 0, deviceId: 'B' };
    const a = serializeCommit(base, [10, 20]);
    const b = serializeCommit(other, [20, 10]);
    // deviceId と parents の並び順に依存せず同一バイト列。
    expect(dec.decode(a)).toBe(dec.decode(b));
    const parsed = JSON.parse(dec.decode(a)) as Record<string, unknown>;
    expect(parsed.deviceId).toBeUndefined();
    expect(parsed.timestamp).toBe(20); // 親 timestamp の最大
  });

  it('通常コミット（単一親）は deviceId を含み、端末ごとに異なるバイト列', () => {
    const c1: Commit = { parents: ['p'], snapshot: 'snap', timestamp: 5, deviceId: 'A' };
    const c2: Commit = { parents: ['p'], snapshot: 'snap', timestamp: 5, deviceId: 'B' };
    expect(dec.decode(serializeCommit(c1, [1]))).not.toBe(dec.decode(serializeCommit(c2, [1])));
    const parsed = JSON.parse(dec.decode(serializeCommit(c1, [1]))) as Record<string, unknown>;
    expect(parsed.deviceId).toBe('A');
  });
});
