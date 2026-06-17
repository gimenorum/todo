import { defineConfig, type PluginOption } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// 本番オリジンに依存しない固定バージョン（決定 #1 / ch.15）。SW のキャッシュ名等に使う。
const APP_VERSION = '0.0.1';

/**
 * 本番ビルド時のみ CSP を <meta http-equiv> として注入する（GitHub Pages はヘッダ不可 / ch.12・14）。
 * dev サーバは HMR がインライン/eval を使うため CSP を入れない。
 * Phase 0 はリモート保存先が無いため connect-src は 'self' のみ。Phase 2 で保存先 FQDN を追加する。
 */
function injectCspMeta(): PluginOption {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
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
  },
});
