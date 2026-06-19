import type { Millis } from '../model/types';

// 表示・入力整形ヘルパ。

export function formatDate(ms: Millis): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 全体ステータスの「最終同期 HH:MM」表示用（ch.09 §9.2）。
export function formatTime(ms: Millis): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

// 一覧表示用。時刻が設定されている（ローカル 00:00 以外）ときだけ "YYYY-MM-DD HH:mm"、
// それ以外は日付のみ（Issue #71）。
export function formatDateTime(ms: Millis): string {
  const time = toTimeInputValue(ms);
  return time === '' ? formatDate(ms) : `${formatDate(ms)} ${time}`;
}

// <input type="date"> 用（YYYY-MM-DD）。
export function toDateInputValue(ms: Millis | null): string {
  return ms === null ? '' : formatDate(ms);
}

export function fromDateInputValue(value: string): Millis | null {
  if (!value) return null;
  const ms = Date.parse(`${value}T00:00:00`);
  return Number.isNaN(ms) ? null : ms;
}

// <input type="time"> 用（Issue #71）。期日に任意の時刻を持たせる。
// 「ローカル 00:00 ＝ 時刻未指定」とみなし空文字を返す（従来の日付のみデータと互換）。
export function toTimeInputValue(ms: Millis | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  if (d.getHours() === 0 && d.getMinutes() === 0) return '';
  return formatTime(ms);
}

// 日付＋時刻（任意）を Millis に。date 空なら期日なし。time 空なら 00:00 を補完（ローカル）。
export function fromDateTimeInputValues(date: string, time: string): Millis | null {
  if (!date) return null;
  const t = time || '00:00';
  const ms = Date.parse(`${date}T${t}:00`);
  return Number.isNaN(ms) ? null : ms;
}

// 入力タグ文字列（スペース/カンマ区切り）→ 正規化済み配列（重複・空を除去）。
export function parseTags(value: string): string[] {
  const seen = new Set<string>();
  for (const raw of value.split(/[\s,]+/)) {
    const t = raw.replace(/^#/, '').trim();
    if (t) seen.add(t);
  }
  return [...seen];
}
