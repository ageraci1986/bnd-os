import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AgentModule from '@nexushub/agent';
import { parseSseLines } from '@/features/assistant/lib/sse';
import type { ChatSseEvent } from '@/lib/assistant/chat-schema';

/**
 * Suivi revue finale 2a (Important 1) : test d'intégration du confirmer côté
 * route chat. Le registry est un VRAI `ToolRegistry` construit via `defineTool`
 * (un tool gated factice + un tool lecture factice nommé `search_mails`, dans
 * la whitelist widgets) ; `runTurn` est le vrai (`@nexushub/agent`) ; seul le
 * provider est scripté — c'est lui qui simule les tours du modèle.
 */

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  assertCsrfHeader: vi.fn(),
  check: vi.fn(),
  recordAudit: vi.fn(),
  workspaceFindUnique: vi.fn(),
  createPending: vi.fn(),
  awaitAnswer: vi.fn(),
  streamTurn: vi.fn(),
  gatedHandler: vi.fn(),
  readHandler: vi.fn(),
  adminHandler: vi.fn(),
  loadMemories: vi.fn(),
  runTurnSpy: vi.fn(),
}));

vi.mock('server-only', () => ({}));

// Wrappe le VRAI `runTurn` (@nexushub/agent) derrière un espion qui capture les
// deps reçues (notamment `deadlineAt`), sans changer son comportement — le
// registre `ToolRegistry`/`defineTool` importés dynamiquement par le mock
// `@/lib/assistant/tools` ci-dessous passe par ce même mock, donc on doit
// réexporter le reste du module tel quel.
vi.mock('@nexushub/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentModule>();
  return {
    ...actual,
    runTurn: (...args: Parameters<typeof actual.runTurn>): ReturnType<typeof actual.runTurn> => {
      mocks.runTurnSpy(...args);
      return actual.runTurn(...args);
    },
  };
});

vi.mock('@/lib/auth', () => ({ getAuthContext: mocks.getAuthContext }));
vi.mock('@/lib/csrf', () => ({ assertCsrfHeader: mocks.assertCsrfHeader }));
vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: () => ({ check: mocks.check }),
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@nexushub/db', () => ({
  prisma: { workspace: { findUnique: mocks.workspaceFindUnique } },
}));
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({ ANTHROPIC_API_KEY: 'sk-test-key', ASSISTANT_MODEL: undefined }),
}));
vi.mock('@/lib/assistant/confirm-store', () => ({
  getConfirmStore: () => ({
    createPending: mocks.createPending,
    awaitAnswer: mocks.awaitAnswer,
  }),
}));
vi.mock('@/lib/assistant/memory', () => ({ loadMemories: mocks.loadMemories }));

vi.mock('@/lib/assistant/provider', () => ({
  createAnthropicProvider: () => ({ streamTurn: mocks.streamTurn }),
  ProviderError: class FakeProviderError extends Error {},
}));

// Registry RÉEL (@nexushub/agent : ToolRegistry + defineTool), pas un stub —
// on veut exercer le vrai chemin gated/read plutôt qu'un registry-maquette.
vi.mock('@/lib/assistant/tools', async () => {
  const { ToolRegistry, defineTool } = await import('@nexushub/agent');
  const { z } = await import('zod');
  return {
    buildRegistry: async () => {
      const registry = new ToolRegistry();
      registry.register(
        defineTool({
          name: 'fake_gated_tool',
          description: 'Tool gated factice pour les tests.',
          inputSchema: z.object({}),
          jsonSchema: { type: 'object', properties: {} },
          gated: true,
          describeForConfirm: () => 'Exécuter le tool gated factice.',
          handler: async () => mocks.gatedHandler(),
        }),
      );
      // 'search_mails' : nom dans la whitelist WIDGET_TOOLS de la route.
      registry.register(
        defineTool({
          name: 'search_mails',
          description: 'Tool de lecture factice pour les tests.',
          inputSchema: z.object({}),
          jsonSchema: { type: 'object', properties: {} },
          handler: async () => mocks.readHandler(),
        }),
      );
      // Tool adminOnly + gated factice (Plan 5b Task 5, ex: change_member_role) —
      // exerce le vrai chemin `run-turn.ts` : le garde adminOnly précède le gate
      // de confirmation, donc un rôle non-admin est refusé AVANT tout
      // confirm_request/exécution.
      registry.register(
        defineTool({
          name: 'fake_admin_tool',
          description: 'Tool admin-only factice pour les tests.',
          inputSchema: z.object({}),
          jsonSchema: { type: 'object', properties: {} },
          adminOnly: true,
          gated: true,
          describeForConfirm: () => 'Exécuter le tool admin-only factice.',
          handler: async () => mocks.adminHandler(),
        }),
      );
      return registry;
    },
  };
});

