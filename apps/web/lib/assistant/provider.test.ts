import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('génération interrompue (abort) → message dédié', () => {
    const err = Object.create(Anthropic.APIUserAbortError.prototype) as InstanceType<
      typeof Anthropic.APIUserAbortError
    >;
    const message = toProviderError(err).message;
    expect(message).toContain('interrompue');
    expect(message).not.toContain('undefined');
  });

  it('erreur d authentification → message générique sans nom de variable', () => {
    const err = Object.create(
      Anthropic.AuthenticationError.prototype,
    ) as Anthropic.AuthenticationError;
    const message = toProviderError(err).message;
    expect(message).toContain('administrateur');
    expect(message).not.toContain('ANTHROPIC_API_KEY');
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

/**
 * Sélection du provider par env (Plan 4 Task 4) — garde double : le mock E2E
 * n'est retourné que si ASSISTANT_E2E_MOCK === '1' ET NODE_ENV !== 'production'.
 * Chaque test mocke `@/lib/env` et `./e2e-provider` puis réimporte `./provider`
 * dynamiquement après `vi.resetModules()` pour isoler l'environnement simulé
 * (le provider réel, lui, ne doit JAMAIS être invoqué réseau ici : on vérifie
 * seulement QUEL provider a été construit, pas son comportement réseau).
 */
describe('createAnthropicProvider — sélection E2E', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/env');
    vi.doUnmock('./e2e-provider');
    vi.resetModules();
  });

  it("ASSISTANT_E2E_MOCK='1' + NODE_ENV='test' → provider scripté", async () => {
    const fakeE2EProvider = { streamTurn: vi.fn() };
    const createE2EProvider = vi.fn(() => fakeE2EProvider);
    vi.resetModules();
    vi.doMock('./e2e-provider', () => ({ createE2EProvider }));
    vi.doMock('@/lib/env', () => ({
      getServerEnv: () => ({ NODE_ENV: 'test', ASSISTANT_E2E_MOCK: '1' }),
    }));

    const { createAnthropicProvider } = await import('./provider');
    const provider = createAnthropicProvider();

    expect(createE2EProvider).toHaveBeenCalledTimes(1);
    expect(provider).toBe(fakeE2EProvider);
  });

  it("NODE_ENV='production' + ASSISTANT_E2E_MOCK='1' → provider réel (garde prod, jamais scripté)", async () => {
    const createE2EProvider = vi.fn();
    vi.resetModules();
    vi.doMock('./e2e-provider', () => ({ createE2EProvider }));
    vi.doMock('@/lib/env', () => ({
      getServerEnv: () => ({ NODE_ENV: 'production', ASSISTANT_E2E_MOCK: '1' }),
    }));

    const { createAnthropicProvider } = await import('./provider');
    const provider = createAnthropicProvider();

    expect(createE2EProvider).not.toHaveBeenCalled();
    expect(typeof provider.streamTurn).toBe('function');
    expect(provider.streamTurn).not.toBe(undefined);
  });

  it('ASSISTANT_E2E_MOCK absent → provider réel (comportement inchangé, preuve par les tests existants)', async () => {
    const createE2EProvider = vi.fn();
    vi.resetModules();
    vi.doMock('./e2e-provider', () => ({ createE2EProvider }));
    vi.doMock('@/lib/env', () => ({
      getServerEnv: () => ({ NODE_ENV: 'test', ASSISTANT_E2E_MOCK: undefined }),
    }));

    const { createAnthropicProvider } = await import('./provider');
    const provider = createAnthropicProvider();

    expect(createE2EProvider).not.toHaveBeenCalled();
    expect(typeof provider.streamTurn).toBe('function');
  });
});
