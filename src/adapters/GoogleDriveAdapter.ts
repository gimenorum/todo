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
  // name（= key）→ fileId のセッション内キャッシュ（Issue #27）。Drive の fileId は不変で、heads/ も
  // PATCH で id 据え置きのため安全。findId のネットワーク往復を削り、同期 1 回あたりの API アクセスを減らす。
  private readonly idCache = new Map<string, string>();

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
    const cached = this.idCache.get(name);
    if (cached) return cached; // キャッシュ命中＝ネットワーク検索を省く（Issue #27）
    const ids = await this.searchIds(name);
    const id = ids[0] ?? null;
    if (id) this.idCache.set(name, id); // ミス時のみ検索し、結果をキャッシュ
    return id;
  }

  // name 完全一致の**全** fileId を返す（同名ファイルが複数できた場合に集約・全削除するのに使う / Issue #29
  // フォローアップ）。Drive は同名ファイルを許可し name 検索が遅延整合のため、可変・複数ライタのキー
  // （conflicts/<todoId>）は別端末が同名ファイルを重複作成しうる。キャッシュは単一 id しか持てないので、
  // 集約パスは必ずネットワーク検索で全件を取得する。
  private async searchIds(name: string): Promise<string[]> {
    const params = new URLSearchParams({
      spaces: APP_FOLDER,
      q: `name='${name}'`,
      fields: 'files(id,name)',
      pageSize: '100',
    });
    const res = await this.authedFetch(`${DRIVE}/files?${params.toString()}`);
    this.checkAuth(res.status);
    if (!res.ok) return this.fail(res, 'find');
    const body = (await res.json()) as DriveList;
    return (body.files ?? []).map((f) => f.id);
  }

  // 同名ファイルが複数できていたら 1 つへ集約する（可変・複数ライタのキー用）。先頭を残し、残りを削除して
  // 残った id を返す（無ければ null）。delete-after は冪等で、見えていない重複は次回の put/delete で回収される。
  private async collapseDuplicates(name: string): Promise<string | null> {
    const ids = await this.searchIds(name);
    if (ids.length === 0) {
      this.idCache.delete(name);
      return null;
    }
    const [keep, ...extras] = ids;
    for (const dupId of extras) {
      const res = await this.authedFetch(`${DRIVE}/files/${dupId}`, { method: 'DELETE' });
      if (res.status !== 404) {
        this.checkAuth(res.status);
        if (!res.ok) return this.fail(res, 'delete');
      }
    }
    this.idCache.set(name, keep);
    return keep;
  }

  // 可変・複数ライタのキー（同名重複が起こりうる）か。conflicts/<todoId> のみ該当（Issue #29 フォローアップ）。
  // objects/<hash> は不変、heads/<deviceId> は単一ライタなので重複しない＝高速パス（findId→PATCH）を維持する。
  private isSharedMutable(key: string): boolean {
    return key.startsWith('conflicts/');
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
      // prefix フィルタ前に全ファイルの id をキャッシュへ。同期開始の list('heads/') で全 object の
      // id が無料でウォームされ、以降の get/既存 put が findId のネットワーク検索を出さなくなる（Issue #27）。
      for (const f of body.files ?? []) {
        this.idCache.set(f.name, f.id);
        if (f.name.startsWith(prefix)) out.push(f.name);
      }
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
    // 可変・複数ライタのキー（conflicts/）は同名重複を集約してから 1 つへ書く（先頭を更新・残りを削除）。
    // 別端末が同名ファイルを重複作成しても、ここで 1 ファイルへ収束する（Issue #29 フォローアップ）。
    const id = this.isSharedMutable(key) ? await this.collapseDuplicates(key) : await this.findId(key);
    if (id) {
      // objects/ は内容アドレス指定＝不変。既存ならスキップ（同名ファイルの重複作成も避ける / ch.05 §5.5）。
      if (key.startsWith('objects/')) return;
      // heads/（単一ライタ）・conflicts/（集約後の単一 id）は可変。既存ファイルの本文を更新する。
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
    const created = (await res.json()) as { id?: string };
    if (created.id) this.idCache.set(name, created.id); // 作成 id をキャッシュ（Issue #27）
  }

  async delete(key: string): Promise<void> {
    // 可変・複数ライタのキー（conflicts/）は同名重複を全削除する（解決時に重複コピーを残さない＝幽霊マーカー
    // 防止 / Issue #29 フォローアップ）。それ以外は単一ファイルなので従来どおり 1 件を削除する。
    const ids = this.isSharedMutable(key)
      ? await this.searchIds(key)
      : await (async (): Promise<string[]> => {
          const id = await this.findId(key);
          return id ? [id] : [];
        })();
    if (ids.length === 0) {
      this.idCache.delete(key);
      return; // 既に無い = 冪等
    }
    for (const id of ids) {
      const res = await this.authedFetch(`${DRIVE}/files/${id}`, { method: 'DELETE' });
      if (res.status === 404) continue;
      this.checkAuth(res.status);
      if (!res.ok) return this.fail(res, 'delete');
    }
    this.idCache.delete(key); // キャッシュからも除去（Issue #27）
  }
}
