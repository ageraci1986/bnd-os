import type { ChatSseEvent } from '@/lib/assistant/chat-schema';

/** Découpe un buffer SSE en événements complets ; renvoie le fragment incomplet restant. */
export function parseSseLines(buffer: string): { events: ChatSseEvent[]; rest: string } {
  const events: ChatSseEvent[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith('data: ')) continue;
    try {
      events.push(JSON.parse(line.slice('data: '.length)) as ChatSseEvent);
    } catch {
      // ligne partielle ou corrompue : ignorée, la conversation continue
    }
  }
  return { events, rest };
}
