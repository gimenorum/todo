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

// <input type="date"> 用（YYYY-MM-DD）。
export function toDateInputValue(ms: Millis | null): string {
  return ms === null ? '' : formatDate(ms);
}

export function fromDateInputValue(value: string): Millis | null {
  if (!value) return null;
  const ms = Date.parse(`${value}T00:00:00`);
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
