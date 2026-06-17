// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hash, IntegrityError, serializeCommit, verify } from '../../src/core';
import type { Commit } from '../../src/model/types';

const enc = new TextEncoder();

describe('hash / 再ハッシュ検証（ch.04 §4.2）', () => {
  it('SHA-256 は 64 桁の小文字 hex', async () => {
    const h = await hash(enc.encode('hello'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verify は正しい鍵で成功する', async () => {
    const bytes = enc.encode('payload');
    const key = await hash(bytes);
    await expect(verify(key, bytes)).resolves.toBeUndefined();
  });

  it('改竄バイト列は IntegrityError', async () => {
    const bytes = enc.encode('payload');
    const key = await hash(bytes);
    const tampered = bytes.slice();
    tampered[0] ^= 0xff;
    await expect(verify(key, tampered)).rejects.toBeInstanceOf(IntegrityError);
  });

  it('マージコミット blob（deviceId 非格納）も検証対象', async () => {
    const merge: Commit = { parents: ['h1', 'h2'], snapshot: 'snap', timestamp: 0, deviceId: 'A' };
    const bytes = serializeCommit(merge, [10, 20]);
    const key = await hash(bytes);
    await expect(verify(key, bytes)).resolves.toBeUndefined();
    const tampered = bytes.slice();
    tampered[1] ^= 0xff;
    await expect(verify(key, tampered)).rejects.toBeInstanceOf(IntegrityError);
  });
});
