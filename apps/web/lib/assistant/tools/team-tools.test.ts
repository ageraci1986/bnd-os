import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolSpec } from '@nexushub/agent';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock functions themselves must be created via `vi.hoisted` — repo
// convention (see client-tools.test.ts, kanban-tools.test.ts).
const teamCoreMocks = vi.hoisted(() => ({
  inviteMemberCore: vi.fn(),
  changeMemberRoleCore: vi.fn(),
  removeMemberCore: vi.fn(),
}));
vi.mock('@/features/team/lib/team-core', () => teamCoreMocks);

// `membership.findUnique` : lookup véridique des `describeForConfirm` gated
// (change_member_role, remove_member) — anti-spoofing, voir types.ts.
const prismaMocks = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMocks }));

import { buildTeamTools } from './team-tools';

// `ctx.userId` DOIT être un UUID valide : `change_member_role`/`remove_member`
// valident `userId` via `z.string().uuid()`, et les tests "vous-même" ci-dessous
// comparent `input.userId === ctx.userId` — un id non-UUID ferait échouer le
// safeParse avant même d'atteindre la comparaison, invalidant ces cas.
const ctx = {
  userId: '4c9d3f0a-1111-4444-8888-cccccccccccc',
  email: 'a@b.c',
  workspaceId: 'w1',
  role: 'admin' as const,
  isSuperAdmin: false,
};

const TARGET_USER_ID = '4c9d3f0a-2222-4444-8888-aaaaaaaaaaaa';

