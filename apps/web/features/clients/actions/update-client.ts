'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { UpdateClientSchema } from '../lib/schemas';
import { updateClientCore } from '../lib/client-core';

export type UpdateClientState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly slug: string }
  | { readonly status: 'error'; readonly message: string };

export async function updateClient(
  _prev: UpdateClientState,
  formData: FormData,
): Promise<UpdateClientState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = UpdateClientSchema.safeParse({
    clientId: formData.get('clientId'),
    name: formData.get('name'),
    colorToken: formData.get('colorToken'),
    initials: formData.get('initials'),
    domains: formData.get('domains') ?? '',
    notes: formData.get('notes') ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Données invalides.',
    };
  }
  const data = parsed.data;

  const result = await updateClientCore(ctx, {
    clientId: data.clientId,
    name: data.name,
    colorToken: data.colorToken,
    initials: data.initials,
    domains: data.domains,
    notes: data.notes,
  });
  if (!result.ok) {
    return { status: 'error', message: result.message };
  }

  revalidatePath('/clients');
  revalidatePath('/(app)/layout', 'layout');
  return {
    status: 'success',
    slug: result.name.toLowerCase().replaceAll(/\s+/g, '-'),
  };
}
