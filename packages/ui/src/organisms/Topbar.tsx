import { cn } from '../utils';

export interface TopbarProps {
  /** Left slot — usually a SearchBar. */
  readonly left?: React.ReactNode;
  /** Right slot — usually a stack of buttons (theme toggle / notifications / + new). */
  readonly right?: React.ReactNode;
  readonly className?: string;
}

/**
 * Sticky topbar, opaque, soulignée du filet Aurora (charte BND 2026). PRD §6 — present on every authenticated page.
 * Renders nothing structural beyond the layout: actual buttons, search,
 * etc. come from the host via `left` / `right` slots.
 */
export function Topbar({ left, right, className }: TopbarProps) {
  return (
    <header className={cn('bnd-topbar', className)}>
      <div className="min-w-0 flex-1">{left}</div>
      <div className="flex items-center gap-3">{right}</div>
    </header>
  );
}
