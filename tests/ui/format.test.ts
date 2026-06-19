import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  fromDateTimeInputValues,
  toDateInputValue,
  toTimeInputValue,
} from '../../src/ui/format';

describe('ui/format 期日の時刻（Issue #71）', () => {
  it('fromDateTimeInputValues: 日付空は null', () => {
    expect(fromDateTimeInputValues('', '09:00')).toBeNull();
    expect(fromDateTimeInputValues('', '')).toBeNull();
  });

  it('fromDateTimeInputValues: 時刻空は 00:00 を補完（ローカル）', () => {
    const onlyDate = fromDateTimeInputValues('2026-06-20', '');
    expect(onlyDate).not.toBeNull();
    const d = new Date(onlyDate as number);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('fromDateTimeInputValues: 日付＋時刻を反映（ローカル）', () => {
    const ms = fromDateTimeInputValues('2026-06-20', '09:30');
    const d = new Date(ms as number);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  it('toTimeInputValue: null と 00:00 は空（時刻未指定扱い）', () => {
    expect(toTimeInputValue(null)).toBe('');
    const midnight = fromDateTimeInputValues('2026-06-20', '');
    expect(toTimeInputValue(midnight)).toBe('');
  });

  it('toTimeInputValue: 非 00:00 は HH:mm', () => {
    const ms = fromDateTimeInputValues('2026-06-20', '09:05');
    expect(toTimeInputValue(ms)).toBe('09:05');
  });

  it('日付＋時刻の往復（date/time 入力値を保持）', () => {
    const ms = fromDateTimeInputValues('2026-06-20', '14:00');
    expect(toDateInputValue(ms)).toBe('2026-06-20');
    expect(toTimeInputValue(ms)).toBe('14:00');
  });

  it('formatDateTime: 時刻ありは "YYYY-MM-DD HH:mm"、時刻なしは日付のみ', () => {
    const withTime = fromDateTimeInputValues('2026-06-20', '14:00') as number;
    expect(formatDateTime(withTime)).toBe('2026-06-20 14:00');
    const dateOnly = fromDateTimeInputValues('2026-06-20', '') as number;
    expect(formatDateTime(dateOnly)).toBe('2026-06-20');
  });
});
