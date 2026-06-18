// tests/helpers/googleDriveMock.ts — Google Drive API v3（appDataFolder）の最小モック（ch.05 §5.6）。
// 実 API を叩かずに GoogleDriveAdapter の name↔key 写像・multipart・応答処理を契約テストで検証する。
// 対応: GET files（list / q=name='…' で find）, GET files/{id}?alt=media, POST upload(multipart),
// PATCH upload(media), DELETE files/{id}。
//
// 実体は **id キーの Map**（`Map<id,{name,bytes}>`）。Drive は**同名ファイルを許可**するため、name キーの Map で
// は実挙動（同名重複）を再現できない（Issue #29 フォローアップでこの差がバグを見逃した）。
//   - `lazyList:true` で**遅延整合**を擬似する: POST 新規作成は `flush()` まで `q=name` 検索／list に出ない
//     （GET/PATCH/DELETE は id 指定なので常に可）。別 idCache の 2 アダプタが同名を重複作成するレースを再現する。
//   - `store`（name ビュー / 後方互換）・`fileCount(name)`・`flush()` を公開。
export interface GoogleDriveMock {
  fetch: typeof fetch;
  // name → {id,bytes} の後方互換ビュー（同名重複時は最後の 1 件）。非表示（未 flush）分も含む。
  readonly store: Map<string, { id: string; bytes: Uint8Array }>;
  // 当該 name のファイル数（同名重複の検証用）。非表示分も数える。
  fileCount(name: string): number;
  // 遅延整合の解消（未 flush の新規作成を list/find に反映する）。
  flush(): void;
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
  opts: { requireAuth?: boolean; validToken?: string; lazyList?: boolean } = {},
): GoogleDriveMock {
  const files = new Map<string, { name: string; bytes: Uint8Array }>(); // id → {name,bytes}
  const hidden = new Set<string>(); // 未 flush の新規作成 id（lazyList 時のみ）
  let seq = 0;
  const valid = opts.validToken ?? 'test-token';
  const lazyList = opts.lazyList ?? false;

  const visibleEntries = (): { id: string; name: string }[] => {
    const out: { id: string; name: string }[] = [];
    for (const [id, e] of files) if (!hidden.has(id)) out.push({ id, name: e.name });
    return out;
  };

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
        files.set(newId, { name, bytes });
        if (lazyList) hidden.add(newId); // 遅延整合: flush まで検索/list に出さない
        return json({ id: newId });
      }
      if (method === 'PATCH' && id) {
        const e = files.get(id);
        if (!e) return new Response(null, { status: 404 });
        files.set(id, { name: e.name, bytes: new Uint8Array((init?.body as Uint8Array) ?? new Uint8Array()) });
        return json({ id });
      }
      return new Response(null, { status: 404 });
    }

    const drive = /\/drive\/v3\/files(?:\/([^/]+))?$/.exec(path);
    if (drive) {
      const id = drive[1];
      if (id) {
        if (method === 'DELETE') {
          files.delete(id);
          hidden.delete(id);
          return new Response(null, { status: 204 });
        }
        // GET ?alt=media
        const e = files.get(id);
        if (!e) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(e.bytes), { status: 200 });
      }
      // list / find by q（name='…'）。非表示（未 flush）分は返さない＝遅延整合。
      const q = u.searchParams.get('q');
      const want = q ? /name\s*=\s*'([^']*)'/.exec(q)?.[1] : undefined;
      const filesOut = visibleEntries().filter((f) => want === undefined || f.name === want);
      return json({ files: filesOut });
    }

    return new Response(null, { status: 404 });
  };

  return {
    fetch: impl as unknown as typeof fetch,
    get store(): Map<string, { id: string; bytes: Uint8Array }> {
      const view = new Map<string, { id: string; bytes: Uint8Array }>();
      for (const [id, e] of files) view.set(e.name, { id, bytes: e.bytes }); // 同名は後勝ち（後方互換）
      return view;
    },
    fileCount(name: string): number {
      let n = 0;
      for (const e of files.values()) if (e.name === name) n++;
      return n;
    },
    flush(): void {
      hidden.clear();
    },
  };
}
