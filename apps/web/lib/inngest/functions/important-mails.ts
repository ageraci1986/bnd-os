import 'server-only';
import { prisma } from '@nexushub/db';
import { createAgentNotice, type AgentNoticeInput } from '@/features/notifications/lib/notice-core';
import { inngestClient } from '../client';

/**
 * Scan « mails importants » (Plan 3b Task 6) — toutes les 30 min, par
 * workspace : parmi les mails non lus de la boîte de réception non lus
 * depuis plus de 4 h, ceux dont l'expéditeur (`fromEmail`) correspond à un
 * `Contact` connu du workspace déclenchent une notice `agent_mail_important`
 * pour le PROPRIÉTAIRE de la boîte concernée (`integration.ownerUserId`).
 *
 * HEURISTIQUE (pas un JOIN SQL) : contrairement à ce que le libellé initial
 * du plan suggérait (« join Citext... via `in` sur les emails contacts »),
 * cette implémentation charge d'abord jusqu'à `MAX_CANDIDATE_MAILS` mails
 * candidats (bornage documenté ci-dessous), PUIS tous les contacts du
 * workspace, et fait correspondre `fromEmail`/`Contact.email` EN MÉMOIRE via
 * une Map indexée en minuscules. Plus simple à tester (pas de dépendance à un
 * comportement Citext précis côté Postgres pour un `in` géant) et évite une
 * clause `IN` non bornée sur la liste des emails contacts, qui pourrait
 * grossir sans limite avec le nombre de contacts du workspace.
 *
 * PINNED (voir `important-mails-imports.test.ts`) : ce module (et
 * `functions/index.ts`) ne doit importer NI `@nexushub/agent` NI
 * provider/registry — aucun tour d'agent n'a lieu ici (même rationale que
 * `morning-briefing.ts` / `blocked-cards-scan.ts`).
 *
 * PATTERN — `runImportantMailsScan` extraite en fonction pure : même
 * rationale que les deux fonctions précédentes (aucun harnais de test
 * Inngest installé dans ce repo). `importantMails` (l'export Inngest) n'est
 * qu'un fil électrique.
 */

/**
 * Bornage — un workspace avec plus de `MAX_CANDIDATE_MAILS` mails non lus en
 * boîte de réception ne verra que les `MAX_CANDIDATE_MAILS` plus récents
 * scannés à CE tick (les 500 les plus anciens dans une boîte déjà noyée sous
 * les mails non lus depuis > 4 h ne sont de toute façon pas la priorité :
 * `orderBy: receivedAt desc` garantit qu'on scanne les plus récents d'abord —
 * le tick suivant, 30 min plus tard, rattrapera le reste si le volume
 * redescend sous la borne). Dette documentée, pas un bug.
 */
export const MAX_CANDIDATE_MAILS = 500;

/** Fenêtre « non lu depuis trop longtemps » — 4 h, fixée par le plan §Task 6. */
const UNREAD_THRESHOLD_MS = 4 * 60 * 60 * 1000;

/** Prisma leaf — aucune PII (uuids seulement). Même requête que dans les deux autres fonctions crons (self-contained, pas partagée — voir leur commentaire d'en-tête). */
export async function listWorkspaceIds(): Promise<string[]> {
  const rows = await prisma.workspace.findMany({ select: { id: true } });
  return rows.map((row) => row.id);
}

export interface CandidateMail {
  readonly id: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly ownerUserId: string | null;
}

/**
 * Prisma leaf — mails non lus, en boîte de réception, non supprimés/archivés,
 * reçus avant `before` (donc non lus depuis plus de 4 h au moment du calcul
 * de `before` par l'appelant), les plus récents d'abord, bornés à
 * `MAX_CANDIDATE_MAILS`. `fromEmail`/`fromName` sont montrés à l'utilisateur
 * dans l'app (boîte mail) — pas de PII nouvelle exposée par cette requête,
 * mais ne JAMAIS les faire fuiter dans un log (CLAUDE.md §4.7 — `console.warn`
 * en fin de run ne loggue que des comptes, jamais ces champs).
 */
