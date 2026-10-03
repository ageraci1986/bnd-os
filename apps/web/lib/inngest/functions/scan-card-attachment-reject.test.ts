import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  updateMany: vi.fn(),
  auditCreate: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@nexushub/db', () => ({
  prisma: {
    cardAttachment: { updateMany: m.updateMany },
    auditLog: { create: m.auditCreate },
  },
}));
vi.mock('@/lib/card-attachment-storage', () => ({
  downloadCardAttachment: vi.fn(),
  statCardAttachment: vi.fn(),
  removeCardAttachment: m.remove,
}));
vi.mock('@/lib/env', () => ({ getServerEnv: () => ({}) }));
vi.mock('../client', () => ({
  inngestClient: { createFunction: () => ({}) },
}));

import { rejectCardAttachment, type ScanRow } from './scan-card-attachment';

const ID = '77777777-7777-7777-7777-777777777777';
const WS = '11111111-1111-1111-1111-111111111111';
const ROW: ScanRow = {
  id: ID,
  workspaceId: WS,
  filename: 'evil.pdf',
  storagePath: `${WS}/card/${ID}`,
  contentType: 'application/pdf',
  sizeBytes: 10,
  scanStatus: 'pending',
};

beforeEach(() => {
  vi.resetAllMocks();
  m.updateMany.mockResolvedValue({ count: 1 });
  m.auditCreate.mockResolvedValue({});
  m.remove.mockResolvedValue(undefined);
});

describe('rejectCardAttachment (prod reject)', () => {
  it('flips the row conditionally on pending FIRST, then removes the object and audits', async () => {
    const order: string[] = [];
    m.updateMany.mockImplementation(async () => {
      order.push('update');
      return { count: 1 };
    });
    m.remove.mockImplementation(async () => {
      order.push('remove');
    });
    m.auditCreate.mockImplementation(async () => {
      order.push('audit');
      return {};
    });
    await rejectCardAttachment({
      row: ROW,
      status: 'dirty',
      reason: 'type_spoof',
      sha256: null,
      engines: [],
    });
    expect(order).toEqual(['update', 'remove', 'audit']);
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: ID, workspaceId: WS, scanStatus: 'pending' },
      data: { scanStatus: 'dirty', sha256: null, scanReport: { reason: 'type_spoof' } },
    });
    expect(m.remove).toHaveBeenCalledWith(ROW.storagePath);
    const audit = m.auditCreate.mock.calls[0]![0].data;
    expect(audit.action).toBe('card_attachment_rejected');
    expect(JSON.stringify(audit)).not.toContain('evil.pdf');
  });

  it('is a no-op when the row is no longer pending (race: already clean/deleted)', async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    await rejectCardAttachment({
      row: ROW,
      status: 'scan_failed',
      reason: 'scanner_error',
      sha256: null,
      engines: [],
    });
    // Objet d'une PJ devenue `clean` conservé ; aucun audit trompeur.
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it('keeps the filename in the audit only for a virus', async () => {
    await rejectCardAttachment({
      row: ROW,
      status: 'dirty',
      reason: 'virus',
      sha256: 'abc',
      engines: ['ClamAV: Eicar'],
    });
    expect(m.auditCreate.mock.calls[0]![0].data.data).toMatchObject({
      filename: 'evil.pdf',
      detectingEngines: ['ClamAV: Eicar'],
    });
  });
});
