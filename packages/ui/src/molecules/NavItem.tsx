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
  readonly active?: boolean;
  readonly className?: string;
}

/**
 * Pure visual sidebar nav row. The hosting app wraps this in a
 * Next `<Link>` and computes `active` from `usePathname()`.
 */
export function NavItem({
  icon,
  label,
  count,
  countTone = 'neutral',
  active,
  className,
}: NavItemProps) {
  return (
    <span
      className={cn(
        'flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] font-medium transition-colors',
        active
          ? 'bg-[image:var(--accent-gradient-soft)] font-bold text-[color:var(--color-accent-primary)] dark:text-[#C084FC]'
          : 'text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)] hover:text-[color:var(--color-text-main)]',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid h-[18px] w-[18px] place-items-center [&>svg]:h-[16px] [&>svg]:w-[16px]"
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 ? (
        <span
          style={
            countTone === 'new'
              ? { background: 'linear-gradient(135deg,#8B2BE2,#FF2A6D)', color: '#fff' }
              : undefined
          }
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            countTone === 'neutral' &&
              'bg-[color:var(--color-bg-hover)] text-[color:var(--color-text-main)]',
          )}
        >
          {count}
        </span>
      ) : null}
    </span>
  );
}
