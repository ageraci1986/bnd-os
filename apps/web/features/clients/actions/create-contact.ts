'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { prisma } from '@nexushub/db';
import { NotFoundError } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { CreateContactSchema } from '../lib/schemas';

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
  const data = parsed.data;

  // Defence in depth: confirm the client belongs to this workspace.
  const client = await prisma.client.findFirst({
    where: { id: data.clientId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new NotFoundError('Client');

  const created = await prisma.contact.create({
    data: {
      workspaceId: ctx.workspaceId,
      clientId: data.clientId,
      firstName: data.name.firstName,
      lastName: data.name.lastName,
      jobTitle: data.jobTitle,
      email: data.email,
      phone: data.phone,
      raci: data.raci ?? null,
      notes: data.notes,
    },
    select: { id: true },
  });

  revalidatePath('/clients');
  return { status: 'success', contactId: created.id };
}
