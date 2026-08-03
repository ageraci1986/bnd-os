export type OrbActivity = 'idle' | 'thinking' | 'responding' | 'listening';

/**
 * Dérive l'état de l'orbe depuis les états du chat (spec §3.1/§6).
 * Précédence : listening > busy (thinking/responding) > speaking → responding
 * > idle. `speaking` couvre le cas où le SSE est terminé (busy=false) mais où
 * la file TTS parle encore : la capsule affiche « Je parle… », l'orbe doit
 * rester `responding` (spec §1) au lieu de retomber à `idle`.
 */
export function deriveOrbActivity(input: {
  busy: boolean;
  streaming: boolean; // streamText non vide
  listening?: boolean; // PTT en cours (voix V1.5)
  speaking?: boolean; // file TTS en cours de lecture (voix V1.5)
}): OrbActivity {
  if (input.listening === true) return 'listening';
  if (input.busy) return input.streaming ? 'responding' : 'thinking';
  if (input.speaking === true) return 'responding';
  return 'idle';
}

/** Orbe décorative — aria-hidden : l'information d'activité est déjà donnée
 *  par les indicateurs textuels du fil (labels d'activité, aria-live). */
export function AssistantOrb({ activity }: { readonly activity: OrbActivity }) {
  return (
    <div className="nx-orb" data-activity={activity} aria-hidden="true" data-testid="assistant-orb">
      <div className="nx-orb-ring" />
      <div className="nx-orb-blob" />
    </div>
  );
}
