import { describe, expect, it } from 'vitest';
import { parseSseLines } from './sse';

describe('parseSseLines', () => {
  it('découpe un buffer en événements et conserve le reste', () => {
    const { events, rest } = parseSseLines(
      'data: {"type":"chunk","text":"Bon"}\n\ndata: {"type":"chunk","text":"jour"}\n\ndata: {"type":"do',
    );
    expect(events).toEqual([
      { type: 'chunk', text: 'Bon' },
      { type: 'chunk', text: 'jour' },
    ]);
    expect(rest).toBe('data: {"type":"do');
  });

  it('ignore les lignes non-JSON sans crasher', () => {
    const { events } = parseSseLines('data: pas-du-json\n\n');
    expect(events).toEqual([]);
  });

  it('rejette un événement de type inconnu (validation Zod)', () => {
    const { events } = parseSseLines('data: {"type":"hack","payload":"x"}\n\n');
    expect(events).toEqual([]);
  });
});
