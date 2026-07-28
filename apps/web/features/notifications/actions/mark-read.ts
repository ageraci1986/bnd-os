'use server';
import 'server-only';
import { z } from 'zod';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';

// Server Action for the notice stack (Task 7) — marks a single notice as
// read, whether via "En discuter" (optimistic then confirmed) or "Ignorer".
// Follows the convention of `communications/actions/mark-email-read.ts`:
// `requireUser()` supplies the workspace/user scope; Next.js Server Actions
// already carry Origin-based CSRF protection (no separate double-submit
// token needed here, same as the existing mail actions).
//
// No `readAt: null` guard in the `where` — the update is idempotent by
// design: re-marking an already-read notification simply re-stamps
// `readAt`, still returns `{ok:true, affected:1}`, never errors.

const Schema = z.object({ notificationId: z.string().uuid() });

export type MarkNotificationReadResult =
  | { readonly ok: true; readonly affected: number }
  | { readonly ok: false; readonly message: string };

export async function markNotificationRead(input: {
  readonly notificationId: string;
}): Promise<MarkNotificationReadResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant invalide.' };
  const ctx = await requireUser();
  const result = await prisma.notification.updateMany({
    where: { id: parsed.data.notificationId, workspaceId: ctx.workspaceId, userId: ctx.userId },
    data: { readAt: new Date() },
  });
  return { ok: true, affected: result.count };
}
