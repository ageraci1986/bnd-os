'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { DeleteContactSchema } from '../lib/schemas';
import { deleteContactCore } from '../lib/client-core';

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

  const result = await deleteContactCore(ctx, { contactId: parsed.data.contactId });
  if (!result.ok) {
    return { status: 'error', message: result.message };
  }

  revalidatePath('/clients');
  return { status: 'idle' };
}
