import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserScope } from '@nexushub/domain';

// `vi.mock` factories are hoisted above regular top-level statements, so the
// mock object itself must be created via `vi.hoisted` — repo convention, see
// `apps/web/features/projects/lib/project-core.test.ts` and `card-core.test.ts`.
const prismaMock = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    client: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    contact: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
    Prisma: { PrismaClientKnownRequestError },
  };
});
vi.mock('@nexushub/db', () => ({
  prisma: {
    client: prismaMock.client,
    contact: prismaMock.contact,
    $transaction: prismaMock.$transaction,
  },
  Prisma: prismaMock.Prisma,
}));

const scopeMocks = vi.hoisted(() => ({
  loadUserScope: vi.fn<() => Promise<UserScope>>(async () => ({ kind: 'workspace' as const })),
}));
vi.mock('@/lib/auth/scope', () => scopeMocks);

const auditMocks = vi.hoisted(() => ({
  recordAudit: vi.fn(async (_entry: unknown) => undefined),
}));
vi.mock('@/lib/audit', () => auditMocks);

import {
  createClientCore,
  createContactCore,
  deleteClientCore,
  deleteContactCore,
  updateClientCore,
  updateContactCore,
} from './client-core';
import { SCOPE_ERROR_MESSAGE, VIEWER_READ_ONLY_MESSAGE } from '@/features/projects/lib/scope-error';
import { NotFoundError } from '@nexushub/domain';
import type { CreateClientInput, CreateContactInput } from './schemas';

const WORKSPACE_ID = 'ws-1';
const CLIENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONTACT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const adminCtx = {
  userId: 'u-1',
  email: 'admin@test',
  workspaceId: WORKSPACE_ID,
  role: 'admin' as const,
  isSuperAdmin: false,
};

const viewerCtx = { ...adminCtx, role: 'viewer' as const };

function makeP2002(): InstanceType<typeof prismaMock.Prisma.PrismaClientKnownRequestError> {
  return new prismaMock.Prisma.PrismaClientKnownRequestError('Unique constraint', 'P2002');
}
function makeP2025(): InstanceType<typeof prismaMock.Prisma.PrismaClientKnownRequestError> {
  return new prismaMock.Prisma.PrismaClientKnownRequestError('Record not found', 'P2025');
}

function baseCreateClientInput(overrides: Partial<CreateClientInput> = {}): CreateClientInput {
  return {
    name: 'Acme Brands',
    colorToken: 'c-acme',
    initials: 'AB',
    domains: [],
    notes: null,
    ...overrides,
  };
}

function baseCreateContactInput(overrides: Partial<CreateContactInput> = {}): CreateContactInput {
  return {
    clientId: CLIENT_ID,
    name: { firstName: 'Anna', lastName: 'Lambert' },
    jobTitle: null,
    email: null,
    phone: null,
    raci: null,
    notes: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  scopeMocks.loadUserScope.mockResolvedValue({ kind: 'workspace' as const });
  prismaMock.$transaction.mockResolvedValue([]);
});

// =====================================================================
// createClientCore
// =====================================================================

describe('createClientCore', () => {
  it('creates the client and returns ok with clientId/slug, audits client_created', async () => {
    prismaMock.client.create.mockResolvedValue({ id: 'new-id', name: 'Acme Brands' });

    const result = await createClientCore(adminCtx, baseCreateClientInput());

    expect(result).toEqual({ ok: true, clientId: 'new-id', slug: 'acme-brands' });
    expect(prismaMock.client.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        name: 'Acme Brands',
        colorToken: 'c-acme',
        initials: 'AB',
        domains: [],
        notes: null,
      }),
      select: { id: true, name: true },
    });
    expect(auditMocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_created',
        workspaceId: WORKSPACE_ID,
        actorId: 'u-1',
        subjectType: 'client',
        subjectId: 'new-id',
      }),
    );
    // No PII (name) leaked into audit data.
    const auditCall = auditMocks.recordAudit.mock.calls[0]![0] as { data?: unknown };
    expect(JSON.stringify(auditCall.data ?? {})).not.toContain('Acme Brands');
  });

  it('returns "Un client porte déjà ce nom." on P2002', async () => {
    prismaMock.client.create.mockRejectedValue(makeP2002());
    const result = await createClientCore(adminCtx, baseCreateClientInput());
    expect(result).toEqual({ ok: false, message: 'Un client porte déjà ce nom.' });
    expect(auditMocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no lookup', async () => {
    const result = await createClientCore(viewerCtx, baseCreateClientInput());
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.client.create).not.toHaveBeenCalled();
  });

  it('refuses restricted scope (top-level resource creation)', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: [],
      projectIds: [],
    });
    const result = await createClientCore(adminCtx, baseCreateClientInput());
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.client.create).not.toHaveBeenCalled();
  });
});

