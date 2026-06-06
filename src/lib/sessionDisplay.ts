import type { SessionRow } from './queries';

// Parse the categories JSON, with a graceful fallback to the legacy single
// category column for rows that haven't been re-classified yet. Lives here
// (not in queries.ts) so client components can import it without pulling in
// node:fs / node:os transitively via the detection helpers.
export function sessionCategories(
  s: { categories?: string | null; category?: string | null },
): string[] {
  if (s.categories) {
    try {
      const parsed = JSON.parse(s.categories);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      // fall through to legacy
    }
  }
  return s.category ? [s.category] : [];
}

export function displayTitle(s: Pick<SessionRow, 'summary' | 'heuristic_title' | 'first_prompt'>): string {
  if (s.summary) return s.summary.split('\n')[0].trim();
  if (s.heuristic_title) return s.heuristic_title;
  if (s.first_prompt) {
    const firstLine = s.first_prompt.trim().split('\n').find((l) => l.trim().length > 0) ?? '';
    const cleaned = firstLine.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= 100) return cleaned;
    const cut = cleaned.lastIndexOf(' ', 100);
    return (cut > 60 ? cleaned.slice(0, cut) : cleaned.slice(0, 100)) + '…';
  }
  return '(untitled session)';
}
