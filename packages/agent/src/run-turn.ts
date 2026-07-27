import type { ToolRegistry } from './registry';
import type {
  AgentEvent,
  AgentRole,
  ChatMessage,
  Confirmer,
  Provider,
  ProviderTurnResult,
} from './types';

export const MAX_TOOL_ROUNDS = 10;

const STUCK_MESSAGE =
  'Je tourne en rond sur cette demande — pouvez-vous reformuler ou la découper ?';
const REFUSAL_MESSAGE = 'Je ne peux pas aider sur ce point.';
const DECLINED_OUTPUT =
  "Action refusée par l'utilisateur — elle n'a PAS été exécutée. Ne pas réessayer sans nouvelle demande explicite.";
const ADMIN_ONLY_OUTPUT =
  'Refusé : cette action est réservée aux administrateurs du workspace. Ne pas réessayer.';
const CONFIRM_UNAVAILABLE_OUTPUT = 'Confirmation indisponible — action non exécutée.';
const TRUNCATED_OUTPUT = 'Tour interrompu (limite de tokens atteinte) — action non exécutée.';

/** Contexte sans humain pour répondre (jobs) : on refuse, toujours. */
export const autoDeny: Confirmer = async () => false;

export interface RunTurnDeps {
  readonly provider: Provider;
  readonly registry: ToolRegistry;
  readonly system: string;
  readonly confirmer: Confirmer;
  readonly role: AgentRole;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly onText?: (chunk: string) => void;
  /**
   * Annulation amont (ex: client SSE déconnecté). Vérifié en tête de chaque
   * round et propagé au provider — évite de brûler jusqu'à MAX_TOOL_ROUNDS
   * appels modèle pour un client déjà parti.
   */
  readonly signal?: AbortSignal;
}

export interface RunTurnResult {
  readonly text: string;
  /** Historique complet après le tour (blocs tool inclus), prêt pour le tour suivant. */
  readonly history: readonly ChatMessage[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Décrit une action pour l'humain qui doit confirmer. */
export function describeAction(name: string, input: unknown): string {
  const args =
    input !== null && typeof input === 'object'
      ? Object.entries(input as Record<string, unknown>)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ')
      : String(input);
  return `${name} (${args === '' ? 'sans arguments' : args})`;
}

/**
 * Un tour complet : message utilisateur → rounds de tools → réponse finale.
 * L'historique d'entrée n'est jamais muté ; en cas d'échec provider, rien
 * n'est conservé du tour raté.
 */
export async function runTurn(
  history: readonly ChatMessage[],
  userText: string,
  deps: RunTurnDeps,
): Promise<RunTurnResult> {
  const messages: ChatMessage[] = [...history, { role: 'user', content: userText }];
  const tools = deps.registry.toProviderTools();
  const spokenParts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    // Client parti : on s'arrête à la frontière de round (l'historique y est
    // API-valide : chaque tool_use a déjà reçu son tool_result).
    if (deps.signal?.aborted === true) {
      return { text: spokenParts.join('\n'), history: messages, inputTokens, outputTokens };
    }
    const result: ProviderTurnResult = await deps.provider.streamTurn({
      system: deps.system,
      messages,
      tools,
      ...(deps.onText !== undefined ? { onText: deps.onText } : {}),
      ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
    });
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    if (result.text !== '') spokenParts.push(result.text);

    if (result.stopReason === 'refusal') {
      const text = result.text === '' ? REFUSAL_MESSAGE : result.text;
      messages.push({ role: 'assistant', content: text });
      return { text, history: messages, inputTokens, outputTokens };
    }

    messages.push({ role: 'assistant', content: result.content });

    if (result.stopReason !== 'tool_use') {
      // Arrêt tronqué (ex: max_tokens) avec des tool_use dans le contenu : on ne
      // les exécute PAS (entrées potentiellement incomplètes), mais on clôt chaque
      // tool_use par un tool_result pour garder un historique valide côté API.
      if (result.toolCalls.length > 0) {
        messages.push({
          role: 'user',
          content: result.toolCalls.map((call) => ({
            type: 'tool_result',
            tool_use_id: call.id,
            content: TRUNCATED_OUTPUT,
            is_error: true,
          })),
        });
      }
      return { text: spokenParts.join('\n'), history: messages, inputTokens, outputTokens };
    }

    const toolResults: Record<string, unknown>[] = [];
    for (const call of result.toolCalls) {
      const { output, isError } = await executeGated(call.name, call.input, deps);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: output,
        is_error: isError,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  messages.push({ role: 'assistant', content: STUCK_MESSAGE });
  return { text: STUCK_MESSAGE, history: messages, inputTokens, outputTokens };
}

async function executeGated(
  name: string,
  input: unknown,
  deps: RunTurnDeps,
): Promise<{ output: string; isError: boolean }> {
  const spec = deps.registry.get(name);
  if (spec !== null && spec.adminOnly && deps.role !== 'admin') {
    return { output: ADMIN_ONLY_OUTPUT, isError: true };
  }
  if (spec !== null && spec.gated) {
    const description = describeAction(name, input);
    deps.onEvent?.({ type: 'confirm_request', description });
    let allowed: boolean;
    try {
      allowed = await deps.confirmer(description);
    } catch {
      // Fail closed : canal de confirmation cassé = action non exécutée, mais le
      // tour continue (is_error: true, c'est une défaillance technique).
      return { output: CONFIRM_UNAVAILABLE_OUTPUT, isError: true };
    }
    if (!allowed) {
      // Refus humain → is_error: false (issue normale, pas un échec à réessayer),
      // contrairement au garde adminOnly ci-dessus (refus dur, is_error: true).
      return { output: DECLINED_OUTPUT, isError: false };
    }
  }
  deps.onEvent?.({ type: 'tool_start', name });
  const result = await deps.registry.execute(name, input);
  deps.onEvent?.({ type: 'tool_end', name, isError: result.isError });
  return result;
}
