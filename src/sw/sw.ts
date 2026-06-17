/// <reference lib="webworker" />
import { clearOldCaches, handleAsset, handleNavigation, precache } from './cache-strategies';

// 手書き SW（依存なし・別ビルド入力 / ch.12）。import は Rollup が単一ファイルへ inline する。

declare const self: ServiceWorkerGlobalScope;

// install: アプリシェルを precache（バージョン付きキャッシュ名）。
self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

// activate: 旧バージョンのキャッシュを掃除し、現在のクライアントを制御下に置く。
// skipWaiting はしない（更新は次回起動で切替＝安全側 / ch.12 §12.1）。
self.addEventListener('activate', (event) => {
  event.waitUntil(clearOldCaches().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // データ/OAuth 通信は介入しない（network only）。

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // クロスオリジンは素通し。

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(req));
    return;
  }
  event.respondWith(handleAsset(req));
});
