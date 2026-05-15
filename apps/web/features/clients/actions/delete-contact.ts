'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { SCOPE_ERROR_MESSAGE } from '@/features/projects/lib/scope-error';
import { DeleteContactSchema } from '../lib/schemas';

export type DeleteContactState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string };

export async function deleteContact(
  _prev: DeleteContactState,
  formData: FormData,
): Promise<DeleteContactState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = DeleteContactSchema.safeParse({ contactId: formData.get('contactId') });
  if (!parsed.success) {
    return { status: 'error', message: 'Identifiant contact invalide.' };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: parsed.data.contactId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, clientId: true },
  });
  if (!contact) return { status: 'error', message: 'Contact introuvable.' };

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    const allowed = scope.clientIds.includes(contact.clientId);
    if (!allowed) return { status: 'error', message: SCOPE_ERROR_MESSAGE };
  }

  await prisma.contact.updateMany({
    where: {
      id: parsed.data.contactId,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });

  revalidatePath('/clients');
  return { status: 'idle' };
}
