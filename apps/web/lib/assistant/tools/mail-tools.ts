import 'server-only';

import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import { stripMailHtmlToText } from '@nexushub/integrations/mail';
import type { AuthContext } from '@/lib/auth';
import {
  loadDraft,
  saveDraft,
  type SaveDraftInput,
} from '@/features/communications/actions/mail-drafts';
import { sendMail, type SendMailResult } from '@/features/communications/actions/send-mail';
import { markEmailRead } from '@/features/communications/actions/mark-email-read';
import {
  setMailStateCore,
  MAIL_BULK_MAX,
  type MailStateOp,
  MailFilterSchema,
  type MailFilter,
  countMailsByFilter,
  setMailStateByFilterCore,
} from '@/features/communications/lib/mail-state-core';
import { safeDb, safeMutation } from './safe-wrappers';

const uuid = z.string().uuid();
const UUID_JSON = { type: 'string', format: 'uuid' } as const;
const emailAddress = z.string().trim().email();
const EMAIL_JSON = { type: 'string', format: 'email' } as const;

/** Max destinataires par champ (to/cc/bcc) — même plafond que sendMail (send-mail.ts). */
const RECIPIENTS_MAX = 20;
/** Longueur max du corps HTML accepté par les tools mail (plus stricte que la limite serveur de sendMail/saveDraft). */
const BODY_HTML_MAX_CHARS = 100_000;
/** Longueur max de l'extrait montré dans le dialog de confirmation de send_mail. */
const CONFIRM_EXCERPT_MAX_CHARS = 200;
/** Nb max d'adresses affichées avant troncature « +n autres » — to/cc uniquement, JAMAIS Cci. */
const CONFIRM_RECIPIENTS_SHOWN_MAX = 5;
/**
 * Budget total de la description de confirmation. La route coupe à 2000
 * chars : si on comptait sur cette coupe, ce serait précisément la FIN de la
 * description — le segment Cci — qui disparaîtrait, trahissant la garantie
 * « chaque destinataire caché est visible ». On reste donc en-dessous, et en
 * cas de dépassement on bascule sur un repli compté (voir describeForConfirm).
 */
const CONFIRM_DESCRIPTION_MAX_CHARS = 1900;
/** Cap d'affichage par adresse dans le dialog de confirmation. */
const CONFIRM_ADDRESS_MAX_CHARS = 60;
/** Cap d'affichage de l'objet dans le dialog de confirmation. */
const CONFIRM_SUBJECT_MAX_CHARS = 150;
/** Longueur max du `bodyText` renvoyé par create_mail_draft/prepare_reply_draft (sortie widget). */
const WIDGET_BODY_TEXT_MAX_CHARS = 2000;
/** Longueur max du `bodyText` renvoyé par get_draft — plus généreux : le modèle relit ce texte pour composer une retouche. */
const GET_DRAFT_BODY_TEXT_MAX_CHARS = 5000;

const recipientsJson = (description: string) => ({
  type: 'array' as const,
  items: EMAIL_JSON,
  maxItems: RECIPIENTS_MAX,
  description,
});

/**
 * Champs communs aux trois tools de composition (create_mail_draft,
 * prepare_reply_draft, send_mail).
 */
const composeFieldsSchema = z.object({
  fromIntegrationId: uuid,
  toRecipients: z.array(emailAddress).min(1).max(RECIPIENTS_MAX),
  ccRecipients: z.array(emailAddress).max(RECIPIENTS_MAX).optional(),
  bccRecipients: z.array(emailAddress).max(RECIPIENTS_MAX).optional(),
  subject: z.string().min(1).max(998),
  bodyHtml: z.string().min(1).max(BODY_HTML_MAX_CHARS),
});

const COMPOSE_JSON_PROPERTIES = {
  fromIntegrationId: UUID_JSON,
  toRecipients: recipientsJson('Destinataires (À), 1 à 20 adresses email'),
  ccRecipients: recipientsJson('Destinataires en copie (Cc), jusqu’à 20 adresses email'),
  bccRecipients: recipientsJson('Destinataires en copie cachée (Cci), jusqu’à 20 adresses email'),
  subject: { type: 'string', maxLength: 998 },
  bodyHtml: {
    type: 'string',
    maxLength: BODY_HTML_MAX_CHARS,
    description: 'Corps du mail en HTML',
  },
} as const;

const COMPOSE_JSON_REQUIRED = ['fromIntegrationId', 'toRecipients', 'subject', 'bodyHtml'];

/**
 * Un seul brouillon par utilisateur (upsert côté `saveDraft`) : les deux tools
 * de brouillon exigent `overwriteExisting: true` pour écraser un brouillon
 * déjà présent — le refus mentionne l'objet du brouillon existant pour que le
 * modèle puisse demander confirmation à l'utilisateur.
 */
const draftInputSchema = composeFieldsSchema.extend({
  overwriteExisting: z.boolean().optional(),
});

const DRAFT_JSON_PROPERTIES = {
  ...COMPOSE_JSON_PROPERTIES,
  overwriteExisting: {
    type: 'boolean',
    description:
      "true pour écraser explicitement le brouillon existant — uniquement après confirmation de l'utilisateur",
  },
} as const;

const sendModeValues = ['new_mail', 'reply', 'reply_all'] as const;

/**
 * Libellés FR des modes d'envoi, pour le dialog de confirmation — source
 * unique partagée par `send_mail` (3 modes possibles côté modèle) et
 * `send_draft` (les 4 valeurs de `DraftDto.kind`, brouillon persisté faisant
 * foi — jamais 'forward' côté modèle : un transfert doit passer par le
 * composer/widget, pas être improvisé). 'forward' est en capitale par choix
 * éditorial (Task 5) — les 3 autres restent en minuscule, décision
 * antérieure inchangée.
 */
