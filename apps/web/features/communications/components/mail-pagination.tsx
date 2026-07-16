'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

interface Props {
  readonly page: number;
  readonly totalPages: number;
  readonly totalCount: number;
}

/**
 * URL-driven pagination for /communications. Emits `?page=N` and preserves
 * every other query param (client filter, mailbox filter, etc.) so the
 * pagination composes cleanly with the existing filters.
 */
export function MailPagination({ page, totalPages, totalCount }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const goto = (next: number): void => {
    const params = new URLSearchParams(searchParams.toString());
    if (next <= 1) params.delete('page');
    else params.set('page', String(next));
    router.push(`${pathname}${params.toString() ? `?${params}` : ''}`);
  };

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="flex items-center justify-between border-t border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-3 text-sm">
      <span className="text-[color:var(--color-text-muted)]">
        Page {page} sur {totalPages} · {totalCount} mails
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => goto(page - 1)}
          className="btn btn-ghost btn-sm disabled:opacity-40"
        >
          ‹ Précédent
        </button>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => goto(page + 1)}
          className="btn btn-ghost btn-sm disabled:opacity-40"
        >
          Suivant ›
        </button>
      </div>
    </div>
  );
}
