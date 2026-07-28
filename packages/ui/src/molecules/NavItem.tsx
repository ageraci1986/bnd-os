import type { ReactNode } from 'react';
import { cn } from '../utils';

export interface NavItemProps {
  /** String → rendered as text, ReactNode → rendered as-is (SVG icon, etc). */
  readonly icon: ReactNode;
  readonly label: string;
  /** Optional unread / item count badge. */
  readonly count?: number;
  /** Highlight the count as "new / unread" with the brand gradient. */
  readonly countTone?: 'neutral' | 'new';
  /**
   * Small animated indicator dot (ported from mockup `.ap-nav .dot`,
   * Plan 3b Task 7) — used for a binary "there's something unread" signal
   * (e.g. Assistant proactive notices) as opposed to `count`, which shows a
   * number. Renders nothing when falsy/omitted.
   */
  readonly dot?: boolean;
  readonly active?: boolean;
  readonly className?: string;
}

/**
 * Pure visual sidebar nav row, faithfully matching the mockup `.nav-item`
 * structure: `<a><span class="ico">…</span> Label <span class="count">…</span></a>`.
 *
 * The hosting app wraps this in a Next `<Link>` and computes `active`
 * from `usePathname()`.
 */
export function NavItem({
  icon,
  label,
  count,
  countTone = 'neutral',
  dot,
  active,
  className,
}: NavItemProps) {
  return (
    <span className={cn('nav-item', active && 'active', className)}>
      <span aria-hidden="true" className="ico">
        {icon}
      </span>
      <span className="label">{label}</span>
      {count !== undefined && count > 0 ? (
        <span className={cn('count', countTone === 'new' && 'new')}>{count}</span>
      ) : null}
      {dot === true ? (
        <span aria-hidden="true" className="nav-item-dot" data-testid="nav-item-dot" />
      ) : null}
    </span>
  );
}
