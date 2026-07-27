import 'server-only';

import { NotFoundError } from '@nexushub/domain';

/**
 * Wrappers d'erreur partagés par tous les modules de tools assistant.
 * Contrat `defineTool` : seul un message user-safe peut s'échapper d'un
 * handler — les erreurs brutes (Prisma, `NotFoundError`, redirect de
 * `requireUser`) ne doivent JAMAIS atteindre le modèle ni l'utilisateur.
 *
 * Dans les deux wrappers, `tool` sert uniquement d'étiquette de log serveur —
 * jamais le contenu de l'erreur ni les arguments (PII / secrets,
 * CLAUDE.md §4.7).
 */

/** `redirect()` de Next (ex. `requireUser` sans session) lève une erreur avec ce digest. */
export function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

/**
 * `instanceof` + sniff par `code` : l'identité de classe peut diverger quand
 * un module est chargé deux fois (même précédent que `prismaErrorCode` dans
 * card-assignees.ts), donc on ne se repose pas uniquement sur `instanceof`.
 */
function isNotFound(error: unknown): boolean {
  if (error instanceof NotFoundError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'NOT_FOUND'
  );
}

/**
 * Exécute une mutation en reformulant toute erreur en message montrable.
 */
export async function safeMutation(tool: string, work: () => Promise<string>): Promise<string> {
  try {
    return await work();
  } catch (error) {
    if (isNextRedirect(error)) {
      return 'Échec : session expirée — reconnectez-vous.';
    }
    if (isNotFound(error)) {
      return 'Échec : élément introuvable ou hors de votre périmètre.';
    }
    console.error('[assistant] tool mutation error', { tool });
    return "Erreur interne pendant l'action — réessayez dans un instant.";
  }
}

/**
 * Pendant lecture de `safeMutation` : reformule toute erreur de requête DB en
 * message montrable. La branche NEXT_REDIRECT couvre les handlers de lecture
 * qui appellent une action ré-authentifiante (ex. `fetchMailBody` →
 * `requireUser()`) alors que la session a expiré.
 */
export async function safeDb(tool: string, work: () => Promise<string>): Promise<string> {
  try {
    return await work();
  } catch (error) {
    if (isNextRedirect(error)) {
      return 'Erreur : session expirée — reconnectez-vous.';
    }
    console.error('[assistant] tool db error', { tool });
    return 'Erreur interne en consultant les données — réessayez dans un instant.';
  }
}
