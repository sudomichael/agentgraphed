// URL → platform detection for self-asserted profile links sent up with
// leaderboard submissions. Slim mirror of the marketing site's helper
// at agentgraphed-web/src/lib/social.ts — the OSS client only needs
// validation + the cleaned shape, not icon rendering. Keep the matcher
// list aligned with the site copy or links will get rejected on submit.

export type SocialPlatform =
  | 'github'
  | 'x'
  | 'reddit'
  | 'bluesky'
  | 'mastodon'
  | 'linkedin'
  | 'youtube'
  | 'website'
  | 'link';

export type DetectedSocial = {
  url: string;
  platform: SocialPlatform;
  label: string;
};

export const SOCIAL_LIMITS = {
  maxLinks: 3,
  maxUrlLength: 200,
  maxTotalBytes: 800,
} as const;

export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > SOCIAL_LIMITS.maxUrlLength) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') return null;
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'ref_src']) {
    u.searchParams.delete(k);
  }
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

export function detectSocial(rawUrl: string): DetectedSocial | null {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'github.com' && parts.length >= 1) return { url, platform: 'github', label: `@${parts[0]}` };
  if ((host === 'x.com' || host === 'twitter.com') && parts.length >= 1) return { url, platform: 'x', label: `@${parts[0]}` };
  if (host === 'reddit.com' && parts.length >= 2 && (parts[0] === 'user' || parts[0] === 'u')) {
    return { url, platform: 'reddit', label: `u/${parts[1]}` };
  }
  if (host === 'bsky.app' && parts.length >= 2 && parts[0] === 'profile') {
    return { url, platform: 'bluesky', label: `@${parts[1]}` };
  }
  if (parts.length >= 1 && parts[0].startsWith('@')) {
    return { url, platform: 'mastodon', label: `${parts[0]}@${host}` };
  }
  if (host === 'linkedin.com' && parts.length >= 2 && parts[0] === 'in') {
    return { url, platform: 'linkedin', label: parts[1] };
  }
  if (host === 'youtube.com' && parts.length >= 1) {
    const first = parts[0];
    if (first.startsWith('@')) return { url, platform: 'youtube', label: first };
    if ((first === 'c' || first === 'channel' || first === 'user') && parts[1]) {
      return { url, platform: 'youtube', label: parts[1] };
    }
  }
  return { url, platform: parts.length === 0 ? 'website' : 'link', label: host };
}

export function cleanSocialLinks(rawList: string[]): DetectedSocial[] {
  const seen = new Set<string>();
  const out: DetectedSocial[] = [];
  for (const raw of rawList) {
    if (out.length >= SOCIAL_LIMITS.maxLinks) break;
    const detected = detectSocial(raw);
    if (!detected) continue;
    if (seen.has(detected.url)) continue;
    seen.add(detected.url);
    out.push(detected);
  }
  if (JSON.stringify(out).length > SOCIAL_LIMITS.maxTotalBytes) {
    return out.slice(0, Math.max(0, out.length - 1));
  }
  return out;
}