const MODE_LABELS = {
  new_mail: 'nouveau message',
  reply: 'réponse',
  reply_all: 'réponse à tous',
  forward: 'Transfert',
} as const satisfies Record<string, string>;

/** Les 4 valeurs de `DraftDto.kind` (mail-drafts.ts) — clés de `MODE_LABELS`. */
type DraftKind = keyof typeof MODE_LABELS;

const sendMailInputSchema = composeFieldsSchema
  .extend({
    mode: z.enum(sendModeValues),
    replyToId: uuid.optional(),
  })
  .refine((r) => r.mode === 'new_mail' || r.replyToId !== undefined, {
    message: 'replyToId requis pour une réponse.',
    path: ['replyToId'],
  });

type SendMailToolInput = z.infer<typeof sendMailInputSchema>;

const SEND_JSON_PROPERTIES = {
  ...COMPOSE_JSON_PROPERTIES,
  mode: { type: 'string', enum: [...sendModeValues] },
  replyToId: {
    ...UUID_JSON,
    description: "Id du mail d'origine — requis pour mode 'reply' ou 'reply_all'",
  },
} as const;

const SEND_JSON_REQUIRED = [...COMPOSE_JSON_REQUIRED, 'mode'];

/**
 * Jeton de fraîcheur `send_draft` (Mandat A, revue T5/T6) — ferme le TOCTOU
 * confirmation→envoi : le modèle DOIT recopier tel quel le `updatedAt` du
 * dernier `get_draft`/`create_mail_draft`/`prepare_reply_draft` qu'il a lu.
 * `z.string().datetime()` exige le format ISO 8601 avec suffixe `Z` — même
 * format que `Date.prototype.toISOString()` (mail-drafts.ts, `loadDraft`).
 */
const sendDraftInputSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
});

const SEND_DRAFT_JSON_PROPERTIES = {
  expectedUpdatedAt: {
    type: 'string',
    format: 'date-time',
    description:
      "updatedAt du brouillon tel que lu dans le DERNIER get_draft/create_mail_draft/prepare_reply_draft — garantit que ce qui est envoyé est bien ce que l'utilisateur a vu au moment de sa confirmation.",
  },
} as const;

const SEND_DRAFT_JSON_REQUIRED = ['expectedUpdatedAt'];

/** Reformule un échec `{ok:false, message}` en message montrable. */
function failure(message: string): string {
  return `Échec : ${message}`;
}

/**
 * Schéma commun aux 4 tools mail-state (Plan 5b Task 8) — même plafond que le
 * core (`MAIL_BULK_MAX`, mail-state-core.ts).
 */
const mailBulkInputSchema = z.object({
  mailIds: z.array(uuid).min(1).max(MAIL_BULK_MAX),
});
type MailBulkInput = z.infer<typeof mailBulkInputSchema>;

const MAIL_BULK_JSON_PROPERTIES = {
  mailIds: {
    type: 'array',
    items: UUID_JSON,
    minItems: 1,
    maxItems: MAIL_BULK_MAX,
    description: `Ids de mails (1 à ${MAIL_BULK_MAX}), obtenus via search_mails`,
  },
} as const;
const MAIL_BULK_JSON_REQUIRED = ['mailIds'];

/**
 * Note rappelée dans les descriptions/dialogs d'archive_mail et delete_mail :
 * ces deux opérations sont LOCALES à NexusHub (comme le core, cf.
 * mail-state-core.ts) — le mail persiste côté serveur (IMAP/Graph) et une
 * synchronisation ultérieure peut donc faire réapparaître l'état d'origine.
 */
const MAIL_LOCAL_NOTE =
  'ils restent sur le serveur mail et peuvent réapparaître après une synchronisation';

function pluralS(n: number): string {
  return n > 1 ? 's' : '';
}

/**
 * jsonSchema des tools `*_by_filter` — décrit les 6 propriétés de
 * `MailFilterSchema` (mail-state-core.ts). Pas de `required` : le refine
 * « au moins un critère » n'est pas exprimable en propriétés individuelles
 * requises côté JSON Schema (voir le test de parité required/properties).
 */
const MAIL_FILTER_JSON = {
  type: 'object',
  description: 'Filtre serveur mail — au moins UN critère requis (jamais de « tout » implicite).',
  properties: {
    fromContains: {
      type: 'string',
      minLength: 3,
      maxLength: 120,
      description: "Sous-chaîne recherchée dans l'expéditeur (nom ou email), insensible à la casse",
    },
    subjectContains: {
      type: 'string',
      minLength: 3,
      maxLength: 120,
      description: 'Sous-chaîne recherchée dans le sujet, insensible à la casse',
    },
    folder: {
      type: 'string',
      minLength: 1,
      maxLength: 16,
      description: 'Dossier mail (ex. inbox)',
    },
    isRead: {
      type: 'boolean',
      description: 'true = déjà lus uniquement, false = non lus uniquement',
    },
    receivedBefore: {
      type: 'string',
      format: 'date-time',
      description: 'Reçus avant cette date ISO 8601 (borne exclue)',
    },
    receivedAfter: {
      type: 'string',
      format: 'date-time',
      description: 'Reçus après cette date ISO 8601 (borne incluse)',
    },
  },
} as const;

/** Reformulation courte du filtre pour les dialogs/résultats — jamais de contenu de mail. */
function describeFilter(filter: MailFilter): string {
  const parts: string[] = [];
  if (filter.fromContains !== undefined) parts.push(`de « ${filter.fromContains} »`);
  if (filter.subjectContains !== undefined) parts.push(`sujet « ${filter.subjectContains} »`);
  if (filter.folder !== undefined) parts.push(`dossier ${filter.folder}`);
  if (filter.isRead === false) parts.push('non lus');
  if (filter.isRead === true) parts.push('déjà lus');
  if (filter.receivedAfter !== undefined)
    parts.push(`reçus après le ${filter.receivedAfter.slice(0, 10)}`);
  if (filter.receivedBefore !== undefined)
    parts.push(`reçus avant le ${filter.receivedBefore.slice(0, 10)}`);
  return parts.join(', ');
}

