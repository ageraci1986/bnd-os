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

const draftMocks = vi.hoisted(() => ({ saveDraft: vi.fn() }));
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

/** Clés Zod requises (non-optionnelles) d'un objet — pour le spot-check de parité avec jsonSchema. */
function requiredKeys(schema: z.ZodTypeAny): string[] {
  if (!(schema instanceof z.ZodObject)) throw new Error('expected a ZodObject');
  return Object.entries(schema.shape as Record<string, z.ZodTypeAny>)
    .filter(([, field]) => !field.isOptional())
    .map(([key]) => key);
}

beforeEach(() => {
  vi.clearAllMocks();
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

      const zodSchema = t.inputSchema as z.ZodTypeAny;
      if (!(zodSchema instanceof z.ZodObject)) throw new Error(`expected ZodObject on ${t.name}`);
      const jsonKeys = Object.keys(json.properties ?? {}).sort();
      const zodKeys = Object.keys(zodSchema.shape as Record<string, unknown>).sort();
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

    it('code générique (ex. SEND_FAILED) → message générique incluant le message du résultat', async () => {
      sendMailMocks.sendMail.mockResolvedValue({
        ok: false,
        code: 'SEND_FAILED',
        message: "Échec de récupération d'une pièce jointe. Réessaie.",
      });
      const out = await run('send_mail', baseInput);
      expect(out).toContain("Échec de récupération d'une pièce jointe. Réessaie.");
    });

    it('code générique sans message → message générique montrable', async () => {
      sendMailMocks.sendMail.mockResolvedValue({ ok: false, code: 'SEND_FAILED_TOO_LARGE' });
      const out = await run('send_mail', baseInput);
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    });

    it('describeForConfirm : contient destinataires, cc, objet, extrait — sans balise HTML, longueur bornée', () => {
      const tool = getTool('send_mail');
      if (tool.describeForConfirm === undefined) throw new Error('describeForConfirm absent');
      const description = tool.describeForConfirm({
        fromIntegrationId: INTEGRATION_ID,
        mode: 'new_mail',
        toRecipients: ['dest@acme.com', 'autre@acme.com'],
        ccRecipients: ['cc1@acme.com'],
        subject: 'Devis signé',
        bodyHtml: '<p>Bonjour, <b>voici</b> le devis signé.</p>'.repeat(20),
      } as never);
      expect(description).toContain('dest@acme.com');
      expect(description).toContain('autre@acme.com');
      expect(description).toContain('+1 cc');
      expect(description).toContain('Devis signé');
      expect(description).not.toContain('<');
      expect(description.length).toBeLessThan(400);
    });

    it('describeForConfirm : sans cc, ne mentionne pas "cc"', () => {
      const tool = getTool('send_mail');
      if (tool.describeForConfirm === undefined) throw new Error('describeForConfirm absent');
      const description = tool.describeForConfirm({
        fromIntegrationId: INTEGRATION_ID,
        mode: 'new_mail',
        toRecipients: ['dest@acme.com'],
        subject: 'Objet',
        bodyHtml: '<p>Bonjour</p>',
      } as never);
      expect(description).not.toContain('cc');
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