function tools(): ToolSpec[] {
  return buildTeamTools(ctx);
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

describe('buildTeamTools', () => {
  it('expose les 3 tools, TOUS adminOnly ET gated', () => {
    const list = tools();
    expect(list.map((t) => t.name).sort()).toEqual([
      'change_member_role',
      'invite_member',
      'remove_member',
    ]);
    expect(list.every((t) => t.adminOnly)).toBe(true);
    expect(list.every((t) => t.gated)).toBe(true);
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

  // ---------- invite_member ---------------------------------------------------

  it('invite_member : délègue à inviteMemberCore, renvoie {invited,email,role} relus sur succès', async () => {
    teamCoreMocks.inviteMemberCore.mockResolvedValue({
      ok: true,
      email: 'bob@x.com',
      role: 'user',
    });
    const out = await run('invite_member', { email: '  Bob@X.com ', role: 'user' });
    expect(teamCoreMocks.inviteMemberCore).toHaveBeenCalledWith(ctx, {
      email: '  Bob@X.com ',
      role: 'user',
    });
    expect(JSON.parse(out)).toEqual({ invited: true, email: 'bob@x.com', role: 'user' });
  });

  it('invite_member : échec core (déjà membre) → message montrable', async () => {
    teamCoreMocks.inviteMemberCore.mockResolvedValue({
      ok: false,
      message: 'Cette personne est déjà membre de l’espace.',
    });
    const out = await run('invite_member', { email: 'bob@x.com', role: 'user' });
    expect(out).toBe('Échec : Cette personne est déjà membre de l’espace.');
  });

  it('invite_member : schéma refuse le rôle viewer', () => {
    const schema = getTool('invite_member').inputSchema as z.ZodTypeAny;
    expect(schema.safeParse({ email: 'bob@x.com', role: 'viewer' }).success).toBe(false);
    expect(schema.safeParse({ email: 'bob@x.com', role: 'admin' }).success).toBe(true);
  });

  it('invite_member : describeForConfirm — input brut invalide → libellé prudent sans appel core/DB', () => {
    const describe = getTool('invite_member').describeForConfirm as (
      input: unknown,
    ) => string | Promise<string>;

    // Le schéma du tool NE valide QUE trim/min(3)/max(254) — pas le format
    // email (`InviteEmailSchema` du core s'en charge et répond « Adresse
    // email invalide. » à l'exécution) ; ces cas restent structurellement
    // invalides pour le schéma du tool (champ manquant / mauvais type / trop
    // court).
    expect(describe({})).toBe('Inviter un membre ? (données invalides)');
    expect(describe({ role: 'user' })).toBe('Inviter un membre ? (données invalides)');
    expect(describe({ email: 'ab', role: 'user' })).toBe('Inviter un membre ? (données invalides)');
    expect(describe({ email: { not: null }, role: 'user' })).toBe(
      'Inviter un membre ? (données invalides)',
    );
    expect(teamCoreMocks.inviteMemberCore).not.toHaveBeenCalled();
    expect(prismaMocks.membership.findUnique).not.toHaveBeenCalled();
  });

  it('invite_member : describeForConfirm — email normalisé (trim+lowercase) affiché, comme le core l’enverra', () => {
    const describe = getTool('invite_member').describeForConfirm as (
      input: unknown,
    ) => string | Promise<string>;
    const out = describe({ email: '  Bob@X.com ', role: 'user' });
    expect(out).toContain('bob@x.com');
    expect(out).not.toContain('Bob@X.com ');
  });

  it('invite_member : describeForConfirm — rôle user, phrase standard', () => {
    const describe = getTool('invite_member').describeForConfirm as (
      input: unknown,
    ) => string | Promise<string>;
    const out = describe({ email: 'bob@x.com', role: 'user' });
    expect(out).toBe(
      "Inviter bob@x.com comme membre ? Un email d'invitation (valide 72 h) lui sera envoyé ; toute invitation en attente pour cette adresse sera remplacée.",
    );
  });

  it('invite_member : describeForConfirm — rôle admin, mention accès complet', () => {
    const describe = getTool('invite_member').describeForConfirm as (
      input: unknown,
    ) => string | Promise<string>;
    const out = describe({ email: 'bob@x.com', role: 'admin' });
    expect(out).toContain('ADMINISTRATEUR');
    expect(out).toContain('accès complet');
    expect(out).toContain('bob@x.com');
  });

  // ---------- change_member_role ----------------------------------------------

  it('change_member_role : délègue à changeMemberRoleCore, renvoie {updated,role} relu sur succès', async () => {
    teamCoreMocks.changeMemberRoleCore.mockResolvedValue({ ok: true, role: 'admin' });
    const out = await run('change_member_role', { userId: TARGET_USER_ID, role: 'admin' });
    expect(teamCoreMocks.changeMemberRoleCore).toHaveBeenCalledWith(ctx, {
      userId: TARGET_USER_ID,
      role: 'admin',
    });
    expect(JSON.parse(out)).toEqual({ updated: true, role: 'admin' });
  });

  it('change_member_role : échec core (dernier Admin) → message montrable', async () => {
    teamCoreMocks.changeMemberRoleCore.mockResolvedValue({
      ok: false,
      message: 'Impossible : ce membre est le dernier Admin de l’espace.',
    });
    const out = await run('change_member_role', { userId: TARGET_USER_ID, role: 'user' });
    expect(out).toBe('Échec : Impossible : ce membre est le dernier Admin de l’espace.');
  });

  it('change_member_role : describeForConfirm — input brut invalide → libellé prudent SANS aucun appel DB', async () => {
    const describe = getTool('change_member_role').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;

    const empty = await describe({});
    expect(empty).toBe("Changer le rôle d'un membre introuvable dans ce workspace ?");
    expect(prismaMocks.membership.findUnique).not.toHaveBeenCalled();

    const structured = await describe({ userId: { not: null }, role: 'admin' });
    expect(structured).toBe("Changer le rôle d'un membre introuvable dans ce workspace ?");
    expect(prismaMocks.membership.findUnique).not.toHaveBeenCalled();
  });

  it('change_member_role : describeForConfirm — membre introuvable en DB → libellé prudent', async () => {
    const describe = getTool('change_member_role').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.membership.findUnique.mockResolvedValueOnce(null);

    const out = await describe({ userId: TARGET_USER_ID, role: 'admin' });
    expect(prismaMocks.membership.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'w1', userId: TARGET_USER_ID } },
      select: { role: true, user: { select: { firstName: true } } },
    });
    expect(out).toBe("Changer le rôle d'un membre introuvable dans ce workspace ?");
  });

  it('change_member_role : describeForConfirm — cas normal, lit le rôle actuel + prénom réels en DB', async () => {
    const describe = getTool('change_member_role').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.membership.findUnique.mockResolvedValueOnce({
      role: 'user',
      user: { firstName: 'Alice' },
    });
    const out = await describe({ userId: TARGET_USER_ID, role: 'viewer' });
    expect(out).toBe('Changer le rôle de Alice : User → Viewer ?');
  });

  it('change_member_role : describeForConfirm — nouveau rôle admin → mention accès complet', async () => {
    const describe = getTool('change_member_role').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.membership.findUnique.mockResolvedValueOnce({
      role: 'user',
      user: { firstName: 'Alice' },
    });
    const out = await describe({ userId: TARGET_USER_ID, role: 'admin' });
    expect(out).toBe(
      'Changer le rôle de Alice : User → Admin ? Ce membre aura un accès administrateur complet.',
    );
  });

  it('change_member_role : describeForConfirm — prénom absent en DB → libellé de repli neutre', async () => {
    const describe = getTool('change_member_role').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.membership.findUnique.mockResolvedValueOnce({
      role: 'user',
      user: { firstName: null },
    });
    const out = await describe({ userId: TARGET_USER_ID, role: 'admin' });
    expect(out).toContain('ce membre');
  });

  it('change_member_role : describeForConfirm — auto-modification (userId === ctx.userId) → phrase spécifique', async () => {
    const describe = getTool('change_member_role').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.membership.findUnique.mockResolvedValueOnce({
      role: 'admin',
      user: { firstName: 'Moi' },
    });
    const out = await describe({ userId: ctx.userId, role: 'user' });
    expect(out).toBe(
      "Changer VOTRE PROPRE rôle : Admin → User ? Vous perdrez vos outils d'administration à la fin de ce tour.",
    );
    // Le prénom (même connu) n'apparaît pas dans la phrase auto-modification.
    expect(out).not.toContain('Moi');
  });

  // ---------- remove_member ----------------------------------------------------

  it('remove_member : délègue à removeMemberCore, message fixe sur succès', async () => {
    teamCoreMocks.removeMemberCore.mockResolvedValue({ ok: true });
    const out = await run('remove_member', { userId: TARGET_USER_ID });
    expect(teamCoreMocks.removeMemberCore).toHaveBeenCalledWith(ctx, { userId: TARGET_USER_ID });
    expect(out).toBe("Membre retiré de l'espace.");
  });

  it('remove_member : échec core (dernier Admin) → message montrable', async () => {
    teamCoreMocks.removeMemberCore.mockResolvedValue({
      ok: false,
      message: 'Impossible : ce membre est le dernier Admin de l’espace.',
    });
    const out = await run('remove_member', { userId: TARGET_USER_ID });
    expect(out).toBe('Échec : Impossible : ce membre est le dernier Admin de l’espace.');
  });

  it('remove_member : describeForConfirm — input brut invalide → libellé prudent SANS aucun appel DB', async () => {
    const describe = getTool('remove_member').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;

    const empty = await describe({});
    expect(empty).toBe("Retirer un membre introuvable de l'espace de travail ?");
    expect(prismaMocks.membership.findUnique).not.toHaveBeenCalled();

    const structured = await describe({ userId: { not: null } });
    expect(structured).toBe("Retirer un membre introuvable de l'espace de travail ?");
    expect(prismaMocks.membership.findUnique).not.toHaveBeenCalled();
  });

  it('remove_member : describeForConfirm — membre introuvable en DB → libellé prudent', async () => {
    const describe = getTool('remove_member').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.membership.findUnique.mockResolvedValueOnce(null);

    const out = await describe({ userId: TARGET_USER_ID });
    expect(out).toBe("Retirer un membre introuvable de l'espace de travail ?");
  });

  it('remove_member : describeForConfirm — cas normal, lit prénom + rôle réels en DB', async () => {
    const describe = getTool('remove_member').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    prismaMocks.membership.findUnique.mockResolvedValueOnce({
      role: 'user',
      user: { firstName: 'Alice' },
    });
    const out = await describe({ userId: TARGET_USER_ID });
    expect(prismaMocks.membership.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'w1', userId: TARGET_USER_ID } },
      select: { role: true, user: { select: { firstName: true } } },
    });
    expect(out).toBe("Retirer Alice (User) de l'espace de travail ?");
  });

  it('remove_member : describeForConfirm — vous-même (userId === ctx.userId) → phrase déclarative, SANS lookup DB', async () => {
    const describe = getTool('remove_member').describeForConfirm as (
      input: unknown,
    ) => Promise<string>;
    const out = await describe({ userId: ctx.userId });
    expect(out).toBe("Vous ne pouvez pas vous retirer vous-même — l'action sera refusée.");
    expect(out).not.toContain('?');
    expect(prismaMocks.membership.findUnique).not.toHaveBeenCalled();
  });
});
