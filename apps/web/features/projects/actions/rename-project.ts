'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUserVerified } from '@/lib/auth';
import { updateProjectCore } from '../lib/project-core';
import { NameSchema } from '../lib/schemas';

const Schema = z.object({
  projectId: z.string().uuid(),
  name: NameSchema,
});

export type RenameProjectResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string };

/**
 * Renommage inline (carte /projects + header projet). Mince wrapper :
 * auth + Zod ; les règles (Viewer refusé, scope, unicité) vivent dans
 * `updateProjectCore`, partagé avec l'assistant.
 */
export async function renameProject(input: {
  projectId: string;
  name: string;
}): Promise<RenameProjectResult> {
  const ctx = await requireUserVerified();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Nom de projet invalide.' };
  }

  const res = await updateProjectCore(ctx, parsed.data);
  if (!res.ok) return res;

  revalidatePath('/projects');
  revalidatePath(`/projects/${parsed.data.projectId}`, 'layout');
  return { ok: true, name: res.name };
}