import { POST } from './route';

const ctx = { userId: 'u1', email: 'a@b.c', workspaceId: 'w1', role: 'user', isSuperAdmin: false };

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'tok' },
    body: JSON.stringify(body),
  });
}

async function readEvents(res: Response): Promise<ChatSseEvent[]> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('response has no body');
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) text += decoder.decode(value, { stream: true });
    if (done) break;
  }
  return parseSseLines(text).events;
}

function findEvent<T extends ChatSseEvent['type']>(
  events: readonly ChatSseEvent[],
  type: T,
): Extract<ChatSseEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<ChatSseEvent, { type: T }> => e.type === type);
}

/** Round modèle scripté : tool_use unique sur `toolName`. */
function toolUseRound(toolName: string, input: unknown = {}) {
  return {
    content: [{ type: 'tool_use', id: 'call-1', name: toolName, input }],
    text: '',
    stopReason: 'tool_use' as const,
    toolCalls: [{ id: 'call-1', name: toolName, input }],
    inputTokens: 10,
    outputTokens: 5,
  };
}

/** Round modèle scripté : fin de tour, texte final. */
function endTurnRound(text = 'Fait.') {
  return {
    content: [{ type: 'text', text }],
    text,
    stopReason: 'end_turn' as const,
    toolCalls: [],
    inputTokens: 3,
    outputTokens: 2,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAuthContext.mockResolvedValue(ctx);
  mocks.assertCsrfHeader.mockResolvedValue(undefined);
  mocks.check.mockResolvedValue({ success: true, remaining: 29, reset: Date.now() + 60_000 });
  mocks.workspaceFindUnique.mockResolvedValue({ name: 'Acme' });
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.createPending.mockResolvedValue('a'.repeat(32));
  mocks.loadMemories.mockResolvedValue([]);
});

