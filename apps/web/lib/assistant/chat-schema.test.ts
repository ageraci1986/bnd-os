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