export async function listCandidateMails(
  workspaceId: string,
  before: Date,
): Promise<CandidateMail[]> {
  const rows = await prisma.emailMessage.findMany({
    where: {
      workspaceId,
      isRead: false,
      deletedAt: null,
      archivedAt: null,
      folder: 'inbox',
      receivedAt: { lt: before },
    },
    orderBy: { receivedAt: 'desc' },
    take: MAX_CANDIDATE_MAILS,
    select: {
      id: true,
      fromEmail: true,
      fromName: true,
      integrationId: true,
      integration: { select: { ownerUserId: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    ownerUserId: row.integration.ownerUserId,
  }));
}

export interface WorkspaceContact {
  readonly email: string;
  readonly clientName: string;
}

/**
 * Prisma leaf — contacts non supprimés du workspace ayant un email renseigné,
 * avec le nom du client associé (affiché dans le message de la notice — le
 * client est une donnée que l'utilisateur voit déjà partout ailleurs dans
 * l'app, cf. contrat PII de `notice-core.ts`).
 */
export async function listWorkspaceContacts(workspaceId: string): Promise<WorkspaceContact[]> {
  const rows = await prisma.contact.findMany({
    where: { workspaceId, deletedAt: null, email: { not: null } },
    select: { email: true, client: { select: { name: true } } },
  });
  return rows
    .filter((row): row is typeof row & { email: string } => row.email !== null)
    .map((row) => ({ email: row.email, clientName: row.client.name }));
}

/** Map lowercase email -> nom du client, pour le matching en mémoire (Citext-safe). */
function buildContactMap(contacts: readonly WorkspaceContact[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const contact of contacts) {
    map.set(contact.email.toLowerCase(), contact.clientName);
  }
  return map;
}

export interface ImportantMailsScanDeps {
  readonly listWorkspaceIds: () => Promise<readonly string[]>;
  readonly listCandidateMails: (
    workspaceId: string,
    before: Date,
  ) => Promise<readonly CandidateMail[]>;
  readonly listWorkspaceContacts: (workspaceId: string) => Promise<readonly WorkspaceContact[]>;
  readonly createNotice: (input: AgentNoticeInput) => Promise<{ created: boolean }>;
  /** `step.run` en prod ; un fake synchrone/async dans les tests. */
  readonly runStep: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
  readonly now: () => Date;
}

export interface ImportantMailsScanResult {
  readonly workspaces: number;
  readonly candidates: number;
  readonly notices: number;
}

function importantMailMessage(
  mail: CandidateMail,
  clientName: string,
): AgentNoticeInput['message'] {
  return `Mail de ${mail.fromName ?? mail.fromEmail} (${clientName}) non lu depuis plus de 4 h.`;
}

function importantMailDiscuss(mailId: string): string {
  // ID + verbes SEULEMENT (contrat anti-injection de `notice-core.ts` — voir
  // le commentaire équivalent dans `blocked-cards-scan.ts`).
  return `Parlons du mail ${mailId} — propose-moi une réponse`;
}

/**
 * Cœur pur de la fonction — voir le commentaire d'en-tête du fichier pour le
 * choix d'architecture. Isolation : une erreur pour UN workspace
 * (`listCandidateMails`/`listWorkspaceContacts`) ne doit interrompre ni les
 * autres mails de ce workspace ni les workspaces suivants — try/catch autour
 * de chaque `runStep` par workspace, même pattern que
 * `blocked-cards-scan.ts`.
 */
export async function runImportantMailsScan(
  deps: ImportantMailsScanDeps,
): Promise<ImportantMailsScanResult> {
  const workspaceIds = await deps.listWorkspaceIds();
  const before = new Date(deps.now().getTime() - UNREAD_THRESHOLD_MS);
  let candidatesTotal = 0;
  let notices = 0;

  for (const workspaceId of workspaceIds) {
    try {
      const { candidates, notices: workspaceNotices } = await deps.runStep(
        `important-mails-${workspaceId}`,
        async () => {
          const [mails, contacts] = await Promise.all([
            deps.listCandidateMails(workspaceId, before),
            deps.listWorkspaceContacts(workspaceId),
          ]);
          const contactMap = buildContactMap(contacts);
          let created = 0;
          for (const mail of mails) {
            if (mail.ownerUserId === null) continue;
            const clientName = contactMap.get(mail.fromEmail.toLowerCase());
            if (clientName === undefined) continue;
            const outcome = await deps.createNotice({
              workspaceId,
              userId: mail.ownerUserId,
              kind: 'agent_mail_important',
              message: importantMailMessage(mail, clientName),
              data: { ref: mail.id, discuss: importantMailDiscuss(mail.id) },
            });
            if (outcome.created) created += 1;
          }
          return { candidates: mails.length, notices: created };
        },
      );
      candidatesTotal += candidates;
      notices += workspaceNotices;
    } catch {
      // Isolation (Task 6) : aucun détail loggé ici au-delà du compte final
      // — CLAUDE.md §4.7 interdit la PII, et une stack trace par échec
      // pourrait exposer des paramètres de requête.
    }
  }

  return { workspaces: workspaceIds.length, candidates: candidatesTotal, notices };
}

export const importantMails = inngestClient.createFunction(
  { id: 'important-mails', triggers: [{ cron: '*/30 * * * *' }] },
  async ({ step }) => {
    const result = await runImportantMailsScan({
      listWorkspaceIds,
      listCandidateMails,
      listWorkspaceContacts,
      createNotice: createAgentNotice,
      // Voir le commentaire équivalent dans `blocked-cards-scan.ts` pour le
      // cast : `step.run`'s return type est `Promise<Jsonify<Awaited<T>>>`,
      // structurellement identique ici (shape `{candidates, notices}` faite
      // de nombres) mais TS ne le prouve pas à travers un générique.
      runStep: (stepId, fn) => step.run(stepId, fn) as ReturnType<typeof fn>,
      now: () => new Date(),
    });
    // Comptes seulement — jamais d'adresse mail, de nom d'expéditeur ni de
    // nom de client (CLAUDE.md §4.7). `console.warn` : seule méthode console
    // autorisée par le lint du repo avec `.error`.
    console.warn('[inngest] important-mails', result);
    return result;
  },
);
