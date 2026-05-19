/**
 * Read-only visual: a small filled checkbox rendered when a card sits
 * in the project's last user column. The completion state is fully
 * derived from the card's position (DB trigger
 * `sync_card_completed_at`) — there is no manual toggle. Same visual
 * footprint as `CardAdvanceCheckbox` so the list-view grid template
 * stays balanced.
 */
export function CardCompletedBadge() {
  return (
    <span
      role="img"
      aria-label="Carte terminée"
      title="Terminé · la carte est dans la dernière colonne"
      className="nx-card-advance"
      data-state="checked"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="3 8.5 6.5 12 13 4.5" />
      </svg>
    </span>
  );
}
