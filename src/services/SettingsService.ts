import * as settingsStore from '../store/settingsStore';
import { getOrCreateDeviceId } from '../store/metaStore';
import type { DeviceId, DeviceSettings } from '../model/types';

export async function loadSettings(): Promise<DeviceSettings> {
  return settingsStore.loadSettings();
}

export async function updateSettings(
  patch: Partial<DeviceSettings>,
): Promise<DeviceSettings> {
  const current = await settingsStore.loadSettings();
  const next: DeviceSettings = { ...current, ...patch };
  await settingsStore.saveSettings(next);
  return next;
}

export async function deviceId(): Promise<DeviceId> {
  return getOrCreateDeviceId();
}
