import { runTurn, type ToolRegistry } from '@nexushub/agent';
import { prisma } from '@nexushub/db';
import { recordAudit } from '@/lib/audit';
import { getAuthContext } from '@/lib/auth';
import { assertCsrfHeader } from '@/lib/csrf';
import { getServerEnv } from '@/lib/env';
import { getRateLimiter } from '@/lib/rate-limit';
import { ChatRequestSchema, type ChatSseEvent } from '@/lib/assistant/chat-schema';
import { getConfirmStore } from '@/lib/assistant/confirm-store';
import { createAnthropicProvider, ProviderError } from '@/lib/assistant/provider';
import { buildSystemPrompt } from '@/lib/assistant/system-prompt';
import { buildRegistry } from '@/lib/assistant/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Budget ~2 fenêtres de confirmation (120 s) + rounds modèle ; Vercel Fluid.
export const maxDuration = 300;

/** Tools de lecture dont la sortie JSON est assez structurée pour un widget déterministe. */
const WIDGET_TOOLS = new Set([
  'get_today_overview',
  'get_project_board',
  'search_mails',
  'list_projects',
]);
const WIDGET_DATA_MAX_CHARS = 8_000;

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

  // Probe config AVANT d'ouvrir le flux : sans clé API, le provider échouerait
  // après le début du stream, où on ne peut plus renvoyer un statut HTTP propre.
  if (getServerEnv().ANTHROPIC_API_KEY === undefined) {
    return Response.json(
      { ok: false, message: "L'assistant n'est pas configuré. Contactez un administrateur." },
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
    // TODO: renommer `nowIso` → `nowLabel` et utiliser la locale/timezone de
    // l'utilisateur (CLAUDE.md §8) quand l'intégration Settings arrivera.
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
          confirmer: async (description, tool) => {
            const store = getConfirmStore();
            const id = await store.createPending(ctx.userId);
            send({ type: 'confirm_request', id, tool, description: description.slice(0, 2000) });
            // Invariant UI : après un confirm_request, un confirm_resolved suit TOUJOURS
            // (sinon dialog orphelin). Si l'attente échoue (backend Redis en panne…),
            // on résout à false côté client puis on relance : executeGated fail-close
            // avec CONFIRM_UNAVAILABLE_OUTPUT — pas d'audit ici, c'est lui qui gère.
            let allowed = false;
            try {
              allowed = await store.awaitAnswer(id, { signal: req.signal });
            } catch (error) {
              send({ type: 'confirm_resolved', id, allowed: false });
              throw error;
            }
            send({ type: 'confirm_resolved', id, allowed });
            await recordAudit({
              action: 'assistant_gate',
              workspaceId: ctx.workspaceId,
              actorId: ctx.userId,
              // nom du tool uniquement — pas les arguments (PII possible)
              data: { tool, allowed },
            });
            return allowed;
          },
          role: ctx.role,
          // Propagation de la déconnexion client : stoppe la boucle de rounds
          // et annule la requête provider en cours (pas de tokens brûlés à vide).
          signal: req.signal,
          onText: (chunk) => {
            send({ type: 'chunk', text: chunk });
          },
          onEvent: (event) => {
            if (event.type === 'tool_start') {
              send({ type: 'tool_start', name: event.name });
            } else if (event.type === 'tool_end') {
              send({ type: 'tool_end', name: event.name, isError: event.isError });
              // Fire-and-forget sûr : onEvent est synchrone, et chaque tool_end est
              // suivi d'au moins un round provider awaité — l'insert a le temps d'aboutir.
              void recordAudit({
                action: 'assistant_tool_run',
                workspaceId: ctx.workspaceId,
                actorId: ctx.userId,
                data: { tool: event.name, isError: event.isError },
              });
              // Widget déterministe : whitelist stricte + plafond de taille + JSON valide
              // uniquement. Une sortie non-JSON ou trop longue reste du texte simple.
              if (
                WIDGET_TOOLS.has(event.name) &&
                !event.isError &&
                event.output.length <= WIDGET_DATA_MAX_CHARS
              ) {
                try {
                  send({ type: 'tool_result', tool: event.name, data: JSON.parse(event.output) });
                } catch {
                  // sortie non-JSON : pas de widget
                }
              }
            }
          },
        });
        await recordAudit({
          action: 'assistant_turn',
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          data: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
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
