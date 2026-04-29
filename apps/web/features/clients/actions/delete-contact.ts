'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
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
