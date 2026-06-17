/// <reference lib="webworker" />

// 手書き SW のキャッシュ戦略（ch.12 §12.1）。アプリ内部モジュールには依存しない（別ビルド）。

declare const __APP_VERSION__: string;

// バージョン付きキャッシュ名（更新時に activate で旧版を掃除する）。
export const CACHE_NAME = `app-shell-${__APP_VERSION__}`;

// オフライン起動を保証する最小シェル（オリジン非依存＝相対 URL）。
export const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

export async function precache(): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(PRECACHE_URLS);
}

export async function clearOldCaches(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
}

// ナビゲーション要求: キャッシュ済みシェル優先 → ネット fallback（オフライン起動 / ch.12）。
export async function handleNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const shell = (await cache.match('./index.html')) ?? (await cache.match('./'));
  if (shell) {
    // バックグラウンドで最新版を取得し、次回起動に備えて更新（stale-while-revalidate 風）。
    void fetch(request)
      .then((res) => (res.ok ? cache.put('./index.html', res.clone()) : undefined))
      .catch(() => undefined);
    return shell;
  }
  return fetch(request);
}

// 同一オリジンの GET（ハッシュ付きアセット等）: キャッシュ優先 ＋ 実行時キャッシュ。
export async function handleAsset(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') void cache.put(request, res.clone());
  return res;
}
