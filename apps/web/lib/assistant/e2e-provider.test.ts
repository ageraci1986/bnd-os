import { describe, expect, it, vi } from 'vitest';
import { createE2EProvider } from './e2e-provider';
import type { ChatMessage } from '@nexushub/agent';

/**
 * Provider scripté E2E (Plan 4 Task 4) : comportement DÉTERMINISTE, piloté par
 * le dernier message utilisateur texte de l'historique. Trois scénarios pinnés
 * (voir e2e-provider.ts pour le contrat) + le streaming par chunks (onText).
 * AUCUN réseau ici — le provider ne doit dépendre que de `messages`.
 */

const CARD_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('createE2EProvider', () => {
  describe('scénario briefing (e2e:briefing)', () => {
    it('round 1 : tool_use get_today_overview, pas de texte, pas de chunk', async () => {
      const provider = createE2EProvider();
      const onText = vi.fn();
      const messages: ChatMessage[] = [{ role: 'user', content: 'e2e:briefing merci' }];

      const result = await provider.streamTurn({ system: '', messages, tools: [], onText });

      expect(result).toEqual({
        content: [
          { type: 'tool_use', id: 'e2e_get_today_overview', name: 'get_today_overview', input: {} },
        ],
        text: '',
        stopReason: 'tool_use',
        toolCalls: [{ id: 'e2e_get_today_overview', name: 'get_today_overview', input: {} }],
        inputTokens: 0,
        outputTokens: 0,
      });
      expect(onText).not.toHaveBeenCalled();
    });

    it('round 2 (après tool_result) : texte de briefing, streamé en 3 chunks', async () => {
      const provider = createE2EProvider();
      const onText = vi.fn();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'e2e:briefing merci' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'e2e_get_today_overview',
              name: 'get_today_overview',
              input: {},
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'e2e_get_today_overview',
              content: '{"blockedCards":2,"dueToday":3}',
              is_error: false,
            },
          ],
        },
      ];

      const result = await provider.streamTurn({ system: '', messages, tools: [], onText });

      expect(result.text).toBe('Voici votre briefing.');
      expect(result.stopReason).toBe('end_turn');
      expect(result.toolCalls).toEqual([]);
      expect(result.content).toEqual([{ type: 'text', text: 'Voici votre briefing.' }]);
      // Chunking déterministe (mots groupés par 3) — reconstruction exacte.
      expect(onText.mock.calls.map((c) => c[0] as string)).toEqual([
        'Voici ',
        'votre ',
        'briefing.',
      ]);
      expect(onText.mock.calls.map((c) => c[0] as string).join('')).toBe('Voici votre briefing.');
    });
  });

  describe('scénario suppression de carte (e2e:delete-card <uuid>)', () => {
    it('round 1 : tool_use delete_card avec le cardId extrait du message', async () => {
      const provider = createE2EProvider();
      const messages: ChatMessage[] = [{ role: 'user', content: `e2e:delete-card ${CARD_ID}` }];

      const result = await provider.streamTurn({ system: '', messages, tools: [] });

      expect(result).toEqual({
        content: [
          {
            type: 'tool_use',
            id: 'e2e_delete_card',
            name: 'delete_card',
            input: { cardId: CARD_ID },
          },
        ],
        text: '',
        stopReason: 'tool_use',
        toolCalls: [{ id: 'e2e_delete_card', name: 'delete_card', input: { cardId: CARD_ID } }],
        inputTokens: 0,
        outputTokens: 0,
      });
    });

    it('round 2 : tool_result contenant "supprimée" → texte de confirmation', async () => {
      const provider = createE2EProvider();
      const onText = vi.fn();
      const messages: ChatMessage[] = [
        { role: 'user', content: `e2e:delete-card ${CARD_ID}` },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'e2e_delete_card',
              name: 'delete_card',
              input: { cardId: CARD_ID },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'e2e_delete_card',
              content: 'Carte supprimée (restaurable 30 jours).',
              is_error: false,
            },
          ],
        },
      ];

      const result = await provider.streamTurn({ system: '', messages, tools: [], onText });

      expect(result.text).toBe('La carte a été supprimée.');
      expect(result.stopReason).toBe('end_turn');
      expect(onText.mock.calls.map((c) => c[0] as string).join('')).toBe(
        'La carte a été supprimée.',
      );
      expect(onText.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(onText.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('round 2 : tool_result sans "supprimée" (refus/erreur) → texte de refus reprenant le résultat', async () => {
      const provider = createE2EProvider();
      const messages: ChatMessage[] = [
        { role: 'user', content: `e2e:delete-card ${CARD_ID}` },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'e2e_delete_card',
              name: 'delete_card',
              input: { cardId: CARD_ID },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'e2e_delete_card',
              content: "Action refusée par l'utilisateur.",
              is_error: false,
            },
          ],
        },
      ];

      const result = await provider.streamTurn({ system: '', messages, tools: [] });

      expect(result.text).toBe("Suppression refusée : Action refusée par l'utilisateur.");
      expect(result.stopReason).toBe('end_turn');
    });
  });

  describe('scénario par défaut (écho)', () => {
    it("texte libre → '[e2e] ' + 30 premiers caractères, streamé en chunks reconstruisant le texte exact", async () => {
      const provider = createE2EProvider();
      const onText = vi.fn();
      const userText = 'Quel est le statut du projet Nova ce matin ?';
      const messages: ChatMessage[] = [{ role: 'user', content: userText }];

      const result = await provider.streamTurn({ system: '', messages, tools: [], onText });

      const expectedText = `[e2e] ${userText.slice(0, 30)}`;
      expect(result.text).toBe(expectedText);
      expect(result.stopReason).toBe('end_turn');
      expect(result.toolCalls).toEqual([]);
      expect(result.content).toEqual([{ type: 'text', text: expectedText }]);
      expect(onText.mock.calls.map((c) => c[0] as string).join('')).toBe(expectedText);
      expect(onText.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(onText.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('ne consulte pas le réseau et est un pur calcul sur `messages` (aucune I/O)', async () => {
      // Preuve indirecte : deux appels avec les mêmes entrées donnent le même résultat.
      const provider = createE2EProvider();
      const messages: ChatMessage[] = [{ role: 'user', content: 'bonjour' }];
      const r1 = await provider.streamTurn({ system: '', messages, tools: [] });
      const r2 = await provider.streamTurn({ system: '', messages, tools: [] });
      expect(r1).toEqual(r2);
    });
  });
});