describe('POST /api/assistant/chat — confirmer', () => {
  it('happy path gated : confirm_request → confirm_resolved(true) → tool exécuté → done', async () => {
    mocks.streamTurn
      .mockResolvedValueOnce(toolUseRound('fake_gated_tool'))
      .mockResolvedValueOnce(endTurnRound());
    mocks.awaitAnswer.mockResolvedValue(true);
    mocks.gatedHandler.mockResolvedValue('Action gated exécutée.');

    const res = await POST(makeRequest({ messages: [], message: 'Fais le truc gated.' }));
    expect(res.status).toBe(200);
    const events = await readEvents(res);

    const confirmRequest = findEvent(events, 'confirm_request');
    expect(confirmRequest).toBeDefined();
    expect(confirmRequest?.id).toMatch(/^[0-9a-f]{32}$/);
    expect(confirmRequest?.tool).toBe('fake_gated_tool');
    expect(confirmRequest?.description.length).toBeGreaterThan(0);

    const confirmResolved = findEvent(events, 'confirm_resolved');
    expect(confirmResolved).toEqual({
      type: 'confirm_resolved',
      id: confirmRequest?.id,
      allowed: true,
    });

    const toolEnd = findEvent(events, 'tool_end');
    expect(toolEnd).toEqual({ type: 'tool_end', name: 'fake_gated_tool', isError: false });

    expect(findEvent(events, 'done')).toBeDefined();

    // Le handler du tool gated a bien tourné.
    expect(mocks.gatedHandler).toHaveBeenCalledTimes(1);

    // Ordre : confirm_request avant confirm_resolved avant tool_start/tool_end.
    const order = events.map((e) => e.type);
    expect(order.indexOf('confirm_request')).toBeLessThan(order.indexOf('confirm_resolved'));
    expect(order.indexOf('confirm_resolved')).toBeLessThan(order.indexOf('tool_end'));

    // Audits : assistant_gate (tool + allowed) et assistant_turn.
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assistant_gate',
        data: { tool: 'fake_gated_tool', allowed: true },
      }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assistant_turn' }),
    );
  });

  it('deny : awaitAnswer → false → tool jamais exécuté, confirm_resolved(false)', async () => {
    mocks.streamTurn
      .mockResolvedValueOnce(toolUseRound('fake_gated_tool'))
      .mockResolvedValueOnce(endTurnRound());
    mocks.awaitAnswer.mockResolvedValue(false);
    mocks.gatedHandler.mockResolvedValue('Ne devrait jamais tourner.');

    const res = await POST(makeRequest({ messages: [], message: 'Fais le truc gated.' }));
    const events = await readEvents(res);

    const confirmRequest = findEvent(events, 'confirm_request');
    expect(confirmRequest).toBeDefined();
    const confirmResolved = findEvent(events, 'confirm_resolved');
    expect(confirmResolved).toEqual({
      type: 'confirm_resolved',
      id: confirmRequest?.id,
      allowed: false,
    });

    expect(findEvent(events, 'tool_start')).toBeUndefined();
    expect(findEvent(events, 'tool_end')).toBeUndefined();
    expect(mocks.gatedHandler).not.toHaveBeenCalled();
    expect(findEvent(events, 'done')).toBeDefined();

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assistant_gate',
        data: { tool: 'fake_gated_tool', allowed: false },
      }),
    );
  });

  it('awaitAnswer rejette : confirm_resolved(false) émis quand même, tool non exécuté, done', async () => {
    mocks.streamTurn
      .mockResolvedValueOnce(toolUseRound('fake_gated_tool'))
      .mockResolvedValueOnce(endTurnRound());
    mocks.awaitAnswer.mockRejectedValue(new Error('Redis down'));
    mocks.gatedHandler.mockResolvedValue('Ne devrait jamais tourner.');

    const res = await POST(makeRequest({ messages: [], message: 'Fais le truc gated.' }));
    expect(res.status).toBe(200);
    const events = await readEvents(res);

    const confirmRequest = findEvent(events, 'confirm_request');
    expect(confirmRequest).toBeDefined();
    const confirmResolved = findEvent(events, 'confirm_resolved');
    expect(confirmResolved).toEqual({
      type: 'confirm_resolved',
      id: confirmRequest?.id,
      allowed: false,
    });

    expect(findEvent(events, 'tool_start')).toBeUndefined();
    expect(findEvent(events, 'tool_end')).toBeUndefined();
    expect(mocks.gatedHandler).not.toHaveBeenCalled();

    // Invariant : le tour continue malgré l'échec du canal de confirmation.
    expect(findEvent(events, 'done')).toBeDefined();
    expect(findEvent(events, 'error')).toBeUndefined();

    // L'audit assistant_gate n'est journalisé qu'après une réponse résolue —
    // il n'est jamais atteint sur ce chemin d'échec technique.
    expect(mocks.recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assistant_gate' }),
    );
  });
});

describe('POST /api/assistant/chat — budget temps du tour', () => {
  it('passe deadlineAt ≈ maintenant + TURN_TIME_BUDGET_MS (540s) à runTurn', async () => {
    mocks.streamTurn.mockResolvedValueOnce(endTurnRound());

    const before = Date.now();
    const res = await POST(makeRequest({ messages: [], message: 'Bonjour' }));
    const after = Date.now();
    expect(res.status).toBe(200);
    await readEvents(res);

    expect(mocks.runTurnSpy).toHaveBeenCalledTimes(1);
    const call = mocks.runTurnSpy.mock.calls[0] as [unknown, unknown, { deadlineAt?: number }];
    const deadlineAt = call[2].deadlineAt;
    expect(deadlineAt).toBeDefined();
    expect(deadlineAt).toBeGreaterThanOrEqual(before + 540_000);
    expect(deadlineAt).toBeLessThanOrEqual(after + 540_000);
  });
});

describe('POST /api/assistant/chat — indisponibilité avant stream', () => {
  it('loadMemories rejette → 500 JSON, aucun flux SSE ouvert', async () => {
    mocks.loadMemories.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await POST(makeRequest({ messages: [], message: 'Bonjour' }));

    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).not.toBe('text/event-stream');
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).not.toContain('ECONNREFUSED');
    // Le tour n'a jamais démarré : aucun appel provider.
    expect(mocks.streamTurn).not.toHaveBeenCalled();
  });
});

