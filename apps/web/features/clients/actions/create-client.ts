'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { CreateClientSchema } from '../lib/schemas';
import { createClientCore } from '../lib/client-core';

export type CreateClientState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly clientId: string; readonly slug: string }
  | { readonly status: 'error'; readonly message: string };

export async function createClient(
  _prev: CreateClientState,
  formData: FormData,
): Promise<CreateClientState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = CreateClientSchema.safeParse({
    name: formData.get('name'),
    colorToken: formData.get('colorToken'),
    initials: formData.get('initials') ?? '',
    domains: formData.get('domains') ?? '',
    notes: formData.get('notes') ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Données invalides.',
    };
  }

  const result = await createClientCore(ctx, parsed.data);
  if (!result.ok) {
    return { status: 'error', message: result.message };
  }

  revalidatePath('/clients');
  revalidatePath('/(app)/layout', 'layout');
  return { status: 'success', clientId: result.clientId, slug: result.slug };
}
