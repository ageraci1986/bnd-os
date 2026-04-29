import Link from 'next/link';
import { ClientMono } from './client-mono';

export interface ClientCardProps {
  readonly slug: string;
  readonly name: string;
  readonly initials: string;
  readonly colorToken: string;
  readonly contactsCount: number;
  readonly projectsCount: number;
  readonly active?: boolean;
}

/**
 * Row in the left column of /clients. Wrapping in a Link keeps the
 * "selected" state purely URL-driven so the page is shareable + the
 * back button does the right thing.
 */
export function ClientCard({
  slug,
  name,
  initials,
  colorToken,
  contactsCount,
  projectsCount,
  active = false,
}: ClientCardProps) {
  return (
    <Link
      href={`/clients?selected=${encodeURIComponent(slug)}`}
      aria-current={active ? 'page' : undefined}
      className={[
        'mb-2 grid grid-cols-[56px_1fr_auto] items-center gap-3.5 rounded-2xl border p-4',
        'shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-hover)]',
        active
          ? 'border-[color:var(--color-accent-primary)] bg-[color:var(--color-accent-soft)]'
          : 'border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)]',
      ].join(' ')}
    >
      <ClientMono initials={initials} colorToken={colorToken} size={56} />
      <div className="min-w-0">
        <p className="truncate text-base font-extrabold tracking-tight">{name}</p>
        <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
          {contactsCount === 0
            ? 'Aucun contact'
            : contactsCount === 1
              ? '1 contact'
              : `${contactsCount} contacts`}
          {' · '}
          {projectsCount === 0
            ? 'aucun projet'
            : projectsCount === 1
              ? '1 projet'
              : `${projectsCount} projets`}
        </p>
      </div>
      <span
        className="text-[color:var(--color-text-muted)]"
        aria-hidden="true"
        style={{ fontSize: 18 }}
      >
        →
      </span>
    </Link>
  );
}
