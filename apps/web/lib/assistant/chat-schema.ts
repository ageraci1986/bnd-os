import { z } from 'zod';

/** L'historique côté client est du texte pur : les blocs tool ne sortent jamais du serveur. */
export const ChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(20_000),
      }),
    )
    .max(40),
  message: z.string().trim().min(1).max(4_000),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** Événements SSE envoyés au client. */
export type ChatSseEvent =
  | { type: 'chunk'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; isError: boolean }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };
