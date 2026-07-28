import { describe, expect, it } from 'vitest';
import { ChatRequestSchema, ChatSseEventSchema } from './chat-schema';

describe('ChatRequestSchema', () => {
  it('accepte un historique texte et un message', () => {
    const parsed = ChatRequestSchema.safeParse({
      messages: [
        { role: 'user', content: 'salut' },
        { role: 'assistant', content: 'bonjour' },
      ],
      message: 'quelles sont mes tâches ?',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuse un message vide, un rôle inconnu, un historique trop long', () => {
    expect(ChatRequestSchema.safeParse({ messages: [], message: '' }).success).toBe(false);
    expect(
      ChatRequestSchema.safeParse({ messages: [{ role: 'system', content: 'x' }], message: 'ok' })
        .success,
    ).toBe(false);
    expect(
      ChatRequestSchema.safeParse({
        messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })),
        message: 'ok',
      }).success,
    ).toBe(false);
  });

  it('refuse un message d historique au contenu vide', () => {
    expect(
      ChatRequestSchema.safeParse({
        messages: [{ role: 'assistant', content: '' }],
        message: 'ok',
      }).success,
    ).toBe(false);
  });

  it('refuse une requête dépassant le volume total (10 × 20k chars)', () => {
    expect(
      ChatRequestSchema.safeParse({
        messages: Array.from({ length: 10 }, () => ({
          role: 'user',
          content: 'x'.repeat(20_000),
        })),
        message: 'ok',
      }).success,
    ).toBe(false);
  });
});

describe('ChatSseEventSchema', () => {
  it('accepte les 8 types et rejette un type inconnu ou un id malformé', () => {
    expect(ChatSseEventSchema.safeParse({ type: 'chunk', text: 'x' }).success).toBe(true);
    expect(
      ChatSseEventSchema.safeParse({
        type: 'confirm_request',
        id: 'a'.repeat(32),
        tool: 'delete_card',
        description: 'd',
      }).success,
    ).toBe(true);
    expect(
      ChatSseEventSchema.safeParse({
        type: 'confirm_request',
        id: 'court',
        tool: 'delete_card',
        description: 'd',
      }).success,
    ).toBe(false);
    expect(ChatSseEventSchema.safeParse({ type: 'hack', foo: 1 }).success).toBe(false);
  });

  it('refuse confirm_request sans tool', () => {
    expect(
      ChatSseEventSchema.safeParse({
        type: 'confirm_request',
        id: 'a'.repeat(32),
        description: 'd',
      }).success,
    ).toBe(false);
  });

  it('accepte tool_result avec des données arbitraires', () => {
    expect(
      ChatSseEventSchema.safeParse({
        type: 'tool_result',
        tool: 'get_today_overview',
        data: { blockedCount: 2 },
      }).success,
    ).toBe(true);
    expect(
      ChatSseEventSchema.safeParse({ type: 'tool_result', tool: 'x', data: null }).success,
    ).toBe(true);
  });
});
