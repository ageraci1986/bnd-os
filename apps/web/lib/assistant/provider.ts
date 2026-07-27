import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { Provider, ProviderTurnResult } from '@nexushub/agent';
import { getServerEnv } from '@/lib/env';

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;

/** Erreur provider avec un message montrable à l'utilisateur. */
export class ProviderError extends Error {}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client === null) {
    const key = getServerEnv().ANTHROPIC_API_KEY;
    if (key === undefined) {
      throw new ProviderError(
        "L'assistant n'est pas configuré (ANTHROPIC_API_KEY manquante). Contactez un administrateur.",
      );
    }
    client = new Anthropic({ apiKey: key });
  }
  return client;
}

export function toTurnResult(final: Anthropic.Message): ProviderTurnResult {
  const content = final.content.map(
    (block) => JSON.parse(JSON.stringify(block)) as Record<string, unknown>,
  );
  const text = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const toolCalls = final.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  const stopReason =
    final.stop_reason === 'end_turn' ||
    final.stop_reason === 'tool_use' ||
    final.stop_reason === 'max_tokens' ||
    final.stop_reason === 'refusal'
      ? final.stop_reason
      : ('other' as const);
  return {
    content,
    text,
    stopReason,
    toolCalls,
    inputTokens: final.usage.input_tokens,
    outputTokens: final.usage.output_tokens,
  };
}

export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError('Ma clé API a été rejetée — vérifiez ANTHROPIC_API_KEY côté serveur.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError('Le modèle est très sollicité — réessayez dans un instant.');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('Impossible de joindre le modèle — vérifiez la connexion réseau.');
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(
      `Le service du modèle a renvoyé une erreur (${String(error.status)}). Réessayez sous peu.`,
    );
  }
  return new ProviderError('Une erreur inattendue est survenue — veuillez réessayer.');
}

/**
 * Protège le listener `text` : le SDK invoque les listeners de façon synchrone
 * et non protégée — si le callback lève (ex: écriture SSE vers un client
 * déconnecté), tout le tour rejetterait en erreur générique et le texte déjà
 * streamé serait perdu. On avale donc l'erreur du callback : le stream doit
 * continuer, et le texte complet revient de toute façon via finalMessage().
 */
export function safeOnText(onText: (chunk: string) => void): (chunk: string) => void {
  return (chunk) => {
    try {
      onText(chunk);
    } catch {
      // Erreur du consommateur (pas du modèle) — volontairement ignorée.
    }
  };
}

/** Seule implémentation de `Provider` du repo ; seul fichier qui importe le SDK. */
export function createAnthropicProvider(): Provider {
  return {
    async streamTurn({ system, messages, tools, onText }) {
      try {
        const stream = getClient().messages.stream({
          model: getServerEnv().ASSISTANT_MODEL ?? DEFAULT_MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: messages as unknown as Anthropic.MessageParam[],
          ...(tools.length > 0 ? { tools: tools as unknown as Anthropic.Tool[] } : {}),
        });
        if (onText !== undefined) {
          stream.on('text', safeOnText(onText));
        }
        const final = await stream.finalMessage();
        return toTurnResult(final);
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}
