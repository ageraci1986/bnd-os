import 'server-only';

import { prisma } from '@nexushub/db';
import { loadUserScope, scopedCardWhere, type ScopeAuthContext } from '@/lib/auth/scope';
import { startOfTodayUtc } from '@/features/projects/lib/card-filter';

/**
 * `loadTodayOverview` only reads `workspaceId`/`userId` directly and
 * forwards the context to `loadUserScope` (which itself only needs
 * `userId`/`workspaceId`/`role`/`isSuperAdmin`) — re-export the same
 * reduced shape so callers without a real HTTP session (Inngest cron
 * functions building a context from a `Membership` row, no `email`) don't
 * need to fabricate one. The page/tool callers keep passing the full
 * `AuthContext`, which satisfies this narrower type — no behavior change.
 */
export type OverviewAuthContext = ScopeAuthContext;

/**
 * Forme EXACTE sérialisée par le tool `get_today_overview`
 * (lib/assistant/tools/read-tools.ts) — les widgets (`KpiCards`) et la route
 * SSE en dépendent, ne pas y toucher sans mettre à jour les deux.
 */
export interface TodayOverview {
  readonly blockedCards: number;
  readonly dueTodayCards: number;
  readonly unreadMails: number;
  readonly unreadNotifications: number;
}

/**
 * Résumé du jour partagé par le tool `get_today_overview` (in-thread) et
 * l'accueil de `/assistant` (chargé côté serveur, zéro tour d'agent — Plan 4
 * Task 3). Recharge son propre scope, comme les autres `*-core.ts` du repo
 * (card-core, project-core…) — pas de dépendance à un scope préchargé par un
 * appelant.
 */
export async function loadTodayOverview(ctx: OverviewAuthContext): Promise<TodayOverview> {
  const scope = await loadUserScope(ctx);
  const workspaceId = ctx.workspaceId;
  // Convention repo (card-filter.ts) : les échéances sont stockées à minuit
  // UTC — « dû aujourd'hui » = [minuit UTC, minuit UTC + 1 j).
  const start = startOfTodayUtc();
  const endExclusive = new Date(start);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  // Seules les cartes de projets VIVANTS comptent : un projet en corbeille
  // (soft delete 30 j) ou archivé disparaît de tous les boards, ses cartes ne
  // doivent plus alimenter les compteurs du briefing (sinon « 6 cartes
  // bloquées » introuvables — bug du 2026-08-03). AND explicite : comme dans
  // read-tools.ts, `scopedCardWhere` pose sa propre clé `project` — un spread
  // à plat écraserait ce filtre.
  const liveProjectFilter = { project: { deletedAt: null, archivedAt: null } };
  const [blockedCards, dueTodayCards, unreadMails, unreadNotifications] = await Promise.all([
    prisma.card.count({
      where: {
        workspaceId,
        deletedAt: null,
        archivedAt: null,
        column: { isBlockedSystem: true },
        AND: [liveProjectFilter, scopedCardWhere(scope)],
      },
    }),
    prisma.card.count({
      where: {
        workspaceId,
        deletedAt: null,
        archivedAt: null,
        dueDate: { gte: start, lt: endExclusive },
        AND: [liveProjectFilter, scopedCardWhere(scope)],
      },
    }),
    prisma.emailMessage.count({ where: { workspaceId, deletedAt: null, isRead: false } }),
    prisma.notification.count({ where: { workspaceId, userId: ctx.userId, readAt: null } }),
  ]);
  return { blockedCards, dueTodayCards, unreadMails, unreadNotifications };
}
