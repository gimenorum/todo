import type { DeviceId, Uuid } from './types';

// model/ は実行時依存ゼロ。crypto はプラットフォーム標準グローバル（import 不要）。

export function newUuid(): Uuid {
  return crypto.randomUUID();
}

// 端末ごとに一度だけ生成し、metaStore に永続する（呼び出しは store/services 側）。
export function newDeviceId(): DeviceId {
  return crypto.randomUUID();
}
