'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma } from '@nexushub/db';
import { NotFoundError } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { UpdateContactSchema } from '../lib/schemas';

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

  try {
    await prisma.contact.update({
      where: {
        id: data.contactId,
        workspaceId: ctx.workspaceId,
        deletedAt: null,
      },
      data: {
        firstName: data.name.firstName,
        lastName: data.name.lastName,
        jobTitle: data.jobTitle,
        email: data.email,
        phone: data.phone,
        raci: data.raci ?? null,
        notes: data.notes,
      },
    });
    revalidatePath('/clients');
    return { status: 'success' };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new NotFoundError('Contact');
    }
    throw err;
  }
}
