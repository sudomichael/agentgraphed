export function PageHeader({
  title,
  subtitle,
  right,
  titleAdornment,
}: {
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  // Optional control rendered inline to the right of the title — for filters
  // that describe *what you're viewing* (vs. actions, which go in `right`).
  titleAdornment?: React.ReactNode;
}) {
  return (
    <header className="px-7 h-[72px] border-b border-surface-2 flex items-center justify-between sticky top-0 z-20 bg-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-canvas/80">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-headline-md text-ink font-semibold">{title}</h1>
          {titleAdornment}
        </div>
        {subtitle && <div className="text-body-sm text-ink-mute mt-0.5">{subtitle}</div>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </header>
  );
}
