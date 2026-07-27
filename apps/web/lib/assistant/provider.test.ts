import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, safeOnText, toProviderError, toTurnResult } from './provider';

function fakeFinalMessage(overrides: Record<string, unknown> = {}) {
  return {
    content: [
      { type: 'text', text: 'Bonjour', citations: null },
      { type: 'tool_use', id: 'tu_1', name: 'lookup', input: { q: 'x' } },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 12, output_tokens: 7 },
    ...overrides,
  } as unknown as Anthropic.Message;
}

describe('toTurnResult', () => {
  it('mappe texte, tool calls, tokens et stop_reason', () => {
    const result = toTurnResult(fakeFinalMessage());
    expect(result.text).toBe('Bonjour');
    expect(result.toolCalls).toEqual([{ id: 'tu_1', name: 'lookup', input: { q: 'x' } }]);
    expect(result.stopReason).toBe('tool_use');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(7);
    // Les blocs sont sérialisés en objets simples réinjectables
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'Bonjour' });
  });

  it('stop_reason inconnu → other', () => {
    const result = toTurnResult(fakeFinalMessage({ stop_reason: 'pause_turn' }));
    expect(result.stopReason).toBe('other');
  });

  it('max_tokens : toolCalls reflète quand même les blocs tool_use du content (contrat du seam)', () => {
    const result = toTurnResult(fakeFinalMessage({ stop_reason: 'max_tokens' }));
    expect(result.stopReason).toBe('max_tokens');
    expect(result.toolCalls).toEqual([{ id: 'tu_1', name: 'lookup', input: { q: 'x' } }]);
  });
});

describe('toProviderError', () => {
  it('erreur d authentification → message clé API', () => {
    const err = Object.create(
      Anthropic.AuthenticationError.prototype,
    ) as Anthropic.AuthenticationError;
    expect(toProviderError(err).message).toContain('clé API');
  });

  it('rate limit → message patienter', () => {
    const err = Object.create(Anthropic.RateLimitError.prototype) as Anthropic.RateLimitError;
    expect(toProviderError(err).message).toContain('sollicité');
  });

  it('erreur de connexion → message réseau', () => {
    // `Anthropic.APIConnectionError` is a namespace value (class), not an exported
    // type in this SDK version — use InstanceType<> to get the instance type.
    const err = Object.create(Anthropic.APIConnectionError.prototype) as InstanceType<
      typeof Anthropic.APIConnectionError
    >;
    expect(toProviderError(err).message).toContain('joindre');
  });

  it('erreur API générique → message avec le statut HTTP', () => {
    // Object.create saute le constructeur — status posé manuellement.
    const err = Object.assign(Object.create(Anthropic.BadRequestError.prototype) as object, {
      status: 400,
    }) as InstanceType<typeof Anthropic.BadRequestError>;
    expect(toProviderError(err).message).toContain('400');
  });

  it('ProviderError déjà mappée → retourne la MÊME instance, message intact', () => {
    const original = new ProviderError('clé manquante');
    const mapped = toProviderError(original);
    expect(mapped).toBe(original);
    expect(mapped.message).toBe('clé manquante');
  });

  it('erreur inconnue → message générique, instance ProviderError', () => {
    const mapped = toProviderError(new Error('interne'));
    expect(mapped).toBeInstanceOf(ProviderError);
    expect(mapped.message).toContain('réessayer');
  });
});

describe('safeOnText', () => {
  it('transmet chaque chunk au callback', () => {
    const onText = vi.fn();
    const guarded = safeOnText(onText);
    guarded('Bon');
    guarded('jour');
    expect(onText).toHaveBeenNthCalledWith(1, 'Bon');
    expect(onText).toHaveBeenNthCalledWith(2, 'jour');
  });

  it('avale une exception du callback (ex: écriture SSE sur client déconnecté)', () => {
    const onText = vi.fn(() => {
      throw new Error('SSE write failed');
    });
    const guarded = safeOnText(onText);
    expect(() => {
      guarded('chunk-1');
    }).not.toThrow();
    // Le stream continue : les chunks suivants atteignent toujours le callback.
    expect(() => {
      guarded('chunk-2');
    }).not.toThrow();
    expect(onText).toHaveBeenCalledTimes(2);
  });
});
