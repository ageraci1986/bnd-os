import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(async () => ({ userId: 'u', workspaceId: 'w' })),
}));

const updateMany = vi.hoisted(() => vi.fn());
const auditCreate = vi.hoisted(() => vi.fn());
vi.mock('@nexushub/db', () => ({
  prisma: {
    integration: { updateMany },
    auditLog: { create: auditCreate },
  },
}));

import { updateSignature } from './update-signature';

describe('updateSignature', () => {
  it('rejects when the integration is not owned', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await updateSignature({
      integrationId: '00000000-0000-0000-0000-000000000000',
      signatureHtml: '<p>Sig</p>',
    });
    expect(r).toEqual({ ok: false, message: expect.any(String) });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('sanitizes + saves + audits on happy path', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    const r = await updateSignature({
      integrationId: '00000000-0000-0000-0000-000000000000',
      signatureHtml: '<p>Sig</p><script>bad</script>',
    });
    expect(r).toEqual({ ok: true });
    const data = updateMany.mock.calls[0]?.[0] as { data: { signatureHtml: string | null } };
    expect(data.data.signatureHtml).toContain('<p>Sig</p>');
    expect(data.data.signatureHtml).not.toContain('<script>');
    expect(auditCreate).toHaveBeenCalledOnce();
  });
});
