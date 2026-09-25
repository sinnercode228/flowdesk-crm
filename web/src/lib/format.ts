const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});

export const formatMoney = (value: number) => usd.format(value);
export const formatMoneyCompact = (value: number) => usdCompact.format(value);
export const formatPercent = (ratio: number, digits = 0) => `${(ratio * 100).toFixed(digits)}%`;
export const formatDate = (iso: string | null | undefined) =>
  iso ? shortDate.format(new Date(iso)) : '—';

/** `2026-03` -> `Mar 26` */
export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return monthLabel.format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/** Relative time like "3d ago" / "in 5d", good enough for a timeline. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const units: Array<[number, string]> = [
    [86_400_000 * 30, 'mo'],
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return diff < 0 ? `${n}${label} ago` : `in ${n}${label}`;
    }
  }
  return 'just now';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Percentage change between two values; `null` when there is no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}
