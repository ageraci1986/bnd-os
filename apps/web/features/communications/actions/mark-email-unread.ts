'use server';
import 'server-only';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { setMailStateCore } from '@/features/communications/lib/mail-state-core';

// Délègue au core bulk owner-only (integration.ownerUserId) : un mail d'une
// boîte d'un autre membre renvoie `affected: 0` silencieusement plutôt
// qu'une erreur. `markEmailRead` applique le même scope propriétaire (aligné
// le 2026-11-10) mais sans passer par le core — voir son commentaire.

const Schema = z.object({ emailId: z.string().uuid() });

export type MarkEmailUnreadResult =
  | { readonly ok: true; readonly affected: number }
  | { readonly ok: false; readonly message: string };

export async function markEmailUnread(input: {
  readonly emailId: string;
}): Promise<MarkEmailUnreadResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant invalide.' };
  const ctx = await requireUser();
  const result = await setMailStateCore(ctx, {
    mailIds: [parsed.data.emailId],
    op: 'unread',
  });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, affected: result.affected };
}
