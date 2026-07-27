import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolSpec } from '@nexushub/agent';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock objects/functions themselves must be created via `vi.hoisted` — repo
// convention (see kanban-tools.test.ts, read-tools.test.ts).
const prismaMock = vi.hoisted(() => ({
  integration: { findMany: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));

const draftMocks = vi.hoisted(() => ({ saveDraft: vi.fn(), loadDraft: vi.fn() }));
vi.mock('@/features/communications/actions/mail-drafts', () => draftMocks);

const sendMailMocks = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('@/features/communications/actions/send-mail', () => sendMailMocks);

const markReadMocks = vi.hoisted(() => ({ markEmailRead: vi.fn() }));
vi.mock('@/features/communications/actions/mark-email-read', () => markReadMocks);

import { buildMailTools } from './mail-tools';

const ctx = {
  userId: 'u1',
  email: 'a@b.c',
  workspaceId: 'w1',
  role: 'user' as const,
  isSuperAdmin: false,
};

const INTEGRATION_ID = '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa';
const EMAIL_ID = '4c9d3f0a-2222-4444-8888-bbbbbbbbbbbb';
const REPLY_TO_ID = '4c9d3f0a-2222-4444-8888-cccccccccccc';

function tools(): ToolSpec[] {
  return buildMailTools(ctx);
}

function getTool(name: string): ToolSpec {
  const tool = tools().find((t) => t.name === name);
  if (tool === undefined) throw new Error(`tool absent: ${name}`);
  return tool;
}

async function run(name: string, input: unknown): Promise<string> {
  return getTool(name).handler(input as never);
}

/** Déplie les `.refine()` (ZodEffects) jusqu'au ZodObject sous-jacent. */
function unwrapObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> {
  let current: z.ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) {
    current = (current as z.ZodEffects<z.ZodTypeAny>).innerType();
  }
  if (!(current instanceof z.ZodObject)) throw new Error('expected a ZodObject');
  return current as z.ZodObject<z.ZodRawShape>;
}

/** Clés Zod requises (non-optionnelles) d'un objet — pour le spot-check de parité avec jsonSchema. */
function requiredKeys(schema: z.ZodTypeAny): string[] {
  return Object.entries(unwrapObject(schema).shape)
    .filter(([, field]) => !field.isOptional())
    .map(([key]) => key);
}

/** Brouillon existant minimal tel que renvoyé par loadDraft (mail-drafts.ts). */
function existingDraft(subject: string) {
  return {
    ok: true as const,
    draft: {
      id: 'd-existing',
      fromIntegrationId: INTEGRATION_ID,
      kind: 'new_mail' as const,
      replyToId: null,
      toRecipients: ['autre@acme.com'],
      ccRecipients: [],
      bccRecipients: [],
      subject,
      bodyHtml: '<p>déjà rédigé</p>',
      composeAttachments: [],
      updatedAt: '2026-07-27T10:00:00.000Z',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Défaut : aucun brouillon existant — les tests d'écrasement le surchargent.
  draftMocks.loadDraft.mockResolvedValue({ ok: true, draft: null });
});

describe('buildMailTools', () => {
  it('expose les 5 tools mail, seul send_mail gated, aucun adminOnly', () => {
    const list = tools();
    expect(list.map((t) => t.name).sort()).toEqual([
      'create_mail_draft',
      'list_my_mailboxes',
      'mark_email_read',
      'prepare_reply_draft',
      'send_mail',
    ]);
    expect(list.every((t) => !t.adminOnly)).toBe(true);
    for (const t of list) {
      expect(t.gated).toBe(t.name === 'send_mail');
    }
  });

  it('jsonSchema (required + properties) correspond au schéma Zod, pour chaque tool', () => {
    for (const t of tools()) {
      const json = t.jsonSchema as { required?: string[]; properties?: Record<string, unknown> };
      const jsonRequired = [...(json.required ?? [])].sort();
      const zodRequired = requiredKeys(t.inputSchema as z.ZodTypeAny).sort();
      expect(jsonRequired, `required mismatch on ${t.name}`).toEqual(zodRequired);

      const zodShape = unwrapObject(t.inputSchema as z.ZodTypeAny).shape;
      const jsonKeys = Object.keys(json.properties ?? {}).sort();
      const zodKeys = Object.keys(zodShape).sort();
      expect(jsonKeys, `properties mismatch on ${t.name}`).toEqual(zodKeys);
    }
  });

  describe('list_my_mailboxes', () => {
    it('interroge Prisma avec ownerUserId + status active + kind graph/imap, et NE sélectionne JAMAIS encryptedTokens', async () => {
      prismaMock.integration.findMany.mockResolvedValue([]);
      await run('list_my_mailboxes', {});
      const call = prismaMock.integration.findMany.mock.calls[0]?.[0] as {
        where: Record<string, unknown>;
        select: Record<string, unknown>;
      };
      expect(call.where).toEqual({
        workspaceId: 'w1',
        ownerUserId: 'u1',
        kind: { in: ['graph', 'imap'] },
        status: 'active',
      });
      expect(Object.keys(call.select).sort()).toEqual([
        'externalAccountId',
        'externalAccountLabel',
        'id',
        'kind',
      ]);
      expect(call.select).not.toHaveProperty('encryptedTokens');
    });

    it('label = externalAccountLabel ?? externalAccountId ?? kind', async () => {
      prismaMock.integration.findMany.mockResolvedValue([
        { id: 'i1', kind: 'graph', externalAccountLabel: 'Boîte pro', externalAccountId: 'x@y.z' },
        { id: 'i2', kind: 'imap', externalAccountLabel: null, externalAccountId: 'a@b.c' },
        { id: 'i3', kind: 'imap', externalAccountLabel: null, externalAccountId: null },
      ]);
      const out = JSON.parse(await run('list_my_mailboxes', {}));
      expect(out).toEqual([
        { integrationId: 'i1', kind: 'graph', label: 'Boîte pro' },
        { integrationId: 'i2', kind: 'imap', label: 'a@b.c' },
        { integrationId: 'i3', kind: 'imap', label: 'imap' },
      ]);
    });

    it('erreur DB brute → message montrable générique', async () => {
      prismaMock.integration.findMany.mockRejectedValue(new Error('connect ECONNREFUSED'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const out = await run('list_my_mailboxes', {});
      expect(out).not.toContain('ECONNREFUSED');
      expect(out.toLowerCase()).toContain('erreur');
      consoleError.mockRestore();
    });
  });

  describe('create_mail_draft', () => {
    const baseInput = {
      fromIntegrationId: INTEGRATION_ID,
      toRecipients: ['dest@acme.com'],
      subject: 'Objet',
      bodyHtml: '<p>Bonjour</p>',
    };

    it('passe kind:new_mail + les champs à saveDraft, et renvoie draftSaved:true', async () => {
      draftMocks.saveDraft.mockResolvedValue({ ok: true, id: 'd1' });
      const out = await run('create_mail_draft', baseInput);
      expect(draftMocks.saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'new_mail',
          fromIntegrationId: INTEGRATION_ID,
          toRecipients: ['dest@acme.com'],
          subject: 'Objet',
          bodyHtml: '<p>Bonjour</p>',
        }),
      );
      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(parsed['draftSaved']).toBe(true);
      expect(parsed['id']).toBe('d1');
    });

    it('brouillon existant sans overwriteExisting → refus mentionnant l’objet, saveDraft PAS appelé', async () => {
      draftMocks.loadDraft.mockResolvedValue(existingDraft('Relance facture'));
      const out = await run('create_mail_draft', baseInput);
      expect(out).toContain('un brouillon existe déjà');
      expect(out).toContain('Relance facture');
      expect(out).toContain('overwriteExisting: true');
      expect(draftMocks.saveDraft).not.toHaveBeenCalled();
    });

    it('brouillon existant + overwriteExisting:true → saveDraft appelé', async () => {
      draftMocks.loadDraft.mockResolvedValue(existingDraft('Relance facture'));
      draftMocks.saveDraft.mockResolvedValue({ ok: true, id: 'd1' });
      const out = await run('create_mail_draft', { ...baseInput, overwriteExisting: true });
      expect(draftMocks.saveDraft).toHaveBeenCalledOnce();
      expect(JSON.parse(out)).toMatchObject({ draftSaved: true });
    });

    it('aucun brouillon existant → saveDraft appelé sans le flag', async () => {
      draftMocks.saveDraft.mockResolvedValue({ ok: true, id: 'd1' });
      await run('create_mail_draft', baseInput);
      expect(draftMocks.loadDraft).toHaveBeenCalledOnce();
      expect(draftMocks.saveDraft).toHaveBeenCalledOnce();
    });

    it('échec saveDraft → message montrable', async () => {
      draftMocks.saveDraft.mockResolvedValue({
        ok: false,
        message: 'Impossible d’enregistrer le brouillon.',
      });
      const out = await run('create_mail_draft', baseInput);
      expect(out).toBe('Échec : Impossible d’enregistrer le brouillon.');
    });

    it('rejette plus de 20 destinataires', () => {
      const schema = getTool('create_mail_draft').inputSchema as z.ZodTypeAny;
      const many = Array.from({ length: 21 }, (_, i) => `d${i}@acme.com`);
      expect(schema.safeParse({ ...baseInput, toRecipients: many }).success).toBe(false);
    });
  });

  describe('prepare_reply_draft', () => {
    const baseInput = {
      fromIntegrationId: INTEGRATION_ID,
      replyToId: REPLY_TO_ID,
      toRecipients: ['dest@acme.com'],
      subject: 'Re: Objet',
      bodyHtml: '<p>Réponse</p>',
    };

    it('passe kind:reply + replyToId à saveDraft', async () => {
      draftMocks.saveDraft.mockResolvedValue({ ok: true, id: 'd2' });
      await run('prepare_reply_draft', baseInput);
      expect(draftMocks.saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'reply', replyToId: REPLY_TO_ID }),
      );
    });

    it('brouillon existant sans overwriteExisting → refus, saveDraft PAS appelé', async () => {
      draftMocks.loadDraft.mockResolvedValue(existingDraft('Brouillon en cours'));
      const out = await run('prepare_reply_draft', baseInput);
      expect(out).toContain('un brouillon existe déjà');
      expect(out).toContain('Brouillon en cours');
      expect(draftMocks.saveDraft).not.toHaveBeenCalled();
    });

    it('brouillon existant + overwriteExisting:true → saveDraft appelé', async () => {
      draftMocks.loadDraft.mockResolvedValue(existingDraft('Brouillon en cours'));
      draftMocks.saveDraft.mockResolvedValue({ ok: true, id: 'd2' });
      await run('prepare_reply_draft', { ...baseInput, overwriteExisting: true });
      expect(draftMocks.saveDraft).toHaveBeenCalledOnce();
    });

    it('replyToId est requis', () => {
      const schema = getTool('prepare_reply_draft').inputSchema as z.ZodTypeAny;
      const { replyToId: _replyToId, ...withoutReplyToId } = baseInput;
      expect(schema.safeParse(withoutReplyToId).success).toBe(false);
    });
  });

  describe('send_mail', () => {
    const baseInput = {
      fromIntegrationId: INTEGRATION_ID,
      mode: 'new_mail' as const,
      toRecipients: ['dest@acme.com'],
      subject: 'Objet',
      bodyHtml: '<p>Bonjour <b>le monde</b></p>',
    };

    it('succès → {sent:true, emailMessageId}', async () => {
      sendMailMocks.sendMail.mockResolvedValue({ ok: true, emailMessageId: 'm1' });
      const out = await run('send_mail', baseInput);
      expect(JSON.parse(out)).toEqual({ sent: true, emailMessageId: 'm1' });
    });

    it("le schéma exige replyToId pour mode 'reply' / 'reply_all', pas pour 'new_mail'", () => {
      const schema = getTool('send_mail').inputSchema as z.ZodTypeAny;
      const asReply = schema.safeParse({ ...baseInput, mode: 'reply' });
      expect(asReply.success).toBe(false);
      if (!asReply.success) {
        expect(asReply.error.issues[0]?.message).toBe('replyToId requis pour une réponse.');
      }
      expect(schema.safeParse({ ...baseInput, mode: 'reply_all' }).success).toBe(false);
      expect(
        schema.safeParse({ ...baseInput, mode: 'reply', replyToId: REPLY_TO_ID }).success,
      ).toBe(true);
      expect(schema.safeParse(baseInput).success).toBe(true);
    });

    it('code RATE_LIMIT → message FR dédié', async () => {
      sendMailMocks.sendMail.mockResolvedValue({ ok: false, code: 'RATE_LIMIT' });
      const out = await run('send_mail', baseInput);
      expect(out).toContain('quota');
    });

    it('code MAILBOX_NOT_FOUND → message FR dédié', async () => {
      sendMailMocks.sendMail.mockResolvedValue({ ok: false, code: 'MAILBOX_NOT_FOUND' });
      const out = await run('send_mail', baseInput);
      expect(out.toLowerCase()).toContain('boîte');
    });

    it('code SMTP_NOT_CONFIGURED → message FR dédié', async () => {
      sendMailMocks.sendMail.mockResolvedValue({ ok: false, code: 'SMTP_NOT_CONFIGURED' });
      const out = await run('send_mail', baseInput);
      expect(out.toLowerCase()).toContain('smtp');
    });

    it('code TOO_MANY_RECIPIENTS → message FR dédié', async () => {
      sendMailMocks.sendMail.mockResolvedValue({ ok: false, code: 'TOO_MANY_RECIPIENTS' });
      const out = await run('send_mail', baseInput);
      expect(out.toLowerCase()).toContain('destinataires');
    });

    it('code SEND_FAILED avec message → le message serveur N’est PAS relayé (hors whitelist)', async () => {
      sendMailMocks.sendMail.mockResolvedValue({
        ok: false,
        code: 'SEND_FAILED',
        message: 'ETIMEDOUT smtp.internal-host.example:587',
      });
      const out = await run('send_mail', baseInput);
      expect(out).not.toContain('internal-host');
      expect(out).toBe("Échec : l'envoi a échoué — réessayez dans un instant.");
    });

    it('code whitelisté (SEND_FAILED_UNSUPPORTED) → le message FR du serveur est relayé', async () => {
      sendMailMocks.sendMail.mockResolvedValue({
        ok: false,
        code: 'SEND_FAILED_UNSUPPORTED',
        message: 'Les pièces jointes ne sont pas prises en charge en réponse via Exchange.',
      });
      const out = await run('send_mail', baseInput);
      expect(out).toContain('Les pièces jointes ne sont pas prises en charge');
    });

    it('code whitelisté sans message → message générique montrable', async () => {
      sendMailMocks.sendMail.mockResolvedValue({ ok: false, code: 'SEND_FAILED_TOO_LARGE' });
      const out = await run('send_mail', baseInput);
      expect(out).toBe("Échec : l'envoi a échoué — réessayez dans un instant.");
    });

    describe('describeForConfirm', () => {
      function describe_(input: Record<string, unknown>): string {
        const tool = getTool('send_mail');
        if (tool.describeForConfirm === undefined) throw new Error('describeForConfirm absent');
        return tool.describeForConfirm(input as never);
      }

      it('contient mode, destinataires, cc en clair, objet, extrait — sans balise HTML', () => {
        const description = describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'new_mail',
          toRecipients: ['dest@acme.com', 'autre@acme.com'],
          ccRecipients: ['cc1@acme.com', 'cc2@acme.com'],
          subject: 'Devis signé',
          bodyHtml: '<p>Bonjour, <b>voici</b> le devis signé.</p>',
        });
        expect(description).toContain('nouveau message');
        expect(description).toContain('dest@acme.com');
        expect(description).toContain('autre@acme.com');
        expect(description).toContain('Cc : cc1@acme.com, cc2@acme.com');
        expect(description).toContain('Devis signé');
        expect(description).toContain('Bonjour, voici le devis signé.');
        expect(description).not.toContain('<');
      });

      it("mode 'reply_all' → libellé FR « réponse à tous »", () => {
        const description = describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'reply_all',
          replyToId: REPLY_TO_ID,
          toRecipients: ['dest@acme.com'],
          subject: 'Re: Objet',
          bodyHtml: '<p>OK</p>',
        });
        expect(description).toContain('réponse à tous');
      });

      it('Cci : chaque adresse apparaît en clair, JAMAIS tronquée (même à 7 adresses)', () => {
        const bcc = Array.from({ length: 7 }, (_, i) => `cache${i}@acme.com`);
        const description = describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'new_mail',
          toRecipients: ['dest@acme.com'],
          bccRecipients: bcc,
          subject: 'Objet',
          bodyHtml: '<p>Bonjour</p>',
        });
        for (const addr of bcc) {
          expect(description).toContain(addr);
        }
        expect(description).toContain('Cci :');
      });

      it('À : tronqué à 5 adresses + « +n autres »', () => {
        const to = Array.from({ length: 7 }, (_, i) => `dest${i}@acme.com`);
        const description = describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'new_mail',
          toRecipients: to,
          subject: 'Objet',
          bodyHtml: '<p>Bonjour</p>',
        });
        expect(description).toContain('dest4@acme.com');
        expect(description).not.toContain('dest5@acme.com');
        expect(description).toContain('+2 autres');
      });

      it('input invalide (brut, pré-validation) → description de refus, sans aucun champ de l’input', () => {
        const description = describe_({
          mode: 'inconnu',
          bodyHtml: '<script>alert(1)</script>',
        });
        expect(description).toBe('Envoi de mail (paramètres invalides — refusez).');
      });

      it('budget dépassé (20 Cci très longues + À/Cc chargés) → repli compté ≤ 1900 chars avec les comptes exacts', () => {
        const longAddr = (prefix: string, i: number) =>
          `${prefix}${i}-${'a'.repeat(80)}@${'b'.repeat(60)}.com`;
        const to = Array.from({ length: 20 }, (_, i) => longAddr('to', i));
        const cc = Array.from({ length: 20 }, (_, i) => longAddr('cc', i));
        const bcc = Array.from({ length: 20 }, (_, i) => longAddr('bcc', i));
        const description = describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'new_mail',
          toRecipients: to,
          ccRecipients: cc,
          bccRecipients: bcc,
          subject: 'S'.repeat(300),
          bodyHtml: `<p>${'contenu '.repeat(50)}</p>`,
        });
        expect(description.length).toBeLessThanOrEqual(1900);
        expect(description).toContain('refusez si vous ne les avez pas dictés');
        expect(description).toContain('20 destinataires');
        expect(description).toContain('20 en copie,');
        expect(description).toContain('20 en copie cachée');
        // L'objet reste présent, borné à 150 chars.
        expect(description).toContain(`« ${'S'.repeat(150)}…`);
      });

      it('sans cc ni cci, aucun segment Cc/Cci', () => {
        const description = describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'new_mail',
          toRecipients: ['dest@acme.com'],
          subject: 'Objet',
          bodyHtml: '<p>Bonjour</p>',
        });
        expect(description).not.toContain('Cc :');
        expect(description).not.toContain('Cci :');
      });

      it('extrait : ellipse UNIQUEMENT si le corps dépasse 200 caractères, longueur bornée', () => {
        const short = describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'new_mail',
          toRecipients: ['dest@acme.com'],
          subject: 'Objet',
          bodyHtml: '<p>Court.</p>',
        });
        expect(short.endsWith('Court.')).toBe(true);
        expect(short).not.toContain('…');

        const long = describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'new_mail',
          toRecipients: ['dest@acme.com'],
          subject: 'Objet',
          bodyHtml: `<p>${'très long contenu '.repeat(30)}</p>`,
        });
        expect(long).toContain('…');
        expect(long.length).toBeLessThan(400);
      });
    });
  });

  describe('mark_email_read', () => {
    it('passe emailId à markEmailRead et renvoie marked:true', async () => {
      markReadMocks.markEmailRead.mockResolvedValue({ ok: true });
      const out = await run('mark_email_read', { emailId: EMAIL_ID });
      expect(markReadMocks.markEmailRead).toHaveBeenCalledWith({ emailId: EMAIL_ID });
      expect(JSON.parse(out)).toEqual({ marked: true });
    });

    it('échec → message montrable', async () => {
      markReadMocks.markEmailRead.mockResolvedValue({ ok: false, message: 'Mail introuvable.' });
      const out = await run('mark_email_read', { emailId: EMAIL_ID });
      expect(out).toBe('Échec : Mail introuvable.');
    });
  });
});
