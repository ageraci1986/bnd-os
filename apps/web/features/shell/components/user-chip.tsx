import { signOut } from '@/features/auth/actions/sign-out';

export interface UserChipProps {
  readonly displayName: string;
  readonly initials: string;
  readonly role: 'Admin' | 'Membre';
}

/**
 * Footer of the sidebar (mockup §03 `.user-profile`) — gradient avatar,
 * name + role, inline signout form. Pure server component.
 */
export function UserChip({ displayName, initials, role }: UserChipProps) {
  return (
    <>
      <div className="avatar gradient" aria-hidden="true">
        {initials}
      </div>
      <div className="user-meta">
        <div className="user-name">{displayName}</div>
        <div className="user-role">{role}</div>
      </div>
      <form action={signOut}>
        <button type="submit" aria-label="Déconnexion" className="signout-btn">
          ⏻
        </button>
      </form>
    </>
  );
}
