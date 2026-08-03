import type { ToolRegistry } from './registry';
import type {
  AgentEvent,
  AgentRole,
  ChatMessage,
  Confirmer,
  Provider,
  ProviderTurnResult,
  ToolSpec,
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
const DEADLINE_SUFFIX =
  '\n\nJe me suis arrêté avant la fin (temps imparti écoulé) — dis « continue » pour poursuivre.';
const DEADLINE_STANDALONE =
  "Le temps imparti pour ce tour est écoulé — j'ai déjà exécuté des actions ci-dessus. Dis « continue » pour poursuivre.";

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
  /**
   * Budget temps du tour (epoch ms). Vérifié en tête de chaque round, AVANT
   * l'appel provider — un round déjà en cours va toujours à son terme (pas
   * d'abort en plein round, juste une frontière propre entre deux rounds).
   * Absent = pas de budget (comportement historique inchangé).
   */
  readonly deadlineAt?: number;
  /** Horloge injectable pour les tests. Par défaut `Date.now`. */
  readonly now?: () => number;
}

export interface RunTurnResult {
  readonly text: string;
  /** Historique complet après le tour (blocs tool inclus), prêt pour le tour suivant. */
  readonly history: readonly ChatMessage[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  /**
   * Présent uniquement quand le tour s'est arrêté prématurément faute de temps
   * (deadline dépassée avant de démarrer un nouveau round provider) — distinct
   * du garde-fou `MAX_TOOL_ROUNDS` (pas de champ dédié) et du `stopReason` du
   * provider (qui, lui, est par round). Absent = arrêt normal.
   */
  readonly stopReason?: 'deadline';
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
    // Budget temps du tour dépassé : on s'arrête proprement à la frontière de
    // round plutôt que de risquer le hard kill serverless (maxDuration Vercel)
    // en plein milieu d'un round provider ou d'exécution d'un tool.
    const now = deps.now ?? Date.now;
    if (deps.deadlineAt !== undefined && now() >= deps.deadlineAt) {
      const hasText = spokenParts.length > 0;
      const chunk = hasText ? DEADLINE_SUFFIX : DEADLINE_STANDALONE;
      deps.onText?.(chunk);
      const text = hasText ? `${spokenParts.join('\n')}${chunk}` : chunk;
      messages.push({ role: 'assistant', content: text });
      return { text, history: messages, inputTokens, outputTokens, stopReason: 'deadline' };
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

/**
 * Description pour le dialog de confirmation : `describeForConfirm` du tool si
 * présent, sinon `describeAction` générique. Une description qui lève ne doit
 * jamais bloquer le gate : repli générique.
 */
async function buildConfirmDescription(
  spec: ToolSpec,
  name: string,
  input: unknown,
): Promise<string> {
  if (spec.describeForConfirm !== undefined) {
    try {
      return await spec.describeForConfirm(input as never);
    } catch {
      // repli sur describeAction ci-dessous (couvre aussi un rejet de promesse)
    }
  }
  return describeAction(name, input);
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
    const description = await buildConfirmDescription(spec, name, input);
    deps.onEvent?.({ type: 'confirm_request', tool: name, description });
    let allowed: boolean;
    try {
      allowed = await deps.confirmer(description, name);
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
  deps.onEvent?.({ type: 'tool_end', name, isError: result.isError, output: result.output });
  return result;
}
