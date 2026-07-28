export type OrbActivity = 'idle' | 'thinking' | 'responding' | 'listening';

/** Dérive l'état de l'orbe depuis les états du chat (spec §3.1/§6). `listening` = V1.5. */
export function deriveOrbActivity(input: {
  busy: boolean;
  streaming: boolean; // streamText non vide
}): OrbActivity {
  if (!input.busy) return 'idle';
  return input.streaming ? 'responding' : 'thinking';
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
