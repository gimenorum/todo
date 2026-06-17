import { getDb } from './db';
import { STORE, SETTINGS_KEY, DEFAULT_SETTINGS } from '../model/constants';
import type { DeviceSettings } from '../model/types';

// 端末ごと設定（同期しない / ch.06・受け入れ基準）。

export async function loadSettings(): Promise<DeviceSettings> {
  const db = await getDb();
  const saved = (await db.get(STORE.settings, SETTINGS_KEY)) as
    | Partial<DeviceSettings>
    | undefined;
  // 既定値で補完（新フィールド追加時の前方互換）。
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
}

export async function saveSettings(settings: DeviceSettings): Promise<void> {
  const db = await getDb();
  await db.put(STORE.settings, settings, SETTINGS_KEY);
}
