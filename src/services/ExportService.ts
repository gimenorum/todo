// services/ExportService.ts — エクスポート（Phase 5 / ch.13）。
// 純関数のみ（DOM・IO に触れない）。中身（FileDescriptor）を組み立て、保存は ui/download.saveFile が担う。
// JSON が正本（無損失・再取込可）。Markdown/CSV は人が読む派生で、tombstone を除いた表示用サブセット。
import type {
  DeviceSettings,
  ExportFileV1,
  FileDescriptor,
  Millis,
  Todo,
} from '../model/types';

const FORMAT = 'todo-pwa-export' as const;

// ファイル名のタイムスタンプ（YYYYMMDD-HHmmss、ローカル時刻）。
function stamp(now: Millis): string {
  const d = new Date(now);
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function jsonDescriptor(file: ExportFileV1, base: string): FileDescriptor {
  return {
    filename: `${base}-${stamp(file.exportedAt)}.json`,
    mime: 'application/json',
    text: JSON.stringify(file, null, 2),
  };
}

// ① タスク（JSON 正本）。tombstone/version 込みでそのまま出す＝無損失。
export function buildTasksJson(todos: Todo[], now: Millis): FileDescriptor {
  const file: ExportFileV1 = { format: FORMAT, v: 1, kind: 'tasks', exportedAt: now, tasks: todos };
  return jsonDescriptor(file, 'todo-tasks');
}

// ② 設定（JSON）。
export function buildSettingsJson(settings: DeviceSettings, now: Millis): FileDescriptor {
  const file: ExportFileV1 = {
    format: FORMAT,
    v: 1,
    kind: 'settings',
    exportedAt: now,
    settings,
  };
  return jsonDescriptor(file, 'todo-settings');
}

// ③ タスク＋設定（JSON 正本）。
export function buildAllJson(todos: Todo[], settings: DeviceSettings, now: Millis): FileDescriptor {
  const file: ExportFileV1 = {
    format: FORMAT,
    v: 1,
    kind: 'tasks+settings',
    exportedAt: now,
    tasks: todos,
    settings,
  };
  return jsonDescriptor(file, 'todo-backup');
}

// Markdown チェックリスト（派生・非 tombstone）。
export function buildTasksMarkdown(todos: Todo[], now: Millis): FileDescriptor {
  const alive = todos.filter((t) => !t.deleted);
  const lines = alive.map((t) => {
    const box = t.done ? '- [x]' : '- [ ]';
    const due = t.dueDate !== null ? `（期限: ${ymd(t.dueDate)}）` : '';
    return `${box} ${t.title}${due}`;
  });
  const text = `# タスク（${alive.length} 件）\n\n${lines.join('\n')}\n`;
  return { filename: `todo-tasks-${stamp(now)}.md`, mime: 'text/markdown', text };
}

// CSV（派生・非 tombstone・表計算向け）。
export function buildTasksCsv(todos: Todo[], now: Millis): FileDescriptor {
  const alive = todos.filter((t) => !t.deleted);
  const header = ['id', 'title', 'done', 'dueDate', 'priority', 'notes', 'tags'];
  const rows = alive.map((t) =>
    [
      t.id,
      t.title,
      String(t.done),
      t.dueDate !== null ? ymd(t.dueDate) : '',
      t.priority,
      t.notes,
      t.tags.join(';'),
    ]
      .map(csvCell)
      .join(','),
  );
  const text = `${header.join(',')}\n${rows.join('\n')}\n`;
  return { filename: `todo-tasks-${stamp(now)}.csv`, mime: 'text/csv', text };
}

function ymd(ms: Millis): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// CSV エスケープ（カンマ・引用符・改行を含むセルは "" で囲み、内部の " は "" に）。
function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
