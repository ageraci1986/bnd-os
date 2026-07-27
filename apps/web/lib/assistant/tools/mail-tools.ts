import 'server-only';

import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { defineTool, type ToolSpec } from '@nexushub/agent';
import type { AuthContext } from '@/lib/auth';
import { saveDraft, type SaveDraftInput } from '@/features/communications/actions/mail-drafts';
import { sendMail, type SendMailResult } from '@/features/communications/actions/send-mail';
import { markEmailRead } from '@/features/communications/actions/mark-email-read';
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

const recipientsJson = (description: string) => ({
  type: 'array' as const,
  items: EMAIL_JSON,
  maxItems: RECIPIENTS_MAX,
  description,
});

/**
 * Champs communs à create_mail_draft et prepare_reply_draft — un brouillon
 * (kind:'new_mail' ou kind:'reply') persisté via `saveDraft`. Un seul
 * brouillon par utilisateur : chaque appel écrase le précédent (upsert côté
 * `saveDraft`).
 */
const draftFieldsSchema = z.object({
  fromIntegrationId: uuid,
  toRecipients: z.array(emailAddress).min(1).max(RECIPIENTS_MAX),
  ccRecipients: z.array(emailAddress).max(RECIPIENTS_MAX).optional(),
  bccRecipients: z.array(emailAddress).max(RECIPIENTS_MAX).optional(),
  subject: z.string().min(1).max(998),
  bodyHtml: z.string().min(1).max(BODY_HTML_MAX_CHARS),
});

const DRAFT_JSON_PROPERTIES = {
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

const DRAFT_JSON_REQUIRED = ['fromIntegrationId', 'toRecipients', 'subject', 'bodyHtml'];

const sendModeValues = ['new_mail', 'reply', 'reply_all'] as const;

const sendMailInputSchema = draftFieldsSchema.extend({
  mode: z.enum(sendModeValues),
  replyToId: uuid.optional(),
});

type SendMailToolInput = z.infer<typeof sendMailInputSchema>;

const SEND_JSON_PROPERTIES = {
  ...DRAFT_JSON_PROPERTIES,
  mode: { type: 'string', enum: [...sendModeValues] },
  replyToId: UUID_JSON,
} as const;

const SEND_JSON_REQUIRED = [...DRAFT_JSON_REQUIRED, 'mode'];

/** Reformule un échec `{ok:false, message}` en message montrable. */
function failure(message: string): string {
  return `Échec : ${message}`;
}

/** Messages FR montrables par code d'échec `sendMail` (send-mail.ts) — pas de fuite du message brut serveur. */
const SEND_FAILURE_MESSAGES: Partial<
  Record<Extract<SendMailResult, { ok: false }>['code'], string>
> = {
  RATE_LIMIT: "quota d'envoi atteint — réessayez plus tard",
  MAILBOX_NOT_FOUND: 'boîte introuvable ou non connectée',
  SMTP_NOT_CONFIGURED: 'SMTP non configuré pour cette boîte',
  TOO_MANY_RECIPIENTS: 'trop de destinataires (max 20)',
};

function describeSendFailure(result: Extract<SendMailResult, { ok: false }>): string {
  const known = SEND_FAILURE_MESSAGES[result.code];
  if (known !== undefined) return known;
  return result.message !== undefined
    ? `échec de l'envoi — ${result.message}`
    : "échec de l'envoi, réessayez dans un instant.";
}

/**
 * Extrait un aperçu texte, montrable, du corps HTML : balises retirées,
 * espaces normalisés, tronqué. JAMAIS le HTML brut dans une description qui
 * transite en clair côté client (contrat `describeForConfirm`, types.ts).
 */
function excerptOf(bodyHtml: string): string {
  return bodyHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CONFIRM_EXCERPT_MAX_CHARS);
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
        'Enregistre un brouillon de nouveau mail (utiliser list_my_mailboxes pour le fromIntegrationId). ATTENTION : un seul brouillon est conservé par utilisateur — cet appel écrase le brouillon en cours, visible dans Communications. Utiliser send_mail ensuite pour l’envoyer réellement.',
      inputSchema: draftFieldsSchema,
      jsonSchema: {
        type: 'object',
        properties: DRAFT_JSON_PROPERTIES,
        required: DRAFT_JSON_REQUIRED,
      },
      handler: async (input) =>
        safeMutation('create_mail_draft', async () => {
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
          return JSON.stringify({
            draftSaved: true,
            id: result.id,
            note: 'Brouillon enregistré — utiliser send_mail pour l’envoyer.',
          });
        }),
    }),

    defineTool({
      name: 'prepare_reply_draft',
      description:
        "Enregistre un brouillon de réponse à un mail existant (replyToId — voir read_mail ou search_mails). Itérer le texte de la réponse avec l'utilisateur AVANT de sauver : cet appel écrase aussi le brouillon en cours (un seul brouillon par utilisateur, visible dans Communications). Utiliser send_mail ensuite pour l'envoyer réellement.",
      inputSchema: draftFieldsSchema.extend({ replyToId: uuid }),
      jsonSchema: {
        type: 'object',
        properties: { ...DRAFT_JSON_PROPERTIES, replyToId: UUID_JSON },
        required: [...DRAFT_JSON_REQUIRED, 'replyToId'],
      },
      handler: async (input) =>
        safeMutation('prepare_reply_draft', async () => {
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
          return JSON.stringify({
            draftSaved: true,
            id: result.id,
            note: 'Brouillon de réponse enregistré — utiliser send_mail pour l’envoyer.',
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
      // JAMAIS le bodyHtml brut dans la description : elle transite en clair
      // côté client (SSE) — contrat `describeForConfirm` (types.ts). Extrait
      // texte tronqué uniquement.
      describeForConfirm: (input: SendMailToolInput) => {
        const to = input.toRecipients.join(', ');
        const ccCount = input.ccRecipients?.length ?? 0;
        const extra = ccCount > 0 ? ` (+${ccCount} cc)` : '';
        const excerpt = excerptOf(input.bodyHtml);
        return `Envoyer un mail à ${to}${extra} — objet « ${input.subject} » : ${excerpt}…`;
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
      name: 'mark_email_read',
      description: 'Marque un mail comme lu.',
      inputSchema: z.object({ emailId: uuid }),
      jsonSchema: { type: 'object', properties: { emailId: UUID_JSON }, required: ['emailId'] },
      handler: async (input) =>
        safeMutation('mark_email_read', async () => {
          const result = await markEmailRead({ emailId: input.emailId });
          if (!result.ok) return failure(result.message);
          return JSON.stringify({ marked: true });
        }),
    }),
  ];
}
