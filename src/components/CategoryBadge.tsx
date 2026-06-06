const COLORS: Record<string, string> = {
  Planning: 'bg-tertiary-soft text-ink-dim border-ink-mute/30',
  Debugging: 'bg-error/15 text-error border-error/30',
  Refactor: 'bg-primary/10 text-primary border-primary/30',
  Feature: 'bg-secondary/10 text-secondary border-secondary/30',
  Styling: 'bg-fuchsia-400/10 text-fuchsia-300 border-fuchsia-400/30',
  'SEO/Content': 'bg-amber-400/10 text-amber-300 border-amber-400/30',
  DevOps: 'bg-orange-400/10 text-orange-300 border-orange-400/30',
  Data: 'bg-sky-400/10 text-sky-300 border-sky-400/30',
  Payments: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/30',
  Docs: 'bg-violet-400/10 text-violet-300 border-violet-400/30',
  Unknown: 'bg-surface-3 text-ink-mute border-surface-4',
};

export function CategoryBadge({ category, size = 'sm' }: { category: string; size?: 'sm' | 'xs' }) {
  const color = COLORS[category] || COLORS.Unknown;
  const sizeCls = size === 'xs' ? 'text-[9px] px-1 py-0' : 'text-[10px] px-1.5 py-0.5';
  return (
    <span
      className={`inline-block ${sizeCls} rounded font-mono uppercase tracking-wider border ${color} shrink-0`}
    >
      {category}
    </span>
  );
}
