'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma } from '@nexushub/db';
import { NotFoundError } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { UpdateClientSchema } from '../lib/schemas';

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

  try {
    const updated = await prisma.client.update({
      where: {
        id: data.clientId,
        workspaceId: ctx.workspaceId,
        deletedAt: null,
      },
      data: {
        name: data.name,
        colorToken: data.colorToken,
        initials: data.initials,
        domains: data.domains,
        notes: data.notes,
      },
      select: { name: true },
    });
    revalidatePath('/clients');
    revalidatePath('/(app)/layout', 'layout');
    return {
      status: 'success',
      slug: updated.name.toLowerCase().replaceAll(/\s+/g, '-'),
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return { status: 'error', message: 'Un client porte déjà ce nom.' };
      if (err.code === 'P2025') throw new NotFoundError('Client');
    }
    throw err;
  }
}
