// ui/download.ts — ファイルの受け渡し（Phase 5 / ch.13）。
// navigator.share（対応端末＝iOS/Android 等）を優先し、不可なら a[download] でダウンロードへフォールバック。
// File System Access API は使わない（要件）。services は中身だけ作り、DOM 副作用はここに閉じる。
import type { FileDescriptor } from '../model/types';

export async function saveFile(d: FileDescriptor): Promise<void> {
  const blob = new Blob([d.text], { type: d.mime });

  // Web Share API（ファイル共有対応時）。キャンセル（AbortError）は握りつぶして何もしない。
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    const file = new File([blob], d.filename, { type: d.mime });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: d.filename });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // ユーザーが共有を取消
        // それ以外（共有不可など）はダウンロードへフォールバック
      }
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = d.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
