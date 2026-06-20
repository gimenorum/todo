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

// 有効な SW 登録を最大 timeoutMs だけ待って返す（無ければ null）。
// `navigator.serviceWorker.ready` は有効化済み SW が無いと永久に解決しないため、
// タイムアウトでレースして打ち切る（dev / SW 未登録でハングしない / Issue #71）。
async function activeRegistration(timeoutMs = 1500): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

// 通知を表示する。表示できたら true、できなければ false（許可なし・失敗）。
// ページコンテキストの new Notification() を優先する（macOS Safari/Chrome で確実に表示。
// SW 経由の registration.showNotification() は通常タブの Safari 等で表示されないため）。
// new Notification() が throw する環境（Android Chrome）でのみ SW にフォールバックする。
export async function showNotification(title: string, options?: NotificationOptions): Promise<boolean> {
  if (getPermission() !== 'granted') return false;
  try {
    new Notification(title, options);
    return true;
  } catch {
    // Android Chrome 等は new Notification() が「Illegal constructor」で throw → SW へ。
  }
  try {
    const reg = await activeRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }
  } catch {
    // SW 経由も不可。
  }
  return false;
}
