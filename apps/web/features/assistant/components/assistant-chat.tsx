'use client';

import { useCallback, useRef, useState } from 'react';
import { parseSseLines } from '../lib/sse';

interface DisplayMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

interface AssistantChatProps {
  readonly csrfToken: string;
  readonly firstName: string;
}

const ACTIVITY_LABELS: Record<string, string> = {
  get_today_overview: 'prépare votre briefing…',
  list_projects: 'consulte les projets…',
  get_project_board: 'consulte le Kanban…',
  list_clients: 'consulte les clients…',
  search_mails: 'cherche dans les mails…',
  read_mail: 'lit un mail…',
  get_current_datetime: 'vérifie la date…',
};

export function AssistantChat({ csrfToken, firstName }: AssistantChatProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streamText, setStreamText] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<DisplayMessage[]>([]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (text === '' || busy) return;
    setBusy(true);
    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setStreamText('');
    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ messages: historyRef.current, message: text }),
      });
      if (!res.ok || res.body === null) {
        const payload = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(payload?.message ?? 'Une erreur est survenue — réessayez.');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseLines(buffer);
        buffer = rest;
        for (const event of events) {
          if (event.type === 'chunk') setStreamText((prev) => (prev ?? '') + event.text);
          if (event.type === 'tool_start') setActivity(ACTIVITY_LABELS[event.name] ?? 'travaille…');
          if (event.type === 'tool_end') setActivity(null);
          if (event.type === 'done') finalText = event.text;
          if (event.type === 'error') setError(event.message);
        }
      }
      if (finalText !== '') {
        historyRef.current = [
          ...historyRef.current,
          { role: 'user', content: text },
          { role: 'assistant', content: finalText },
        ];
        setMessages((prev) => [...prev, { role: 'assistant', content: finalText }]);
      }
    } catch {
      setError('Connexion interrompue — réessayez.');
    } finally {
      setStreamText(null);
      setActivity(null);
      setBusy(false);
    }
  }, [busy, csrfToken, input]);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center gap-4 px-6 py-8">
      {/* Placeholder orbe — remplacé par le blob animé au Plan 4 */}
      <div
        aria-hidden
        className="h-20 w-20 rounded-full"
        style={{
          background: 'var(--accent-gradient)',
          boxShadow: '0 14px 40px rgba(139,43,226,.32)',
        }}
      />
      <h1 className="text-lg font-bold text-[color:var(--color-text-main)]">
        Bonjour {firstName} 👋
      </h1>
      <p className="text-sm text-[color:var(--color-text-muted)]">
        Demandez votre briefing, interrogez vos projets et vos mails.
      </p>

      <div className="flex w-full flex-1 flex-col gap-2 overflow-y-auto" aria-live="polite">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user'
                ? 'self-end rounded-2xl px-4 py-2 text-sm text-white'
                : 'self-start rounded-2xl border border-[color:var(--color-border-soft)] bg-[color:var(--color-bg-card)] px-4 py-2 text-sm text-[color:var(--color-text-soft)]'
            }
            style={m.role === 'user' ? { background: 'var(--accent-gradient)' } : undefined}
          >
            {m.content}
          </div>
        ))}
        {streamText !== null && streamText !== '' && (
          <div className="self-start rounded-2xl border border-[color:var(--color-border-soft)] bg-[color:var(--color-bg-card)] px-4 py-2 text-sm text-[color:var(--color-text-soft)]">
            {streamText}
          </div>
        )}
        {activity !== null && (
          <p className="text-xs font-semibold text-[color:var(--color-text-ghost)]">{activity}</p>
        )}
        {error !== null && <p className="text-sm text-[color:var(--color-danger)]">{error}</p>}
      </div>

      <form
        className="flex w-full items-center gap-2 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className="flex-1 bg-transparent text-sm text-[color:var(--color-text-main)] outline-none"
          placeholder="Demandez quelque chose, ou dictez une série d'actions…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button
          type="button"
          className="h-8 w-8 rounded-full bg-[color:var(--color-bg-hover)] text-sm opacity-45"
          title="Voix — bientôt"
          aria-label="Voix — bientôt"
          disabled
        >
          🎙
        </button>
        <button
          type="submit"
          className="h-8 w-8 rounded-full text-sm text-white disabled:opacity-50"
          style={{ background: 'var(--accent-gradient)' }}
          aria-label="Envoyer"
          disabled={busy || input.trim() === ''}
        >
          ➤
        </button>
      </form>
    </div>
  );
}
