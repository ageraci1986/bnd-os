import { runTurn, type ToolRegistry } from '@nexushub/agent';
import { prisma } from '@nexushub/db';
import { getAuthContext } from '@/lib/auth';
import { assertCsrfHeader } from '@/lib/csrf';
import { getRateLimiter } from '@/lib/rate-limit';
import { ChatRequestSchema, type ChatSseEvent } from '@/lib/assistant/chat-schema';
import { createAnthropicProvider, ProviderError } from '@/lib/assistant/provider';
import { buildSystemPrompt } from '@/lib/assistant/system-prompt';
import { buildRegistry } from '@/lib/assistant/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sse(event: ChatSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

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

  const limit = await getRateLimiter('assistant_chat').check(ctx.userId);
  if (!limit.success) {
    return Response.json(
      { ok: false, message: 'Trop de messages — patientez un instant.' },
      { status: 429 },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, message: 'Requête invalide.' }, { status: 400 });
  }

  // `buildRegistry` appelle `loadUserScope` (requête Prisma) EN DEHORS du wrapper
  // `safeDb` (voir tools/index.ts) — une panne DB à ce moment lève une erreur brute.
  // On doit donc l'entourer d'un try/catch et répondre AVANT d'ouvrir le flux SSE :
  // une fois le stream démarré, il est trop tard pour changer le statut HTTP.
  let registry: ToolRegistry;
  let workspaceName: string;
  try {
    const [builtRegistry, workspace] = await Promise.all([
      buildRegistry(ctx),
      prisma.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true } }),
    ]);
    registry = builtRegistry;
    workspaceName = workspace?.name ?? 'NexusHub';
  } catch {
    return Response.json(
      { ok: false, message: "L'assistant est indisponible pour le moment." },
      { status: 500 },
    );
  }

  const system = buildSystemPrompt({
    userFirstName: ctx.email.split('@')[0] ?? 'utilisateur',
    role: ctx.role,
    workspaceName,
    // Le champ s'appelle `nowIso` (contrat de buildSystemPrompt) mais on lui passe une
    // date lisible en français plutôt qu'un ISO brut : plus naturel pour un assistant
    // conversationnel/vocal et pour le raisonnement "aujourd'hui" du modèle.
    nowIso: new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date()),
  });

  const { messages, message } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Déjà fermé côté runtime (double close) — sans conséquence.
        }
      };
      const onAbort = (): void => {
        closed = true;
      };
      req.signal.addEventListener('abort', onAbort);

      const send = (event: ChatSseEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sse(event)));
        } catch {
          // Le client est parti (enqueue sur controller fermé) : on cesse d'écrire,
          // mais le tour continue côté serveur (tokens déjà engagés côté provider).
          closed = true;
        }
      };

      try {
        const result = await runTurn(messages, message, {
          provider: createAnthropicProvider(),
          registry,
          system,
          // Plan 1 : aucun tool "gated" n'est encore enregistré. Si un tool gated
          // apparaissait malgré tout, on refuse systématiquement (fail closed) — la
          // confirmation utilisateur temps réel arrivera dans un plan ultérieur.
          confirmer: async () => false,
          role: ctx.role,
          onText: (chunk) => {
            send({ type: 'chunk', text: chunk });
          },
          onEvent: (event) => {
            if (event.type === 'tool_start') {
              send({ type: 'tool_start', name: event.name });
            } else if (event.type === 'tool_end') {
              send({ type: 'tool_end', name: event.name, isError: event.isError });
            }
          },
        });
        send({ type: 'done', text: result.text });
      } catch (error) {
        const msg =
          error instanceof ProviderError ? error.message : 'Une erreur est survenue — réessayez.';
        send({ type: 'error', message: msg });
      } finally {
        req.signal.removeEventListener('abort', onAbort);
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
