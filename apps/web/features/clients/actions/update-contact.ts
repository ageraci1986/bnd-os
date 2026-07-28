'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { UpdateContactSchema } from '../lib/schemas';
import { updateContactCore } from '../lib/client-core';

export type UpdateContactState =
  | { readonly status: 'idle' }
  | { readonly status: 'success' }
  | { readonly status: 'error'; readonly message: string };

export async function updateContact(
  _prev: UpdateContactState,
  formData: FormData,
): Promise<UpdateContactState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = UpdateContactSchema.safeParse({
    contactId: formData.get('contactId'),
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
  const data = parsed.data;

  const result = await updateContactCore(ctx, {
    contactId: data.contactId,
    firstName: data.name.firstName,
    lastName: data.name.lastName,
    jobTitle: data.jobTitle,
    email: data.email,
    phone: data.phone,
    raci: data.raci ?? null,
    notes: data.notes,
  });
  if (!result.ok) {
    return { status: 'error', message: result.message };
  }

  revalidatePath('/clients');
  return { status: 'success' };
}
