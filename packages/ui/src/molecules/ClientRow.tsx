import { ClientDot, type ClientColorToken } from '../atoms/ClientDot';
import { cn } from '../utils';

export interface ClientRowProps {
  readonly name: string;
  readonly colorToken: ClientColorToken | string;
  /** Active project count shown on the right. Hidden when 0. */
  readonly count?: number;
  readonly active?: boolean;
  readonly className?: string;
}

/**
 * Sidebar row for a client (shown under "Clients actifs"). Pure visual:
 * the host app wraps it in a `<Link>` and toggles `active` based on the
 * `?client=<slug>` query param (PRD §8.1).
 */
export function ClientRow({ name, colorToken, count, active, className }: ClientRowProps) {
  return (
    <span
      className={cn(
        'mb-0.5 flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors',
        active
          ? 'bg-[color:var(--color-bg-hover)] font-semibold text-[color:var(--color-text-main)]'
          : 'text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)] hover:text-[color:var(--color-text-main)]',
        className,
      )}
    >
      <ClientDot colorToken={colorToken} size={10} />
      <span className="flex-1 truncate">{name}</span>
      {count !== undefined && count > 0 ? (
        <span className="text-[11px] font-medium text-[color:var(--color-text-ghost)]">
          {count}
        </span>
      ) : null}
    </span>
  );
}
