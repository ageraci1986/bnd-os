import { cn } from '../utils';

export interface SidebarSectionProps {
  readonly label: string;
  readonly children: React.ReactNode;
  /** Optional small "NEW" pill next to the section label. */
  readonly badge?: string;
  readonly className?: string;
}

export function SidebarSection({ label, children, badge, className }: SidebarSectionProps) {
  return (
    <div className={cn('px-4 pb-5', className)}>
      <div className="mb-2.5 flex items-center justify-between px-2">
        <span className="text-[10px] font-bold uppercase tracking-[1.5px] text-[color:var(--color-text-muted)]">
          {label}
        </span>
        {badge ? (
          <span
            style={{ background: 'var(--color-accent-secondary)', color: '#fff' }}
            className="rounded-full px-2 py-0.5 text-[9px] tracking-[0.5px]"
          >
            {badge}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export interface SidebarBrandProps {
  readonly mark: string;
  readonly name: string;
  readonly subtitle?: string;
  readonly className?: string;
}

export function SidebarBrand({ mark, name, subtitle, className }: SidebarBrandProps) {
  return (
    <div className={cn('flex items-center gap-3 px-6 pb-7', className)}>
      <span className="brand-mark">{mark}</span>
      <div>
        <div className="brand-name">{name}</div>
        {subtitle ? <span className="brand-sub">{subtitle}</span> : null}
      </div>
    </div>
  );
}

export interface SidebarFooterProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function SidebarFooter({ children, className }: SidebarFooterProps) {
  return (
    <div
      className={cn(
        'mt-auto flex items-center gap-3 border-t border-[color:var(--color-border-light)] px-6 pt-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface SidebarProps {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly ariaLabel?: string;
}

/**
 * Permanent left rail (260 px sticky). PRD §6 — present on every authenticated
 * page. The host composes `SidebarBrand`, `SidebarSection` and `SidebarFooter`
 * inside it.
 */
export function Sidebar({
  children,
  className,
  ariaLabel = 'Navigation principale',
}: SidebarProps) {
  return (
    <aside
      aria-label={ariaLabel}
      className={cn(
        'sticky top-0 flex h-screen w-[260px] shrink-0 flex-col overflow-y-auto border-r border-[color:var(--color-border-light)] bg-[color:var(--color-bg-sidebar)] py-6',
        className,
      )}
    >
      {children}
    </aside>
  );
}
