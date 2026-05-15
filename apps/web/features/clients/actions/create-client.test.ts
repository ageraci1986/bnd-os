import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  clientCreate,
  workspaceAccessFindMany,
  requireUserMock,
  assertCsrfMock,
  revalidatePathMock,
  FakePrismaP2002,
} = vi.hoisted(() => {
  class FakePrismaP2002 extends Error {
    override readonly name = 'PrismaClientKnownRequestError';
    readonly code = 'P2002';
    readonly clientVersion = 'test';
    readonly meta = { target: ['workspace_id', 'name'] };
  }
  return {
    clientCreate: vi.fn(),
    workspaceAccessFindMany: vi.fn(),
    requireUserMock: vi.fn(),
    assertCsrfMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    FakePrismaP2002,
  };
});

vi.mock('@nexushub/db', () => ({
  prisma: {
    client: { create: clientCreate },
    workspaceAccess: { findMany: workspaceAccessFindMany },
  },
  Prisma: { PrismaClientKnownRequestError: FakePrismaP2002 },
}));
vi.mock('@/lib/auth', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: assertCsrfMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { createClient } from './create-client';

beforeEach(() => {
  clientCreate.mockReset();
  workspaceAccessFindMany.mockReset();
  requireUserMock.mockReset();
  assertCsrfMock.mockReset();
  revalidatePathMock.mockReset();
  requireUserMock.mockResolvedValue({
    userId: 'user-1',
    workspaceId: 'ws-1',
    role: 'user',
    isSuperAdmin: false,
  });
  // Empty array → scopeFromRows([]) → { kind: 'workspace' } → no-op for scope check.
  workspaceAccessFindMany.mockResolvedValue([]);
});

interface ClientFormOverrides {
  name?: string;
  colorToken?: string;
  initials?: string;
  domains?: string;
  notes?: string;
}

function buildForm(overrides: ClientFormOverrides = {}): FormData {
  const fd = new FormData();
  fd.set('name', overrides.name ?? 'Acme Brands');
  fd.set('colorToken', overrides.colorToken ?? 'c-acme');
  fd.set('initials', overrides.initials ?? '');
  fd.set('domains', overrides.domains ?? '');
  if (overrides.notes !== undefined) fd.set('notes', overrides.notes);
  return fd;
}

describe('createClient', () => {
  it('creates the client + revalidates and returns the slug', async () => {
    clientCreate.mockResolvedValue({ id: 'new-id', name: 'Acme Brands' });

    const result = await createClient({ status: 'idle' }, buildForm());

    expect(result).toEqual({
      status: 'success',
      clientId: 'new-id',
      slug: 'acme-brands',
    });
    expect(clientCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'ws-1',
        name: 'Acme Brands',
        colorToken: 'c-acme',
        initials: 'AB',
        domains: [],
        notes: null,
      }),
      select: { id: true, name: true },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/clients');
  });

  it('surfaces a friendly French message when the unique constraint fires (P2002)', async () => {
    clientCreate.mockRejectedValue(new FakePrismaP2002());

    const result = await createClient({ status: 'idle' }, buildForm());

    expect(result).toEqual({
      status: 'error',
      message: 'Un client porte déjà ce nom.',
    });
  });

  it('returns an error without touching Prisma when the colorToken is invalid', async () => {
    const result = await createClient({ status: 'idle' }, buildForm({ colorToken: 'c-bogus' }));
    expect(result.status).toBe('error');
    expect(clientCreate).not.toHaveBeenCalled();
  });
});
