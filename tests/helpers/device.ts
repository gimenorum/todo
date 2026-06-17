// tests/helpers/device.ts — 同期エンジン検証用の端末ハーネス（ch.16）
//
// 実 services を待たずに、core のプリミティブ（serialize/hash/syncOnce）で
// コミットを著作し、InMemory アダプタ越しに 2 端末の同期を決定的に再現する。
import {
  decodeCommit,
  decodeSnapshot,
  hash,
  publishHead,
  serializeCommit,
  serializeSnapshot,
  syncOnce,
  type LocalState,
} from '../../src/core';
import type {
  Clock,
  Commit,
  DeviceId,
  Hash,
  Snapshot,
  StorageAdapter,
  SyncResult,
  Todo,
  Uuid,
} from '../../src/model/types';

function mustGet(map: Map<Hash, Uint8Array>, h: Hash): Uint8Array {
  const v = map.get(h);
  if (!v) throw new Error(`device: object が複製にありません（${h}）`);
  return v;
}

export class Device {
  objects = new Map<Hash, Uint8Array>();
  head: Hash | null = null;

  constructor(
    readonly deviceId: DeviceId,
    private readonly clock: Clock,
  ) {}

  // 現在の先端のスナップショット（無ければ空）。
  currentSnapshot(): Snapshot {
    if (!this.head) return { todos: {} };
    const c = decodeCommit(mustGet(this.objects, this.head));
    return decodeSnapshot(mustGet(this.objects, c.snapshot));
  }

  // 通常コミットを著作する（version 等の方針は呼び出し側 mutate に委ねる）。
  async commit(mutate: (todos: Record<Uuid, Todo>) => void): Promise<Hash> {
    const next: Snapshot = { todos: structuredClone(this.currentSnapshot().todos) };
    mutate(next.todos);

    const snapBytes = serializeSnapshot(next);
    const snapHash = await hash(snapBytes);
    this.objects.set(snapHash, snapBytes);

    const parents = this.head ? [this.head] : [];
    const parentTs = parents.map((p) => decodeCommit(mustGet(this.objects, p)).timestamp);
    const commit: Commit = {
      parents,
      snapshot: snapHash,
      timestamp: this.clock.now(),
      deviceId: this.deviceId,
    };
    const commitBytes = serializeCommit(commit, parentTs);
    const commitHash = await hash(commitBytes);
    this.objects.set(commitHash, commitBytes);
    this.head = commitHash;
    return commitHash;
  }

  // 1 回同期。syncOnce がローカル複製・先端を最新化する。
  async sync(adapter: StorageAdapter): Promise<SyncResult> {
    const local: LocalState = { objects: this.objects, head: this.head, deviceId: this.deviceId };
    const res = await syncOnce(adapter, local);
    this.objects = local.objects;
    this.head = local.head;
    return res;
  }

  // マージせず先端だけ publish（収束テストで fork を素のまま用意するのに使う）。
  async publish(adapter: StorageAdapter): Promise<void> {
    await publishHead(adapter, {
      objects: this.objects,
      head: this.head,
      deviceId: this.deviceId,
    });
  }
}

// 共通の base コミットを作り、全端末をそこへ揃える（fork の出発点）。base の hash を返す。
export async function establishCommonBase(
  adapter: StorageAdapter,
  devices: Device[],
  seed: (todos: Record<Uuid, Todo>) => void = () => {},
): Promise<Hash> {
  const [first, ...rest] = devices;
  const base = await first.commit(seed);
  await first.sync(adapter);
  for (const d of rest) await d.sync(adapter);
  return base;
}
