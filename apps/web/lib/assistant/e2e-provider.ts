import 'server-only';

import type { ChatMessage, Provider, ProviderTurnResult } from '@nexushub/agent';

/**
 * Provider scripté pour les E2E Playwright (Plan 4 Task 4 — orbe/E2E/Storybook).
 * AUCUN réseau, AUCUN import du SDK Anthropic : comportement DÉTERMINISTE,
 * dérivé uniquement de `messages` (aucune I/O, aucun état interne). Piloté
 * par le dernier message utilisateur texte (la commande d'origine du tour,
 * cherchée en remontant l'historique — elle reste identifiable à tout round
 * car c'est le seul message `role: 'user'` dont `content` est une chaîne ;
 * les rounds suivants ont `content` = blocs `tool_result`) :
 *
 *  - contient `e2e:briefing`            → round 1 : tool_use `get_today_overview` ;
 *                                          round 2 : texte « Voici votre briefing. »
 *  - matche `e2e:delete-card <uuid>`    → round 1 : tool_use `delete_card {cardId}`
 *                                          (tool GATED — le vrai flux de confirmation
 *                                          de `runTurn` s'exécute autour de cet appel) ;
 *                                          round 2 : texte dérivé du tool_result — si le
 *                                          résultat contient « supprimée » → confirmation,
 *                                          sinon → refus reprenant un extrait du résultat.
 *  - sinon                              → texte `[e2e] ` + les 30 premiers caractères
 *                                          du message.
 *
 * Le texte final est toujours streamé via `onText` en 2-3 chunks (mots
 * regroupés) pour que l'orbe passe par l'état `responding` pendant les E2E.
 * N'est jamais sélectionné en production — garde double dans `provider.ts`.
 */

const DELETE_CARD_RE = /e2e:delete-card ([0-9a-f-]{36})/;
/** Longueur de l'extrait du résultat de tool repris dans le message de refus. */
const REFUSAL_EXCERPT_MAX_CHARS = 80;
/** Longueur de l'écho dans le scénario par défaut. */
const ECHO_MAX_CHARS = 30;

/** Découpe `text` en 2-3 chunks (mots regroupés), reconstruction exacte par concaténation. */
function splitIntoChunks(text: string, maxParts = 3): string[] {
  if (text === '') return [text];
  const words = text.split(' ');
  const parts = Math.min(maxParts, words.length);
  const perPart = Math.ceil(words.length / parts);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += perPart) {
    const isLast = i + perPart >= words.length;
    chunks.push(words.slice(i, i + perPart).join(' ') + (isLast ? '' : ' '));
  }
  return chunks;
}

function emitText(text: string, onText?: (chunk: string) => void): ProviderTurnResult {
  if (onText !== undefined) {
    for (const chunk of splitIntoChunks(text)) onText(chunk);
  }
  return {
    content: [{ type: 'text', text }],
    text,
    stopReason: 'end_turn',
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
  };
}

function emitToolUse(name: string, input: Record<string, unknown>): ProviderTurnResult {
  // Un seul appel par nom possible dans nos scripts (pas de collision d'id).
  const id = `e2e_${name}`;
  return {
    content: [{ type: 'tool_use', id, name, input }],
    text: '',
    stopReason: 'tool_use',
    toolCalls: [{ id, name, input }],
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** La commande d'origine du tour : dernier message `user` dont `content` est une chaîne. */
function findOriginatingUserText(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message !== undefined && message.role === 'user' && typeof message.content === 'string') {
      return message.content;
    }
  }
  return '';
}

/** Contenu du bloc `tool_result` si le dernier message en contient un (round ≥ 2). */
function findLastToolResult(messages: readonly ChatMessage[]): string | null {
  const last = messages[messages.length - 1];
  if (last === undefined || last.role !== 'user' || typeof last.content === 'string') return null;
  const block = last.content.find((b) => b['type'] === 'tool_result');
  if (block === undefined) return null;
  const content = block['content'];
  return typeof content === 'string' ? content : JSON.stringify(content);
}

export function createE2EProvider(): Provider {
  return {
    async streamTurn({ messages, onText }) {
      const userText = findOriginatingUserText(messages);
      const toolResult = findLastToolResult(messages);
      const deleteMatch = DELETE_CARD_RE.exec(userText);

      if (toolResult === null) {
        // Round 1 : pas encore de tool_result dans l'historique.
        if (userText.includes('e2e:briefing')) {
          return emitToolUse('get_today_overview', {});
        }
        if (deleteMatch !== null) {
          return emitToolUse('delete_card', { cardId: deleteMatch[1] });
        }
        return emitText(`[e2e] ${userText.slice(0, ECHO_MAX_CHARS)}`, onText);
      }

      // Round ≥ 2 : le tool a déjà tourné (ou a été refusé) — texte final.
      if (userText.includes('e2e:briefing')) {
        return emitText('Voici votre briefing.', onText);
      }
      if (deleteMatch !== null) {
        const text = toolResult.includes('supprimée')
          ? 'La carte a été supprimée.'
          : `Suppression refusée : ${toolResult.slice(0, REFUSAL_EXCERPT_MAX_CHARS)}`;
        return emitText(text, onText);
      }
      // Non censé arriver (nos deux scripts gated n'ont qu'un round de tool) —
      // repli sur l'écho par défaut pour rester total et déterministe.
      return emitText(`[e2e] ${userText.slice(0, ECHO_MAX_CHARS)}`, onText);
    },
  };
}
