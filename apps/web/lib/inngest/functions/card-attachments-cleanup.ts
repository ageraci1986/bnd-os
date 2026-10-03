import 'server-only';
import { prisma, type Prisma } from '@nexushub/db';
import { removeCardAttachment } from '@/lib/card-attachment-storage';
import { inngestClient } from '../client';

/**
 * Nettoyage horaire des pièces jointes de cartes (lot C, spec §3.5) :
 *   - lignes `pending` de plus de 30 min (upload abandonné, finalize jamais
 *     appelé, ou scan épuisé en retries) ;
 *   - lignes `dirty` / `scan_failed` de plus de 7 jours (gardées une semaine
 *     pour l'investigation, l'objet ayant déjà été supprimé au rejet).
 * Objet Storage supprimé (si présent) + ligne supprimée. Lot borné à 500.
 *
 * ORDRE (écart assumé vs plan « remove puis deleteRow ») : la ligne est
 * supprimée d'abord, CONDITIONNELLEMENT à son statut lu (`deleteRow` →
 * false si le statut a changé entre-temps, ex. un scan tardif l'a passée
 * `clean`) ; l'objet n'est retiré qu'ensuite. On ne peut ainsi jamais
 * retirer l'objet d'une PJ devenue `clean`. `removeCardAttachment` est
 * best-effort et n'échoue jamais : rien n'est perdu par cet ordre.
 *
 * Job système multi-workspace (comme `blocked-cards-scan`) : aucune session ;
 * les suppressions ciblent la clé primaire + statut lu.
 *
 * PINNED (voir `scan-card-attachment-imports.test.ts`) : aucun import de
 * `@nexushub/agent` ni provider/registry.
 */

const PENDING_TTL_MS = 30 * 60 * 1000;
const REJECTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 500;

export interface StaleAttachment {
  readonly id: string;
  readonly storagePath: string;
  readonly scanStatus: 'pending' | 'clean' | 'dirty' | 'scan_failed';
}

export interface CleanupDeps {
  readonly now: () => Date;
  readonly findStale: (now: Date) => Promise<readonly StaleAttachment[]>;
  /** Suppression conditionnelle au statut lu ; true si la ligne a été supprimée. */
  readonly deleteRow: (row: StaleAttachment) => Promise<boolean>;
  readonly remove: (path: string) => Promise<void>;
}

export interface CleanupResult {
  readonly found: number;
  readonly deleted: number;
  readonly failed: number;
}

export function staleAttachmentsWhere(now: Date): Prisma.CardAttachmentWhereInput {
  return {
    OR: [
      { scanStatus: 'pending', createdAt: { lt: new Date(now.getTime() - PENDING_TTL_MS) } },
      {
        scanStatus: { in: ['dirty', 'scan_failed'] },
        updatedAt: { lt: new Date(now.getTime() - REJECTED_TTL_MS) },
      },
    ],
  };
}

export async function runCardAttachmentsCleanup(deps: CleanupDeps): Promise<CleanupResult> {
  const rows = await deps.findStale(deps.now());
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    // Isolation par ligne : une erreur n'interrompt pas les suivantes. Aucun
    // détail loggé (§4.7) — seuls les comptes remontent.
    try {
      if (!(await deps.deleteRow(row))) continue;
      await deps.remove(row.storagePath);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { found: rows.length, deleted, failed };
}

const prodDeps: CleanupDeps = {
  now: () => new Date(),
  findStale: (now) =>
    prisma.cardAttachment.findMany({
      where: staleAttachmentsWhere(now),
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
      select: { id: true, storagePath: true, scanStatus: true },
    }),
  deleteRow: async (row) => {
    const res = await prisma.cardAttachment.deleteMany({
      where: { id: row.id, scanStatus: row.scanStatus },
    });
    return res.count > 0;
  },
  remove: removeCardAttachment,
};

export const cardAttachmentsCleanup = inngestClient.createFunction(
  { id: 'card-attachments-cleanup', triggers: [{ cron: '15 * * * *' }] },
  async ({ step }) => {
    const result = await step.run('cleanup', () => runCardAttachmentsCleanup(prodDeps));
    console.warn('[inngest] card-attachments-cleanup', result);
    return result;
  },
);
