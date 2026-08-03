import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolSpec } from '@nexushub/agent';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock objects/functions themselves must be created via `vi.hoisted` — repo
// convention (see kanban-tools.test.ts, read-tools.test.ts).
const prismaMock = vi.hoisted(() => ({
  integration: { findMany: vi.fn() },
  emailMessage: { count: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));

const draftMocks = vi.hoisted(() => ({ saveDraft: vi.fn(), loadDraft: vi.fn() }));
vi.mock('@/features/communications/actions/mail-drafts', () => draftMocks);

const sendMailMocks = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('@/features/communications/actions/send-mail', () => sendMailMocks);

const markReadMocks = vi.hoisted(() => ({ markEmailRead: vi.fn() }));
vi.mock('@/features/communications/actions/mark-email-read', () => markReadMocks);

const mailStateMocks = vi.hoisted(() => ({
  setMailStateCore: vi.fn(),
  countMailsByFilter: vi.fn(),
  setMailStateByFilterCore: vi.fn(),
  MAIL_BULK_MAX: 100,
}));
// Garde les exports RÉELS (notamment `MailFilterSchema`, `buildMailFilterWhere`)
// via importOriginal — seuls les appels réseau (`countMailsByFilter`,
// `setMailStateByFilterCore`, `setMailStateCore`) sont mockés. Même pattern
// que send-mail.test.ts (@nexushub/integrations/graph).
vi.mock('@/features/communications/lib/mail-state-core', async (importOriginal) => {
  const actual = await importOriginal<typeof MailStateCoreModule>();
  return {
    ...actual,
    setMailStateCore: mailStateMocks.setMailStateCore,
    countMailsByFilter: mailStateMocks.countMailsByFilter,
    setMailStateByFilterCore: mailStateMocks.setMailStateByFilterCore,
    MAIL_BULK_MAX: mailStateMocks.MAIL_BULK_MAX,
  };
});

import { buildMailTools } from './mail-tools';
import type * as MailStateCoreModule from '@/features/communications/lib/mail-state-core';

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
const MAIL_ID_A = '4c9d3f0a-2222-4444-8888-dddddddddddd';
const MAIL_ID_B = '4c9d3f0a-2222-4444-8888-eeeeeeeeeeee';
const MAIL_ID_C = '4c9d3f0a-2222-4444-8888-ffffffffffff';

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
  it('expose les 14 tools mail, seuls send_mail/send_draft/archive_mail/delete_mail/*_by_filter gated, aucun adminOnly', () => {
    const list = tools();
    expect(list.map((t) => t.name).sort()).toEqual([
      'archive_mail',
      'archive_mails_by_filter',
      'create_mail_draft',
      'delete_mail',
      'delete_mails_by_filter',
      'get_draft',
      'list_my_mailboxes',
      'mark_email_read',
      'mark_mail_read',
      'mark_mail_unread',
      'mark_mails_read_by_filter',
      'prepare_reply_draft',
      'send_draft',
      'send_mail',
    ]);
    expect(list.every((t) => !t.adminOnly)).toBe(true);
    const gatedNames = new Set([
      'send_mail',
      'send_draft',
      'archive_mail',
      'delete_mail',
      'mark_mails_read_by_filter',
      'archive_mails_by_filter',
      'delete_mails_by_filter',
    ]);
    for (const t of list) {
      expect(t.gated).toBe(gatedNames.has(t.name));
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

    it('passe kind:new_mail + les champs à saveDraft, et renvoie le brouillon structuré (sortie widget) avec updatedAt relu post-save', async () => {
      // 1er appel loadDraft : refuseIfDraftExists (rien à écraser). 2e appel :
      // currentDraftUpdatedAt() relit le brouillon fraîchement persisté
      // (Mandat A) — c'est CETTE valeur, pas une horloge locale, qui doit
      // sortir dans `updatedAt`.
      draftMocks.loadDraft
        .mockResolvedValueOnce({ ok: true, draft: null })
        .mockResolvedValueOnce({ ok: true, draft: { updatedAt: '2026-07-27T11:00:00.000Z' } });
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
      expect(JSON.parse(out)).toEqual({
        draftSaved: true,
        kind: 'new_mail',
        to: ['dest@acme.com'],
        cc: [],
        bcc: [],
        subject: 'Objet',
        bodyText: 'Bonjour',
        replyToId: null,
        fromIntegrationId: INTEGRATION_ID,
        updatedAt: '2026-07-27T11:00:00.000Z',
      });
    });

    it('bodyText strippé (aucune balise) et borné à 2000 caractères, avec marqueur si tronqué', async () => {
      draftMocks.saveDraft.mockResolvedValue({ ok: true, id: 'd1' });
      const longHtml = `<p><b>${'a'.repeat(2100)}</b></p>`;
      const out = await run('create_mail_draft', { ...baseInput, bodyHtml: longHtml });
      const parsed = JSON.parse(out) as { bodyText: string };
      expect(parsed.bodyText).not.toContain('<');
      expect(parsed.bodyText).toContain('[…tronqué]');
      expect(parsed.bodyText.startsWith('a'.repeat(2000))).toBe(true);
      expect(parsed.bodyText.length).toBe(2000 + '[…tronqué]'.length);
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

    it('aucun brouillon existant → saveDraft appelé sans le flag ; loadDraft appelé deux fois (pré-check + relecture updatedAt)', async () => {
      draftMocks.saveDraft.mockResolvedValue({ ok: true, id: 'd1' });
      await run('create_mail_draft', baseInput);
      expect(draftMocks.loadDraft).toHaveBeenCalledTimes(2);
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

    it('passe kind:reply + replyToId à saveDraft, et renvoie le brouillon structuré (sortie widget) avec updatedAt relu post-save', async () => {
      draftMocks.loadDraft
        .mockResolvedValueOnce({ ok: true, draft: null })
        .mockResolvedValueOnce({ ok: true, draft: { updatedAt: '2026-07-27T11:30:00.000Z' } });
      draftMocks.saveDraft.mockResolvedValue({ ok: true, id: 'd2' });
      const out = await run('prepare_reply_draft', baseInput);
      expect(draftMocks.saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'reply', replyToId: REPLY_TO_ID }),
      );
      expect(JSON.parse(out)).toEqual({
        draftSaved: true,
        kind: 'reply',
        to: ['dest@acme.com'],
        cc: [],
        bcc: [],
        subject: 'Re: Objet',
        bodyText: 'Réponse',
        replyToId: REPLY_TO_ID,
        fromIntegrationId: INTEGRATION_ID,
        updatedAt: '2026-07-27T11:30:00.000Z',
      });
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
      // describeForConfirm peut désormais être async (string | Promise<string>) :
      // on attend la valeur, sans changer le comportement testé.
      async function describe_(input: Record<string, unknown>): Promise<string> {
        const tool = getTool('send_mail');
        if (tool.describeForConfirm === undefined) throw new Error('describeForConfirm absent');
        return tool.describeForConfirm(input as never);
      }

      it('contient mode, destinataires, cc en clair, objet, extrait — sans balise HTML', async () => {
        const description = await describe_({
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

      it("mode 'reply_all' → libellé FR « réponse à tous »", async () => {
        const description = await describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'reply_all',
          replyToId: REPLY_TO_ID,
          toRecipients: ['dest@acme.com'],
          subject: 'Re: Objet',
          bodyHtml: '<p>OK</p>',
        });
        expect(description).toContain('réponse à tous');
      });

      it('Cci : chaque adresse apparaît en clair, JAMAIS tronquée (même à 7 adresses)', async () => {
        const bcc = Array.from({ length: 7 }, (_, i) => `cache${i}@acme.com`);
        const description = await describe_({
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

      it('À : tronqué à 5 adresses + « +n autres »', async () => {
        const to = Array.from({ length: 7 }, (_, i) => `dest${i}@acme.com`);
        const description = await describe_({
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

      it('input invalide (brut, pré-validation) → description de refus, sans aucun champ de l’input', async () => {
        const description = await describe_({
          mode: 'inconnu',
          bodyHtml: '<script>alert(1)</script>',
        });
        expect(description).toBe('Envoi de mail (paramètres invalides — refusez).');
      });

      it('budget dépassé (20 Cci très longues + À/Cc chargés) → repli compté ≤ 1900 chars avec les comptes exacts', async () => {
        const longAddr = (prefix: string, i: number) =>
          `${prefix}${i}-${'a'.repeat(80)}@${'b'.repeat(60)}.com`;
        const to = Array.from({ length: 20 }, (_, i) => longAddr('to', i));
        const cc = Array.from({ length: 20 }, (_, i) => longAddr('cc', i));
        const bcc = Array.from({ length: 20 }, (_, i) => longAddr('bcc', i));
        const description = await describe_({
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

      it('sans cc ni cci, aucun segment Cc/Cci', async () => {
        const description = await describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'new_mail',
          toRecipients: ['dest@acme.com'],
          subject: 'Objet',
          bodyHtml: '<p>Bonjour</p>',
        });
        expect(description).not.toContain('Cc :');
        expect(description).not.toContain('Cci :');
      });

      it('extrait : ellipse UNIQUEMENT si le corps dépasse 200 caractères, longueur bornée', async () => {
        const short = await describe_({
          fromIntegrationId: INTEGRATION_ID,
          mode: 'new_mail',
          toRecipients: ['dest@acme.com'],
          subject: 'Objet',
          bodyHtml: '<p>Court.</p>',
        });
        expect(short.endsWith('Court.')).toBe(true);
        expect(short).not.toContain('…');

        const long = await describe_({
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

  describe('get_draft', () => {
    it('non gated, schéma et jsonSchema vides', () => {
      const tool = getTool('get_draft');
      expect(tool.gated).toBe(false);
      expect(tool.jsonSchema).toEqual({ type: 'object', properties: {} });
    });

    it('aucun brouillon → {exists:false}', async () => {
      draftMocks.loadDraft.mockResolvedValue({ ok: true, draft: null });
      const out = await run('get_draft', {});
      expect(JSON.parse(out)).toEqual({ exists: false });
    });

    it('brouillon existant → {exists:true, draft:{...}}, bodyText strippé, JAMAIS bodyHtml brut', async () => {
      draftMocks.loadDraft.mockResolvedValue({
        ok: true,
        draft: {
          id: 'd1',
          fromIntegrationId: INTEGRATION_ID,
          kind: 'reply',
          replyToId: REPLY_TO_ID,
          toRecipients: ['dest@acme.com'],
          ccRecipients: ['cc@acme.com'],
          bccRecipients: [],
          subject: 'Re: Objet',
          bodyHtml: '<p>Bonjour <b>le monde</b></p>',
          composeAttachments: [],
          updatedAt: '2026-07-27T10:00:00.000Z',
        },
      });
      const out = await run('get_draft', {});
      expect(out).not.toContain('<p>');
      expect(out).not.toContain('<b>');
      expect(out).not.toContain('Bonjour <b>');
      expect(JSON.parse(out)).toEqual({
        exists: true,
        draft: {
          kind: 'reply',
          replyToId: REPLY_TO_ID,
          to: ['dest@acme.com'],
          cc: ['cc@acme.com'],
          bcc: [],
          subject: 'Re: Objet',
          bodyText: 'Bonjour le monde',
          updatedAt: '2026-07-27T10:00:00.000Z',
        },
      });
    });

    it('bodyText borné à 5000 caractères, marqueur si tronqué', async () => {
      draftMocks.loadDraft.mockResolvedValue({
        ok: true,
        draft: {
          id: 'd1',
          fromIntegrationId: INTEGRATION_ID,
          kind: 'new_mail',
          replyToId: null,
          toRecipients: ['dest@acme.com'],
          ccRecipients: [],
          bccRecipients: [],
          subject: 'Objet',
          bodyHtml: `<p>${'a'.repeat(5200)}</p>`,
          composeAttachments: [],
          updatedAt: '2026-07-27T10:00:00.000Z',
        },
      });
      const out = await run('get_draft', {});
      const parsed = JSON.parse(out) as { draft: { bodyText: string } };
      expect(parsed.draft.bodyText).toContain('[…tronqué]');
      expect(parsed.draft.bodyText.startsWith('a'.repeat(5000))).toBe(true);
      expect(parsed.draft.bodyText.length).toBe(5000 + '[…tronqué]'.length);
    });

    it('erreur DB brute → message montrable générique, sans fuite', async () => {
      draftMocks.loadDraft.mockRejectedValue(new Error('connect ECONNREFUSED'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const out = await run('get_draft', {});
      expect(out).not.toContain('ECONNREFUSED');
      expect(out.toLowerCase()).toContain('erreur');
      consoleError.mockRestore();
    });
  });

  describe('send_draft', () => {
    const draftBase = {
      id: 'd1',
      fromIntegrationId: INTEGRATION_ID,
      toRecipients: ['dest@acme.com'],
      ccRecipients: ['cc@acme.com'],
      bccRecipients: ['bcc@acme.com'],
      subject: 'Objet',
      bodyHtml: '<p>Corps</p>',
      composeAttachments: [],
      updatedAt: '2026-07-27T10:00:00.000Z',
    };
    /** Jeton de fraîcheur correspondant à `draftBase.updatedAt`, inchangé par les overrides `kind`/`replyToId`/etc. des tests ci-dessous. */
    const FRESH_TOKEN = { expectedUpdatedAt: draftBase.updatedAt };

    it('gated: true ; schéma et jsonSchema exigent expectedUpdatedAt (jeton de fraîcheur — le contenu vient toujours du brouillon persisté)', () => {
      const tool = getTool('send_draft');
      expect(tool.gated).toBe(true);
      const json = tool.jsonSchema as { required?: string[]; properties?: Record<string, unknown> };
      expect(json.required).toEqual(['expectedUpdatedAt']);
      expect(Object.keys(json.properties ?? {})).toEqual(['expectedUpdatedAt']);
    });

    it('inputSchema : expectedUpdatedAt requis, doit être une date ISO 8601', () => {
      const schema = getTool('send_draft').inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ expectedUpdatedAt: 'pas-une-date' }).success).toBe(false);
      expect(schema.safeParse(FRESH_TOKEN).success).toBe(true);
    });

    it('aucun brouillon → échec, sendMail PAS appelé', async () => {
      draftMocks.loadDraft.mockResolvedValue({ ok: true, draft: null });
      const out = await run('send_draft', FRESH_TOKEN);
      expect(out).toBe('Échec : Aucun brouillon à envoyer.');
      expect(sendMailMocks.sendMail).not.toHaveBeenCalled();
    });

    it.each([
      ['new_mail', null, {}] as const,
      ['reply', REPLY_TO_ID, { replyToId: REPLY_TO_ID }] as const,
      ['reply_all', REPLY_TO_ID, { replyToId: REPLY_TO_ID }] as const,
      ['forward', REPLY_TO_ID, { replyToId: REPLY_TO_ID }] as const,
    ])(
      "kind:%s → sendMail appelé avec mode:%s (mapping identité constaté dans compose-panel.tsx, y compris 'forward')",
      async (kind, replyToId, expectedReplyTo) => {
        draftMocks.loadDraft.mockResolvedValue({
          ok: true,
          draft: { ...draftBase, kind, replyToId },
        });
        sendMailMocks.sendMail.mockResolvedValue({ ok: true, emailMessageId: 'm1' });
        const out = await run('send_draft', FRESH_TOKEN);
        expect(sendMailMocks.sendMail).toHaveBeenCalledWith({
          fromIntegrationId: INTEGRATION_ID,
          mode: kind,
          ...expectedReplyTo,
          toRecipients: ['dest@acme.com'],
          ccRecipients: ['cc@acme.com'],
          bccRecipients: ['bcc@acme.com'],
          subject: 'Objet',
          bodyHtml: '<p>Corps</p>',
          composeAttachments: [],
        });
        expect(JSON.parse(out)).toEqual({ sent: true, emailMessageId: 'm1' });
      },
    );

    it('succès → PAS de deleteDraft distinct appelé (sendMail supprime déjà le brouillon dans sa propre transaction)', async () => {
      draftMocks.loadDraft.mockResolvedValue({
        ok: true,
        draft: { ...draftBase, kind: 'new_mail', replyToId: null },
      });
      sendMailMocks.sendMail.mockResolvedValue({ ok: true, emailMessageId: 'm1' });
      await run('send_draft', FRESH_TOKEN);
      // Le mock du module mail-drafts.ts n'expose ici que loadDraft/saveDraft
      // (voir vi.mock en tête de fichier) : si send_draft appelait deleteDraft,
      // ce serait une erreur d'exécution — la réussite de ce test EST la preuve.
      expect(draftMocks.loadDraft).toHaveBeenCalledTimes(1);
    });

    it('échec sendMail (code connu) → message FR curé, réutilise describeSendFailure', async () => {
      draftMocks.loadDraft.mockResolvedValue({
        ok: true,
        draft: { ...draftBase, kind: 'new_mail', replyToId: null },
      });
      sendMailMocks.sendMail.mockResolvedValue({ ok: false, code: 'RATE_LIMIT' });
      const out = await run('send_draft', FRESH_TOKEN);
      expect(out).toContain('quota');
    });

    it('échec sendMail (SEND_FAILED, message serveur) → message serveur NON relayé (hors whitelist)', async () => {
      draftMocks.loadDraft.mockResolvedValue({
        ok: true,
        draft: { ...draftBase, kind: 'new_mail', replyToId: null },
      });
      sendMailMocks.sendMail.mockResolvedValue({
        ok: false,
        code: 'SEND_FAILED',
        message: 'ETIMEDOUT smtp.internal-host.example:587',
      });
      const out = await run('send_draft', FRESH_TOKEN);
      expect(out).not.toContain('internal-host');
      expect(out).toBe("Échec : l'envoi a échoué — réessayez dans un instant.");
    });

    describe('jeton de fraîcheur (Mandat A)', () => {
      it('handler : expectedUpdatedAt ne correspond plus au brouillon persisté → échec, sendMail PAS appelé', async () => {
        draftMocks.loadDraft.mockResolvedValue({
          ok: true,
          draft: { ...draftBase, kind: 'new_mail', replyToId: null },
        });
        const out = await run('send_draft', { expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
        expect(out).toBe(
          'Échec : Le brouillon a changé depuis la confirmation — relisez get_draft et réessayez.',
        );
        expect(sendMailMocks.sendMail).not.toHaveBeenCalled();
      });

      it('handler : expectedUpdatedAt correspond → envoi normal (déjà couvert par les tests kind:* ci-dessus, re-pinné ici pour la lisibilité de la revue)', async () => {
        draftMocks.loadDraft.mockResolvedValue({
          ok: true,
          draft: { ...draftBase, kind: 'new_mail', replyToId: null },
        });
        sendMailMocks.sendMail.mockResolvedValue({ ok: true, emailMessageId: 'm1' });
        const out = await run('send_draft', FRESH_TOKEN);
        expect(JSON.parse(out)).toEqual({ sent: true, emailMessageId: 'm1' });
      });
    });

    describe('describeForConfirm', () => {
      async function describe_(input: unknown = FRESH_TOKEN): Promise<string> {
        const tool = getTool('send_draft');
        if (tool.describeForConfirm === undefined) throw new Error('describeForConfirm absent');
        return tool.describeForConfirm(input as never);
      }

      it('input brut invalide (expectedUpdatedAt absent/mal formé) → description prudente, SANS lire le brouillon', async () => {
        const missing = await describe_({});
        expect(missing.toLowerCase()).toContain('invalide');
        expect(draftMocks.loadDraft).not.toHaveBeenCalled();

        const malformed = await describe_({ expectedUpdatedAt: 'pas-une-date' });
        expect(malformed.toLowerCase()).toContain('invalide');
        expect(draftMocks.loadDraft).not.toHaveBeenCalled();
      });

      it('expectedUpdatedAt ne correspond pas au brouillon persisté → description DÉCLARATIVE de fraîcheur rédigée pour un humain (sans nom de tool), sans appel sendMail', async () => {
        draftMocks.loadDraft.mockResolvedValue({
          ok: true,
          draft: { ...draftBase, kind: 'new_mail', replyToId: null },
        });
        const description = await describe_({ expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
        expect(description).toBe(
          "Le brouillon a été modifié depuis sa préparation — demandez à l'assistant de le relire avant d'envoyer.",
        );
        expect(description).not.toContain('get_draft');
        expect(sendMailMocks.sendMail).not.toHaveBeenCalled();
      });

      it('aucun brouillon → description DÉCLARATIVE de refus, sans appel sendMail', async () => {
        draftMocks.loadDraft.mockResolvedValue({ ok: true, draft: null });
        const description = await describe_();
        expect(description).toBe(
          "Envoyer un brouillon ? Aucun brouillon en cours — l'envoi sera refusé.",
        );
        expect(sendMailMocks.sendMail).not.toHaveBeenCalled();
      });

      it('brouillon présent → même énumération que send_mail (mode, destinataires, Cc, Cci, objet, extrait), sans balise HTML', async () => {
        draftMocks.loadDraft.mockResolvedValue({
          ok: true,
          draft: {
            ...draftBase,
            kind: 'reply_all',
            replyToId: REPLY_TO_ID,
            subject: 'Devis signé',
            bodyHtml: '<p>Bonjour, <b>voici</b> le devis signé.</p>',
          },
        });
        const description = await describe_();
        expect(description).toContain('réponse à tous');
        expect(description).toContain('dest@acme.com');
        expect(description).toContain('Cc : cc@acme.com');
        expect(description).toContain('Cci : bcc@acme.com');
        expect(description).toContain('Devis signé');
        expect(description).toContain('Bonjour, voici le devis signé.');
        expect(description).not.toContain('<');
      });

      it("kind 'forward' → libellé FR « Transfert »", async () => {
        draftMocks.loadDraft.mockResolvedValue({
          ok: true,
          draft: {
            ...draftBase,
            kind: 'forward',
            replyToId: REPLY_TO_ID,
            ccRecipients: [],
            bccRecipients: [],
          },
        });
        const description = await describe_();
        expect(description).toContain('Transfert');
      });

      it('Cci : chaque adresse apparaît en clair, JAMAIS tronquée (même à 7 adresses)', async () => {
        const bcc = Array.from({ length: 7 }, (_, i) => `cache${i}@acme.com`);
        draftMocks.loadDraft.mockResolvedValue({
          ok: true,
          draft: {
            ...draftBase,
            kind: 'new_mail',
            replyToId: null,
            ccRecipients: [],
            bccRecipients: bcc,
          },
        });
        const description = await describe_();
        for (const addr of bcc) {
          expect(description).toContain(addr);
        }
        expect(description).toContain('Cci :');
      });

      it('À : tronqué à 5 adresses + « +n autres »', async () => {
        const to = Array.from({ length: 7 }, (_, i) => `dest${i}@acme.com`);
        draftMocks.loadDraft.mockResolvedValue({
          ok: true,
          draft: {
            ...draftBase,
            kind: 'new_mail',
            replyToId: null,
            toRecipients: to,
            ccRecipients: [],
            bccRecipients: [],
          },
        });
        const description = await describe_();
        expect(description).toContain('dest4@acme.com');
        expect(description).not.toContain('dest5@acme.com');
        expect(description).toContain('+2 autres');
      });

      it('budget dépassé (20 Cci très longues + À/Cc chargés) → repli compté ≤ 1900 chars avec comptes exacts', async () => {
        const longAddr = (prefix: string, i: number) =>
          `${prefix}${i}-${'a'.repeat(80)}@${'b'.repeat(60)}.com`;
        const to = Array.from({ length: 20 }, (_, i) => longAddr('to', i));
        const cc = Array.from({ length: 20 }, (_, i) => longAddr('cc', i));
        const bcc = Array.from({ length: 20 }, (_, i) => longAddr('bcc', i));
        draftMocks.loadDraft.mockResolvedValue({
          ok: true,
          draft: {
            ...draftBase,
            kind: 'new_mail',
            replyToId: null,
            toRecipients: to,
            ccRecipients: cc,
            bccRecipients: bcc,
            subject: 'S'.repeat(300),
            bodyHtml: `<p>${'contenu '.repeat(50)}</p>`,
          },
        });
        const description = await describe_();
        expect(description.length).toBeLessThanOrEqual(1900);
        expect(description).toContain('refusez si vous ne les avez pas dictés');
        expect(description).toContain('20 destinataires');
        expect(description).toContain('20 en copie,');
        expect(description).toContain('20 en copie cachée');
        expect(description).toContain(`« ${'S'.repeat(150)}…`);
      });

      it('sans cc ni cci, aucun segment Cc/Cci', async () => {
        draftMocks.loadDraft.mockResolvedValue({
          ok: true,
          draft: {
            ...draftBase,
            kind: 'new_mail',
            replyToId: null,
            ccRecipients: [],
            bccRecipients: [],
          },
        });
        const description = await describe_();
        expect(description).not.toContain('Cc :');
        expect(description).not.toContain('Cci :');
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

  describe('descriptions mono vs bulk — pins statiques', () => {
    it('mark_email_read : UN mail, portée workspace, renvoi croisé vers mark_mail_read', () => {
      const description = getTool('mark_email_read').description;
      expect(description).toContain('UN mail');
      expect(description).toContain('workspace');
      expect(description).toContain('mark_mail_read');
    });

    it('mark_mail_read : « vos boîtes uniquement » + renvoi croisé vers mark_email_read', () => {
      const description = getTool('mark_mail_read').description;
      expect(description).toContain('vos boîtes uniquement');
      expect(description).toContain('mark_email_read');
    });

    it('mark_mail_unread : « vos boîtes uniquement » + précise l’absence d’équivalent mono-mail workspace', () => {
      const description = getTool('mark_mail_unread').description;
      expect(description).toContain('vos boîtes uniquement');
      expect(description).toContain('pas d’équivalent mono-mail workspace');
    });

    it.each(['archive_mail', 'delete_mail'])(
      '%s : « vos boîtes uniquement » + « LOCALE » + « réapparaître après une synchronisation »',
      (toolName) => {
        const description = getTool(toolName).description;
        expect(description).toContain('vos boîtes uniquement');
        expect(description).toContain('LOCALE');
        expect(description).toContain('réapparaître après une synchronisation');
      },
    );
  });

  describe('mark_mail_read / mark_mail_unread (non gated)', () => {
    it.each([['mark_mail_read', 'read'] as const, ['mark_mail_unread', 'unread'] as const])(
      '%s → setMailStateCore(ctx, {mailIds, op:%s})',
      async (toolName, op) => {
        mailStateMocks.setMailStateCore.mockResolvedValue({ ok: true, affected: 2, skipped: 1 });
        const mailIds = [MAIL_ID_A, MAIL_ID_B, MAIL_ID_C];
        const out = await run(toolName, { mailIds });
        expect(mailStateMocks.setMailStateCore).toHaveBeenCalledWith(ctx, { mailIds, op });
        expect(JSON.parse(out)).toEqual({ done: true, affected: 2, skipped: 1 });
      },
    );

    it.each(['mark_mail_read', 'mark_mail_unread'])('%s n’est pas gated', (toolName) => {
      expect(getTool(toolName).gated).not.toBe(true);
    });

    it.each(['mark_mail_read', 'mark_mail_unread'])(
      '%s : échec core (reject) → message générique safeMutation, sans fuite',
      async (toolName) => {
        mailStateMocks.setMailStateCore.mockRejectedValue(new Error('connect ECONNREFUSED'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const out = await run(toolName, { mailIds: [MAIL_ID_A] });
        expect(out).toBe("Erreur interne pendant l'action — réessayez dans un instant.");
        expect(out).not.toContain('ECONNREFUSED');
        consoleError.mockRestore();
      },
    );

    it.each(['mark_mail_read', 'mark_mail_unread'])(
      '%s : refus core (ok:false, ex. Viewer) → message relayé via failure()',
      async (toolName) => {
        mailStateMocks.setMailStateCore.mockResolvedValue({
          ok: false,
          message: 'Lecture seule.',
        });
        const out = await run(toolName, { mailIds: [MAIL_ID_A] });
        expect(out).toBe('Échec : Lecture seule.');
      },
    );

    it('mailIds : borné à 100, au moins 1, uuid', () => {
      const schema = getTool('mark_mail_read').inputSchema as z.ZodTypeAny;
      expect(schema.safeParse({ mailIds: [] }).success).toBe(false);
      expect(
        schema.safeParse({ mailIds: Array.from({ length: 101 }, () => MAIL_ID_A) }).success,
      ).toBe(false);
      expect(schema.safeParse({ mailIds: ['not-a-uuid'] }).success).toBe(false);
      expect(schema.safeParse({ mailIds: [MAIL_ID_A] }).success).toBe(true);
    });
  });

  describe.each([['archive_mail', 'archive'] as const, ['delete_mail', 'delete'] as const])(
    '%s (gated)',
    (toolName, op) => {
      it('gated : true', () => {
        expect(getTool(toolName).gated).toBe(true);
      });

      it(`handler → setMailStateCore(ctx, {mailIds, op:'${op}'}), JSON {done, affected, skipped}`, async () => {
        mailStateMocks.setMailStateCore.mockResolvedValue({ ok: true, affected: 3, skipped: 2 });
        const mailIds = [MAIL_ID_A, MAIL_ID_B, MAIL_ID_C];
        const out = await run(toolName, { mailIds });
        expect(mailStateMocks.setMailStateCore).toHaveBeenCalledWith(ctx, { mailIds, op });
        expect(JSON.parse(out)).toEqual({ done: true, affected: 3, skipped: 2 });
      });

      it('échec core (reject) → message générique safeMutation, sans fuite', async () => {
        mailStateMocks.setMailStateCore.mockRejectedValue(new Error('connect ECONNREFUSED'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const out = await run(toolName, { mailIds: [MAIL_ID_A] });
        expect(out).toBe("Erreur interne pendant l'action — réessayez dans un instant.");
        expect(out).not.toContain('ECONNREFUSED');
        consoleError.mockRestore();
      });

      it('refus core (ok:false) → message relayé via failure()', async () => {
        mailStateMocks.setMailStateCore.mockResolvedValue({ ok: false, message: 'Lecture seule.' });
        const out = await run(toolName, { mailIds: [MAIL_ID_A] });
        expect(out).toBe('Échec : Lecture seule.');
      });

      describe('describeForConfirm', () => {
        async function describe_(input: unknown): Promise<string> {
          const tool = getTool(toolName);
          if (tool.describeForConfirm === undefined) throw new Error('describeForConfirm absent');
          return tool.describeForConfirm(input as never);
        }

        it('input brut {} → description prudente, SANS requête DB', async () => {
          const description = await describe_({});
          expect(description.toLowerCase()).toContain('invalide');
          expect(prismaMock.emailMessage.count).not.toHaveBeenCalled();
        });

        it('input brut {mailIds:"x"} (mauvais type) → description prudente, SANS requête DB', async () => {
          const description = await describe_({ mailIds: 'x' });
          expect(description.toLowerCase()).toContain('invalide');
          expect(prismaMock.emailMessage.count).not.toHaveBeenCalled();
        });

        it('count === N (tous possédés) → requête DB owner-only pinnée, description avec N', async () => {
          const mailIds = [MAIL_ID_A, MAIL_ID_B, MAIL_ID_C];
          prismaMock.emailMessage.count.mockResolvedValue(3);
          const description = await describe_({ mailIds });
          expect(prismaMock.emailMessage.count).toHaveBeenCalledWith({
            where: {
              id: { in: mailIds },
              workspaceId: ctx.workspaceId,
              deletedAt: null,
              integration: { ownerUserId: ctx.userId },
            },
          });
          expect(description).toContain('3');
          if (op === 'archive') {
            expect(description).toContain('archivage local');
          } else {
            expect(description).toContain('suppression locale');
          }
          expect(description).toContain('réapparaître');
        });

        it('count < N (certains hors périmètre) → description signale le sous-ensemble', async () => {
          const mailIds = [MAIL_ID_A, MAIL_ID_B, MAIL_ID_C];
          prismaMock.emailMessage.count.mockResolvedValue(1);
          const description = await describe_({ mailIds });
          expect(description).toContain('3');
          expect(description).toContain('1');
          expect(description.toLowerCase()).toContain('ignoré');
          if (op === 'archive') {
            expect(description).toContain('archivage local');
          } else {
            expect(description).toContain('suppression locale');
          }
        });

        it('dédoublonne les mailIds avant le count DB (même liste que le core)', async () => {
          const mailIds = [MAIL_ID_A, MAIL_ID_A, MAIL_ID_B];
          prismaMock.emailMessage.count.mockResolvedValue(2);
          await describe_({ mailIds });
          const call = prismaMock.emailMessage.count.mock.calls[0]?.[0] as {
            where: { id: { in: string[] } };
          };
          expect(call.where.id.in.sort()).toEqual([MAIL_ID_A, MAIL_ID_B].sort());
        });
      });
    },
  );

  describe('tools *_by_filter', () => {
    it('les 3 tools existent et sont gated', () => {
      for (const name of [
        'mark_mails_read_by_filter',
        'archive_mails_by_filter',
        'delete_mails_by_filter',
      ]) {
        const t = getTool(name);
        expect(t.gated).toBe(true);
        expect(t.describeForConfirm).toBeDefined();
      }
    });

    describe('describeForConfirm', () => {
      async function describeFilterTool(name: string, input: unknown): Promise<string> {
        const tool = getTool(name);
        if (tool.describeForConfirm === undefined) throw new Error('describeForConfirm absent');
        return tool.describeForConfirm(input as never);
      }

      it('compte réel + reformulation du filtre', async () => {
        mailStateMocks.countMailsByFilter.mockResolvedValue(143);
        const description = await describeFilterTool('mark_mails_read_by_filter', {
          fromContains: 'notifications@github.com',
        });
        expect(description).toContain('143 mails');
        expect(description).toContain('notifications@github.com');
        expect(description).toMatch(/marquer.*lus/i);
      });

      it('0 résultat → « Aucun mail ne correspond »', async () => {
        mailStateMocks.countMailsByFilter.mockResolvedValue(0);
        const description = await describeFilterTool('archive_mails_by_filter', {
          folder: 'inbox',
        });
        expect(description).toMatch(/aucun mail ne correspond/i);
      });

      it('entrée BRUTE malformée (filtre vide, viole le refine) → libellé de repli, jamais de crash', async () => {
        const description = await describeFilterTool('delete_mails_by_filter', {});
        expect(description).toMatch(/données invalides/i);
        expect(mailStateMocks.countMailsByFilter).not.toHaveBeenCalled();
      });

      it('archive/delete : la note « local à NexusHub » figure dans le describe', async () => {
        mailStateMocks.countMailsByFilter.mockResolvedValue(9);
        const description = await describeFilterTool('archive_mails_by_filter', {
          folder: 'inbox',
        });
        expect(description).toMatch(/local/i);
      });

      it('describeForConfirm compte avec le MÊME op que le handler exécutera (archive exclut archivedAt non-null)', async () => {
        mailStateMocks.countMailsByFilter.mockResolvedValue(5);
        await describeFilterTool('archive_mails_by_filter', { folder: 'inbox' });
        expect(mailStateMocks.countMailsByFilter).toHaveBeenCalledWith(
          ctx,
          { folder: 'inbox' },
          'archive',
        );
      });
    });

    it('handler : délègue au core by-filter et renvoie le compte réel + filtre appliqué', async () => {
      mailStateMocks.setMailStateByFilterCore.mockResolvedValue({
        ok: true,
        affected: 143,
        skipped: 0,
      });
      const raw = await run('mark_mails_read_by_filter', { fromContains: 'github' });
      expect(JSON.parse(raw)).toMatchObject({ affected: 143 });
      expect(mailStateMocks.setMailStateByFilterCore).toHaveBeenCalledWith(ctx, {
        filter: { fromContains: 'github' },
        op: 'read',
      });
    });

    it.each([
      ['archive_mails_by_filter', 'archive'] as const,
      ['delete_mails_by_filter', 'delete'] as const,
    ])('%s : handler délègue avec op:%s', async (name, op) => {
      mailStateMocks.setMailStateByFilterCore.mockResolvedValue({
        ok: true,
        affected: 7,
        skipped: 0,
      });
      const raw = await run(name, { folder: 'inbox' });
      expect(JSON.parse(raw)).toMatchObject({ affected: 7 });
      expect(mailStateMocks.setMailStateByFilterCore).toHaveBeenCalledWith(ctx, {
        filter: { folder: 'inbox' },
        op,
      });
    });

    it('refus core (ok:false, ex. Viewer) → JSON relayé tel quel', async () => {
      mailStateMocks.setMailStateByFilterCore.mockResolvedValue({
        ok: false,
        message: 'Lecture seule.',
      });
      const raw = await run('mark_mails_read_by_filter', { fromContains: 'github' });
      expect(JSON.parse(raw)).toEqual({ ok: false, message: 'Lecture seule.' });
    });

    it('jsonSchema : les 6 propriétés du filtre, sans champ requis individuel (le refine « au moins un » n’est pas exprimable)', () => {
      for (const name of [
        'mark_mails_read_by_filter',
        'archive_mails_by_filter',
        'delete_mails_by_filter',
      ]) {
        const json = getTool(name).jsonSchema as {
          required?: string[];
          properties?: Record<string, unknown>;
        };
        expect(Object.keys(json.properties ?? {}).sort()).toEqual([
          'folder',
          'fromContains',
          'isRead',
          'receivedAfter',
          'receivedBefore',
          'subjectContains',
        ]);
        expect(json.required ?? []).toEqual([]);
      }
    });
  });
});
