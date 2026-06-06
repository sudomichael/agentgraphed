// Shared range options for Dashboard + Analytics pages.

export type RangeKey = '7d' | '30d' | '90d' | 'all';

export const RANGE_OPTIONS: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
];

const DEFAULT: RangeKey = '30d';

export function parseRange(raw: string | undefined | null): RangeKey {
  const r = (raw || '').toLowerCase();
  const match = RANGE_OPTIONS.find((o) => o.key === r);
  return match ? match.key : DEFAULT;
}

export function rangeDays(key: RangeKey): number | null {
  return RANGE_OPTIONS.find((o) => o.key === key)?.days ?? 30;
}

export function rangeLabel(key: RangeKey): string {
  return RANGE_OPTIONS.find((o) => o.key === key)?.label ?? 'Last 30 days';
}

export function rangeShortLabel(key: RangeKey): string {
  return key === 'all' ? 'all time' : key;
}