describe('POST /api/assistant/chat — tool_result (widgets)', () => {
  it('émis pour un tool whitelisté (search_mails) avec sortie JSON', async () => {
    const payload = { mails: [{ id: 'm1', subject: 'Bonjour' }] };
    mocks.streamTurn
      .mockResolvedValueOnce(toolUseRound('search_mails'))
      .mockResolvedValueOnce(endTurnRound());
    mocks.readHandler.mockResolvedValue(JSON.stringify(payload));

    const res = await POST(makeRequest({ messages: [], message: 'Mails non lus ?' }));
    const events = await readEvents(res);

    const toolResult = findEvent(events, 'tool_result');
    expect(toolResult).toEqual({ type: 'tool_result', tool: 'search_mails', data: payload });
  });

  it('absent quand la sortie dépasse 8 000 caractères, même pour un tool whitelisté', async () => {
    const huge = JSON.stringify({ mails: ['x'.repeat(8_100)] });
    expect(huge.length).toBeGreaterThan(8_000);
    mocks.streamTurn
      .mockResolvedValueOnce(toolUseRound('search_mails'))
      .mockResolvedValueOnce(endTurnRound());
    mocks.readHandler.mockResolvedValue(huge);

    const res = await POST(makeRequest({ messages: [], message: 'Mails non lus ?' }));
    const events = await readEvents(res);

    expect(findEvent(events, 'tool_result')).toBeUndefined();
    // Le tool a bien tourné (isError:false) — seul le widget est absent.
    expect(findEvent(events, 'tool_end')).toEqual({
      type: 'tool_end',
      name: 'search_mails',
      isError: false,
    });
  });

  it('absent quand la sortie du tool whitelisté n’est pas du JSON valide', async () => {
    mocks.streamTurn
      .mockResolvedValueOnce(toolUseRound('search_mails'))
      .mockResolvedValueOnce(endTurnRound());
    mocks.readHandler.mockResolvedValue('3 mails trouvés (texte libre, pas de JSON).');

    const res = await POST(makeRequest({ messages: [], message: 'Mails non lus ?' }));
    const events = await readEvents(res);

    expect(findEvent(events, 'tool_result')).toBeUndefined();
    expect(findEvent(events, 'tool_end')).toEqual({
      type: 'tool_end',
      name: 'search_mails',
      isError: false,
    });
  });
});

describe('POST /api/assistant/chat — garde adminOnly (Plan 5b Task 5)', () => {
  it('rôle user + tool adminOnly appelé → refus dur du registry, sans confirm_request ni exécution', async () => {
    // ctx par défaut (beforeEach) a role: 'user' — pas besoin de le redéfinir.
    mocks.streamTurn
      .mockResolvedValueOnce(toolUseRound('fake_admin_tool'))
      .mockResolvedValueOnce(endTurnRound());

    const res = await POST(makeRequest({ messages: [], message: 'Change le rôle de Bob.' }));
    expect(res.status).toBe(200);
    const events = await readEvents(res);

    // Le garde adminOnly (`executeGated` dans run-turn.ts) précède le gate de
    // confirmation : aucun dialog n'est jamais proposé pour un tool que le
    // rôle courant ne peut de toute façon pas exécuter.
    expect(findEvent(events, 'confirm_request')).toBeUndefined();
    expect(findEvent(events, 'confirm_resolved')).toBeUndefined();
    expect(findEvent(events, 'tool_start')).toBeUndefined();
    expect(findEvent(events, 'tool_end')).toBeUndefined();
    expect(mocks.adminHandler).not.toHaveBeenCalled();
    expect(findEvent(events, 'done')).toBeDefined();

    // Pas d'audit assistant_gate (jamais atteint : le refus se joue avant le
    // confirmer côté route) — seul assistant_turn est journalisé.
    expect(mocks.recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assistant_gate' }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assistant_turn' }),
    );

    // Le refus (message user-safe, sans PII) est bien renvoyé au modèle comme
    // résultat du tool_use, quelque part dans l'historique reconstruit.
    // Note : `messages` est le même tableau muté en place au fil des rounds
    // (run-turn.ts pousse dedans après chaque round) — l'inspecter après coup
    // via `mock.calls` en donne l'état FINAL, pas l'état au moment de l'appel ;
    // c'est pourquoi on cherche dans tout le tableau plutôt qu'à une position
    // fixe (ex: `.at(-1)`, qui pointerait vers le texte final « Fait. »).
    const secondCall = mocks.streamTurn.mock.calls[1]?.[0] as { messages: unknown[] } | undefined;
    expect(JSON.stringify(secondCall?.messages)).toContain('administrateur');
  });
});
