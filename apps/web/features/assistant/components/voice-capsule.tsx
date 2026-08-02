'use client';

/**
 * Capsule d'état du mode voix (spec §1) — bandeau au-dessus du champ de
 * saisie. `idle` ne rend rien. aria-live=polite : les changements d'état
 * sont annoncés sans interrompre le lecteur d'écran.
 */

export type VoiceCapsuleMode = 'idle' | 'recording' | 'transcribing' | 'speaking' | 'denied';

export function VoiceCapsule({
  mode,
  onStop,
}: {
  readonly mode: VoiceCapsuleMode;
  readonly onStop: () => void;
}) {
  if (mode === 'idle') return null;
  return (
    <div aria-live="polite" className="w-full">
      <div
        data-testid="voice-capsule"
        data-mode={mode}
        className="flex w-full items-center gap-2 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-2 text-xs text-[color:var(--color-text-muted)]"
      >
        {mode === 'recording' && (
          <>
            <span
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ background: 'var(--color-danger)' }}
              aria-hidden
            />
            <span>J&apos;écoute… relâche pour envoyer</span>
            <span className="ml-auto text-[color:var(--color-text-ghost)]">
              ✕ Échap pour annuler
            </span>
          </>
        )}
        {mode === 'transcribing' && <span className="opacity-60">Transcription…</span>}
        {mode === 'speaking' && (
          <>
            <span
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ background: 'var(--accent-primary)' }}
              aria-hidden
            />
            <span>Je parle…</span>
            <button
              type="button"
              onClick={onStop}
              aria-label="Arrêter la lecture"
              className="ml-auto rounded-full border border-[color:var(--color-border-light)] px-3 py-1 font-bold text-[color:var(--color-text-muted)]"
            >
              ■ Stop
            </button>
          </>
        )}
        {mode === 'denied' && (
          <span>
            Le micro est bloqué — autorise-le dans les réglages du navigateur (icône 🔒 dans la
            barre d&apos;adresse), puis recharge la page.
          </span>
        )}
      </div>
    </div>
  );
}
