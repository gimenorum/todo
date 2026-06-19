// services/notify.ts — Web 通知の薄いラッパ（Issue #71 / ch.19）。
// サーバなし（BYOS）。Service Worker があれば registration.showNotification() を、
// 無ければメインスレッドの new Notification() を使う。例外は握りつぶす（環境差吸収）。

export type Permission = NotificationPermission | 'unsupported';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

// 'default' | 'granted' | 'denied' | 'unsupported'。
export function getPermission(): Permission {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

// 許可をユーザー操作内で要求する。非対応・例外時は 'unsupported'/'denied' を返す。
export async function requestNotificationPermission(): Promise<Permission> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

// 通知を表示する。許可されていなければ何もしない。
export async function showNotification(title: string, options?: NotificationOptions): Promise<void> {
  if (getPermission() !== 'granted') return;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    // SW 経由が使えない環境はメインスレッドにフォールバック。
  }
  try {
    new Notification(title, options);
  } catch {
    // 一部環境（Android Chrome 等）は new Notification() が throw する。黙って諦める。
  }
}
