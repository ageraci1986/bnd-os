'use server';
import 'server-only';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUserVerified } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { getClientIp } from '@/lib/rate-limit';
import { DeleteClientSchema } from '../lib/schemas';
import { deleteClientCore } from '../lib/client-core';

export type DeleteClientState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string };

/**
 * Soft-delete a client (PRD §10 #14): refused if any active project is
 * still attached. Contacts cascade-soft-delete via the same `deletedAt`
 * stamp so the count updates immediately in the sidebar.
 *
 * Thin Server Action wrapper: CSRF + auth + input validation + navigation
 * side effects. The checks + soft-delete + audit live in `deleteClientCore`
 * so the assistant's delete tool can reuse them without `redirect()`.
 */
export async function deleteClient(
  _prev: DeleteClientState,
  formData: FormData,
): Promise<DeleteClientState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUserVerified();

  const parsed = DeleteClientSchema.safeParse({ clientId: formData.get('clientId') });
  if (!parsed.success) {
    return { status: 'error', message: 'Identifiant client invalide.' };
  }

  const reqHeaders = await headers();
  const result = await deleteClientCore(ctx, {
    clientId: parsed.data.clientId,
    ip: getClientIp(reqHeaders),
    userAgent: reqHeaders.get('user-agent'),
  });
  if (!result.ok) {
    return { status: 'error', message: result.message };
  }

  revalidatePath('/clients');
  revalidatePath('/(app)/layout', 'layout');
  redirect('/clients');
}
