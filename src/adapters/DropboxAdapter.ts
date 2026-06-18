// adapters/DropboxAdapter.ts — Dropbox 保存先アダプタ（ch.05 §5.4）。
// StorageAdapter の 4 操作を Dropbox API に写像する。鍵空間 objects/<hash>・heads/<deviceId>
// をアプリ専用フォルダ配下のパス '/objects/...'・'/heads/...' に対応させる。
// トークンは TokenProvider 注入で受け取り、store/idb は直接 import しない（依存方向 / ch.01）。
// putIfAbsent は実装しない（CAS 非依存で正しさ成立 / ch.04 §4.3・§4.6）。
import type { StorageAdapter } from '../model/types';
import type { TokenProvider } from './oauth/tokenStore';
import { AuthError } from './errors';

const CONTENT = 'https://content.dropboxapi.com/2';
const RPC = 'https://api.dropboxapi.com/2';
// Dropbox の CORS 回避用 Content-Type。MIME は text/plain（CORS 安全リスト）なので preflight を
// 起こさず、かつ Dropbox はこの charset を octet-stream 相当として受理する（ch.05 §5.4）。
const CORS_HACK_CT = 'text/plain; charset=dropbox-cors-hack';

export interface DropboxAdapterOptions {
  tokens: TokenProvider;
  // 認証失効（401）を検知したときに呼ぶ（services が global を needs-reauth へ）。
  onAuthError?: () => void;
}

// key（'objects/ab..'）→ Dropbox パス（'/objects/ab..'）。
function toPath(key: string): string {
  return key.startsWith('/') ? key : `/${key}`;
}
// Dropbox パス（'/objects/ab..'）→ key（'objects/ab..'）。
function toKey(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}

interface ListEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  path_lower?: string;
  name: string;
}
interface ListResult {
  entries: ListEntry[];
  cursor: string;
  has_more: boolean;
}

export class DropboxAdapter implements StorageAdapter {
  private readonly tokens: TokenProvider;
  private readonly onAuthError: (() => void) | undefined;
  // このセッションで「サーバに在る」と確認済みの objects/* キー（Issue #27）。objects/* は内容アドレス
  // 指定＝不変なので、既知のものは再アップロードを省ける。pull の get と最初の put で自然に育ち、
  // 2 回目以降の同期は既存 object を 0 アップロードでスキップする（事前 list は使わない）。
  private readonly knownObjects = new Set<string>();

  constructor(opts: DropboxAdapterOptions) {
    this.tokens = opts.tokens;
    this.onAuthError = opts.onAuthError;
  }

  private async authHeader(): Promise<string> {
    return `Bearer ${await this.tokens.getAccessToken()}`;
  }

  // content エンドポイント（download/upload）用の URL を組み立てる。Dropbox の「cors-hack」で
  // CORS の「単純リクエスト」にし、ブラウザから直接呼べるようにする（ブラウザ診断で実証 / ch.05 §5.4）:
  //   1) arg と authorization を **URL クエリ**で渡す（独自ヘッダ Dropbox-API-Arg/Authorization を使わない）。
  //      authorization の値は `Bearer <token>`（生トークンのみは 400「Invalid authorization value」）。
  //   2) reject_cors_preflight=true を付ける（これが無いと URL パラメータ認証が無効になる）。
  //   3) Content-Type は呼び出し側で制御（download=付けない／upload=CORS_HACK_CT。download は cors-hack
  //      charset を 400 で拒否するため付けない）。
  // RPC（api.dropboxapi.com）は preflight を処理するのでヘッダ方式のまま（list/delete）。
  // forceRefresh=true のときはトークンを再取得する（401 リトライ用）。
  private async contentUrl(endpoint: string, arg: unknown, forceRefresh = false): Promise<string> {
    const token = await this.tokens.getAccessToken(forceRefresh ? { forceRefresh: true } : undefined);
    const auth = encodeURIComponent(`Bearer ${token}`);
    const a = encodeURIComponent(JSON.stringify(arg));
    return `${CONTENT}/${endpoint}?authorization=${auth}&arg=${a}&reject_cors_preflight=true`;
  }

