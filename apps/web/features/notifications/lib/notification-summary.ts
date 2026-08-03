/**
 * Résumé HUMAIN d'une ligne `Notification` pour le tool `list_notifications`
 * (spec visibilité totale §1). Pur, tolérant (même philosophie que
 * agent-notice-mapping.ts) : un `data` malformé donne un titre null, jamais un
 * crash — et le `data` JSON n'est JAMAIS renvoyé brut à l'agent
 * (anti-injection : seules des chaînes extraites de clés connues, bornées,
 * atteignent le prompt).
 */

const KIND_LABELS: Record<string, string> = {
  card_assigned: 'Carte assignée',
  card_commented: 'Commentaire sur une carte',
  card_blocked: 'Carte bloquée',
  email_new: 'Nouveau mail',
  slack_mention: 'Mention Slack',
  agent_briefing: 'Briefing matinal (agent)',
  agent_card_blocked: 'Cartes bloquées (agent)',
  agent_mail_important: 'Mail important (agent)',
};

/** Clés de `data` acceptées comme titre, par ordre de préférence. */
const TITLE_KEYS = ['message', 'title', 'subject', 'cardTitle'] as const;
const TITLE_MAX_CHARS = 200;

export interface NotificationSummary {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly title: string | null;
  readonly read: boolean;
  readonly createdAt: string;
}

export interface RawNotificationRow {
  readonly id: string;
  readonly kind: string;
  readonly data: unknown;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

function extractTitle(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  for (const key of TITLE_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.slice(0, TITLE_MAX_CHARS);
    }
  }
  return null;
}

export function toNotificationSummary(row: RawNotificationRow): NotificationSummary {
  return {
    id: row.id,
    kind: row.kind,
    label: KIND_LABELS[row.kind] ?? 'Notification',
    title: extractTitle(row.data),
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
