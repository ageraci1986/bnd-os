import { cn } from '../utils';

export interface BreadcrumbCrumb {
  readonly label: string;
  /** When true, rendered as the current/strong page. */
  readonly current?: boolean;
}

export interface ContextBarProps {
  readonly crumbs: readonly BreadcrumbCrumb[];
  /** Right slot — usually a ContextChip showing the active client filter. */
  readonly right?: React.ReactNode;
  readonly className?: string;
}

/**
 * Breadcrumb + global context strip below the topbar (PRD §6).
 * The right-hand slot holds the client filter chip; the host wires it
 * to the global Zustand store so it persists across navigation.
 */
export function ContextBar({ crumbs, right, className }: ContextBarProps) {
  return (
    <nav
      aria-label="Fil d'Ariane"
      className={cn(
        'mb-7 flex items-center gap-4 border-b border-[color:var(--color-border-soft)] pb-[18px]',
        className,
      )}
    >
      <ol className="flex flex-wrap items-center gap-2.5 text-xs font-medium text-[color:var(--color-text-muted)]">
        {crumbs.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-2.5">
            {i > 0 ? (
              <span aria-hidden="true" className="text-[color:var(--color-text-ghost)]">
                /
              </span>
            ) : null}
            {c.current ? (
              <strong className="font-bold text-[color:var(--color-text-main)]">{c.label}</strong>
            ) : (
              <span>{c.label}</span>
            )}
          </li>
        ))}
      </ol>
      {right ? <div className="ml-auto">{right}</div> : null}
    </nav>
  );
}
