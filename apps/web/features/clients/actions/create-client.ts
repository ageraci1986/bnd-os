'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { loadUserScope } from '@/lib/auth/scope';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { SCOPE_ERROR_MESSAGE } from '@/features/projects/lib/scope-error';
import { CreateClientSchema } from '../lib/schemas';

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
  const data = parsed.data;

  const scope = await loadUserScope(ctx);
  if (scope.kind === 'restricted') {
    // Restricted users cannot create top-level resources outside their scope.
    return { status: 'error', message: SCOPE_ERROR_MESSAGE };
  }

  try {
    const created = await prisma.client.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: data.name,
        colorToken: data.colorToken,
        initials: data.initials,
        domains: data.domains,
        notes: data.notes,
      },
      select: { id: true, name: true },
    });
    revalidatePath('/clients');
    revalidatePath('/(app)/layout', 'layout');
    return {
      status: 'success',
      clientId: created.id,
      slug: created.name.toLowerCase().replaceAll(/\s+/g, '-'),
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'error', message: 'Un client porte déjà ce nom.' };
    }
    throw err;
  }
}
