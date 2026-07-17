import { z } from 'zod';

// Mirrors the AttachmentDraft shape persisted in MailDraft.composeAttachments
// (JSONB array — see packages/db/prisma/schema.prisma MailDraft doc comment).
// `reprisedFromAttachmentId` marks entries carried over from a Forward (an
// existing EmailAttachment id) rather than a fresh compose-time upload — used
// downstream to skip a Storage delete on removal.
//
// Lives outside actions/ because Next.js `'use server'` files may only export
// async functions — value exports (schemas, constants) must live elsewhere.
export const attachmentDraftSchema = z.object({
  id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(25 * 1024 * 1024),
  storagePath: z.string().min(1),
  sha256: z.string().length(64),
  reprisedFromAttachmentId: z.string().uuid().optional(),
});

export type AttachmentDraft = z.infer<typeof attachmentDraftSchema>;
