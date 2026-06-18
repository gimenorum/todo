import { defineConfig, type PluginOption } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));

// バージョンは package.json を単一の真実として参照（ch.15）。SW のキャッシュ名・設定画面表示に使う。
// 別定数へハードコードすると版数がドリフトするため、リリース時は package.json の version だけ更新する。
const APP_VERSION = (
  JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as { version: string }
).version;

/**
 * 本番ビルド時のみ CSP を <meta http-equiv> として注入する（GitHub Pages はヘッダ不可 / ch.12・14）。
 * dev サーバは HMR がインライン/eval を使うため CSP を入れない。
 * Phase 2 で Dropbox の API FQDN を connect-src に追加（download/upload と RPC/token）。
 * 認可ページ https://www.dropbox.com/oauth2/authorize はトップレベル遷移のため connect-src 対象外。
 * Phase 3 で Google（GIS トークンモデル / ch.05 §5.5）を追加: GIS スクリプト（script-src）、
 * Drive API www.googleapis.com（connect-src）、GIS の無音 iframe accounts.google.com（frame-src）。
 * 認可ポップアップはトップレベル遷移のため対象外。
 */
function injectCspMeta(): PluginOption {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "connect-src 'self' https://api.dropboxapi.com https://content.dropboxapi.com https://www.googleapis.com https://accounts.google.com",
    "frame-src 'self' https://accounts.google.com",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join('; ');
  return {
    name: 'inject-csp-meta',
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html; // dev では入れない（HMR と相性が悪い）
      // charset を最優先に保ち、CSP はその直後へ置く（後続リソース読み込みに効かせる / ch.12）。
      const cspTag = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
      const withCsp = html.replace(
        /(<meta\s+charset=["'][^"']*["']\s*\/?>)/i,
        `$1\n    ${cspTag}`,
      );
      // charset が見つからない場合のフォールバック（head 先頭）。
      return withCsp === html ? html.replace(/<head>/i, `<head>\n    ${cspTag}`) : withCsp;
    },
  };
}

export default defineConfig({
  // オリジン/サブパス非依存（決定 #1）。独自ドメイン・サブパスどちらでも同一成果物が動く。
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [injectCspMeta()],
  build: {
    target: 'es2022',
    rollupOptions: {
      // アプリ本体と手書き SW を複数入力に（ch.12・15）。
      input: {
        app: resolve(root, 'index.html'),
        sw: resolve(root, 'src/sw/sw.ts'),
      },
      output: {
        // SW は固定名 sw.js（ルート出力）、それ以外はハッシュ付き。
        entryFileNames: (chunk) =>
          chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // store 層テスト用に IndexedDB を polyfill（jsdom/node とも未実装 / ch.16）。
    setupFiles: ['fake-indexeddb/auto'],
  },
});