/**
 * Fabrique `describeForConfirm` des tools by-filter : re-parse BRUT (le gate
 * précède la validation du registry — même pattern anti-injection que
 * `buildMailBulkDescribeForConfirm` ci-dessus), puis compte en DB avec
 * EXACTEMENT le même `where` que l'exécution — `countMailsByFilter` partage
 * `buildMailFilterWhere` avec `setMailStateByFilterCore` (mail-state-core.ts),
 * y compris le même `op` (invariant central : le nombre annoncé ici DOIT être
 * celui réellement affecté par le handler).
 */
function buildByFilterDescribe(
  ctx: AuthContext,
  op: MailStateOp,
  fallback: string,
  phrase: (count: number, filterLabel: string) => string,
): (input: unknown) => Promise<string> {
  return async (input: unknown): Promise<string> => {
    const parsed = MailFilterSchema.safeParse(input);
    if (!parsed.success) return fallback;
    const count = await countMailsByFilter(ctx, parsed.data, op);
    if (count === 0) {
      return `Aucun mail ne correspond (${describeFilter(parsed.data)}) — rien ne sera fait.`;
    }
    return phrase(count, describeFilter(parsed.data));
  };
}

/**
 * Formule en ÉTAT (pas en action) : « Archiver N mail(s)… » décrit ce qui
 * VA se passer une fois confirmé, indépendamment du fait que l'opération soit
 * idempotente côté core (affected peut inclure des mails déjà archivés).
 */
function describeArchiveConfirm(total: number, owned: number): string {
  const label = `${total} mail${pluralS(total)}`;
  if (owned === total) {
    return `Archiver ${label} de vos boîtes dans NexusHub ? (archivage local — ${MAIL_LOCAL_NOTE})`;
  }
  return `Archiver ${label} ? Seuls ${owned} vous appartiennent et seront archivés (les autres seront ignorés). (archivage local — ${MAIL_LOCAL_NOTE})`;
}

function describeDeleteConfirm(total: number, owned: number): string {
  const label = `${total} mail${pluralS(total)}`;
  if (owned === total) {
    return `Masquer ${label} dans NexusHub (suppression locale : ${MAIL_LOCAL_NOTE}) ?`;
  }
  return `Masquer ${label} ? Seuls ${owned} vous appartiennent et seront masqués (les autres seront ignorés). (suppression locale : ${MAIL_LOCAL_NOTE})`;
}

/**
 * Fabrique `describeForConfirm` pour archive_mail/delete_mail : re-parse
 * BRUT (le gate précède la validation du registry — même rationnel que
 * send_mail/delete_column), puis compte en DB avec EXACTEMENT le même `where`
 * owner-only que `setMailStateCore` (mail-state-core.ts) pour annoncer
 * fidèlement combien de mails appartiennent réellement à l'utilisateur avant
 * confirmation.
 */
function buildMailBulkDescribeForConfirm(
  ctx: AuthContext,
  invalidMessage: string,
  render: (total: number, owned: number) => string,
): (input: unknown) => Promise<string> {
  return async (input: unknown): Promise<string> => {
    const parsed = mailBulkInputSchema.safeParse(input);
    if (!parsed.success) return invalidMessage;
    const mailIds = [...new Set(parsed.data.mailIds)];
    const owned = await prisma.emailMessage.count({
      where: {
        id: { in: mailIds },
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        integration: { ownerUserId: ctx.userId },
      },
    });
    return render(mailIds.length, owned);
  };
}

/**
 * Handler commun aux 4 tools mail-state : délègue à `setMailStateCore`
 * (ownership + plafond + idempotence gérés côté core) et reformule en JSON
 * `{done, affected, skipped}` — `skipped` reste volontairement agrégé sans
 * cause distinguable (le core ne les distingue pas non plus).
 */
function buildMailStateHandler(
  ctx: AuthContext,
  toolName: string,
  op: MailStateOp,
): (input: MailBulkInput) => Promise<string> {
  return async (input: MailBulkInput) =>
    safeMutation(toolName, async () => {
      const result = await setMailStateCore(ctx, { mailIds: input.mailIds, op });
      if (!result.ok) return failure(result.message);
      return JSON.stringify({
        done: true,
        affected: result.affected,
        skipped: result.skipped,
      });
    });
}

/**
 * Messages FR montrables par code d'échec `sendMail` (send-mail.ts).
 * Rédaction : chaque message doit se lire naturellement après le préfixe
 * « Échec : » ajouté par `failure()` — pas de « Échec : échec… ».
 */
const SEND_FAILURE_MESSAGES: Partial<
  Record<Extract<SendMailResult, { ok: false }>['code'], string>
> = {
  RATE_LIMIT: "quota d'envoi atteint — réessayez plus tard.",
  MAILBOX_NOT_FOUND: 'boîte introuvable ou non connectée.',
  SMTP_NOT_CONFIGURED: 'SMTP non configuré pour cette boîte.',
  TOO_MANY_RECIPIENTS: 'trop de destinataires (max 20).',
};

/**
 * Codes dont le `message` serveur est réputé montrable (rédigé en FR côté
 * send-mail.ts, sans détail d'infrastructure) et peut être relayé tel quel.
 * Posture whitelist : tout autre code non mappé → message générique, même si
 * un `message` est présent.
 */
const RELAYABLE_MESSAGE_CODES: ReadonlySet<Extract<SendMailResult, { ok: false }>['code']> =
  new Set(['INVALID_INPUT', 'SEND_FAILED_TOO_LARGE', 'SEND_FAILED_UNSUPPORTED']);

