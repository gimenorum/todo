import { beforeEach, describe, expect, it } from 'vitest';
import * as settingsSvc from '../../src/services/SettingsService';
import * as tokenStore from '../../src/store/tokenStore';
import { getDb } from '../../src/store/db';
import { STORE } from '../../src/model/constants';

async function clearDb(): Promise<void> {
  const db = await getDb();
  await Promise.all([db.clear(STORE.settings), db.clear(STORE.tokens), db.clear(STORE.meta)]);
}

beforeEach(clearDb);

describe('services/SettingsService（連携）', () => {
  it('未連携では buildAdapter は null', async () => {
    expect(await settingsSvc.buildAdapter()).toBeNull();
  });

  it('connectedProvider=dropbox でもトークンが無ければ buildAdapter は null', async () => {
    await settingsSvc.updateSettings({ connectedProvider: 'dropbox' });
    expect(await settingsSvc.buildAdapter()).toBeNull();
  });

  it('トークンがあれば buildAdapter はアダプタを返し、disconnect で破棄される', async () => {
    await settingsSvc.updateSettings({ connectedProvider: 'dropbox' });
    await tokenStore.putToken('dropbox', { accessToken: 'A' });
    expect(await settingsSvc.buildAdapter()).not.toBeNull();

    const next = await settingsSvc.disconnect();
    expect(next.connectedProvider).toBe('none');
    expect(await tokenStore.getToken('dropbox')).toBeNull();
    expect(await settingsSvc.buildAdapter()).toBeNull();
  });

  it('isOAuthCallback は ?code= を検出する', () => {
    expect(settingsSvc.isOAuthCallback('?code=abc&state=x')).toBe(true);
    expect(settingsSvc.isOAuthCallback('?foo=1')).toBe(false);
  });

  it('App key 未設定では connectDropbox がエラーになる', async () => {
    await expect(settingsSvc.connectDropbox()).rejects.toThrow(/VITE_DROPBOX_APP_KEY/);
  });

  it('connectedProvider=gdrive ＋トークンで buildAdapter を返し、disconnect で破棄される', async () => {
    await settingsSvc.updateSettings({ connectedProvider: 'gdrive' });
    await tokenStore.putToken('gdrive', { accessToken: 'G', expiresAt: Date.now() + 3_600_000 });
    expect(await settingsSvc.buildAdapter()).not.toBeNull();

    const next = await settingsSvc.disconnect();
    expect(next.connectedProvider).toBe('none');
    expect(await tokenStore.getToken('gdrive')).toBeNull();
    expect(await settingsSvc.buildAdapter()).toBeNull();
  });

  it('Client ID 未設定では isGoogleConfigured=false・connectGoogle はエラー', async () => {
    expect(settingsSvc.isGoogleConfigured()).toBe(false);
    await expect(settingsSvc.connectGoogle()).rejects.toThrow(/VITE_GOOGLE_CLIENT_ID/);
  });
});
