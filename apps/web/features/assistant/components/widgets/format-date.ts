/**
 * Formatage des dates dans les widgets assistant (fr-FR).
 * Une chaîne non parsable est renvoyée telle quelle (jamais « Invalid Date »).
 */

/** Date de réception d'un mail : heure si c'est aujourd'hui, sinon date courte. */
export function formatReceivedAt(receivedAt: string): string {
  const date = new Date(receivedAt);
  if (Number.isNaN(date.getTime())) return receivedAt;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' }).format(date)
    : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(date);
}

/**
 * Échéance d'une carte du board : date courte — les dues du board sont
 * volontairement NON relatives (« 01/08/2026 », pas « dans 3 jours ») pour
 * rester lisibles quel que soit le moment où le fil est relu.
 */
export function formatDue(due: string): string {
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return due;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(date);
}
