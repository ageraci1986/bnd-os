import type { TodayOverview } from './overview-core';

/**
 * Phrase digérée partagée entre l'accueil `/assistant` (`DigestedBrief` dans
 * `assistant-chat.tsx`) et la notice de briefing matinal (Inngest, Plan 3b
 * Task 4) — un seul endroit pour les accords singulier/pluriel FR.
 *
 * Séparé de `overview-core.ts` : c'est de la présentation (formatage FR),
 * pas de l'agrégation de données — et il ne doit dépendre de rien côté
 * serveur (pas de Prisma) pour rester importable depuis le composant client
 * `assistant-chat.tsx` sans tirer `overview-core`'s `'server-only'` chain.
 */

// Règle CLDR fr : "one" pour n = 0 ou 1 (« 0 mail », « 1 mail »), "other" au-delà.
function isSingularFr(count: number): boolean {
  return count === 0 || count === 1;
}

export interface BriefParts {
  readonly task: string;
  /** `null` quand `blockedCards === 0` — la partie ne doit pas apparaître. */
  readonly blocked: string | null;
  readonly mail: string;
}

/**
 * Fragments individuels de la phrase — exportés séparément pour que
 * `DigestedBrief` puisse styler la partie « bloquée(s) » (token danger) sans
 * dupliquer la logique d'accord.
 */
export function briefParts(overview: TodayOverview): BriefParts {
  const { dueTodayCards, blockedCards, unreadMails } = overview;
  const task = `${dueTodayCards} ${isSingularFr(dueTodayCards) ? 'tâche due' : 'tâches dues'} aujourd'hui`;
  const blocked =
    blockedCards > 0
      ? `${blockedCards} ${isSingularFr(blockedCards) ? 'bloquée' : 'bloquées'}`
      : null;
  const mail = `${unreadMails} ${isSingularFr(unreadMails) ? 'mail non lu' : 'mails non lus'}`;
  return { task, blocked, mail };
}

/**
 * Phrase complète en texte brut (jointe par « · »), utilisée telle quelle
 * comme `message` de la notice `agent_briefing` (Inngest). Ne prend pas de
 * décision sur le cas tout-à-zéro — au caller (le cron) de décider s'il
 * saute la notice.
 */
export function briefSentence(overview: TodayOverview): string {
  const { task, blocked, mail } = briefParts(overview);
  return [task, blocked, mail].filter((part): part is string => part !== null).join(' · ');
}
