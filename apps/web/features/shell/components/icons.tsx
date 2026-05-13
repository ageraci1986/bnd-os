/**
 * Sidebar / topbar icon set. Lucide-style line icons (1.5 stroke,
 * round caps) sized to fit the 18px slot in NavItem. Inheriting
 * `currentColor` lets the active/hover states colour them naturally.
 */
import type { SVGProps } from 'react';

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  style: { width: 18, height: 18, display: 'block' },
} as const;

type Props = SVGProps<SVGSVGElement>;

export function DashboardIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function ProjectsIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function MailIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function ClientsIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15 19c0-2 1.5-3.5 4-3.5s2 1 2 1" />
    </svg>
  );
}

export function PencilIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <path d="M16 3.5 20.5 8 9 19.5l-5 1 1-5z" />
      <path d="m13 6.5 4.5 4.5" />
    </svg>
  );
}

export function GridIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function TeamIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.5 3-6 6-6s6 2.5 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M21 19.5c0-2.5-2-4.5-4-4.5" />
    </svg>
  );
}

export function PlugIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <path d="M9 3v6" />
      <path d="M15 3v6" />
      <path d="M5 9h14v3a7 7 0 0 1-14 0z" />
      <path d="M12 19v3" />
    </svg>
  );
}

export function GearIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.4.8a7 7 0 0 0-2.2-1.3L13.7 3h-3.4l-.6 2.3a7 7 0 0 0-2.2 1.3l-2.4-.8-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.4-.8a7 7 0 0 0 2.2 1.3l.6 2.3h3.4l.6-2.3a7 7 0 0 0 2.2-1.3l2.4.8 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z" />
    </svg>
  );
}

export function PlusIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function KanbanIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="10" rx="1.5" />
      <rect x="17" y="4" width="4" height="13" rx="1.5" />
    </svg>
  );
}

export function TrashIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function CalendarIcon(p: Props) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  );
}