// =====================================================================
// updateClientCore
// =====================================================================

describe('updateClientCore', () => {
  beforeEach(() => {
    prismaMock.client.update.mockResolvedValue({ id: CLIENT_ID });
    prismaMock.client.findFirst.mockResolvedValue({
      name: 'Acme Renamed',
      colorToken: 'c-tech',
      initials: 'AR',
      domains: ['acme.com'],
      notes: 'Updated notes',
    });
  });

  it('updates only the provided fields and returns the re-read post-state', async () => {
    const result = await updateClientCore(adminCtx, { clientId: CLIENT_ID, name: 'Acme Renamed' });

    expect(prismaMock.client.update).toHaveBeenCalledWith({
      where: { id: CLIENT_ID, workspaceId: WORKSPACE_ID, deletedAt: null },
      data: { name: 'Acme Renamed' },
      select: { id: true },
    });
    expect(result).toEqual({
      ok: true,
      name: 'Acme Renamed',
      colorToken: 'c-tech',
      initials: 'AR',
      domains: ['acme.com'],
      notes: 'Updated notes',
    });
    expect(auditMocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_updated',
        workspaceId: WORKSPACE_ID,
        actorId: 'u-1',
        subjectType: 'client',
        subjectId: CLIENT_ID,
      }),
    );
  });

  it('returns "Un client porte déjà ce nom." on P2002', async () => {
    prismaMock.client.update.mockRejectedValue(makeP2002());
    const result = await updateClientCore(adminCtx, { clientId: CLIENT_ID, name: 'Dup' });
    expect(result).toEqual({ ok: false, message: 'Un client porte déjà ce nom.' });
    expect(auditMocks.recordAudit).not.toHaveBeenCalled();
  });

  it('throws NotFoundError("Client") on P2025', async () => {
    prismaMock.client.update.mockRejectedValue(makeP2025());
    await expect(
      updateClientCore(adminCtx, { clientId: CLIENT_ID, name: 'Gone' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no update', async () => {
    const result = await updateClientCore(viewerCtx, { clientId: CLIENT_ID, name: 'X' });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.client.update).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: [],
    });
    const result = await updateClientCore(adminCtx, { clientId: CLIENT_ID, name: 'X' });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.client.update).not.toHaveBeenCalled();
  });

  it('allows restricted scope that includes the client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: [CLIENT_ID],
      projectIds: [],
    });
    const result = await updateClientCore(adminCtx, { clientId: CLIENT_ID, name: 'X' });
    expect(result.ok).toBe(true);
  });
});

// =====================================================================
// deleteClientCore
// =====================================================================

