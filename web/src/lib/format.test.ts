import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatMoneyCompact,
  formatMonth,
  formatRelative,
  initials,
  percentChange,
} from './format';

describe('format helpers', () => {
  it('formats money', () => {
    expect(formatMoney(12500)).toBe('$12,500');
    expect(formatMoneyCompact(1_250_000)).toBe('$1.3M');
  });

  it('formats months and relative times', () => {
    expect(formatMonth('2026-03')).toBe('Mar 26');
    const now = new Date('2026-05-10T12:00:00Z');
    expect(formatRelative('2026-05-07T12:00:00Z', now)).toBe('3d ago');
    expect(formatRelative('2026-05-10T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-05-10T15:00:00Z', now)).toBe('in 3h');
  });

  it('computes initials and percent change', () => {
    expect(initials('Maria  Sokolova')).toBe('MS');
    expect(percentChange(150, 100)).toBeCloseTo(0.5);
    expect(percentChange(10, 0)).toBeNull();
  });
});
