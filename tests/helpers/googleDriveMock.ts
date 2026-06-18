// tests/helpers/googleDriveMock.ts — Google Drive API v3（appDataFolder）の最小モック（ch.05 §5.6）。
// 実 API を叩かずに GoogleDriveAdapter の name↔key 写像・multipart・応答処理を契約テストで検証する。
// 対応: GET files（list / q=name='…' で find）, GET files/{id}?alt=media, POST upload(multipart),
// PATCH upload(media), DELETE files/{id}。バック実体は Map<name, {id, bytes}>。
export interface GoogleDriveMock {
  fetch: typeof fetch;
  store: Map<string, { id: string; bytes: Uint8Array }>;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// multipart/related の本文から name（メタデータ）と octet 本文を取り出す。
// latin1 で 1 バイト=1 文字に展開し、オフセットを元バイト列の slice に使う（バイナリ安全）。
function parseMultipart(body: Uint8Array): { name: string; bytes: Uint8Array } {
  const text = new TextDecoder('latin1').decode(body);
  const name = /"name"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? '';
  const marker = 'application/octet-stream\r\n\r\n';
  const start = text.indexOf(marker);
  if (start < 0) return { name, bytes: new Uint8Array() };
  const from = start + marker.length;
  const end = text.lastIndexOf('\r\n--'); // 末尾の閉じ境界 \r\n--boundary--
  return { name, bytes: body.slice(from, end >= from ? end : body.length) };
}

export function createGoogleDriveMock(
  opts: { requireAuth?: boolean; validToken?: string } = {},
): GoogleDriveMock {
  const store = new Map<string, { id: string; bytes: Uint8Array }>();
  const idToName = new Map<string, string>();
  let seq = 0;
  const valid = opts.validToken ?? 'test-token';

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = new URL(typeof input === 'string' ? input : input.toString());
    const path = u.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);

    if (opts.requireAuth) {
      const auth = headers.get('Authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== valid) return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
    }

    const upload = /\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(path);
    if (upload) {
      const id = upload[1];
      if (method === 'POST') {
        const { name, bytes } = parseMultipart(
          new Uint8Array((init?.body as Uint8Array) ?? new Uint8Array()),
        );
        const newId = `id${++seq}`;
        store.set(name, { id: newId, bytes });
        idToName.set(newId, name);
        return json({ id: newId });
      }
      if (method === 'PATCH' && id) {
        const name = idToName.get(id);
        if (!name) return new Response(null, { status: 404 });
        store.set(name, { id, bytes: new Uint8Array((init?.body as Uint8Array) ?? new Uint8Array()) });
        return json({ id });
      }
      return new Response(null, { status: 404 });
    }

    const drive = /\/drive\/v3\/files(?:\/([^/]+))?$/.exec(path);
    if (drive) {
      const id = drive[1];
      if (id) {
        const name = idToName.get(id);
        if (method === 'DELETE') {
          if (name) {
            store.delete(name);
            idToName.delete(id);
          }
          return new Response(null, { status: 204 });
        }
        // GET ?alt=media
        const entry = name ? store.get(name) : undefined;
        if (!entry) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(entry.bytes), { status: 200 });
      }
      // list / find by q（name='…'）
      const q = u.searchParams.get('q');
      const want = q ? /name\s*=\s*'([^']*)'/.exec(q)?.[1] : undefined;
      const names = [...store.keys()].filter((n) => want === undefined || n === want);
      const files = names.map((n) => ({ id: store.get(n)!.id, name: n }));
      return json({ files });
    }

    return new Response(null, { status: 404 });
  };

  return { fetch: impl as unknown as typeof fetch, store };
}
