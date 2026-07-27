import { describe, expect, it } from 'vitest';
import { ChatRequestSchema } from './chat-schema';

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
});
