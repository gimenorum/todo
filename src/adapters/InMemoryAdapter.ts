// adapters/InMemoryAdapter.ts — テスト/開発用の純メモリアダプタ（ch.05 §5.3）
//
// 実体は Map<string, Uint8Array>。ネットワークも永続も持たないため、
// ch.16 の 6 シナリオが決定的・高速に回る。
//   - putIfAbsent（CAS）は任意の最適化。opts.cas=false で無効化でき、CAS 非依存を検証できる。
//   - opts.lazyList=true で「put 直後に list へ反映されない」遅延整合を擬似する
//     （Drive の一覧遅延整合 / 要件「ストレージアダプタ」）。get は常に即時。
import type { StorageAdapter } from '../model/types';

export interface InMemoryOptions {
  cas?: boolean; // 既定 true。false なら putIfAbsent を実装しない（CAS 非依存テスト）。
  lazyList?: boolean; // 既定 false。true なら新規 put が flush() まで list に出ない。
}

export class InMemoryAdapter implements StorageAdapter {
  private readonly store = new Map<string, Uint8Array>();
  private readonly hiddenFromList = new Set<string>();
  private readonly lazyList: boolean;

  // CAS 非依存を検証するため、opts.cas=false のときは putIfAbsent を未定義のままにする。
  putIfAbsent?: (key: string, bytes: Uint8Array) => Promise<boolean>;

  constructor(opts: InMemoryOptions = {}) {
    this.lazyList = opts.lazyList ?? false;
    if (opts.cas !== false) {
      this.putIfAbsent = (key, bytes) => this.#putIfAbsent(key, bytes);
    }
  }

  list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix) && !this.hiddenFromList.has(key)) out.push(key);
    }
    return Promise.resolve(out.sort());
  }

  get(key: string): Promise<Uint8Array | null> {
    const v = this.store.get(key);
    return Promise.resolve(v ? v.slice() : null);
  }

  put(key: string, bytes: Uint8Array): Promise<void> {
    this.store.set(key, bytes.slice());
    if (this.lazyList) this.hiddenFromList.add(key);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.store.delete(key);
    this.hiddenFromList.delete(key);
    return Promise.resolve();
  }

  // lazyList=true のとき、保留中の put を list へ反映する（遅延整合の解消）。
  flush(): void {
    this.hiddenFromList.clear();
  }

  // 同一状態の独立コピー（収束テストで 2 端末が同じ fork を各自マージするのに使う）。
  clone(): InMemoryAdapter {
    const copy = new InMemoryAdapter({
      cas: this.putIfAbsent !== undefined,
      lazyList: this.lazyList,
    });
    for (const [k, v] of this.store) copy.store.set(k, v.slice());
    for (const k of this.hiddenFromList) copy.hiddenFromList.add(k);
    return copy;
  }

  #putIfAbsent(key: string, bytes: Uint8Array): Promise<boolean> {
    if (this.store.has(key)) return Promise.resolve(false);
    this.store.set(key, bytes.slice());
    if (this.lazyList) this.hiddenFromList.add(key);
    return Promise.resolve(true);
  }
}
