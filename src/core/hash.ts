// core/hash.ts — SHA-256 と再ハッシュ検証（ch.04 §4.2）
//
// ストレージから取得した全 blob は使用前に再ハッシュ検証する。
// 不一致なら IntegrityError を投げ、その blob は捨てて再取得する（呼び出し側）。
// verify は取得したバイト列をそのまま再ハッシュして key と照合する
// （Commit から再直列化しない）。マージコミット blob は deviceId 非格納だが、
// バイト列そのものを照合するため齟齬は生じない。
import type { Hash } from '../model/types';

export class IntegrityError extends Error {
  readonly key: Hash;
  constructor(key: Hash) {
    super(`IntegrityError: blob のハッシュが鍵と一致しません（${key}）`);
    this.name = 'IntegrityError';
    this.key = key;
  }
}

// 0..255 → 2 桁 hex の事前テーブル（小文字）。
const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i]];
  return s;
}

// SHA-256 → 64 桁 hex 小文字。crypto.subtle はプラットフォーム標準（Node 20+/ブラウザ）。
export async function hash(bytes: Uint8Array): Promise<Hash> {
  // digest は ArrayBuffer 裏付けの BufferSource を要求するため、コピーして渡す
  // （TS 5.7 の Uint8Array<ArrayBufferLike> 対策。blob は小さくコピーは安価）。
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return toHex(digest);
}

// 取得 blob の整合性検証。一致しなければ IntegrityError。
export async function verify(key: Hash, bytes: Uint8Array): Promise<void> {
  const actual = await hash(bytes);
  if (actual !== key) throw new IntegrityError(key);
}
