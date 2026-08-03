import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from './registry';
import { MAX_TOOL_ROUNDS, autoDeny, describeAction, runTurn } from './run-turn';
import type { ChatMessage, Provider, ProviderTurnResult, ToolSpec } from './types';

function textResult(text: string): ProviderTurnResult {
  return {
    content: [{ type: 'text', text }],
    text,
    stopReason: 'end_turn',
    toolCalls: [],
    inputTokens: 10,
    outputTokens: 5,
  };
}

function toolUseResult(name: string, input: unknown, id = 'tu_1'): ProviderTurnResult {
  return {
    content: [{ type: 'tool_use', id, name, input }],
    text: '',
    stopReason: 'tool_use',
    toolCalls: [{ id, name, input }],
    inputTokens: 10,
    outputTokens: 5,
  };
}

function scriptedProvider(results: ProviderTurnResult[]): Provider {
  let call = 0;
  return {
    streamTurn: vi.fn(async ({ onText }) => {
      const result = results[call];
      if (result === undefined) throw new Error('provider script exhausted');
      call += 1;
      if (onText !== undefined && result.text !== '') onText(result.text);
      return result;
    }),
  };
}

function makeRegistry(specs: Partial<ToolSpec>[] = []): ToolRegistry {
  const registry = new ToolRegistry();
  for (const [i, spec] of specs.entries()) {
    registry.register({
      name: `tool_${String(i)}`,
      description: 'test tool',
      inputSchema: z.object({}).passthrough(),
      jsonSchema: { type: 'object', properties: {} },
      gated: false,
      adminOnly: false,
      handler: (async () => 'ok') as ToolSpec['handler'],
      ...spec,
    });
  }
  return registry;
}

function deps(
  provider: Provider,
  registry: ToolRegistry,
  extra: Partial<Parameters<typeof runTurn>[2]> = {},
) {
  return {
    provider,
    registry,
    system: 'système',
    confirmer: autoDeny,
    role: 'user' as const,
    ...extra,
  };
}

