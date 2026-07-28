'use server';
import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';

// Asymétrie assumée avec `mail-state-core.ts` (Plan 5b Task 7) : cette action
// UI est mono-mail et workspace-scopée (n'importe quel membre du workspace
// peut marquer lu un mail qu'il voit), alors que le core bulk de l'assistant
// est owner-only (integration.ownerUserId) — décision produit V2 sur les
// mutations mail. Ne pas aligner l'un sur l'autre sans revalidation produit.

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
    await prisma.emailMessage.update({
      where: { id: parsed.data.emailId, workspaceId: ctx.workspaceId },
      data: { isRead: true },
    });
    return { ok: true };
  } catch {
    return { ok: false, message: 'Mail introuvable.' };
  }
}
