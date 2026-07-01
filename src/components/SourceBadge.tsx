// Stable per-tag color: hash the tag to an index into a fixed palette so the
// same tag is always the same color across the app.
const PALETTE = [
  'bg-emerald-500/15 text-emerald-400',
  'bg-amber-500/15 text-amber-400',
  'bg-violet-500/15 text-violet-400',
  'bg-rose-500/15 text-rose-400',
  'bg-cyan-500/15 text-cyan-400',
];

function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function SourceBadge({ tag }: { tag: string | null | undefined }) {
  if (!tag) return null;
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono lowercase tracking-wider ${tagColor(tag)}`}
      title={`source: ${tag}`}
    >
      {tag}
    </span>
  );
}
