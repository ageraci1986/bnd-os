'use client';
import { useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useMailboxFilterStore } from '@/stores/mailbox-filter-store';

export interface MailboxFilterOption {
  readonly id: string;
  readonly label: string;
}

export interface MailboxFilterProps {
  readonly options: readonly MailboxFilterOption[];
  /** Mailbox id resolved server-side from `?mailbox=`, or null when unset. */
  readonly initialMailboxId: string | null;
}

/**
 * Toolbar dropdown narrowing the mail list to a single mailbox source
 * (Graph or IMAP — both surface here identically, `label` is just the
 * connected email address). Composes with `?client=` in the URL: only the
 * `mailbox` param is ever touched, every other search param is preserved.
 */
export function MailboxFilter({ options, initialMailboxId }: MailboxFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { mailboxId, setMailboxId } = useMailboxFilterStore();

  // Zustand is UI-only here; the URL (parsed server-side into
  // `initialMailboxId`) is the source of truth, so hydrate on every mount.
  useEffect(() => {
    setMailboxId(initialMailboxId);
  }, [initialMailboxId, setMailboxId]);

  if (options.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-[11px] text-[color:var(--color-text-muted)]">
      <span>Boîte :</span>
      <select
        value={mailboxId ?? ''}
        onChange={(e) => {
          const next = e.target.value || null;
          setMailboxId(next);
          const params = new URLSearchParams(searchParams.toString());
          if (next) params.set('mailbox', next);
          else params.delete('mailbox');
          const qs = params.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        }}
        className="field-select"
        aria-label="Filtrer par boîte mail"
      >
        <option value="">Toutes</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
