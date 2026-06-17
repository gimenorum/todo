// tests/helpers/factories.ts — 決定的テスト用ファクトリ（ch.16 §16.1）
import type { Clock, Millis, Snapshot, Todo, Uuid } from '../../src/model/types';
import { Device } from './device';

// 既定値入りの Todo（必要な値だけ上書き）。
export function makeTodo(partial: Partial<Todo> & { id: Uuid }): Todo {
  return {
    id: partial.id,
    title: partial.title ?? '',
    done: partial.done ?? false,
    dueDate: partial.dueDate ?? null,
    priority: partial.priority ?? 'none',
    notes: partial.notes ?? '',
    tags: partial.tags ?? [],
    order: partial.order ?? '',
    createdAt: partial.createdAt ?? 0,
    updatedAt: partial.updatedAt ?? 0,
    deleted: partial.deleted ?? false,
    version: partial.version ?? 1,
  };
}

export function seedSnapshot(todos: Todo[]): Snapshot {
  const map: Record<Uuid, Todo> = {};
  for (const t of todos) map[t.id] = t;
  return { todos: map };
}

// 単調増加の固定クロック。now() 呼び出しごとに step 進む（時刻注入＝決定性）。
export function fixedClock(start: Millis = 1000, step: Millis = 1000): Clock {
  let cur = start;
  return {
    now(): Millis {
      const t = cur;
      cur += step;
      return t;
    },
  };
}

// deviceId を固定した端末ハーネスを作る。
export function makeDevice(id: string, clock: Clock): Device {
  return new Device(id, clock);
}