describe('deleteClientCore', () => {
  beforeEach(() => {
    prismaMock.client.findFirst.mockResolvedValue({
      id: CLIENT_ID,
      _count: { projects: 0 },
    });
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no lookup', async () => {
    const result = await deleteClientCore(viewerCtx, { clientId: CLIENT_ID });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.client.findFirst).not.toHaveBeenCalled();
  });

  it('returns "Client introuvable." when the client lookup misses', async () => {
    prismaMock.client.findFirst.mockResolvedValueOnce(null);
    const result = await deleteClientCore(adminCtx, { clientId: CLIENT_ID });
    expect(result).toEqual({ ok: false, message: 'Client introuvable.' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('refuses deletion (ADR #14) when active projects remain — singular', async () => {
    prismaMock.client.findFirst.mockResolvedValueOnce({ id: CLIENT_ID, _count: { projects: 1 } });
    const result = await deleteClientCore(adminCtx, { clientId: CLIENT_ID });
    expect(result).toEqual({
      ok: false,
      message: 'Suppression impossible : 1 projet actif est encore attaché à ce client.',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('refuses deletion (ADR #14) when active projects remain — plural', async () => {
    prismaMock.client.findFirst.mockResolvedValueOnce({ id: CLIENT_ID, _count: { projects: 4 } });
    const result = await deleteClientCore(adminCtx, { clientId: CLIENT_ID });
    expect(result).toEqual({
      ok: false,
      message: 'Suppression impossible : 4 projets actifs sont encore attachés à ce client.',
    });
  });

  it('denies restricted scope that does not include the client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: [],
    });
    const result = await deleteClientCore(adminCtx, { clientId: CLIENT_ID });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('soft-deletes contacts then client in a single transaction, and audits with ip/userAgent when provided', async () => {
    const result = await deleteClientCore(adminCtx, {
      clientId: CLIENT_ID,
      ip: '203.0.113.1',
      userAgent: 'vitest-agent',
    });
    expect(result).toEqual({ ok: true });
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    const txArg = prismaMock.$transaction.mock.calls[0]![0] as unknown[];
    expect(txArg).toHaveLength(2);
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { clientId: CLIENT_ID, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prismaMock.client.update).toHaveBeenCalledWith({
      where: { id: CLIENT_ID },
      data: { deletedAt: expect.any(Date) },
    });
    // Order: contacts soft-delete queued before the client soft-delete.
    expect(prismaMock.contact.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.client.update.mock.invocationCallOrder[0]!,
    );
    expect(auditMocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'client_deleted',
        workspaceId: WORKSPACE_ID,
        actorId: 'u-1',
        subjectType: 'client',
        subjectId: CLIENT_ID,
        ip: '203.0.113.1',
        userAgent: 'vitest-agent',
      }),
    );
  });

  it('audits without ip/userAgent when the caller (e.g. an assistant tool) does not supply them', async () => {
    await deleteClientCore(adminCtx, { clientId: CLIENT_ID });
    const auditCall = auditMocks.recordAudit.mock.calls[0]![0] as {
      ip?: unknown;
      userAgent?: unknown;
    };
    expect(auditCall.ip ?? null).toBeNull();
    expect(auditCall.userAgent ?? null).toBeNull();
  });
});

// =====================================================================
// createContactCore
// =====================================================================

describe('createContactCore', () => {
  beforeEach(() => {
    prismaMock.client.findFirst.mockResolvedValue({ id: CLIENT_ID });
    prismaMock.contact.create.mockResolvedValue({ id: 'contact-1' });
  });

  it('creates the contact and audits contact_created (no PII in audit data)', async () => {
    const result = await createContactCore(adminCtx, baseCreateContactInput());
    expect(result).toEqual({ ok: true, contactId: 'contact-1' });
    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        clientId: CLIENT_ID,
        firstName: 'Anna',
        lastName: 'Lambert',
      }),
      select: { id: true },
    });
    expect(auditMocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contact_created',
        workspaceId: WORKSPACE_ID,
        actorId: 'u-1',
        subjectType: 'contact',
        subjectId: 'contact-1',
      }),
    );
    const auditCall = auditMocks.recordAudit.mock.calls[0]![0] as { data?: unknown };
    const serialized = JSON.stringify(auditCall.data ?? {});
    expect(serialized).not.toContain('Anna');
    expect(serialized).not.toContain('Lambert');
  });

  it('throws NotFoundError("Client") when the client is missing/out-of-workspace', async () => {
    prismaMock.client.findFirst.mockResolvedValueOnce(null);
    await expect(createContactCore(adminCtx, baseCreateContactInput())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no lookup', async () => {
    const result = await createContactCore(viewerCtx, baseCreateContactInput());
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.client.findFirst).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: [],
    });
    const result = await createContactCore(adminCtx, baseCreateContactInput());
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });
});

// =====================================================================
// updateContactCore
// =====================================================================

