// Shared range options for Dashboard + Analytics pages.
//
// `days` is the size of the rolling window in days (1 = last 24h, 7 = last
// week, etc.). null means "all time." This is the value every query in
// queries.ts windows on: `timestamp >= Date.now() - days * 86_400_000`.

export type RangeKey = '24h' | '7d' | '30d' | '90d' | 'all';

export const RANGE_OPTIONS: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '24h', label: 'Last 24 hours', days: 1 },
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
  // Have to distinguish "match found, days intentionally null (All time)" from
  // "no match, fall back to 30". Using `?? 30` collapsed both cases because
  // ?? treats null as missing — which silently demoted ?range=all to 30 days.
  const match = RANGE_OPTIONS.find((o) => o.key === key);
  return match ? match.days : 30;
}

export function rangeLabel(key: RangeKey): string {
  return RANGE_OPTIONS.find((o) => o.key === key)?.label ?? 'Last 30 days';
}

export function rangeShortLabel(key: RangeKey): string {
  return key === 'all' ? 'all time' : key;
}