describe('runTurn', () => {
  it('tour simple sans tool : renvoie le texte et un historique complet', async () => {
    const provider = scriptedProvider([textResult('Bonjour !')]);
    const result = await runTurn([], 'Salut', deps(provider, makeRegistry()));
    expect(result.text).toBe('Bonjour !');
    expect(result.history).toEqual([
      { role: 'user', content: 'Salut' },
      { role: 'assistant', content: [{ type: 'text', text: 'Bonjour !' }] },
    ]);
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
  });

  it('round de tool : exécute, réinjecte le résultat, continue', async () => {
    const handler = vi.fn(async () => 'résultat-tool');
    const registry = makeRegistry([{ name: 'lookup', handler: handler as ToolSpec['handler'] }]);
    const provider = scriptedProvider([toolUseResult('lookup', { q: 'x' }), textResult('Fini')]);
    const events: unknown[] = [];
    const result = await runTurn(
      [],
      'Question',
      deps(provider, registry, { onEvent: (e) => void events.push(e) }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('Fini');
    // Le tool_result est réinjecté comme message user
    const toolResultMsg = result.history[2];
    expect(toolResultMsg?.role).toBe('user');
    expect(toolResultMsg?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'résultat-tool', is_error: false },
    ]);
    expect(events).toEqual([
      { type: 'tool_start', name: 'lookup' },
      { type: 'tool_end', name: 'lookup', isError: false, output: 'résultat-tool' },
    ]);
  });

  it('cumule les tokens sur plusieurs rounds', async () => {
    const registry = makeRegistry([{ name: 'lookup' }]);
    const provider = scriptedProvider([toolUseResult('lookup', {}), textResult('Fini')]);
    const result = await runTurn([], 'Q', deps(provider, registry));
    expect(result.inputTokens).toBe(20);
    expect(result.outputTokens).toBe(10);
  });

  it('tool gated + confirmer refuse → le tool ne tourne pas, note claire au modèle', async () => {
    const handler = vi.fn(async () => 'jamais');
    const registry = makeRegistry([
      { name: 'danger', gated: true, handler: handler as ToolSpec['handler'] },
    ]);
    const provider = scriptedProvider([
      toolUseResult('danger', {}),
      textResult("D'accord, j'annule."),
    ]);
    const confirmer = vi.fn(async () => false);
    const result = await runTurn([], 'Vas-y', deps(provider, registry, { confirmer }));
    expect(confirmer).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
    const toolResultMsg = result.history[2];
    expect(JSON.stringify(toolResultMsg?.content)).toContain('refusée');
  });

  it('tool gated + confirmer accepte → exécution (un oui = une exécution)', async () => {
    const handler = vi.fn(async () => 'fait');
    const registry = makeRegistry([
      { name: 'danger', gated: true, handler: handler as ToolSpec['handler'] },
    ]);
    const provider = scriptedProvider([
      toolUseResult('danger', {}, 'tu_1'),
      toolUseResult('danger', {}, 'tu_2'),
      textResult('Fini'),
    ]);
    const confirmer = vi.fn(async () => true);
    await runTurn([], 'Deux fois', deps(provider, registry, { confirmer }));
    // Chaque exécution redemande : 2 appels au confirmer pour 2 tool calls
    expect(confirmer).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('émet confirm_request avant de demander, avec le nom du tool', async () => {
    const registry = makeRegistry([{ name: 'danger', gated: true }]);
    const provider = scriptedProvider([toolUseResult('danger', { a: 1 }), textResult('ok')]);
    const events: { type: string }[] = [];
    await runTurn(
      [],
      'x',
      deps(provider, registry, {
        confirmer: async () => true,
        onEvent: (e) => void events.push(e),
      }),
    );
    expect(events.map((e) => e.type)).toEqual(['confirm_request', 'tool_start', 'tool_end']);
    expect(events[0]).toMatchObject({ type: 'confirm_request', tool: 'danger' });
  });

  it('confirmer reçoit (description, name)', async () => {
    const registry = makeRegistry([{ name: 'danger', gated: true }]);
    const provider = scriptedProvider([toolUseResult('danger', { a: 1 }), textResult('ok')]);
    const confirmer = vi.fn(async () => true);
    await runTurn([], 'x', deps(provider, registry, { confirmer }));
    expect(confirmer).toHaveBeenCalledWith('danger (a=1)', 'danger');
  });

  it('describeForConfirm du tool est utilisé pour la description quand présent', async () => {
    const registry = makeRegistry([
      {
        name: 'danger',
        gated: true,
        describeForConfirm: ((input: { a: number }) =>
          `envoyer ${String(input.a)}`) as ToolSpec['describeForConfirm'],
      },
    ]);
    const provider = scriptedProvider([toolUseResult('danger', { a: 1 }), textResult('ok')]);
    const confirmer = vi.fn(async () => true);
    const events: { type: string; description?: string }[] = [];
    await runTurn(
      [],
      'x',
      deps(provider, registry, { confirmer, onEvent: (e) => void events.push(e) }),
    );
    expect(confirmer).toHaveBeenCalledWith('envoyer 1', 'danger');
    expect(events[0]).toMatchObject({ type: 'confirm_request', description: 'envoyer 1' });
  });

  it('describeForConfirm qui throw → repli sur describeAction, le gate fonctionne toujours', async () => {
    const handler = vi.fn(async () => 'fait');
    const registry = makeRegistry([
      {
        name: 'danger',
        gated: true,
        handler: handler as ToolSpec['handler'],
        describeForConfirm: (() => {
          throw new Error('boom description');
        }) as ToolSpec['describeForConfirm'],
      },
    ]);
    const provider = scriptedProvider([toolUseResult('danger', { a: 1 }), textResult('ok')]);
    const confirmer = vi.fn(async () => true);
    await runTurn([], 'x', deps(provider, registry, { confirmer }));
    expect(confirmer).toHaveBeenCalledWith('danger (a=1)', 'danger');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('accepte un describeForConfirm async et attend sa résolution avant le Confirmer', async () => {
    const registry = makeRegistry([
      {
        name: 'danger',
        gated: true,
        describeForConfirm: (async (input: { id: string }) =>
          `Supprimer « Vrai Nom » (${input.id}) — 3 cartes`) as ToolSpec['describeForConfirm'],
      },
    ]);
    const provider = scriptedProvider([
      toolUseResult('danger', { id: 'card_1' }),
      textResult('ok'),
    ]);
    const confirmer = vi.fn(async () => true);
    await runTurn([], 'x', deps(provider, registry, { confirmer }));
    expect(confirmer).toHaveBeenCalledWith('Supprimer « Vrai Nom » (card_1) — 3 cartes', 'danger');
  });

  it('describeForConfirm async qui rejette → repli sur describeAction, pas de fuite', async () => {
    const handler = vi.fn(async () => 'fait');
    const registry = makeRegistry([
      {
        name: 'danger',
        gated: true,
        handler: handler as ToolSpec['handler'],
        describeForConfirm: (async () => {
          throw new Error('secret interne');
        }) as ToolSpec['describeForConfirm'],
      },
    ]);
    const provider = scriptedProvider([toolUseResult('danger', { a: 1 }), textResult('ok')]);
    const confirmer = vi.fn(async () => true);
    await runTurn([], 'x', deps(provider, registry, { confirmer }));
    const [description, toolName] = confirmer.mock.calls[0] as [string, string];
    expect(description).not.toContain('secret interne');
    expect(description).toBe('danger (a=1)');
    expect(toolName).toBe('danger');
    // Le repli ne doit pas empêcher l'exécution une fois confirmée (symétrie du cas sync-throw)
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('tool adminOnly appelé par un non-admin → refus propre sans exécution ni confirmation', async () => {
    const handler = vi.fn(async () => 'jamais');
    const confirmer = vi.fn(async () => true);
    const registry = makeRegistry([
      {
        name: 'admin_thing',
        adminOnly: true,
        gated: true,
        handler: handler as ToolSpec['handler'],
      },
    ]);
    const provider = scriptedProvider([toolUseResult('admin_thing', {}), textResult('ok')]);
    const result = await runTurn([], 'x', deps(provider, registry, { role: 'user', confirmer }));
    expect(handler).not.toHaveBeenCalled();
    expect(confirmer).not.toHaveBeenCalled();
    expect(JSON.stringify(result.history[2]?.content)).toContain('administrateur');
  });

  it('tool adminOnly + role admin → exécution normale', async () => {
    const handler = vi.fn(async () => 'fait');
    const registry = makeRegistry([
      { name: 'admin_thing', adminOnly: true, handler: handler as ToolSpec['handler'] },
    ]);
    const provider = scriptedProvider([toolUseResult('admin_thing', {}), textResult('ok')]);
    await runTurn([], 'x', deps(provider, registry, { role: 'admin' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('garde-fou MAX_TOOL_ROUNDS : stoppe avec un message d excuse', async () => {
    const registry = makeRegistry([{ name: 'loop' }]);
    const provider = scriptedProvider(
      Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) =>
        toolUseResult('loop', {}, `tu_${String(i)}`),
      ),
    );
    const result = await runTurn([], 'x', deps(provider, registry));
    expect(result.text).toContain('reformuler');
    expect(result.history.at(-1)).toEqual({ role: 'assistant', content: result.text });
  });

  it('stopReason refusal sans texte → message de refus par défaut', async () => {
    const provider = scriptedProvider([{ ...textResult(''), stopReason: 'refusal' }]);
    const result = await runTurn([], 'x', deps(provider, makeRegistry()));
    expect(result.text).not.toBe('');
    expect(result.history.at(-1)?.role).toBe('assistant');
  });

  it('stopReason refusal avec texte → réutilise le texte du modèle', async () => {
    const provider = scriptedProvider([
      { ...textResult('Je ne peux pas faire ça.'), stopReason: 'refusal' },
    ]);
    const result = await runTurn([], 'x', deps(provider, makeRegistry()));
    expect(result.text).toBe('Je ne peux pas faire ça.');
  });

  it('transmet onText au provider quand fourni', async () => {
    const provider = scriptedProvider([textResult('Bonjour')]);
    const onText = vi.fn();
    await runTurn([], 'x', deps(provider, makeRegistry(), { onText }));
    expect(onText).toHaveBeenCalledWith('Bonjour');
  });

  it("échec provider → l'historique d'entrée n'est pas modifié", async () => {
    const provider: Provider = {
      streamTurn: async () => {
        throw new Error('réseau KO');
      },
    };
    const history: ChatMessage[] = [{ role: 'user', content: 'avant' }];
    await expect(runTurn(history, 'x', deps(provider, makeRegistry()))).rejects.toThrow(
      'réseau KO',
    );
    expect(history).toEqual([{ role: 'user', content: 'avant' }]);
  });

  it('concatène le texte de tous les rounds dans la réponse finale', async () => {
    const registry = makeRegistry([{ name: 'lookup' }]);
    const provider = scriptedProvider([
      {
        ...toolUseResult('lookup', {}),
        text: 'Je regarde…',
        content: [
          { type: 'text', text: 'Je regarde…' },
          { type: 'tool_use', id: 'tu_1', name: 'lookup', input: {} },
        ],
      },
      textResult('Voilà.'),
    ]);
    const result = await runTurn([], 'x', deps(provider, registry));
    expect(result.text).toBe('Je regarde…\nVoilà.');
  });

  it('autoDeny refuse toujours (2 args ignorés)', async () => {
    await expect(autoDeny('peu importe', 'un_tool')).resolves.toBe(false);
  });

  it('describeAction avec une entrée non-objet (ex: string ou null) tombe sur String(input)', () => {
    expect(describeAction('ping', 'juste-un-texte')).toBe('ping (juste-un-texte)');
    expect(describeAction('ping', null)).toBe('ping (null)');
  });

  it('max_tokens avec tool_use tronqué → tool_result de clôture, pas d exécution', async () => {
    const handler = vi.fn(async () => 'jamais');
    const registry = makeRegistry([{ name: 'lookup', handler: handler as ToolSpec['handler'] }]);
    const provider = scriptedProvider([
      { ...toolUseResult('lookup', { q: 'x' }), stopReason: 'max_tokens' },
    ]);
    const result = await runTurn([], 'x', deps(provider, registry));
    expect(handler).not.toHaveBeenCalled();
    // L'historique reste valide côté API : chaque tool_use a son tool_result
    const closing = result.history.at(-1);
    expect(closing?.role).toBe('user');
    expect(closing?.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'tu_1',
        content: 'Tour interrompu (limite de tokens atteinte) — action non exécutée.',
        is_error: true,
      },
    ]);
  });

  it('stop non-tool_use sans toolCalls → pas de tool_result de clôture', async () => {
    const provider = scriptedProvider([textResult('Bonjour')]);
    const result = await runTurn([], 'x', deps(provider, makeRegistry()));
    expect(result.history).toHaveLength(2);
    expect(result.history.at(-1)?.role).toBe('assistant');
  });

  it('confirmer qui throw → fail closed, tool non exécuté, le tour continue', async () => {
    const handler = vi.fn(async () => 'jamais');
    const registry = makeRegistry([
      { name: 'danger', gated: true, handler: handler as ToolSpec['handler'] },
    ]);
    const provider = scriptedProvider([toolUseResult('danger', {}), textResult('Compris.')]);
    const confirmer = vi.fn(async () => {
      throw new Error('canal de confirmation mort');
    });
    const result = await runTurn([], 'x', deps(provider, registry, { confirmer }));
    expect(handler).not.toHaveBeenCalled();
    const toolResultMsg = result.history[2];
    expect(JSON.stringify(toolResultMsg?.content)).toContain('indisponible');
    expect(JSON.stringify(toolResultMsg?.content)).toContain('"is_error":true');
    expect(result.text).toBe('Compris.');
  });

  it('tool inconnu appelé par le modèle → tool_result is_error, pas de crash, le tour continue', async () => {
    const provider = scriptedProvider([toolUseResult('does_not_exist', {}), textResult('Désolé.')]);
    const result = await runTurn([], 'x', deps(provider, makeRegistry()));
    const toolResultMsg = result.history[2];
    expect(JSON.stringify(toolResultMsg?.content)).toContain('aucun tool');
    expect(JSON.stringify(toolResultMsg?.content)).toContain('"is_error":true');
    expect(result.text).toBe('Désolé.');
  });

  it('signal aborté entre deux rounds → stoppe à la frontière, provider appelé une seule fois', async () => {
    const controller = new AbortController();
    const registry = makeRegistry([
      {
        name: 'lookup',
        // Le client se déconnecte pendant l'exécution du tool du round 1.
        handler: (async () => {
          controller.abort();
          return 'résultat';
        }) as ToolSpec['handler'],
      },
    ]);
    const provider = scriptedProvider([
      {
        ...toolUseResult('lookup', {}),
        text: 'Je regarde…',
        content: [
          { type: 'text', text: 'Je regarde…' },
          { type: 'tool_use', id: 'tu_1', name: 'lookup', input: {} },
        ],
      },
      textResult('jamais atteint'),
    ]);
    const result = await runTurn([], 'x', deps(provider, registry, { signal: controller.signal }));
    expect(provider.streamTurn).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('Je regarde…');
    // L'historique reste API-valide : le tool_use du round 1 a son tool_result.
    expect(result.history.at(-1)?.role).toBe('user');
    expect(JSON.stringify(result.history.at(-1)?.content)).toContain('tool_result');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
  });

  it('signal fourni et non aborté → transmis au provider, comportement inchangé', async () => {
    const controller = new AbortController();
    const provider = scriptedProvider([textResult('Bonjour')]);
    const result = await runTurn(
      [],
      'x',
      deps(provider, makeRegistry(), { signal: controller.signal }),
    );
    expect(result.text).toBe('Bonjour');
    const streamTurnMock = provider.streamTurn as ReturnType<typeof vi.fn>;
    expect(streamTurnMock.mock.calls[0]?.[0]?.signal).toBe(controller.signal);
  });

  it('signal absent → aucun signal transmis au provider', async () => {
    const provider = scriptedProvider([textResult('Bonjour')]);
    await runTurn([], 'x', deps(provider, makeRegistry()));
    const streamTurnMock = provider.streamTurn as ReturnType<typeof vi.fn>;
    expect('signal' in (streamTurnMock.mock.calls[0]?.[0] as object)).toBe(false);
  });

  it('deadline dépassée AVANT le premier round → message standalone, stopReason deadline', async () => {
    const provider = scriptedProvider([textResult('jamais atteint')]);
    const onText = vi.fn();
    const result = await runTurn(
      [],
      'x',
      deps(provider, makeRegistry(), { deadlineAt: 1_000, now: () => 1_000, onText }),
    );
    expect(provider.streamTurn).not.toHaveBeenCalled();
    expect(result.text).toBe(
      "Le temps imparti pour ce tour est écoulé — j'ai déjà exécuté des actions ci-dessus. Dis « continue » pour poursuivre.",
    );
    expect(result.stopReason).toBe('deadline');
    expect(onText).toHaveBeenCalledWith(result.text);
    expect(result.history.at(-1)).toEqual({ role: 'assistant', content: result.text });
  });

  it('deadline dépassée APRÈS un round avec du texte → suffixe ajouté, emis via onText', async () => {
    const registry = makeRegistry([{ name: 'lookup' }]);
    const provider = scriptedProvider([
      {
        ...toolUseResult('lookup', {}),
        text: 'Je regarde…',
        content: [
          { type: 'text', text: 'Je regarde…' },
          { type: 'tool_use', id: 'tu_1', name: 'lookup', input: {} },
        ],
      },
      textResult('jamais atteint'),
    ]);
    const onText = vi.fn();
    // now() : 0 au round 1 (avant le deadline), >= deadline au round 2.
    let call = 0;
    const nowFn = () => {
      call += 1;
      return call === 1 ? 0 : 5_000;
    };
    const result = await runTurn(
      [],
      'x',
      deps(provider, registry, { deadlineAt: 5_000, now: nowFn, onText }),
    );
    expect(provider.streamTurn).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('deadline');
    expect(result.text).toBe(
      'Je regarde…\n\nJe me suis arrêté avant la fin (temps imparti écoulé) — dis « continue » pour poursuivre.',
    );
    // onText reçoit le chunk du round 1 PUIS uniquement le suffixe (pas le texte complet).
    expect(onText).toHaveBeenNthCalledWith(1, 'Je regarde…');
    expect(onText).toHaveBeenNthCalledWith(
      2,
      '\n\nJe me suis arrêté avant la fin (temps imparti écoulé) — dis « continue » pour poursuivre.',
    );
    expect(result.history.at(-1)).toEqual({ role: 'assistant', content: result.text });
  });

  it('deadlineAt absent → comportement inchangé, aucune vérification de temps', async () => {
    const provider = scriptedProvider([textResult('Bonjour')]);
    const result = await runTurn([], 'x', deps(provider, makeRegistry()));
    expect(result.text).toBe('Bonjour');
    expect(result.stopReason).toBeUndefined();
  });

  it('deadlineAt fourni mais now() encore avant l’échéance → tour complet, pas d’arrêt', async () => {
    const provider = scriptedProvider([textResult('Bonjour')]);
    const result = await runTurn(
      [],
      'x',
      deps(provider, makeRegistry(), { deadlineAt: 10_000, now: () => 0 }),
    );
    expect(result.text).toBe('Bonjour');
    expect(result.stopReason).toBeUndefined();
    expect(provider.streamTurn).toHaveBeenCalledTimes(1);
  });

  it('deux appels gated dans un même round : oui puis non → une seule exécution, deux tool_results', async () => {
    const handler = vi.fn(async () => 'fait');
    const registry = makeRegistry([
      { name: 'danger', gated: true, handler: handler as ToolSpec['handler'] },
    ]);
    const provider = scriptedProvider([
      {
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'danger', input: {} },
          { type: 'tool_use', id: 'tu_2', name: 'danger', input: {} },
        ],
        text: '',
        stopReason: 'tool_use',
        toolCalls: [
          { id: 'tu_1', name: 'danger', input: {} },
          { id: 'tu_2', name: 'danger', input: {} },
        ],
        inputTokens: 10,
        outputTokens: 5,
      },
      textResult('Fini'),
    ]);
    const confirmer = vi.fn(async () => confirmer.mock.calls.length === 1);
    const result = await runTurn([], 'x', deps(provider, registry, { confirmer }));
    expect(confirmer).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
    const toolResults = result.history[2]?.content as Record<string, unknown>[];
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]).toMatchObject({ tool_use_id: 'tu_1', content: 'fait' });
    expect(JSON.stringify(toolResults[1])).toContain('refusée');
    expect(toolResults[1]).toMatchObject({ tool_use_id: 'tu_2' });
  });
});
