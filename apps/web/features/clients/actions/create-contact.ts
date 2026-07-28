'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { CreateContactSchema } from '../lib/schemas';
import { createContactCore } from '../lib/client-core';

export type CreateContactState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly contactId: string }
  | { readonly status: 'error'; readonly message: string };

export async function createContact(
  _prev: CreateContactState,
  formData: FormData,
): Promise<CreateContactState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = CreateContactSchema.safeParse({
    clientId: formData.get('clientId'),
    name: {
      firstName: formData.get('firstName') ?? '',
      lastName: formData.get('lastName') ?? '',
    },
    jobTitle: formData.get('jobTitle') ?? undefined,
    email: formData.get('email') ?? undefined,
    phone: formData.get('phone') ?? undefined,
    raci: formData.get('raci') === '' ? null : (formData.get('raci') ?? null),
    notes: formData.get('notes') ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Données invalides.',
    };
  }

  const result = await createContactCore(ctx, parsed.data);
  if (!result.ok) {
    return { status: 'error', message: result.message };
  }

  revalidatePath('/clients');
  return { status: 'success', contactId: result.contactId };
}
