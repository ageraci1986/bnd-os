import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cardFindFirst: vi.fn(),
  attachmentFindMany: vi.fn(),
  loadUserScope: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    card: { findFirst: mocks.cardFindFirst },
    cardAttachment: { findMany: mocks.attachmentFindMany },
  },
}));
vi.mock('@/lib/auth/scope', () => ({ loadUserScope: mocks.loadUserScope }));

import type { AuthContext } from '@/lib/auth';
import {
  canDeleteAttachment,
  listCardAttachmentDTOs,
  loadAccessibleCard,
} from './card-attachment-core';

const WS = '11111111-1111-1111-1111-111111111111';
const CARD = '22222222-2222-2222-2222-222222222222';
const PROJECT = '33333333-3333-3333-3333-333333333333';
const CLIENT = '44444444-4444-4444-4444-444444444444';
const ME = '55555555-5555-5555-5555-555555555555';
const OTHER = '66666666-6666-6666-6666-666666666666';

function ctx(role: AuthContext['role'] = 'user', userId = ME): AuthContext {
  return { userId, email: 'me@test', workspaceId: WS, role, isSuperAdmin: false };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadUserScope.mockResolvedValue({ kind: 'workspace' });
  mocks.cardFindFirst.mockResolvedValue({
    id: CARD,
    projectId: PROJECT,
    project: { clientId: CLIENT },
  });
});

describe('loadAccessibleCard', () => {
  it('scopes the lookup to the caller workspace and excludes deleted cards', async () => {
    const res = await loadAccessibleCard(ctx(), CARD);
    expect(res).toEqual({ id: CARD, projectId: PROJECT });
    expect(mocks.cardFindFirst.mock.calls[0]![0].where).toEqual({
      id: CARD,
      workspaceId: WS,
      deletedAt: null,
    });
  });

  it('returns null when the card is not in the workspace', async () => {
    mocks.cardFindFirst.mockResolvedValue(null);
    expect(await loadAccessibleCard(ctx(), CARD)).toBeNull();
  });

  it('refuses a restricted scope that covers neither project nor client', async () => {
    mocks.loadUserScope.mockResolvedValue({
      kind: 'restricted',
      projectIds: ['other-project'],
      clientIds: ['other-client'],
    });
    expect(await loadAccessibleCard(ctx(), CARD)).toBeNull();
  });

  it('allows a restricted scope through the project or the client', async () => {
    mocks.loadUserScope.mockResolvedValue({
      kind: 'restricted',
      projectIds: [],
      clientIds: [CLIENT],
    });
    expect(await loadAccessibleCard(ctx(), CARD)).toEqual({ id: CARD, projectId: PROJECT });
    mocks.loadUserScope.mockResolvedValue({
      kind: 'restricted',
      projectIds: [PROJECT],
      clientIds: [],
    });
    expect(await loadAccessibleCard(ctx(), CARD)).toEqual({ id: CARD, projectId: PROJECT });
  });
});

describe('canDeleteAttachment', () => {
  it('allows the author', () => {
    expect(canDeleteAttachment(ctx('user'), ME)).toBe(true);
  });
  it('allows an Admin on someone else’s attachment', () => {
    expect(canDeleteAttachment(ctx('admin'), OTHER)).toBe(true);
  });
  it('refuses a Member who is not the author', () => {
    expect(canDeleteAttachment(ctx('user'), OTHER)).toBe(false);
    expect(canDeleteAttachment(ctx('user'), null)).toBe(false);
  });
  it('refuses a Viewer, even on their own upload', () => {
    expect(canDeleteAttachment(ctx('viewer'), ME)).toBe(false);
  });
});

describe('listCardAttachmentDTOs', () => {
  it('queries visible statuses only, workspace-scoped, oldest first, and maps DTOs', async () => {
    const createdAt = new Date('2026-10-03T10:00:00Z');
    mocks.attachmentFindMany.mockResolvedValue([
      {
        id: 'a1',
        filename: 'brief.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1234,
        scanStatus: 'clean',
        createdAt,
        uploadedById: ME,
        uploadedBy: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@test' },
      },
      {
        id: 'a2',
        filename: 'photo.png',
        contentType: 'image/png',
        sizeBytes: 99,
        scanStatus: 'pending',
        createdAt,
        uploadedById: OTHER,
        uploadedBy: { firstName: null, lastName: null, email: 'other@test' },
      },
      {
        id: 'a3',
        filename: 'orphan.txt',
        contentType: 'text/plain',
        sizeBytes: 1,
        scanStatus: 'clean',
        createdAt,
        uploadedById: null,
        uploadedBy: null,
      },
    ]);

    const dtos = await listCardAttachmentDTOs(ctx('user'), CARD);

    const args = mocks.attachmentFindMany.mock.calls[0]![0];
    expect(args.where).toEqual({
      workspaceId: WS,
      cardId: CARD,
      scanStatus: { in: ['pending', 'clean'] },
    });
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
    expect(dtos).toEqual([
      {
        id: 'a1',
        filename: 'brief.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1234,
        scanStatus: 'clean',
        uploaderName: 'Ada Lovelace',
        createdAt: createdAt.toISOString(),
        canDelete: true,
      },
      expect.objectContaining({ id: 'a2', uploaderName: 'other@test', canDelete: false }),
      expect.objectContaining({ id: 'a3', uploaderName: null, canDelete: false }),
    ]);
  });

  it('marks every attachment deletable for an Admin and none for a Viewer', async () => {
    mocks.attachmentFindMany.mockResolvedValue([
      {
        id: 'a1',
        filename: 'x.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1,
        scanStatus: 'clean',
        createdAt: new Date(),
        uploadedById: OTHER,
        uploadedBy: null,
      },
    ]);
    expect((await listCardAttachmentDTOs(ctx('admin'), CARD))[0]!.canDelete).toBe(true);
    expect((await listCardAttachmentDTOs(ctx('viewer'), CARD))[0]!.canDelete).toBe(false);
  });
});
