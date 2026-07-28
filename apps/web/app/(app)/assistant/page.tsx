import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getCsrfTokenForForm } from '@/lib/csrf';
import { loadMemories } from '@/lib/assistant/memory';
import { loadTodayOverview, type TodayOverview } from '@/lib/assistant/overview-core';
import { AssistantChat } from '@/features/assistant/components/assistant-chat';
import { MemoryPanel } from '@/features/assistant/components/memory-panel';

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
  if (!isMemoryTab) {
    try {
      overview = await loadTodayOverview(ctx);
    } catch {
      overview = undefined;
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
            {...(overview !== undefined ? { overview } : {})}
          />
        )}
      </div>
    </div>
  );
}
