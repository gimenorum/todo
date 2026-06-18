// tests/helpers/dropboxMock.ts — Dropbox API の最小モック（ch.05 §5.6・ch.16 §16.5）。
// 実 API を叩かずに DropboxAdapter のキー→パス写像と応答処理を契約テストで検証する。
// 対応エンドポイント: files/upload, files/download, files/list_folder(+continue は不要),
// files/delete_v2。バック実体は Map<dropboxPath, bytes>。
export interface DropboxMock {
  fetch: typeof fetch;
  store: Map<string, Uint8Array>;
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createDropboxMock(
  opts: { requireAuth?: boolean; validToken?: string } = {},
): DropboxMock {
  const store = new Map<string, Uint8Array>();
  const valid = opts.validToken ?? 'test-token';

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(typeof input === 'string' ? input : input.toString());
    const path = u.pathname; // 例: /2/files/download（クエリは無視してパスで判定）
    const headers = new Headers(init?.headers);
    // content エンドポイントは arg / authorization を URL クエリで受ける（CORS 単純化）。
    // RPC は従来どおりヘッダ＋本文。テストは両形式を受理する。
    const qArg = u.searchParams.get('arg');
    const qAuth = u.searchParams.get('authorization');

    if (opts.requireAuth) {
      const authRaw = qAuth ?? headers.get('Authorization') ?? '';
      const token = authRaw.startsWith('Bearer ') ? authRaw.slice(7) : '';
      if (token !== valid) return new Response(null, { status: 401 });
    }

    const readArg = (): { path: string } =>
      JSON.parse(qArg ?? headers.get('Dropbox-API-Arg') ?? '{}') as { path: string };

    if (path.endsWith('/files/upload')) {
      const arg = readArg();
      store.set(arg.path, new Uint8Array(init?.body as Uint8Array));
      return jsonResponse({ name: arg.path.split('/').pop(), path_lower: arg.path });
    }

    if (path.endsWith('/files/download')) {
      const arg = readArg();
      const v = store.get(arg.path);
      if (!v) return new Response(null, { status: 409 }); // path/not_found
      return new Response(new Uint8Array(v), { status: 200 });
    }

    if (path.endsWith('/files/list_folder')) {
      const body = JSON.parse((init?.body as string) ?? '{}') as { path: string };
      const folder = body.path; // '/objects'（末尾スラッシュ無し）
      const entries = [...store.keys()]
        .filter((p) => p.startsWith(`${folder}/`))
        .map((p) => ({ '.tag': 'file' as const, path_lower: p, name: p.split('/').pop() ?? '' }));
      return jsonResponse({ entries, cursor: 'END', has_more: false });
    }

    if (path.endsWith('/files/delete_v2')) {
      const body = JSON.parse((init?.body as string) ?? '{}') as { path: string };
      if (!store.has(body.path)) return new Response(null, { status: 409 });
      store.delete(body.path);
      return jsonResponse({ metadata: { path_lower: body.path } });
    }

    return new Response(null, { status: 404 });
  };

  return { fetch: impl as unknown as typeof fetch, store };
}
