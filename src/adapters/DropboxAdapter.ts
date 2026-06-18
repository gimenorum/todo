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

  constructor(opts: DropboxAdapterOptions) {
    this.tokens = opts.tokens;
    this.onAuthError = opts.onAuthError;
  }

  private async authHeader(): Promise<string> {
    return `Bearer ${await this.tokens.getAccessToken()}`;
  }

  // content エンドポイント（download/upload）用の URL を組み立てる。arg と authorization を
  // **URL クエリ**で渡し、独自ヘッダ（Dropbox-API-Arg / Authorization / Content-Type）を一切付けない。
  // これによりリクエストが CORS の「単純リクエスト」になり **preflight を起こさない**＝ブラウザから
  // 直接呼べる。content.dropboxapi.com は preflight を正しく返さず、ヘッダ方式だと ACAO 無しで
  // CORS 失敗するため（Dropbox 公式のブラウザ CORS 回避策 / ch.05 §5.4）。RPC（api.dropboxapi.com）は
  // preflight を処理するのでヘッダ方式のまま（list/delete）。
  private async contentUrl(endpoint: string, arg: unknown): Promise<string> {
    const auth = encodeURIComponent(`Bearer ${await this.tokens.getAccessToken()}`);
    const a = encodeURIComponent(JSON.stringify(arg));
    return `${CONTENT}/${endpoint}?authorization=${auth}&arg=${a}`;
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
    // CORS 単純リクエスト化のため独自ヘッダを付けない（arg/authorization はクエリ）。
    const res = await fetch(await this.contentUrl('files/download', { path: toPath(key) }), {
      method: 'POST',
    });
    if (res.status === 409) return null; // path/not_found
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'download');
    return new Uint8Array(await res.arrayBuffer());
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    // Content-Type を付けない＝単純リクエスト（application/octet-stream は preflight を誘発するため外す）。
    // Dropbox はアップロード本文を Content-Type に依らず生バイトとして扱う。arg/authorization はクエリ。
    const res = await fetch(
      await this.contentUrl('files/upload', { path: toPath(key), mode: 'overwrite', mute: true }),
      {
        method: 'POST',
        body: new Uint8Array(bytes), // ArrayBuffer 裏付けを保証（TS 5.7 BodyInit 対策）
      },
    );
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'upload');
  }

  async delete(key: string): Promise<void> {
    const res = await fetch(`${RPC}/files/delete_v2`, {
      method: 'POST',
      headers: { Authorization: await this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: toPath(key) }),
    });
    if (res.status === 409) return; // 既に無い = 冪等
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'delete_v2');
  }
}
