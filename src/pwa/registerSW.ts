// 手書き SW を登録（ch.12）。オフライン起動・インストールの基盤。
export function registerServiceWorker(): void {
  // dev では SW を登録しない（本番ビルドで有効。dev は HMR と相性が悪い）。
  if (import.meta.env.DEV) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    // base 相対で登録＝オリジン/サブパス非依存（決定 #1）。
    navigator.serviceWorker.register('./sw.js').catch((err: unknown) => {
      console.error('[pwa] service worker registration failed', err);
    });
  });
}
