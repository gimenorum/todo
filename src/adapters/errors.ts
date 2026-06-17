// adapters/errors.ts — アダプタが投げる分類用エラー（ch.09 §9.5）。
// SyncService が「一時的なエラー」と「再認証が必要（needs-reauth）」を区別するのに使う。
export class AuthError extends Error {
  constructor(message = '認証が失効しました。再連携が必要です。') {
    super(message);
    this.name = 'AuthError';
  }
}
