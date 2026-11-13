/**
 * Glossaire de noms propres pour la reconnaissance vocale (Deepgram `keyterm`).
 *
 * Les noms propres sont le point faible de toute transcription : un client,
 * un patronyme, un projet n'existent dans aucun modèle acoustique. Les
 * donner d'avance les corrige (« Angelo Jurassi » → « Angelo Geraci »).
 *
 * Deux mesures (faites sur l'API réelle, côté lleva) décident de ce module :
 *
 *   1. Un terme CONTENANT UN CHIFFRE corrompt les nombres dictés autour :
 *      « Casa 47 » envoyé comme terme faisait transcrire « Casa 48 ».
 *      D'où le retrait systématique des chiffres.
 *   2. Les termes hors-sujet sont INOFFENSIFS. On peut ratisser large : seul
 *      l'oubli coûte.
 *
 * Module PUR : aucune dépendance, utilisable côté serveur comme client.
 */

/** Plafond généreux : le bruit ne coûte rien, l'oubli si. */
export const MAX_KEYTERMS = 40;

/**
 * Deepgram refuse une requête dont les `keyterm` dépassent 500 tokens au
 * total. 800 caractères laisse de la marge même sur des noms que le
 * tokenizer découpe finement (~2 caractères par token au pire).
 */
export const MAX_KEYTERMS_TOTAL_CHARS = 800;

const MIN_TERM_CHARS = 3;
const MAX_TERM_CHARS = 40;

/** Chiffres retirés, espaces normalisés, ponctuation de bordure retirée. */
function clean(raw: string): string {
  return raw
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
}

/** Clé de dédoublonnage : sans accents, sans casse. */
function fold(term: string): string {
  return term.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Transforme des noms bruts en termes sûrs à envoyer à Deepgram.
 * L'ordre d'entrée est conservé : c'est lui qui survit aux plafonds, donc
 * l'appelant place les noms les plus importants en premier.
 */
export function toKeyterms(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const name of names) {
    if (out.length >= MAX_KEYTERMS) break;
    const term = clean(name);
    if (term.length < MIN_TERM_CHARS || term.length > MAX_TERM_CHARS) continue;
    const key = fold(term);
    if (seen.has(key)) continue;
    if (total + term.length > MAX_KEYTERMS_TOTAL_CHARS) continue;
    seen.add(key);
    out.push(term);
    total += term.length;
  }
  return out;
}
