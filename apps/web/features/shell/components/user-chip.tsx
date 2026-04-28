import { Avatar } from '@nexushub/ui';
import { signOut } from '@/features/auth/actions/sign-out';

export interface UserChipProps {
  readonly displayName: string;
  readonly email: string;
  readonly initials: string;
  readonly role: 'Admin' | 'Membre';
}

/**
 * Footer of the sidebar (PRD §6) — gradient avatar + name + role +
 * inline signout form. Pure server component (no hooks needed).
 */
export function UserChip({ displayName, email, initials, role }: UserChipProps) {
  return (
    <div className="flex w-full items-center gap-3">
      <Avatar initials={initials} variant="gradient" title={displayName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-[color:var(--color-text-main)]">
          {displayName}
        </p>
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.5px] text-[color:var(--color-text-muted)]">
          {role} · {email}
        </p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          aria-label="Déconnexion"
          className="grid h-8 w-8 place-items-center rounded-full text-base text-[color:var(--color-text-muted)] transition hover:bg-[color:var(--color-bg-hover)] hover:text-[color:var(--color-danger)]"
        >
          ⏻
        </button>
      </form>
    </div>
  );
}
