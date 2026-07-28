'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUserVerified } from '@/lib/auth';
import { deleteProjectCore } from '../lib/project-core';

const Schema = z.object({
  projectId: z.string().uuid(),
});

/**
 * Soft-delete a project (ADR 0001 #15: corbeille 30j, restore Admin V1.5).
 * Thin Server Action wrapper: auth + input validation + navigation side
 * effects. The actual checks (Viewer refusal, lookup, scope, soft delete)
 * live in `deleteProjectCore` so the assistant's delete tool can reuse
 * them without the `redirect()` below.
 */
export async function deleteProject(input: {
  projectId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUserVerified();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant projet invalide.' };

  const result = await deleteProjectCore(ctx, parsed.data);
  if (!result.ok) return result;

  revalidatePath('/projects');
  redirect('/projects');
}
