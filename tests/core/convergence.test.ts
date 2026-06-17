// @vitest-environment node
//
// マージコミット収束（ch.04 §4.1/§4.6・②）。両端末が push 前に同じ fork を各自マージ
// しても、マージコミット blob は deviceId 非格納＝決定的なので **同一ハッシュ** になり、
// dedup されて **単一先端へ収束**する（マージ合戦が起きない）。
import { beforeEach, describe, expect, it } from 'vitest';
import { Device, establishCommonBase } from '../helpers/device';
import { fixedClock, makeDevice, makeTodo } from '../helpers/factories';
import { newAdapter } from '../helpers/storage';

let A: Device;
let B: Device;

beforeEach(() => {
  const clock = fixedClock();
  A = makeDevice('A', clock);
  B = makeDevice('B', clock);
});

describe('収束（ch.16 §16.3）', () => {
  it('別 deviceId の 2 端末が同じ fork を各自マージ → 同一マージコミット', async () => {
    const adapter = newAdapter();
    await establishCommonBase(adapter, [A, B], (t) => {
      t['x'] = makeTodo({ id: 'x', title: 'orig', notes: '' });
    });
    await A.commit((t) => (t['x'].title = 'A-title'));
    await B.commit((t) => (t['x'].notes = 'B-notes'));
    // マージせず両 leaf を publish（fork を素のまま用意）。
    await A.publish(adapter);
    await B.publish(adapter);

    // 同一の fork 状態を独立にマージする 2 端末（deviceId は別）。
    const clock = fixedClock();
    const C = makeDevice('C', clock);
    const D = makeDevice('D', clock);
    const rC = await C.sync(adapter.clone());
    const rD = await D.sync(adapter.clone());

    expect(rC.newHead).not.toBeNull();
    expect(rC.newHead).toBe(rD.newHead); // deviceId 非依存で同一ハッシュ
    expect(rC.conflicts).toEqual([]);
  });

  it('共有アダプタ上では単一先端へ収束する', async () => {
    const adapter = newAdapter();
    await establishCommonBase(adapter, [A, B], (t) => {
      t['x'] = makeTodo({ id: 'x', title: 'orig', notes: '' });
    });
    await A.commit((t) => (t['x'].title = 'A-title'));
    await B.commit((t) => (t['x'].notes = 'B-notes'));
    await A.publish(adapter);
    await B.publish(adapter);

    const clock = fixedClock();
    const C = makeDevice('C', clock);
    const D = makeDevice('D', clock);
    const rC = await C.sync(adapter); // C がマージして publish
    expect(rC.newHead).not.toBeNull();
    const rD = await D.sync(adapter); // D は C のマージを見て単一先端を採用
    expect(rD.newHead).toBeNull();

    // 新規端末から見ても先端は 1 つ（マージ結果に両変更が乗る）。
    const E = makeDevice('E', clock);
    const rE = await E.sync(adapter);
    expect(rE.newHead).toBeNull();
    expect(rE.mergedSnapshot.todos['x'].title).toBe('A-title');
    expect(rE.mergedSnapshot.todos['x'].notes).toBe('B-notes');
  });
});
