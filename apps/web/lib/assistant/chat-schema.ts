import { z } from 'zod';

/** L'historique côté client est du texte pur : les blocs tool ne sortent jamais du serveur. */
export const ChatRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          // min(1) : un content vide dans l'historique est un 400 côté API Anthropic.
          content: z.string().min(1).max(20_000),
        }),
      )
      .max(40),
    message: z.string().trim().min(1).max(4_000),
  })
  // Cap global : sans lui, 40 messages × 20k chars passeraient (~800k chars par requête).
  .refine(
    (r) => r.messages.reduce((n, m) => n + m.content.length, 0) + r.message.length <= 150_000,
    { message: 'Historique trop volumineux.' },
  );

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** Événements SSE — validés côté client (confirm_request est sensible). */
export const ChatSseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chunk'), text: z.string() }),
  z.object({ type: z.literal('tool_start'), name: z.string() }),
  z.object({ type: z.literal('tool_end'), name: z.string(), isError: z.boolean() }),
  z.object({
    type: z.literal('confirm_request'),
    id: z.string().regex(/^[0-9a-f]{32}$/),
    description: z.string().max(2000),
  }),
  z.object({
    type: z.literal('confirm_resolved'),
    id: z.string().regex(/^[0-9a-f]{32}$/),
    allowed: z.boolean(),
  }),
  z.object({ type: z.literal('done'), text: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

export type ChatSseEvent = z.infer<typeof ChatSseEventSchema>;
