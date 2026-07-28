import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { loadMemories } from '@/lib/assistant/memory';
import { loadTodayOverview, type TodayOverview } from '@/lib/assistant/overview-core';
import { AssistantChat } from '@/features/assistant/components/assistant-chat';
import { MemoryPanel } from '@/features/assistant/components/memory-panel';
import {
  AGENT_NOTICE_KINDS,
  toAgentNotice,
  type AgentNotice,
} from '@/features/notifications/lib/agent-notice-mapping';

/** Nb max de notices affichées en pile (Plan 3b Task 7). */
const NOTICES_TAKE = 5;

export const metadata: Metadata = { title: 'Assistant' };

interface AssistantPageProps {
  readonly searchParams: Promise<{ readonly tab?: string }>;
}

const TAB_PILL = 'rounded-full px-3.5 py-1.5 text-[11px] font-bold no-underline';
const TAB_PILL_ON = `${TAB_PILL} bg-[color:var(--color-bg-card)] text-[color:var(--color-text-main)] shadow-sm`;
const TAB_PILL_OFF = `${TAB_PILL} text-[color:var(--color-text-muted)]`;

export default async function AssistantPage({ searchParams }: AssistantPageProps) {
  const ctx = await requireUser();
  const [csrfToken, memories, { tab }] = await Promise.all([
    getCsrfTokenForForm(),
    loadMemories(ctx),
    searchParams,
  ]);
  const firstName = ctx.email.split('@')[0] ?? 'vous';
  const isMemoryTab = tab === 'memoire';

  // Briefing + KPI de l'accueil (Plan 4 Task 3) : chargé côté serveur, zéro
  // tour d'agent, zéro token. Inutile sur l'onglet Mémoire (AssistantChat
  // n'y est pas monté). Échec (DB indisponible…) → accueil dégradé, la prop
  // est omise plutôt que passée `undefined` explicitement
  // (`exactOptionalPropertyTypes`) et AssistantChat retombe sur le brief
  // statique existant.
  let overview: TodayOverview | undefined;
  // Pile de notices proactives (Plan 3b Task 7) : les 5 notices non lues les
  // plus récentes, des 3 kinds `agent_*` uniquement (les notices "classiques"
  // — card_assigned, email_new… — n'ont pas de pile dédiée en V1, cf. dette
  // "cloche globale" du plan). Même stratégie de dégradation que l'overview
  // ci-dessus : une panne DB ne doit pas casser la page, la pile reste vide.
  let notices: AgentNotice[] = [];
  if (!isMemoryTab) {
    try {
      overview = await loadTodayOverview(ctx);
    } catch {
      // Accueil dégradé (brief statique) — loggé sans détail d'erreur ni PII,
      // convention safe-wrappers/CLAUDE.md §4.7 : une panne DB ne doit pas
      // être invisible en observabilité.
      console.error('[assistant] today-overview load failed');
      overview = undefined;
    }
    try {
      const rows = await prisma.notification.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          kind: { in: [...AGENT_NOTICE_KINDS] },
          readAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: NOTICES_TAKE,
        select: { id: true, kind: true, data: true },
      });
      notices = rows.map((row) => toAgentNotice(row)).filter((n): n is AgentNotice => n !== null);
    } catch {
      console.error('[assistant] agent notices load failed');
      notices = [];
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-end px-6 pt-4">
        <nav
          aria-label="Vue de l'assistant"
          className="inline-flex rounded-full bg-[color:var(--color-bg-hover)] p-[3px]"
        >
          <Link
            href="/assistant"
            aria-current={isMemoryTab ? undefined : 'page'}
            className={isMemoryTab ? TAB_PILL_OFF : TAB_PILL_ON}
          >
            Conversation
          </Link>
          <Link
            href="/assistant?tab=memoire"
            aria-current={isMemoryTab ? 'page' : undefined}
            className={isMemoryTab ? TAB_PILL_ON : TAB_PILL_OFF}
          >
            Mémoire ({memories.length})
          </Link>
        </nav>
      </div>
      <div className="min-h-0 flex-1">
        {isMemoryTab ? (
          <MemoryPanel entries={memories} csrfToken={csrfToken} />
        ) : (
          <AssistantChat
            csrfToken={csrfToken}
            firstName={firstName}
            notices={notices}
            {...(overview !== undefined ? { overview } : {})}
          />
        )}
      </div>
    </div>
  );
}