describe('updateContactCore', () => {
  beforeEach(() => {
    prismaMock.contact.findFirst
      .mockResolvedValueOnce({ id: CONTACT_ID, clientId: CLIENT_ID }) // scope lookup
      .mockResolvedValueOnce({
        firstName: 'Anna',
        lastName: 'Renamed',
        raci: 'responsible',
        email: 'anna@acme.com',
      }); // read-after-write
    prismaMock.contact.update.mockResolvedValue({ id: CONTACT_ID });
  });

  it('updates the provided fields (incl. raci) and returns the re-read post-state', async () => {
    const result = await updateContactCore(adminCtx, {
      contactId: CONTACT_ID,
      lastName: 'Renamed',
      raci: 'responsible',
    });
    expect(prismaMock.contact.update).toHaveBeenCalledWith({
      where: { id: CONTACT_ID, workspaceId: WORKSPACE_ID, deletedAt: null },
      data: { lastName: 'Renamed', raci: 'responsible' },
    });
    expect(result).toEqual({
      ok: true,
      firstName: 'Anna',
      lastName: 'Renamed',
      raci: 'responsible',
      email: 'anna@acme.com',
    });
    expect(auditMocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contact_updated',
        workspaceId: WORKSPACE_ID,
        actorId: 'u-1',
        subjectType: 'contact',
        subjectId: CONTACT_ID,
      }),
    );
  });

  it('accepts raci: null to clear the assignment', async () => {
    await updateContactCore(adminCtx, { contactId: CONTACT_ID, raci: null });
    expect(prismaMock.contact.update).toHaveBeenCalledWith({
      where: { id: CONTACT_ID, workspaceId: WORKSPACE_ID, deletedAt: null },
      data: { raci: null },
    });
  });

  it('returns "Contact introuvable." when the contact lookup misses', async () => {
    prismaMock.contact.findFirst.mockReset();
    prismaMock.contact.findFirst.mockResolvedValueOnce(null);
    const result = await updateContactCore(adminCtx, { contactId: CONTACT_ID, lastName: 'X' });
    expect(result).toEqual({ ok: false, message: 'Contact introuvable.' });
    expect(prismaMock.contact.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError("Contact") on P2025', async () => {
    prismaMock.contact.update.mockRejectedValueOnce(makeP2025());
    await expect(
      updateContactCore(adminCtx, { contactId: CONTACT_ID, lastName: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no lookup', async () => {
    const result = await updateContactCore(viewerCtx, { contactId: CONTACT_ID, lastName: 'X' });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.contact.findFirst).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the contact client', async () => {
    prismaMock.contact.findFirst.mockReset();
    prismaMock.contact.findFirst.mockResolvedValueOnce({ id: CONTACT_ID, clientId: CLIENT_ID });
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: [],
    });
    const result = await updateContactCore(adminCtx, { contactId: CONTACT_ID, lastName: 'X' });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.contact.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// deleteContactCore
// =====================================================================

describe('deleteContactCore', () => {
  beforeEach(() => {
    prismaMock.contact.findFirst.mockResolvedValue({ id: CONTACT_ID, clientId: CLIENT_ID });
    prismaMock.contact.updateMany.mockResolvedValue({ count: 1 });
  });

  it('soft-deletes the contact and audits contact_deleted', async () => {
    const result = await deleteContactCore(adminCtx, { contactId: CONTACT_ID });
    expect(result).toEqual({ ok: true });
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { id: CONTACT_ID, workspaceId: WORKSPACE_ID, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(auditMocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contact_deleted',
        workspaceId: WORKSPACE_ID,
        actorId: 'u-1',
        subjectType: 'contact',
        subjectId: CONTACT_ID,
      }),
    );
  });

  it('returns "Contact introuvable." when the contact lookup misses, no audit recorded', async () => {
    prismaMock.contact.findFirst.mockResolvedValueOnce(null);
    const result = await deleteContactCore(adminCtx, { contactId: CONTACT_ID });
    expect(result).toEqual({ ok: false, message: 'Contact introuvable.' });
    expect(prismaMock.contact.updateMany).not.toHaveBeenCalled();
    expect(auditMocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects Viewer with VIEWER_READ_ONLY_MESSAGE and performs no lookup', async () => {
    const result = await deleteContactCore(viewerCtx, { contactId: CONTACT_ID });
    expect(result).toEqual({ ok: false, message: VIEWER_READ_ONLY_MESSAGE });
    expect(prismaMock.contact.findFirst).not.toHaveBeenCalled();
  });

  it('denies restricted scope that does not include the contact client', async () => {
    scopeMocks.loadUserScope.mockResolvedValueOnce({
      kind: 'restricted' as const,
      clientIds: ['other-client'],
      projectIds: [],
    });
    const result = await deleteContactCore(adminCtx, { contactId: CONTACT_ID });
    expect(result).toEqual({ ok: false, message: SCOPE_ERROR_MESSAGE });
    expect(prismaMock.contact.updateMany).not.toHaveBeenCalled();
  });
});
