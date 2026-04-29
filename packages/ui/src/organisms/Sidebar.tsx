import type { ReactNode } from 'react';
import { cn } from '../utils';

/**
 * Permanent left rail (260px sticky). Faithful port of the
 * `mockups/03-overview.html` `.sidebar` block — the host composes
 * <SidebarBrand>, <SidebarSection> and <SidebarFooter> inside it.
 *
 * Visual rules live in `packages/ui/src/tokens/components.css` so the
 * React tree stays a thin structural shell.
 */
export interface SidebarProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly ariaLabel?: string;
}

export function Sidebar({
  children,
  className,
  ariaLabel = 'Navigation principale',
}: SidebarProps) {
  return (
    <aside aria-label={ariaLabel} className={cn('sidebar', className)}>
      {children}
    </aside>
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
    <div className={cn('brand', className)}>
      <div className="brand-mark">{mark}</div>
      <div>
        <div className="brand-name">{name}</div>
        {subtitle ? <span className="brand-sub">{subtitle}</span> : null}
      </div>
    </div>
  );
}

export interface SidebarSectionProps {
  readonly label: string;
  readonly children: ReactNode;
  /** Small "NEW" pill next to the section label (mockup .pill-new). */
  readonly badge?: string;
  readonly className?: string;
}

export function SidebarSection({ label, children, badge, className }: SidebarSectionProps) {
  return (
    <div className={cn('nav-section', className)}>
      <div className="nav-label">
        <span>{label}</span>
        {badge ? <span className="pill-new">{badge}</span> : null}
      </div>
      {children}
    </div>
  );
}

export interface SidebarFooterProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function SidebarFooter({ children, className }: SidebarFooterProps) {
  return <div className={cn('user-profile', className)}>{children}</div>;
}
