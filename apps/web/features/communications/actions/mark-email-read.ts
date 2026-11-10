'use server';
import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { ownedMailWhere } from '@/features/communications/lib/owned-mail-where';

// Owner-scoped (integration.ownerUserId), comme `markEmailUnread` et le core
// bulk de l'assistant : un membre ne peut marquer lu QUE les mails de ses
// propres boîtes. Correctif 2026-11-10 — l'ancienne asymétrie (marquage
// workspace-scopé) laissait un membre modifier l'état des mails d'un collègue
// et a été levée par décision produit : un mail n'appartient qu'à son
// propriétaire. Volontairement PAS délégué à `setMailStateCore` : ce dernier
// refuse le rôle Viewer et audite chaque appel, or ce toggle est déclenché à
// chaque ouverture de mail.

const Schema = z.object({ emailId: z.string().uuid() });

export type MarkEmailReadResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function markEmailRead(input: {
  readonly emailId: string;
}): Promise<MarkEmailReadResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant invalide.' };
  const ctx = await requireUser();
  try {
    const result = await prisma.emailMessage.updateMany({
      where: { id: parsed.data.emailId, ...ownedMailWhere(ctx) },
      data: { isRead: true },
    });
    if (result.count === 0) return { ok: false, message: 'Mail introuvable.' };
    return { ok: true };
  } catch {
    return { ok: false, message: 'Mail introuvable.' };
  }
}
