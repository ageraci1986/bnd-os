'use client';
import type { UserScope } from '@nexushub/domain';

export interface ScopeChipProps {
  readonly scope: UserScope;
  readonly onClick?: () => void;
}

export function ScopeChip({ scope, onClick }: ScopeChipProps) {
  const label =
    scope.kind === 'workspace'
      ? 'Tout le workspace'
      : `${scope.clientIds.length} client${scope.clientIds.length > 1 ? 's' : ''} + ${scope.projectIds.length} projet${scope.projectIds.length > 1 ? 's' : ''}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--color-text-soft)] hover:text-[color:var(--color-text-main)]"
    >
      <span aria-hidden="true">🎯</span>
      {label}
    </button>
  );
}
