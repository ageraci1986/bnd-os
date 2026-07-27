'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { assertCsrfFromFormData } from '@/lib/csrf';
import { createProjectCore } from '../lib/project-core';
import { CreateProjectSchema } from '../lib/schemas';

export type CreateProjectState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string };

/**
 * Create a project (PRD §7 wizard). Thin Server Action wrapper: CSRF +
 * auth + FormData parsing, then delegates the transaction to
 * `createProjectCore` (see project-core.ts). Redirects to
 * /projects/[id] (Phase 5.D.2 Kanban board) only on success.
 */
export async function createProject(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  await assertCsrfFromFormData(formData);
  const ctx = await requireUser();

  const parsed = CreateProjectSchema.safeParse({
    name: formData.get('name'),
    clientId: formData.get('clientId'),
    description: formData.get('description') ?? undefined,
    startDate: formData.get('startDate') ?? undefined,
    endDate: formData.get('endDate') ?? undefined,
    typeId: formData.get('typeId') === '' ? null : (formData.get('typeId') ?? null),
    templateId: formData.get('templateId'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Données invalides.',
    };
  }

  const result = await createProjectCore(ctx, parsed.data);
  if (!result.ok) {
    return { status: 'error', message: result.message };
  }

  revalidatePath('/projects');
  revalidatePath('/(app)/layout', 'layout');
  redirect(`/projects/${result.projectId}`);
}
