import { describe, expect, it } from 'vitest';
import { deleteToken, getToken, putToken } from '../../src/store/tokenStore';

describe('store/tokenStore (fake-indexeddb)', () => {
  it('putToken → getToken 往復', async () => {
    await putToken('dropbox', {
      accessToken: 'A',
      refreshToken: 'R',
      expiresAt: 123,
      accountId: 'acc',
    });
    expect(await getToken('dropbox')).toEqual({
      accessToken: 'A',
      refreshToken: 'R',
      expiresAt: 123,
      accountId: 'acc',
    });
  });

  it('deleteToken で null に戻る', async () => {
    await putToken('dropbox', { accessToken: 'X' });
    await deleteToken('dropbox');
    expect(await getToken('dropbox')).toBeNull();
  });

  it('未設定 provider は null', async () => {
    expect(await getToken('gdrive')).toBeNull();
  });
});
