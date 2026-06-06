export function MetricCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: 'primary' | 'secondary' | 'none';
}) {
  const accentColor =
    accent === 'primary' ? 'text-primary' : accent === 'secondary' ? 'text-secondary' : 'text-ink';
  return (
    <div className="card p-4">
      <div className="metric-label">{label}</div>
      <div className={`metric-value tabular mt-1 ${accentColor}`}>{value}</div>
      {hint && <div className="text-[11px] text-ink-mute mt-1">{hint}</div>}
    </div>
  );
}