function describeSendFailure(result: Extract<SendMailResult, { ok: false }>): string {
  const known = SEND_FAILURE_MESSAGES[result.code];
  if (known !== undefined) return known;
  if (RELAYABLE_MESSAGE_CODES.has(result.code) && result.message !== undefined) {
    // Phrase FR complète rédigée côté send-mail.ts — relayée telle quelle.
    return result.message;
  }
  return "l'envoi a échoué — réessayez dans un instant.";
}

/**
 * Extrait un aperçu texte, montrable, du corps HTML : balises retirées,
 * espaces normalisés, tronqué (ellipse UNIQUEMENT si troncature). JAMAIS le
 * HTML brut dans une description qui transite en clair côté client (contrat
 * `describeForConfirm`, types.ts).
 */
function excerptOf(bodyHtml: string): string {
  const text = bodyHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > CONFIRM_EXCERPT_MAX_CHARS
    ? `${text.slice(0, CONFIRM_EXCERPT_MAX_CHARS)}…`
    : text;
}

/** Tronque un texte affiché avec ellipse — pour borner adresses et objet dans le dialog. */
function capped(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Liste d'adresses (chacune bornée) avec troncature « +n autres » — pour À/Cc uniquement, jamais Cci. */
function joinShown(addrs: readonly string[]): string {
  const shown = addrs
    .slice(0, CONFIRM_RECIPIENTS_SHOWN_MAX)
    .map((a) => capped(a, CONFIRM_ADDRESS_MAX_CHARS))
    .join(', ');
  if (addrs.length <= CONFIRM_RECIPIENTS_SHOWN_MAX) return shown;
  return `${shown} +${addrs.length - CONFIRM_RECIPIENTS_SHOWN_MAX} autres`;
}

/** Forme minimale partagée par l'input validé de `send_mail` et un `DraftDto` — tout ce dont `buildSendDescription` a besoin. */
interface DescribableSend {
  readonly mode: DraftKind;
  readonly toRecipients: readonly string[];
  readonly ccRecipients?: readonly string[] | undefined;
  readonly bccRecipients?: readonly string[] | undefined;
  readonly subject: string;
  readonly bodyHtml: string;
}

/**
 * Description de confirmation partagée par `send_mail` (input modèle validé,
 * 3 modes) et `send_draft` (brouillon persisté relu en DB, 4 kinds dont
 * 'forward') — seule la provenance des données diffère, l'énumération et les
 * garanties (Cci JAMAIS tronqué, budget 1900 avec repli compté) sont
 * identiques dans les deux cas. Extrait tel quel du describeForConfirm
 * historique de `send_mail` (Plan 2b) — NE PAS changer son comportement pour
 * les 3 modes existants : les tests `send_mail` inchangés en sont la preuve.
 */
function buildSendDescription(v: DescribableSend): string {
  const modeLabel = MODE_LABELS[v.mode];
  const subject = capped(v.subject, CONFIRM_SUBJECT_MAX_CHARS);
  const segments = [`Envoyer un mail (${modeLabel}) à ${joinShown(v.toRecipients)}`];
  if (v.ccRecipients !== undefined && v.ccRecipients.length > 0) {
    segments.push(`Cc : ${joinShown(v.ccRecipients)}`);
  }
  if (v.bccRecipients !== undefined && v.bccRecipients.length > 0) {
    segments.push(
      `Cci : ${v.bccRecipients.map((a) => capped(a, CONFIRM_ADDRESS_MAX_CHARS)).join(', ')}`,
    );
  }
  segments.push(`objet « ${subject} »`);
  const full = `${segments.join(' — ')} : ${excerptOf(v.bodyHtml)}`;
  if (full.length <= CONFIRM_DESCRIPTION_MAX_CHARS) return full;
  // Repli compté : au-delà du budget, on remplace le détail par des
  // comptes exacts plutôt que de laisser la route couper la fin (Cci).
  const ccCount = v.ccRecipients?.length ?? 0;
  const bccCount = v.bccRecipients?.length ?? 0;
  return `Envoyer un mail (${modeLabel}) à ${v.toRecipients.length} destinataires, ${ccCount} en copie, ${bccCount} en copie cachée — liste trop longue pour être affichée intégralement : refusez si vous ne les avez pas dictés vous-même — objet « ${subject} »`;
}

/**
 * Extrait un aperçu texte borné du corps HTML pour une sortie STRUCTURÉE
 * (widget `create_mail_draft`/`prepare_reply_draft`, `get_draft`) — jamais le
 * HTML brut. Contrairement à `excerptOf` (dialog de confirmation, 200 chars,
 * ellipse simple), le marqueur `[…tronqué]` signale explicitement une
 * troncature au modèle qui relit ce texte (`get_draft`), pour qu'il ne le
 * prenne jamais pour le corps intégral.
 */
function boundedBodyText(bodyHtml: string, max: number): string {
  const text = stripMailHtmlToText(bodyHtml);
  return text.length > max ? `${text.slice(0, max)}[…tronqué]` : text;
}

/**
 * Garde anti-écrasement silencieux : le brouillon est unique par utilisateur,
 * donc sauver sans `overwriteExisting: true` alors qu'un brouillon existe
 * détruirait du contenu potentiellement rédigé à la main dans Communications.
 * La garde vit ici (côté tool), PAS dans `saveDraft` : l'UI Communications,
 * elle, écrase légitimement en continu (autosave).
 */
async function refuseIfDraftExists(overwriteExisting: boolean | undefined): Promise<string | null> {
  if (overwriteExisting === true) return null;
  const existing = await loadDraft();
  if (existing.draft === null) return null;
  return `Échec : un brouillon existe déjà (objet « ${existing.draft.subject} ») — demander confirmation à l'utilisateur puis rappeler avec overwriteExisting: true.`;
}

/**
 * Relit le brouillon fraîchement persisté pour renvoyer son `updatedAt` réel
 * — même valeur que `get_draft` renverrait immédiatement après (Mandat A,
 * revue T5/T6) : le modèle copie cette valeur dans `expectedUpdatedAt` lors
 * d'un futur `send_draft`, jeton de fraîcheur qui détecte une édition inline
 * du widget/composer survenue entre la confirmation et l'exécution. Filet de
 * sécurité si le brouillon avait disparu entre la sauvegarde et cette
 * relecture (ne devrait jamais arriver en pratique) : horodatage courant
 * plutôt qu'un crash.
 */
async function currentDraftUpdatedAt(): Promise<string> {
  const { draft } = await loadDraft();
  return draft?.updatedAt ?? new Date().toISOString();
}

/**
 * Tools mail (Plan 2b Task 7). Wrappent le pipeline mail existant
 * (`saveDraft`, `sendMail`, `markEmailRead`) — aucune logique métier ici,
 * uniquement la traduction schéma Zod ↔ résultat `{ok}` ↔ message montrable.
 * `ctx` est lié à la construction (jamais fourni par le modèle) : voir
 * `tools/index.ts`.
 */
export function buildMailTools(ctx: AuthContext): ToolSpec[] {
  return [
    defineTool({
      name: 'list_my_mailboxes',
      description:
        "Liste les boîtes mail connectées de l'utilisateur courant (integrationId, type, libellé). Nécessaire avant create_mail_draft, prepare_reply_draft ou send_mail pour connaître le fromIntegrationId à utiliser.",
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      handler: async () =>
        safeDb('list_my_mailboxes', async () => {
          // JAMAIS `encryptedTokens` dans le select (CLAUDE.md §4.2) — seuls
          // des identifiants et libellés d'affichage sortent de ce tool.
          const integrations = await prisma.integration.findMany({
            where: {
              workspaceId: ctx.workspaceId,
              ownerUserId: ctx.userId,
              kind: { in: ['graph', 'imap'] },
              status: 'active',
            },
            select: {
              id: true,
              kind: true,
              externalAccountLabel: true,
              externalAccountId: true,
            },
          });
          return JSON.stringify(
            integrations.map((i) => ({
              integrationId: i.id,
              kind: i.kind,
              label: i.externalAccountLabel ?? i.externalAccountId ?? i.kind,
            })),
          );
        }),
    }),

    defineTool({
      name: 'create_mail_draft',
      description:
        'Enregistre un brouillon de nouveau mail (utiliser list_my_mailboxes pour le fromIntegrationId). ATTENTION : un seul brouillon est conservé par utilisateur — si un brouillon existe déjà, le tool refuse sauf overwriteExisting: true (à ne passer qu’après confirmation de l’utilisateur). Le brouillon est visible dans Communications ; relire avec get_draft avant toute retouche, puis utiliser send_draft pour l’envoyer réellement.',
      inputSchema: draftInputSchema,
      jsonSchema: {
        type: 'object',
        properties: DRAFT_JSON_PROPERTIES,
        required: COMPOSE_JSON_REQUIRED,
      },
      handler: async (input) =>
        safeMutation('create_mail_draft', async () => {
          const refusal = await refuseIfDraftExists(input.overwriteExisting);
          if (refusal !== null) return refusal;
          const payload: SaveDraftInput = {
            fromIntegrationId: input.fromIntegrationId,
            kind: 'new_mail',
            toRecipients: input.toRecipients,
            ccRecipients: input.ccRecipients ?? [],
            bccRecipients: input.bccRecipients ?? [],
            subject: input.subject,
            bodyHtml: input.bodyHtml,
          };
          const result = await saveDraft(payload);
          if (!result.ok) return failure(result.message);
          // Sortie STRUCTURÉE (widget-tools.ts : 'create_mail_draft' est un
          // widget-tool) — c'est ce JSON, pas `result.id`, que le widget
          // (Task 6) autosauvera : fromIntegrationId/kind/replyToId lui sont
          // nécessaires pour retrouver le brouillon. JAMAIS bodyHtml brut.
          // `updatedAt` (Mandat A) : le modèle le copie dans `expectedUpdatedAt`
          // lors d'un futur send_draft — jeton de fraîcheur, voir
          // currentDraftUpdatedAt().
          return JSON.stringify({
            draftSaved: true,
            kind: 'new_mail',
            to: input.toRecipients,
            cc: input.ccRecipients ?? [],
            bcc: input.bccRecipients ?? [],
            subject: input.subject,
            bodyText: boundedBodyText(input.bodyHtml, WIDGET_BODY_TEXT_MAX_CHARS),
            replyToId: null,
            fromIntegrationId: input.fromIntegrationId,
            updatedAt: await currentDraftUpdatedAt(),
          });
        }),
    }),

    defineTool({
      name: 'prepare_reply_draft',
      description:
        "Enregistre un brouillon de réponse à un mail existant (replyToId — voir read_mail ou search_mails). Itérer le texte de la réponse avec l'utilisateur AVANT de sauver. Un seul brouillon par utilisateur : si un brouillon existe déjà, le tool refuse sauf overwriteExisting: true (à ne passer qu'après confirmation de l'utilisateur). Le brouillon est visible dans Communications ; relire avec get_draft avant toute retouche, puis utiliser send_draft pour l'envoyer réellement.",
      inputSchema: draftInputSchema.extend({ replyToId: uuid }),
      jsonSchema: {
        type: 'object',
        properties: { ...DRAFT_JSON_PROPERTIES, replyToId: UUID_JSON },
        required: [...COMPOSE_JSON_REQUIRED, 'replyToId'],
      },
      handler: async (input) =>
        safeMutation('prepare_reply_draft', async () => {
          const refusal = await refuseIfDraftExists(input.overwriteExisting);
          if (refusal !== null) return refusal;
          const payload: SaveDraftInput = {
            fromIntegrationId: input.fromIntegrationId,
            kind: 'reply',
            replyToId: input.replyToId,
            toRecipients: input.toRecipients,
            ccRecipients: input.ccRecipients ?? [],
            bccRecipients: input.bccRecipients ?? [],
            subject: input.subject,
            bodyHtml: input.bodyHtml,
          };
          const result = await saveDraft(payload);
          if (!result.ok) return failure(result.message);
          // Même sortie structurée que create_mail_draft — voir son commentaire
          // (`updatedAt` inclus, même rôle de jeton de fraîcheur).
          return JSON.stringify({
            draftSaved: true,
            kind: 'reply',
            to: input.toRecipients,
            cc: input.ccRecipients ?? [],
            bcc: input.bccRecipients ?? [],
            subject: input.subject,
            bodyText: boundedBodyText(input.bodyHtml, WIDGET_BODY_TEXT_MAX_CHARS),
            replyToId: input.replyToId,
            fromIntegrationId: input.fromIntegrationId,
            updatedAt: await currentDraftUpdatedAt(),
          });
        }),
    }),

    defineTool({
      name: 'send_mail',
      description:
        "Envoie réellement un mail (nouveau message ou réponse) depuis une boîte connectée de l'utilisateur — action irréversible, soumise à confirmation. Utiliser list_my_mailboxes pour le fromIntegrationId, et replyToId (via read_mail/search_mails) pour mode:'reply' ou 'reply_all'.",
      inputSchema: sendMailInputSchema,
      jsonSchema: {
        type: 'object',
        properties: SEND_JSON_PROPERTIES,
        required: SEND_JSON_REQUIRED,
      },
      gated: true,
      // Consentement éclairé : le dialog énumère TOUT ce qui part — mode,
      // destinataires (liste Cci JAMAIS tronquée : l'utilisateur doit voir
      // chaque destinataire caché ; troncature « +n autres » tolérée pour
      // À/Cc ; chaque adresse et l'objet sont bornés en affichage), objet,
      // extrait texte. JAMAIS le bodyHtml brut : la description transite en
      // clair côté client (SSE) — contrat `describeForConfirm` (types.ts).
      // La boîte émettrice n'est pas nommée ici : l'input ne porte que son
      // id, et résoudre le libellé exigerait un appel DB — hors contrat d'une
      // description synchrone (suivi M3, revue 2b).
      describeForConfirm: (input: unknown): string => {
        // Le gate précède la validation du registry : l'input arrive BRUT.
        // Re-parse local — sans quoi un input invalide ferait lever la
        // description, et le repli generique `describeAction` (run-turn.ts)
        // sérialiserait le bodyHtml brut dans le dialog.
        const parsed = sendMailInputSchema.safeParse(input);
        if (!parsed.success) return 'Envoi de mail (paramètres invalides — refusez).';
        const v: SendMailToolInput = parsed.data;
        return buildSendDescription(v);
      },
      handler: async (input) =>
        safeMutation('send_mail', async () => {
          const result = await sendMail({
            fromIntegrationId: input.fromIntegrationId,
            mode: input.mode,
            ...(input.replyToId !== undefined ? { replyToId: input.replyToId } : {}),
            toRecipients: input.toRecipients,
            ccRecipients: input.ccRecipients ?? [],
            bccRecipients: input.bccRecipients ?? [],
            subject: input.subject,
            bodyHtml: input.bodyHtml,
          });
          if (!result.ok) return failure(describeSendFailure(result));
          return JSON.stringify({ sent: true, emailMessageId: result.emailMessageId });
        }),
    }),

    defineTool({
      name: 'get_draft',
      description:
        'Lit VOTRE brouillon en cours (celui du widget ou du composer). À appeler avant toute retouche demandée — les éditions inline de l’utilisateur priment sur ce que tu as rédigé.',
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {} },
      handler: async () =>
        safeDb('get_draft', async () => {
          const { draft } = await loadDraft();
          if (draft === null) return JSON.stringify({ exists: false });
          // JAMAIS bodyHtml brut (CLAUDE.md §4.5.3 — HTML utilisateur) : le
          // modèle ne relit qu'un texte strippé et borné.
          return JSON.stringify({
            exists: true,
            draft: {
              kind: draft.kind,
              replyToId: draft.replyToId,
              to: draft.toRecipients,
              cc: draft.ccRecipients,
              bcc: draft.bccRecipients,
              subject: draft.subject,
              bodyText: boundedBodyText(draft.bodyHtml, GET_DRAFT_BODY_TEXT_MAX_CHARS),
              updatedAt: draft.updatedAt,
            },
          });
        }),
    }),

    defineTool({
      name: 'send_draft',
      description:
        "Envoie réellement le brouillon persisté en cours (celui affiché dans le widget/composer) — action irréversible, soumise à confirmation. Aucun champ de contenu à fournir : c'est le brouillon en base qui fait foi, jamais ce que tu proposes ici. `expectedUpdatedAt` (jeton de fraîcheur) est REQUIS : recopie tel quel le champ `updatedAt` du DERNIER get_draft/create_mail_draft/prepare_reply_draft — si le brouillon a été modifié depuis (édition inline dans le widget/composer), l'envoi est refusé et il faut relire get_draft avant de réessayer. Échoue si aucun brouillon n'existe.",
      // Le SEUL champ acceptable est le jeton de fraîcheur — jamais un champ
      // de contenu (to/subject/bodyHtml…). C'est la garantie du flux (Plan 5c
      // Task 5) : ce qui part est exactement ce que l'utilisateur voit dans
      // le widget/composer au moment de la confirmation, jamais une resaisie
      // du modèle qui pourrait diverger d'une édition inline entre-temps.
      // `expectedUpdatedAt` (Mandat A, revue T5/T6) ferme le TOCTOU restant :
      // sans lui, un brouillon édité entre la confirmation et l'exécution
      // partirait quand même — voir describeForConfirm et le handler.
      inputSchema: sendDraftInputSchema,
      jsonSchema: {
        type: 'object',
        properties: SEND_DRAFT_JSON_PROPERTIES,
        required: SEND_DRAFT_JSON_REQUIRED,
      },
      gated: true,
      // Async : relit le brouillon en DB (closure `ctx` → même utilisateur,
      // même session que le handler) pour décrire fidèlement ce qui va
      // partir. Réutilise `buildSendDescription` (voir send_mail ci-dessus)
      // — même énumération, même garantie Cci exhaustif, même budget/repli.
      describeForConfirm: async (input: unknown): Promise<string> => {
        // Le gate précède la validation du registry — input BRUT, re-parse
        // local (même rationnel que send_mail/archive_mail/delete_mail).
        const parsed = sendDraftInputSchema.safeParse(input);
        if (!parsed.success) {
          return 'Envoyer un brouillon ? paramètres invalides — refusez.';
        }
        const { draft } = await loadDraft();
        if (draft === null) {
          return "Envoyer un brouillon ? Aucun brouillon en cours — l'envoi sera refusé.";
        }
        if (draft.updatedAt !== parsed.data.expectedUpdatedAt) {
          // Déclaratif, pas impératif : décrit ce qui VA se passer au moment
          // de la confirmation — le handler réévalue la même condition à
          // l'exécution (course possible entre confirmation et clic Autoriser).
          // Rédigé pour un HUMAIN (c'est lui qui lit ce dialog) : pas de nom
          // de tool, une action concrète à sa portée (revue M2).
          return "Le brouillon a été modifié depuis sa préparation — demandez à l'assistant de le relire avant d'envoyer.";
        }
        return buildSendDescription({
          mode: draft.kind,
          toRecipients: draft.toRecipients,
          ccRecipients: draft.ccRecipients,
          bccRecipients: draft.bccRecipients,
          subject: draft.subject,
          bodyHtml: draft.bodyHtml,
        });
      },
      handler: async (input) =>
        safeMutation('send_draft', async () => {
          const { draft } = await loadDraft();
          if (draft === null) return failure('Aucun brouillon à envoyer.');
          if (draft.updatedAt !== input.expectedUpdatedAt) {
            // Le brouillon a changé entre la confirmation (describeForConfirm)
            // et l'exécution de ce handler — jamais envoyer un contenu que
            // l'utilisateur n'a pas vu au moment où il a autorisé l'action.
            return failure(
              'Le brouillon a changé depuis la confirmation — relisez get_draft et réessayez.',
            );
          }
          const result = await sendMail({
            fromIntegrationId: draft.fromIntegrationId,
            // Mapping kind→mode CONSTATÉ dans compose-panel.tsx : `kind`
            // (mail-drafts.ts) et `mode` (send-mail.ts) partagent exactement
            // les 4 mêmes valeurs — le composer les passe déjà en identité
            // (`saveDraft({ kind: mode, ... })` / `sendMail({ mode, ... })`,
            // même variable `mode` du store). 'forward' y compris : seul un
            // brouillon PERSISTÉ (jamais l'input modèle de send_mail) peut
            // porter ce kind.
            mode: draft.kind,
            ...(draft.replyToId !== null ? { replyToId: draft.replyToId } : {}),
            toRecipients: [...draft.toRecipients],
            ccRecipients: [...draft.ccRecipients],
            bccRecipients: [...draft.bccRecipients],
            subject: draft.subject,
            bodyHtml: draft.bodyHtml,
            composeAttachments: [...draft.composeAttachments],
          });
          if (!result.ok) return failure(describeSendFailure(result));
          // Pas de deleteDraft() ici : `sendMail` (send-mail.ts) supprime déjà
          // le brouillon en DB dans sa propre transaction de succès (brouillon
          // unique par utilisateur) — un appel redondant introduirait une
          // fenêtre best-effort inutile pour un état déjà cohérent. Constaté
          // dans compose-panel.tsx : `onSend` ne rappelle PAS `deleteDraft()`
          // après un envoi réussi (seul `onDiscard` le fait) — même
          // comportement reproduit ici.
          return JSON.stringify({ sent: true, emailMessageId: result.emailMessageId });
        }),
    }),

    defineTool({
      name: 'mark_email_read',
      description:
        "Marque UN mail comme lu (n'importe quel mail visible du workspace). Pour un lot ou vos boîtes uniquement, voir mark_mail_read.",
      inputSchema: z.object({ emailId: uuid }),
      jsonSchema: { type: 'object', properties: { emailId: UUID_JSON }, required: ['emailId'] },
      handler: async (input) =>
        safeMutation('mark_email_read', async () => {
          const result = await markEmailRead({ emailId: input.emailId });
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ marked: true });
        }),
    }),

    defineTool({
      name: 'mark_mail_read',
      description:
        'Marque un lot de mails comme lus (vos boîtes uniquement, ids via search_mails). Réversible. Pour un seul mail du workspace (y compris d’un autre membre), voir mark_email_read.',
      inputSchema: mailBulkInputSchema,
      jsonSchema: {
        type: 'object',
        properties: MAIL_BULK_JSON_PROPERTIES,
        required: MAIL_BULK_JSON_REQUIRED,
      },
      handler: buildMailStateHandler(ctx, 'mark_mail_read', 'read'),
    }),

    defineTool({
      name: 'mark_mail_unread',
      description:
        "Marque un lot de mails comme non lus (vos boîtes uniquement, ids via search_mails). Réversible — l'état lu/non-lu peut être re-synchronisé depuis le serveur mail. Il n’existe pas d’équivalent mono-mail workspace pour non-lu.",
      inputSchema: mailBulkInputSchema,
      jsonSchema: {
        type: 'object',
        properties: MAIL_BULK_JSON_PROPERTIES,
        required: MAIL_BULK_JSON_REQUIRED,
      },
      handler: buildMailStateHandler(ctx, 'mark_mail_unread', 'unread'),
    }),

    defineTool({
      name: 'archive_mail',
      description:
        'Archive un lot de mails (vos boîtes uniquement, ids via search_mails, max 100) — action LOCALE à NexusHub : le mail reste sur le serveur mail et peut réapparaître après une synchronisation. Action sensible : confirmation utilisateur requise.',
      inputSchema: mailBulkInputSchema,
      jsonSchema: {
        type: 'object',
        properties: MAIL_BULK_JSON_PROPERTIES,
        required: MAIL_BULK_JSON_REQUIRED,
      },
      gated: true,
      describeForConfirm: buildMailBulkDescribeForConfirm(
        ctx,
        'Archiver des mails ? (données invalides)',
        describeArchiveConfirm,
      ),
      handler: buildMailStateHandler(ctx, 'archive_mail', 'archive'),
    }),

    defineTool({
      name: 'delete_mail',
      description:
        'Masque (supprime localement) un lot de mails dans NexusHub (vos boîtes uniquement, ids via search_mails, max 100) — action LOCALE : le mail reste sur le serveur mail et peut réapparaître après une synchronisation. Action sensible : confirmation utilisateur requise.',
      inputSchema: mailBulkInputSchema,
      jsonSchema: {
        type: 'object',
        properties: MAIL_BULK_JSON_PROPERTIES,
        required: MAIL_BULK_JSON_REQUIRED,
      },
      gated: true,
      describeForConfirm: buildMailBulkDescribeForConfirm(
        ctx,
        'Masquer des mails ? (données invalides)',
        describeDeleteConfirm,
      ),
      handler: buildMailStateHandler(ctx, 'delete_mail', 'delete'),
    }),

    defineTool({
      name: 'mark_mails_read_by_filter',
      description:
        'Marque comme lus TOUS les mails de vos boîtes correspondant à un filtre serveur (expéditeur, sujet, dossier, lu/non-lu, période) — sans plafond, pour « marque tous les mails de X comme lus ». Au moins un critère requis. Action de masse : confirmation utilisateur requise (le nombre exact est annoncé).',
      inputSchema: MailFilterSchema,
      jsonSchema: MAIL_FILTER_JSON,
      gated: true,
      describeForConfirm: buildByFilterDescribe(
        ctx,
        'read',
        'Marquer des mails comme lus ? (données invalides)',
        (count, label) => `Marquer ${count} mail${pluralS(count)} (${label}) comme lus ?`,
      ),
      handler: async (input) =>
        safeMutation('mark_mails_read_by_filter', async () => {
          const result = await setMailStateByFilterCore(ctx, { filter: input, op: 'read' });
          if (!result.ok) return JSON.stringify(result);
          return JSON.stringify({ affected: result.affected, filter: describeFilter(input) });
        }),
    }),

    defineTool({
      name: 'archive_mails_by_filter',
      description: `Archive TOUS les mails de vos boîtes correspondant à un filtre serveur (expéditeur, sujet, dossier, lu/non-lu, période) — sans plafond, pour « archive tous les mails de X ». Action LOCALE à NexusHub : ${MAIL_LOCAL_NOTE}. Au moins un critère requis. Action de masse : confirmation utilisateur requise (le nombre exact est annoncé).`,
      inputSchema: MailFilterSchema,
      jsonSchema: MAIL_FILTER_JSON,
      gated: true,
      describeForConfirm: buildByFilterDescribe(
        ctx,
        'archive',
        'Archiver des mails ? (données invalides)',
        (count, label) =>
          `Archiver ${count} mail${pluralS(count)} (${label}) ? (archivage local — ${MAIL_LOCAL_NOTE})`,
      ),
      handler: async (input) =>
        safeMutation('archive_mails_by_filter', async () => {
          const result = await setMailStateByFilterCore(ctx, { filter: input, op: 'archive' });
          if (!result.ok) return JSON.stringify(result);
          return JSON.stringify({ affected: result.affected, filter: describeFilter(input) });
        }),
    }),

    defineTool({
      name: 'delete_mails_by_filter',
      description: `Masque (supprime localement) TOUS les mails de vos boîtes correspondant à un filtre serveur (expéditeur, sujet, dossier, lu/non-lu, période) — sans plafond, pour « supprime tous les mails de X ». Action LOCALE à NexusHub : ${MAIL_LOCAL_NOTE}. Au moins un critère requis. Action de masse : confirmation utilisateur requise (le nombre exact est annoncé).`,
      inputSchema: MailFilterSchema,
      jsonSchema: MAIL_FILTER_JSON,
      gated: true,
      describeForConfirm: buildByFilterDescribe(
        ctx,
        'delete',
        'Masquer des mails ? (données invalides)',
        (count, label) =>
          `Masquer ${count} mail${pluralS(count)} (${label}) dans NexusHub (suppression locale : ${MAIL_LOCAL_NOTE}) ?`,
      ),
      handler: async (input) =>
        safeMutation('delete_mails_by_filter', async () => {
          const result = await setMailStateByFilterCore(ctx, { filter: input, op: 'delete' });
          if (!result.ok) return JSON.stringify(result);
          return JSON.stringify({ affected: result.affected, filter: describeFilter(input) });
        }),
    }),
  ];
}
