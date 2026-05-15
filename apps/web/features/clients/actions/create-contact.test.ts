import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  clientFindFirst,
  contactCreate,
  workspaceAccessFindMany,
  requireUserMock,
  assertCsrfMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  clientFindFirst: vi.fn(),
  contactCreate: vi.fn(),
  workspaceAccessFindMany: vi.fn(),
  requireUserMock: vi.fn(),
  assertCsrfMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    client: { findFirst: clientFindFirst },
    contact: { create: contactCreate },
    workspaceAccess: { findMany: workspaceAccessFindMany },
  },
}));
vi.mock('@/lib/auth', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/csrf', () => ({ assertCsrfFromFormData: assertCsrfMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { createContact } from './create-contact';
import { NotFoundError } from '@nexushub/domain';

const VALID_CLIENT = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  clientFindFirst.mockReset();
  contactCreate.mockReset();
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

interface ContactFormOverrides {
  clientId?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  raci?: string;
  notes?: string;
}

function buildForm(overrides: ContactFormOverrides = {}): FormData {
  const fd = new FormData();
  fd.set('clientId', overrides.clientId ?? VALID_CLIENT);
  fd.set('firstName', overrides.firstName ?? 'Anna');
  fd.set('lastName', overrides.lastName ?? 'Lambert');
  if (overrides.jobTitle !== undefined) fd.set('jobTitle', overrides.jobTitle);
  if (overrides.email !== undefined) fd.set('email', overrides.email);
  if (overrides.phone !== undefined) fd.set('phone', overrides.phone);
  if (overrides.raci !== undefined) fd.set('raci', overrides.raci);
  if (overrides.notes !== undefined) fd.set('notes', overrides.notes);
  return fd;
}

describe('createContact', () => {
  it('throws NotFoundError when the clientId belongs to another workspace', async () => {
    // Prisma scoped lookup returns nothing → defence in depth on top of RLS.
    clientFindFirst.mockResolvedValue(null);

    await expect(createContact({ status: 'idle' }, buildForm())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(contactCreate).not.toHaveBeenCalled();
  });

  it('creates the contact with normalised email + null defaults for empty fields', async () => {
    clientFindFirst.mockResolvedValue({ id: VALID_CLIENT });
    contactCreate.mockResolvedValue({ id: 'contact-1' });

    const result = await createContact(
      { status: 'idle' },
      buildForm({ email: 'Anna@Acme.COM', raci: 'consulted' }),
    );

    expect(result).toEqual({ status: 'success', contactId: 'contact-1' });
    expect(contactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'ws-1',
        clientId: VALID_CLIENT,
        firstName: 'Anna',
        lastName: 'Lambert',
        email: 'anna@acme.com',
        raci: 'consulted',
        jobTitle: null,
        phone: null,
        notes: null,
      }),
      select: { id: true },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/clients');
  });

  it('rejects an empty first name before hitting the workspace lookup', async () => {
    const result = await createContact({ status: 'idle' }, buildForm({ firstName: '   ' }));
    expect(result).toEqual({ status: 'error', message: 'Prénom requis' });
    expect(clientFindFirst).not.toHaveBeenCalled();
  });
});
