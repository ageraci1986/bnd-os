'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../utils';

export interface SidebarSectionCollapsibleProps {
  readonly label: string;
  readonly children: ReactNode;
  /** Stable key used to persist the open/closed state across reloads. */
  readonly storageKey: string;
  /** Initial open state before localStorage is read on hydration. */
  readonly defaultOpen?: boolean;
  readonly badge?: string;
  readonly className?: string;
}

/**
 * Same visual as <SidebarSection> but the label becomes a toggle.
 * State persists per `storageKey` in localStorage so a refresh keeps
 * the user's choice. SSR uses `defaultOpen` to avoid layout shift on
 * first paint; hydration then reconciles against localStorage.
 */
export function SidebarSectionCollapsible({
  label,
  children,
  storageKey,
  defaultOpen = false,
  badge,
  className,
}: SidebarSectionCollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(`sidebar-section:${storageKey}`);
    if (stored !== null) setOpen(stored === 'true');
    setHydrated(true);
  }, [storageKey]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (hydrated) {
        window.localStorage.setItem(`sidebar-section:${storageKey}`, String(next));
      }
      return next;
    });
  };

  return (
    <div className={cn('nav-section', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="nav-label nav-label-toggle"
      >
        <span className="nav-label-text">{label}</span>
        {badge ? <span className="pill-new">{badge}</span> : null}
        <span className={cn('nav-label-caret', open ? 'is-open' : undefined)} aria-hidden="true">
          ▸
        </span>
      </button>
      <div hidden={!open}>{children}</div>
    </div>
  );
}
