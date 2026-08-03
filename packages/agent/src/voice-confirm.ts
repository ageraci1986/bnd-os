/**
 * Confirmation vocale des actions gated (spec §4) : matching STRICT d'un
 * transcript vers allow/deny. Normalisation casse + ponctuation, puis
 * correspondance EXACTE contre des listes fermées. Tout le reste → null
 * (l'appelant redemande ou laisse le widget cliquable). Aucun LLM ici :
 * pas de faux positif possible sur une action irréversible.
 */

export type VoiceConfirmIntent = 'allow' | 'deny';

const ALLOW = new Set([
  'oui',
  'autorise',
  'valide',
  'envoie',
  'confirme',
  'go',
  'oui envoie',
  'oui autorise',
  'oui valide',
  'oui confirme',
  'yes',
  'confirm',
  'send',
  'approve',
  'yes send',
]);

const DENY = new Set([
  'non',
  'refuse',
  'annule',
  'stop',
  'non annule',
  'non refuse',
  'no',
  'cancel',
  'deny',
  'no cancel',
]);

/** Minuscule, ponctuation retirée, espaces normalisés. Les accents sont conservés. */
function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[.,;:!?…'"«»()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchVoiceConfirm(transcript: string): VoiceConfirmIntent | null {
  const t = normalize(transcript);
  if (ALLOW.has(t)) return 'allow';
  if (DENY.has(t)) return 'deny';
  return null;
}
