/**
 * Pathname → breadcrumb label mapping for the (app) shell.
 *
 * Kept as a flat lookup table so it stays trivially testable. When a
 * route lands a real layout in its own file (e.g. /projects/[id]) it
 * can override the title via metadata or a per-route helper.
 */

const ROUTE_LABELS: Readonly<Record<string, string>> = {
  '/overview': 'Tableau de bord',
  '/projects': 'Projets',
  '/communications': 'Communications',
  '/clients': 'Clients',
  '/templates/email': 'Templates e-mail',
  '/templates/kanban': 'Templates Kanban',
  '/team': 'Équipe',
  '/integrations': 'Intégrations',
  '/settings': 'Paramètres',
};

export function pathnameToLabel(pathname: string): string {
  // Exact match first
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];

  // Fall back to the longest matching prefix (handles /projects/abc-123 etc.)
  const sortedKeys = Object.keys(ROUTE_LABELS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (pathname.startsWith(`${key}/`)) {
      const label = ROUTE_LABELS[key];
      if (label) return label;
    }
  }

  // Last resort: prettify the last segment
  const segs = pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  return last.charAt(0).toUpperCase() + last.slice(1);
}
