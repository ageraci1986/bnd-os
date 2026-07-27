import { ChatSseEventSchema, type ChatSseEvent } from '@/lib/assistant/chat-schema';

/** Découpe un buffer SSE en événements complets ; renvoie le fragment incomplet restant. */
export function parseSseLines(buffer: string): { events: ChatSseEvent[]; rest: string } {
  const events: ChatSseEvent[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith('data: ')) continue;
    try {
      const parsed = ChatSseEventSchema.safeParse(JSON.parse(line.slice('data: '.length)));
      if (parsed.success) {
        events.push(parsed.data);
      } else {
        // Événement inconnu/malformé : ignoré (la conversation continue), mais
        // tracé — un confirm_request droppé laisserait le serveur attendre 120 s.
        console.warn('[assistant] événement SSE ignoré (schéma invalide)');
      }
    } catch {
      // ligne partielle ou corrompue : ignorée
    }
  }
  return { events, rest };
}
