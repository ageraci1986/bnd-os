import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolSpec } from '@nexushub/agent';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock functions themselves must be created via `vi.hoisted` — repo
// convention (see kanban-tools.test.ts, read-tools.test.ts).
const clientCoreMocks = vi.hoisted(() => ({
  createClientCore: vi.fn(),
  updateClientCore: vi.fn(),
  deleteClientCore: vi.fn(),
  createContactCore: vi.fn(),
  updateContactCore: vi.fn(),
  deleteContactCore: vi.fn(),
}));
vi.mock('@/features/clients/lib/client-core', () => clientCoreMocks);

// `client.findFirst` / `contact.findFirst` : lookups véridiques des
// `describeForConfirm` gated (delete_client, delete_contact) — anti-spoofing,
// voir types.ts.
const prismaMocks = vi.hoisted(() => ({
  client: { findFirst: vi.fn() },
  contact: { findFirst: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMocks }));

// Scope : les describes gated appliquent le MÊME filtrage que les tools de
// lecture — un restricted ne doit jamais voir le nom d'un client/contact
// hors de son scope via le dialog de confirmation.
const scopeMocks = vi.hoisted(() => ({
  loadUserScope: vi.fn<() => Promise<unknown>>(async () => ({ kind: 'workspace' as const })),
  scopedClientWhere: vi.fn((): Record<string, unknown> => ({})),
}));
vi.mock('@/lib/auth/scope', () => scopeMocks);

import { buildClientTools } from './client-tools';

const ctx = {
  userId: 'u1',
  email: 'a@b.c',
  workspaceId: 'w1',
  role: 'user' as const,
  isSuperAdmin: false,
};

const CLIENT_ID = '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa';
const CONTACT_ID = '4c9d3f0a-2222-4444-8888-bbbbbbbbbbbb';

function tools(): ToolSpec[] {
  return buildClientTools(ctx);
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
  scopeMocks.loadUserScope.mockResolvedValue({ kind: 'workspace' as const });
  scopeMocks.scopedClientWhere.mockReturnValue({});
});

