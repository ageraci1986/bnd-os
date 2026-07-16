import { describe, it, expect, vi, beforeEach } from 'vitest';

const upload = vi.hoisted(() => vi.fn());
const createSignedUrl = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({
    storage: {
      from: () => ({ upload, createSignedUrl, remove }),
    },
  }),
}));

import {
  uploadMailAttachment,
  getMailAttachmentSignedUrl,
  deleteMailAttachment,
} from './mail-attachment-storage';

beforeEach(() => vi.clearAllMocks());

describe('uploadMailAttachment', () => {
  it('uploads with the workspace-scoped path + returns storagePath', async () => {
    upload.mockResolvedValueOnce({ data: { path: 'w1/att-uuid' }, error: null });
    const r = await uploadMailAttachment({
      workspaceId: 'w1',
      attachmentId: 'att-uuid',
      contentType: 'application/pdf',
      binary: Buffer.from('x'),
    });
    expect(r).toEqual({ ok: true, storagePath: 'w1/att-uuid' });
    expect(upload).toHaveBeenCalledWith('w1/att-uuid', expect.any(Buffer), {
      contentType: 'application/pdf',
      upsert: false,
    });
  });

  it('returns error on Storage failure', async () => {
    upload.mockResolvedValueOnce({ data: null, error: { message: 'quota exceeded' } });
    const r = await uploadMailAttachment({
      workspaceId: 'w1',
      attachmentId: 'att-uuid',
      contentType: 'application/pdf',
      binary: Buffer.from('x'),
    });
    expect(r).toEqual({ ok: false, message: expect.any(String) });
  });
});

describe('getMailAttachmentSignedUrl', () => {
  it('returns the signed URL with a 300s TTL', async () => {
    createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://…/att?token=…' },
      error: null,
    });
    const r = await getMailAttachmentSignedUrl('w1/att-uuid');
    expect(r).toEqual({ ok: true, signedUrl: 'https://…/att?token=…' });
    expect(createSignedUrl).toHaveBeenCalledWith('w1/att-uuid', 300);
  });
});

describe('deleteMailAttachment', () => {
  it('swallows errors thrown by the Storage client', async () => {
    remove.mockRejectedValueOnce(new Error('network down'));
    await expect(deleteMailAttachment('w1/att-uuid')).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(['w1/att-uuid']);
  });
});
