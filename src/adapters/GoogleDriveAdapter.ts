// adapters/GoogleDriveAdapter.ts — Google Drive 保存先アダプタ（ch.05 §5.5）。
// StorageAdapter の 4 操作を Drive API v3（appDataFolder）へ写像する。鍵空間 objects/<hash>・
// heads/<deviceId> を appDataFolder 内のフラットなファイル名にそのまま使う（file.name = key）。
// 認証は Authorization: Bearer ヘッダ（標準 CORS。Dropbox の cors-hack は不要）。トークンは
// TokenProvider 注入（GIS のアクセストークン）で受け取り、store/idb は直接 import しない（依存方向 / ch.01）。
// putIfAbsent は実装しない（CAS 非依存で正しさ成立 / ch.04 §4.3・§4.6）。
import type { StorageAdapter } from '../model/types';
import type { TokenProvider } from './oauth/tokenStore';
import { AuthError } from './errors';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const APP_FOLDER = 'appDataFolder';

export interface GoogleDriveAdapterOptions {
  tokens: TokenProvider;
  // 認証失効（401）を検知したときに呼ぶ（services が global を needs-reauth へ）。
  onAuthError?: () => void;
}

interface DriveFile {
  id: string;
  name: string;
}
interface DriveList {
  files?: DriveFile[];
  nextPageToken?: string;
}

export class GoogleDriveAdapter implements StorageAdapter {
  private readonly tokens: TokenProvider;
  private readonly onAuthError: (() => void) | undefined;

  constructor(opts: GoogleDriveAdapterOptions) {
    this.tokens = opts.tokens;
    this.onAuthError = opts.onAuthError;
  }

  // Bearer 認証で fetch。401 が返ったらトークンを強制 refresh（GIS 無音再取得）して URL を作り直し
  // 1 回だけリトライする（アクセストークン失効の自己回復 / ch.05 §5.5）。2 回目も 401 なら呼び出し側の
  // checkAuth が AuthError（needs-reauth）にする。init は再利用する（body は消費されないため再 fetch 可）。
  private async authedFetch(url: string, init: RequestInit = {}, forceRefresh = false): Promise<Response> {
    const token = await this.tokens.getAccessToken(forceRefresh ? { forceRefresh: true } : undefined);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401 && !forceRefresh) return this.authedFetch(url, init, true);
    return res;
  }

  // 401 を検知したら onAuthError を呼びエラーを投げる（SyncService が分類する）。
  private checkAuth(status: number): void {
    if (status === 401) {
      this.onAuthError?.();
      throw new AuthError('Google Drive 認証が失効しました（401）。再連携が必要です。');
    }
  }

  // 401 以外の失敗を本文付きで投げる。403 のスコープ不足は権限不足＝再連携で解決するため
  // AuthError 扱いにし（UI は needs-reauth＝「要再接続」）、それ以外は理由が分かるよう本文を含める。
  private async fail(res: Response, op: string): Promise<never> {
    let detail = '';
    try {
      detail = (await res.text()).trim();
    } catch {
      /* 本文を読めない場合は無視 */
    }
    if (res.status === 403 && /insufficient|scope|accessNotConfigured/i.test(detail)) {
      this.onAuthError?.();
      throw new AuthError(
        'Google Drive の権限（スコープ）が不足しています。設定で一度切断し、再度連携し直してください。' +
          (detail ? `（詳細: ${detail}）` : ''),
      );
    }
    throw new Error(`Google Drive ${op} 失敗（${res.status}）${detail ? `: ${detail}` : ''}`);
  }

  // name（= key）→ fileId。appDataFolder 内を name 完全一致で検索（無ければ null）。
  // key はアプリ生成（objects/<hex>・heads/<uuid>）でクォートを含まないため、q の値はそのまま使える。
  private async findId(name: string): Promise<string | null> {
    const params = new URLSearchParams({
      spaces: APP_FOLDER,
      q: `name='${name}'`,
      fields: 'files(id,name)',
      pageSize: '10',
    });
    const res = await this.authedFetch(`${DRIVE}/files?${params.toString()}`);
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'find');
    const body = (await res.json()) as DriveList;
    return body.files?.[0]?.id ?? null;
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        spaces: APP_FOLDER,
        fields: 'nextPageToken,files(id,name)',
        pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.authedFetch(`${DRIVE}/files?${params.toString()}`);
      this.checkAuth(res.status);
      if (!res.ok) return this.fail(res, 'list');
      const body = (await res.json()) as DriveList;
      for (const f of body.files ?? []) if (f.name.startsWith(prefix)) out.push(f.name);
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out.sort();
  }

  async get(key: string): Promise<Uint8Array | null> {
    const id = await this.findId(key);
    if (!id) return null; // 未存在
    const res = await this.authedFetch(`${DRIVE}/files/${id}?alt=media`);
    if (res.status === 404) return null;
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'download');
    return new Uint8Array(await res.arrayBuffer());
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const id = await this.findId(key);
    if (id) {
      // objects/ は内容アドレス指定＝不変。既存ならスキップ（同名ファイルの重複作成も避ける / ch.05 §5.5）。
      if (key.startsWith('objects/')) return;
      // heads/ は可変（advisory HEAD）。既存ファイルの本文を更新する。
      const res = await this.authedFetch(`${UPLOAD}/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(bytes), // ArrayBuffer 裏付けを保証（TS 5.7 BodyInit 対策）
      });
      this.checkAuth(res.status);
      if (!res.ok) return this.fail(res, 'update');
      return;
    }
    await this.createMultipart(key, bytes);
  }

  // 新規作成（multipart/related: メタデータ JSON ＋ 本文）。parent=appDataFolder で最小権限。
  private async createMultipart(name: string, bytes: Uint8Array): Promise<void> {
    const boundary = `todo${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const enc = new TextEncoder();
    const meta = JSON.stringify({ name, parents: [APP_FOLDER] });
    const head = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    const res = await this.authedFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'upload');
  }

  async delete(key: string): Promise<void> {
    const id = await this.findId(key);
    if (!id) return; // 既に無い = 冪等
    const res = await this.authedFetch(`${DRIVE}/files/${id}`, { method: 'DELETE' });
    if (res.status === 404) return;
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'delete');
  }
}