describe('buildClientTools', () => {
  it('expose les 7 tools, delete_client/delete_contact gated, aucun adminOnly', () => {
    const list = tools();
    expect(list.map((t) => t.name).sort()).toEqual([
      'create_client',
      'create_contact',
      'delete_client',
      'delete_contact',
      'set_contact_raci',
      'update_client',
      'update_contact',
    ]);
    expect(list.every((t) => !t.adminOnly)).toBe(true);
    const gatedNames = new Set(['delete_client', 'delete_contact']);
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

      const zodSchema = t.inputSchema as z.ZodTypeAny;
      if (!(zodSchema instanceof z.ZodObject)) throw new Error(`expected ZodObject on ${t.name}`);
      const jsonKeys = Object.keys(json.properties ?? {}).sort();
      const zodKeys = Object.keys(zodSchema.shape as Record<string, unknown>).sort();
      expect(jsonKeys, `properties mismatch on ${t.name}`).toEqual(zodKeys);
    }
  });

  // ---------- create_client -------------------------------------------------

  it('create_client : initials fournies + domains + notes → transmis normalisés au core, JSON sur succès', async () => {
    clientCoreMocks.createClientCore.mockResolvedValue({
      ok: true,
      clientId: 'c-1',
      slug: 'acme',
    });
    const out = await run('create_client', {
      name: 'Acme',
      colorToken: 'c-acme',
      initials: 'ac',
      domains: ['ACME.com', 'sub.acme.com'],
      notes: '  Bon client  ',
    });
    expect(clientCoreMocks.createClientCore).toHaveBeenCalledWith(ctx, {
      name: 'Acme',
      colorToken: 'c-acme',
      initials: 'AC',
      domains: ['acme.com', 'sub.acme.com'],
      notes: 'Bon client',
    });
    expect(JSON.parse(out)).toEqual({ created: true, clientId: 'c-1', slug: 'acme' });
  });

  it('create_client : initials omises → auto-dérivées du nom (computeInitials réel)', async () => {
    clientCoreMocks.createClientCore.mockResolvedValue({
      ok: true,
      clientId: 'c-1',
      slug: 'acme-brands',
    });
    await run('create_client', { name: 'Acme Brands', colorToken: 'c-acme' });
    expect(clientCoreMocks.createClientCore).toHaveBeenCalledWith(ctx, {
      name: 'Acme Brands',
      colorToken: 'c-acme',
      initials: 'AB',
      domains: [],
      notes: null,
    });
  });

  it('create_client : initiales invalides (caractères) → échec sans appeler le core', async () => {
    const out = await run('create_client', {
      name: 'Acme',
      colorToken: 'c-acme',
      initials: '@@',
    });
    expect(out).toContain('Échec');
    expect(clientCoreMocks.createClientCore).not.toHaveBeenCalled();
  });

  it('create_client : domaine invalide → échec sans appeler le core', async () => {
    const out = await run('create_client', {
      name: 'Acme',
      colorToken: 'c-acme',
      domains: ['not a domain'],
    });
    expect(out).toContain('Échec');
    expect(out).toContain('Domaine invalide');
    expect(clientCoreMocks.createClientCore).not.toHaveBeenCalled();
  });

  it('create_client : échec core (nom dupliqué) → message montrable', async () => {
    clientCoreMocks.createClientCore.mockResolvedValue({
      ok: false,
      message: 'Un client porte déjà ce nom.',
    });
    const out = await run('create_client', { name: 'Acme', colorToken: 'c-acme' });
    expect(out).toBe('Échec : Un client porte déjà ce nom.');
  });

  it('create_client : le schéma borne le nom à 80 caractères (CLIENT_NAME_MAX du domain)', () => {
    const schema = getTool('create_client').inputSchema as z.ZodTypeAny;
    expect(schema.safeParse({ name: 'a'.repeat(80), colorToken: 'c-acme' }).success).toBe(true);
    expect(schema.safeParse({ name: 'a'.repeat(81), colorToken: 'c-acme' }).success).toBe(false);
  });

  // ---------- update_client --------------------------------------------------

  it('update_client : conditional-spread — seuls les champs fournis sont transmis, post-état RELU du core renvoyé', async () => {
    clientCoreMocks.updateClientCore.mockResolvedValue({
      ok: true,
      name: 'Nouveau nom',
      colorToken: 'c-tech',
      initials: 'NN',
      domains: ['acme.com'],
      notes: null,
    });
    const out = await run('update_client', { clientId: CLIENT_ID, name: 'Nouveau nom' });
    expect(clientCoreMocks.updateClientCore).toHaveBeenCalledWith(ctx, {
      clientId: CLIENT_ID,
      name: 'Nouveau nom',
    });
    expect(JSON.parse(out)).toEqual({
      updated: true,
      name: 'Nouveau nom',
      colorToken: 'c-tech',
      initials: 'NN',
      domains: ['acme.com'],
      notes: null,
    });
  });

  it('update_client : notes:null efface explicitement (transmis), notes absent n’est pas transmis', async () => {
    clientCoreMocks.updateClientCore.mockResolvedValue({
      ok: true,
      name: 'X',
      colorToken: 'c-acme',
      initials: 'X',
      domains: [],
      notes: null,
    });
    await run('update_client', { clientId: CLIENT_ID, notes: null });
    expect(clientCoreMocks.updateClientCore).toHaveBeenCalledWith(ctx, {
      clientId: CLIENT_ID,
      notes: null,
    });

    await run('update_client', { clientId: CLIENT_ID, name: 'Y' });
    expect(clientCoreMocks.updateClientCore).toHaveBeenCalledWith(ctx, {
      clientId: CLIENT_ID,
      name: 'Y',
    });
  });

  it('update_client : initiales invalides → échec sans appeler le core', async () => {
    const out = await run('update_client', { clientId: CLIENT_ID, initials: '####' });
    expect(out).toContain('Échec');
    expect(clientCoreMocks.updateClientCore).not.toHaveBeenCalled();
  });

  it('update_client : domaine invalide → échec sans appeler le core', async () => {
    const out = await run('update_client', { clientId: CLIENT_ID, domains: ['???'] });
    expect(out).toContain('Échec');
    expect(clientCoreMocks.updateClientCore).not.toHaveBeenCalled();
  });

  it('update_client : échec core → message montrable', async () => {
    clientCoreMocks.updateClientCore.mockResolvedValue({
      ok: false,
      message: 'Un client porte déjà ce nom.',
    });
    const out = await run('update_client', { clientId: CLIENT_ID, name: 'X' });
    expect(out).toBe('Échec : Un client porte déjà ce nom.');
  });

  // ---------- delete_client ---------------------------------------------------

  it('delete_client est gated:true et wrappe deleteClientCore(ctx, { clientId }) sans ip/userAgent', async () => {
    const tool = getTool('delete_client');
    expect(tool.gated).toBe(true);

    clientCoreMocks.deleteClientCore.mockResolvedValue({ ok: true });
    const ok = await run('delete_client', { clientId: CLIENT_ID });
    expect(clientCoreMocks.deleteClientCore).toHaveBeenCalledWith(ctx, { clientId: CLIENT_ID });
    expect(ok).toBe('Client supprimé.');

    clientCoreMocks.deleteClientCore.mockResolvedValue({
      ok: false,
      message: 'Suppression impossible : 1 projet actif est encore attaché à ce client.',
    });
    const fail = await run('delete_client', { clientId: CLIENT_ID });
    expect(fail).toBe(
      'Échec : Suppression impossible : 1 projet actif est encore attaché à ce client.',
    );
  });

  it('delete_client : describeForConfirm re-valide l’input BRUT — {} ou id structuré → libellé prudent SANS aucun appel DB', async () => {
    const describe = getTool('delete_client').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;

    const empty = await describe({});
    expect(empty).toBe('Supprimer un client introuvable dans ce workspace ?');
    expect(prismaMocks.client.findFirst).not.toHaveBeenCalled();
    expect(scopeMocks.loadUserScope).not.toHaveBeenCalled();

    const structured = await describe({ clientId: { not: null } });
    expect(structured).toBe('Supprimer un client introuvable dans ce workspace ?');
    expect(prismaMocks.client.findFirst).not.toHaveBeenCalled();
  });

  it('delete_client : describeForConfirm applique le scope restricted (AND scopedClientWhere) — hors scope → « introuvable », nom réel jamais présent', async () => {
    const describe = getTool('delete_client').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['scope-c1'],
      projectIds: [],
    });
    scopeMocks.scopedClientWhere.mockReturnValueOnce({ id: { in: ['scope-c1'] } });
    prismaMocks.client.findFirst.mockResolvedValueOnce(null);

    const out = await describe({ clientId: CLIENT_ID });

    expect(prismaMocks.client.findFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: CLIENT_ID, workspaceId: ctx.workspaceId, deletedAt: null },
          { id: { in: ['scope-c1'] } },
        ],
      },
      select: {
        name: true,
        _count: { select: { projects: { where: { deletedAt: null, archivedAt: null } } } },
      },
    });
    expect(out).toBe('Supprimer un client introuvable dans ce workspace ?');
    expect(out).not.toContain('Acme');
  });

  it('delete_client : describeForConfirm annonce les projets actifs attachés', async () => {
    const describe = getTool('delete_client').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.client.findFirst.mockResolvedValueOnce({
      name: 'Acme',
      _count: { projects: 2 },
    });
    const out = await describe({ clientId: CLIENT_ID });
    expect(out).toBe(
      'Supprimer le client « Acme » ? Attention : 2 projet(s) actif(s) y sont attachés — la suppression sera refusée.',
    );
  });

  it('delete_client : describeForConfirm sans projet actif → mentionne aussi les contacts', async () => {
    const describe = getTool('delete_client').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.client.findFirst.mockResolvedValueOnce({
      name: 'Acme',
      _count: { projects: 0 },
    });
    const out = await describe({ clientId: CLIENT_ID });
    expect(out).toBe(
      'Supprimer le client « Acme » (aucun projet actif) ? Ses contacts seront aussi supprimés.',
    );
  });

  // ---------- create_contact ---------------------------------------------------

  it('create_contact : transmet name imbriqué + défauts null pour les champs omis, JSON sur succès', async () => {
    clientCoreMocks.createContactCore.mockResolvedValue({ ok: true, contactId: 'ct-1' });
    const out = await run('create_contact', {
      clientId: CLIENT_ID,
      firstName: 'Jane',
      lastName: 'Doe',
    });
    expect(clientCoreMocks.createContactCore).toHaveBeenCalledWith(ctx, {
      clientId: CLIENT_ID,
      name: { firstName: 'Jane', lastName: 'Doe' },
      jobTitle: null,
      email: null,
      phone: null,
      raci: null,
      notes: null,
    });
    expect(JSON.parse(out)).toEqual({ created: true, contactId: 'ct-1' });
  });

  it('create_contact : transmet email normalisé (lowercase) + jobTitle/phone/raci fournis', async () => {
    clientCoreMocks.createContactCore.mockResolvedValue({ ok: true, contactId: 'ct-2' });
    await run('create_contact', {
      clientId: CLIENT_ID,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'Jane.Doe@ACME.com',
      jobTitle: 'CMO',
      phone: '+33 6 00 00 00 00',
      raci: 'approver',
    });
    expect(clientCoreMocks.createContactCore).toHaveBeenCalledWith(ctx, {
      clientId: CLIENT_ID,
      name: { firstName: 'Jane', lastName: 'Doe' },
      jobTitle: 'CMO',
      email: 'jane.doe@acme.com',
      phone: '+33 6 00 00 00 00',
      raci: 'approver',
      notes: null,
    });
  });

  it('create_contact : échec core → message montrable', async () => {
    clientCoreMocks.createContactCore.mockResolvedValue({
      ok: false,
      message: 'Accès restreint à ce client.',
    });
    const out = await run('create_contact', {
      clientId: CLIENT_ID,
      firstName: 'Jane',
      lastName: 'Doe',
    });
    expect(out).toBe('Échec : Accès restreint à ce client.');
  });

  // ---------- update_contact ---------------------------------------------------

  it('update_contact : conditional-spread — seuls les champs fournis sont transmis, post-état RELU du core renvoyé', async () => {
    clientCoreMocks.updateContactCore.mockResolvedValue({
      ok: true,
      firstName: 'Jane',
      lastName: 'Doe',
      raci: 'consulted',
      email: 'jane@acme.com',
    });
    const out = await run('update_contact', { contactId: CONTACT_ID, raci: 'consulted' });
    expect(clientCoreMocks.updateContactCore).toHaveBeenCalledWith(ctx, {
      contactId: CONTACT_ID,
      raci: 'consulted',
    });
    expect(JSON.parse(out)).toEqual({
      updated: true,
      firstName: 'Jane',
      lastName: 'Doe',
      raci: 'consulted',
      email: 'jane@acme.com',
    });
  });

  it('update_contact : email:null efface explicitement (transmis), raci:null efface explicitement', async () => {
    clientCoreMocks.updateContactCore.mockResolvedValue({
      ok: true,
      firstName: 'Jane',
      lastName: 'Doe',
      raci: null,
      email: null,
    });
    await run('update_contact', { contactId: CONTACT_ID, email: null, raci: null });
    expect(clientCoreMocks.updateContactCore).toHaveBeenCalledWith(ctx, {
      contactId: CONTACT_ID,
      email: null,
      raci: null,
    });
  });

  it('update_contact : échec core → message montrable', async () => {
    clientCoreMocks.updateContactCore.mockResolvedValue({
      ok: false,
      message: 'Contact introuvable.',
    });
    const out = await run('update_contact', { contactId: CONTACT_ID, firstName: 'X' });
    expect(out).toBe('Échec : Contact introuvable.');
  });

  // ---------- delete_contact ---------------------------------------------------

  it('delete_contact est gated:true et wrappe deleteContactCore(ctx, { contactId })', async () => {
    const tool = getTool('delete_contact');
    expect(tool.gated).toBe(true);

    clientCoreMocks.deleteContactCore.mockResolvedValue({ ok: true });
    const ok = await run('delete_contact', { contactId: CONTACT_ID });
    expect(clientCoreMocks.deleteContactCore).toHaveBeenCalledWith(ctx, {
      contactId: CONTACT_ID,
    });
    expect(ok).toBe('Contact supprimé.');

    clientCoreMocks.deleteContactCore.mockResolvedValue({
      ok: false,
      message: 'Contact introuvable.',
    });
    const fail = await run('delete_contact', { contactId: CONTACT_ID });
    expect(fail).toBe('Échec : Contact introuvable.');
  });

  it('delete_contact : describeForConfirm re-valide l’input BRUT — {} ou id structuré → libellé prudent SANS aucun appel DB', async () => {
    const describe = getTool('delete_contact').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;

    const empty = await describe({});
    expect(empty).toBe('Supprimer un contact introuvable dans ce workspace ?');
    expect(prismaMocks.contact.findFirst).not.toHaveBeenCalled();
    expect(scopeMocks.loadUserScope).not.toHaveBeenCalled();

    const structured = await describe({ contactId: { not: null } });
    expect(structured).toBe('Supprimer un contact introuvable dans ce workspace ?');
    expect(prismaMocks.contact.findFirst).not.toHaveBeenCalled();
  });

  it('delete_contact : describeForConfirm applique le scope restricted (join client) — hors scope → « introuvable », nom réel jamais présent', async () => {
    const describe = getTool('delete_contact').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['scope-c1'],
      projectIds: [],
    });
    scopeMocks.scopedClientWhere.mockReturnValueOnce({ id: { in: ['scope-c1'] } });
    prismaMocks.contact.findFirst.mockResolvedValueOnce(null);

    const out = await describe({ contactId: CONTACT_ID });

    expect(prismaMocks.contact.findFirst).toHaveBeenCalledWith({
      where: {
        id: CONTACT_ID,
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        client: {
          AND: [{ workspaceId: ctx.workspaceId, deletedAt: null }, { id: { in: ['scope-c1'] } }],
        },
      },
      select: { firstName: true, lastName: true, client: { select: { name: true } } },
    });
    expect(out).toBe('Supprimer un contact introuvable dans ce workspace ?');
    expect(out).not.toContain('Jane');
  });

  it('delete_contact : describeForConfirm lit prénom/nom + client réels en DB', async () => {
    const describe = getTool('delete_contact').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.contact.findFirst.mockResolvedValueOnce({
      firstName: 'Jane',
      lastName: 'Doe',
      client: { name: 'Acme' },
    });
    const out = await describe({ contactId: CONTACT_ID });
    expect(out).toBe('Supprimer le contact « Jane Doe » (client « Acme ») ?');
  });

  // ---------- set_contact_raci ---------------------------------------------------

  it('set_contact_raci : transmet {contactId, raci} à updateContactCore et renvoie le raci relu', async () => {
    clientCoreMocks.updateContactCore.mockResolvedValue({
      ok: true,
      firstName: 'Jane',
      lastName: 'Doe',
      raci: 'informed',
      email: null,
    });
    const out = await run('set_contact_raci', { contactId: CONTACT_ID, raci: 'informed' });
    expect(clientCoreMocks.updateContactCore).toHaveBeenCalledWith(ctx, {
      contactId: CONTACT_ID,
      raci: 'informed',
    });
    expect(JSON.parse(out)).toEqual({ updated: true, raci: 'informed' });
  });

  it('set_contact_raci : raci:null efface le RACI', async () => {
    clientCoreMocks.updateContactCore.mockResolvedValue({
      ok: true,
      firstName: 'Jane',
      lastName: 'Doe',
      raci: null,
      email: null,
    });
    const out = await run('set_contact_raci', { contactId: CONTACT_ID, raci: null });
    expect(clientCoreMocks.updateContactCore).toHaveBeenCalledWith(ctx, {
      contactId: CONTACT_ID,
      raci: null,
    });
    expect(JSON.parse(out)).toEqual({ updated: true, raci: null });
  });

  it('set_contact_raci : échec core → message montrable', async () => {
    clientCoreMocks.updateContactCore.mockResolvedValue({
      ok: false,
      message: 'Contact introuvable.',
    });
    const out = await run('set_contact_raci', { contactId: CONTACT_ID, raci: 'responsible' });
    expect(out).toBe('Échec : Contact introuvable.');
  });
});
