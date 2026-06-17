// tests/helpers/storage.ts — テスト用 InMemory アダプタのファクトリ。
//
// tests/core からは本ヘルパ経由で取得し、core テストが src/adapters の実体を
// 直接 import しない構造を保つ（ch.02 §2.3 / ch.16 §16.4 の意図）。
import { InMemoryAdapter, type InMemoryOptions } from '../../src/adapters/InMemoryAdapter';

export function newAdapter(opts?: InMemoryOptions): InMemoryAdapter {
  return new InMemoryAdapter(opts);
}
