import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { assertCsrfHeader } from '@/lib/csrf';
import { getConfirmStore } from '@/lib/assistant/confirm-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  allowed: z.boolean(),
});

const OUTCOME_STATUS = { not_found: 404, forbidden: 403, already_answered: 409 } as const;

export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();
  if (ctx === null) {
    return Response.json({ ok: false, message: 'Non authentifié.' }, { status: 401 });
  }
  try {
    await assertCsrfHeader(req.headers.get('x-csrf-token'));
  } catch {
    return Response.json({ ok: false, message: 'CSRF invalide.' }, { status: 403 });
  }
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, message: 'Requête invalide.' }, { status: 400 });
  }
  const outcome = await getConfirmStore().answer(parsed.data.id, ctx.userId, parsed.data.allowed);
  if (outcome !== 'ok') {
    return Response.json({ ok: false }, { status: OUTCOME_STATUS[outcome] });
  }
  return Response.json({ ok: true });
}
