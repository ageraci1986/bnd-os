import { cn } from '../utils';

export interface TopbarProps {
  /** Left slot — usually a SearchBar. */
  readonly left?: React.ReactNode;
  /** Right slot — usually a stack of buttons (theme toggle / notifications / + new). */
  readonly right?: React.ReactNode;
  readonly className?: string;
}

/**
 * Sticky glass topbar. PRD §6 — present on every authenticated page.
 * Renders nothing structural beyond the layout: actual buttons, search,
 * etc. come from the host via `left` / `right` slots.
 */
export function Topbar({ left, right, className }: TopbarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-10 mb-5 flex items-center justify-between gap-6 border-b border-[color:var(--color-border-soft)] bg-[color:var(--glass-bg)] px-10 py-5 backdrop-blur',
        className,
      )}
    >
      <div className="min-w-0 flex-1">{left}</div>
      <div className="flex items-center gap-3">{right}</div>
    </header>
  );
}