  // content エンドポイントへ fetch。401 が返ったら token を**強制 refresh して URL を作り直し 1 回だけ
  // リトライ**する（一過性のトークン状態 401＝list は通るが content だけ 401、を自己回復する / ch.05 §5.4）。
  // 2 回目も 401 なら呼び出し側の checkAuth が AuthError（needs-reauth）にする。init は再利用する
  //（body の Uint8Array は消費されないため再 fetch 可）。
  private async contentFetch(endpoint: string, arg: unknown, init: RequestInit): Promise<Response> {
    const res = await fetch(await this.contentUrl(endpoint, arg, false), init);
    if (res.status !== 401) return res;
    return fetch(await this.contentUrl(endpoint, arg, true), init);
  }

  // 401 を検知したら onAuthError を呼びエラーを投げる（SyncService が分類する）。
  private checkAuth(status: number): void {
    if (status === 401) {
      this.onAuthError?.();
      throw new AuthError('Dropbox 認証が失効しました（401）。再連携が必要です。');
    }
  }

  // 401 以外の失敗を本文付きで投げる。403 missing_scope は権限不足＝再連携で解決するため
  // AuthError 扱いにし（UI は needs-reauth＝「要再接続」）、それ以外は理由が分かるよう本文を含める。
  private async fail(res: Response, op: string): Promise<never> {
    let detail = '';
    try {
      detail = (await res.text()).trim();
    } catch {
      /* 本文を読めない場合は無視 */
    }
    if (res.status === 403 && detail.includes('missing_scope')) {
      this.onAuthError?.();
      throw new AuthError(
        'Dropbox の権限（スコープ）が不足しています。設定で一度切断し、再度連携し直してください。' +
          (detail ? `（詳細: ${detail}）` : ''),
      );
    }
    throw new Error(`Dropbox ${op} 失敗（${res.status}）${detail ? `: ${detail}` : ''}`);
  }

  async list(prefix: string): Promise<string[]> {
    const folder = toPath(prefix).replace(/\/$/, ''); // '/objects/' → '/objects'
    const out: string[] = [];
    let res = await fetch(`${RPC}/files/list_folder`, {
      method: 'POST',
      headers: { Authorization: await this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folder, recursive: false, limit: 2000 }),
    });
    if (res.status === 409) return out; // フォルダ未作成 = 空
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'list_folder');
    let page = (await res.json()) as ListResult;
    for (;;) {
      for (const e of page.entries) {
        if (e['.tag'] === 'file' && e.path_lower) {
          const key = toKey(e.path_lower);
          if (key.startsWith(prefix)) out.push(key);
        }
      }
      if (!page.has_more) break;
      res = await fetch(`${RPC}/files/list_folder/continue`, {
        method: 'POST',
        headers: { Authorization: await this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursor: page.cursor }),
      });
      this.checkAuth(res.status);
      if (!res.ok) return this.fail(res, 'list_folder/continue');
      page = (await res.json()) as ListResult;
    }
    return out.sort();
  }

  async get(key: string): Promise<Uint8Array | null> {
    // download は本文が無いので Content-Type を付けない（ヘッダ無し＝CORS 安全リスト＝preflight 不要）。
    const res = await this.contentFetch('files/download', { path: toPath(key) }, { method: 'POST' });
    if (res.status === 409) return null; // path/not_found
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'download');
    if (key.startsWith('objects/')) this.knownObjects.add(key); // サーバに在ると確認（Issue #27）
    return new Uint8Array(await res.arrayBuffer());
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    // 既知の objects/*（不変）は再アップロードしない（Issue #27）。heads/* は可変なので常にアップロード。
    if (key.startsWith('objects/') && this.knownObjects.has(key)) return;
    // upload は Content-Type に cors-hack（text/plain＝安全リスト・preflight 不要・Dropbox は octet-stream
    // 相当として受理）。application/octet-stream は preflight を誘発するため使わない。
    const res = await this.contentFetch(
      'files/upload',
      { path: toPath(key), mode: 'overwrite', mute: true },
      {
        method: 'POST',
        headers: { 'Content-Type': CORS_HACK_CT },
        body: new Uint8Array(bytes), // ArrayBuffer 裏付けを保証（TS 5.7 BodyInit 対策）
      },
    );
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'upload');
    if (key.startsWith('objects/')) this.knownObjects.add(key); // アップロード成功後に既知集合へ
  }

  async delete(key: string): Promise<void> {
    const res = await fetch(`${RPC}/files/delete_v2`, {
      method: 'POST',
      headers: { Authorization: await this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: toPath(key) }),
    });
    this.knownObjects.delete(key); // 既知集合からも除去（Issue #27）
    if (res.status === 409) return; // 既に無い = 冪等
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'delete_v2');
  }
}
