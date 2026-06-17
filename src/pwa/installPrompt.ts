// beforeinstallprompt を捕捉し、インストール導線を提供する（ch.12）。
// 返り値は ui/context.ts の InstallController と構造的に一致する（ui への依存は持たない）。

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function setupInstall() {
  let deferred: BeforeInstallPromptEvent | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of listeners) l();
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    // 既定のミニインフォバーを抑止し、自前の導線から出す。
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });

  // iOS は beforeinstallprompt 非対応。Safari の「ホーム画面に追加」を案内する。
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return {
    canInstall: (): boolean => deferred !== null,
    async promptInstall(): Promise<void> {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      notify();
    },
    onChange: (cb: () => void): void => {
      listeners.add(cb);
    },
    isIOS,
    isStandalone,
  };
}
