'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { searchRecipients, type RecipientSuggestion } from '../actions/search-recipients';
import { isValidEmail } from '../lib/recipient-match';

export interface RecipientFieldProps {
  readonly label: string;
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

const DEBOUNCE_MS = 150;
const MAX_SUGGESTIONS = 10;

function initials(source: string): string {
  const cleaned = source.replace(/[<>"']/g, '').trim();
  const parts = cleaned.split(/[\s.@_-]+/).filter(Boolean);
  const a = parts[0]?.[0]?.toUpperCase() ?? '?';
  const b = parts[1]?.[0]?.toUpperCase() ?? '';
  return a + b;
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nText = norm(text);
  const nQuery = norm(query);
  const idx = nText.indexOf(nQuery);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-[color:var(--color-warning-soft,#fef3c7)] px-0.5 text-[color:var(--color-text-main)]">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function RecipientField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: RecipientFieldProps) {
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<readonly RecipientSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeq = useRef(0);

  const commitText = useCallback(
    (raw: string) => {
      const trimmed = raw.trim().replace(/[,;]$/, '').trim();
      if (!trimmed) return;
      onChange([...value, trimmed]);
      setText('');
      setOpen(false);
    },
    [value, onChange],
  );

  const commitChip = useCallback(
    (email: string) => {
      onChange([...value, email]);
      setText('');
      setOpen(false);
    },
    [value, onChange],
  );

  // Debounced search
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (text.trim().length === 0) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      const seq = ++requestSeq.current;
      void searchRecipients({ query: text.trim(), limit: MAX_SUGGESTIONS }).then((r) => {
        if (seq !== requestSeq.current) return; // stale
        if (!r.ok) {
          setSuggestions([]);
          setOpen(false);
          return;
        }
        // Filter out already-chipped emails
        const existing = new Set(value.map((v) => v.toLowerCase()));
        const filtered = r.suggestions.filter((s) => !existing.has(s.email.toLowerCase()));
        setSuggestions(filtered);
        setOpen(filtered.length > 0);
        setHighlight(0);
      });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [text, value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (open && suggestions[highlight]) {
        e.preventDefault();
        commitChip(suggestions[highlight].email);
      } else if (text.trim().length > 0) {
        e.preventDefault();
        commitText(text);
      }
      return;
    }
    if (e.key === ',' || e.key === ';') {
      if (text.trim().length > 0) {
        e.preventDefault();
        commitText(text);
      }
      return;
    }
    if (e.key === 'Backspace' && text.length === 0 && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open) setHighlight((h) => (h + 1) % suggestions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
      return;
    }
  }

  function handleBlur() {
    // Commit any leftover text on blur (permissive Gmail-esque)
    if (text.trim().length > 0) commitText(text);
    // Close dropdown after a tick to allow row click handlers to fire first
    setTimeout(() => setOpen(false), 100);
  }

  return (
    <div className="relative mb-2">
      <div className="flex flex-wrap items-center gap-1 rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] px-2 py-1 text-sm focus-within:ring-1 focus-within:ring-[color:var(--color-accent-primary)]">
        <span className="mr-1 text-xs font-bold text-[color:var(--color-text-muted)]">{label}</span>
        {value.map((email, i) => {
          const invalid = !isValidEmail(email);
          return (
            <span
              key={`${email}-${i}`}
              data-invalid={invalid ? 'true' : 'false'}
              className={
                invalid
                  ? 'inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-700'
                  : 'inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] px-2 py-0.5 text-xs text-[color:var(--color-text-main)]'
              }
              title={invalid ? 'email invalide' : undefined}
            >
              {email}
              <button
                type="button"
                aria-label={`Retirer ${email}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="ml-1 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-main)]"
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={() => text.trim().length > 0 && suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-[8ch] flex-1 border-none bg-transparent text-sm outline-none"
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] shadow-lg"
        >
          {suggestions.map((s, i) => {
            const isHighlighted = i === highlight;
            return (
              <li
                key={s.email}
                role="option"
                aria-selected={isHighlighted}
                onMouseDown={(e) => {
                  // onMouseDown (not onClick) so blur doesn't fire before we commit
                  e.preventDefault();
                  commitChip(s.email);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={
                  isHighlighted
                    ? 'flex cursor-pointer items-center gap-2 border-b border-[color:var(--color-border-light)] bg-[color:var(--color-bg-muted)] px-2 py-1.5'
                    : 'flex cursor-pointer items-center gap-2 border-b border-[color:var(--color-border-light)] px-2 py-1.5 hover:bg-[color:var(--color-bg-muted)]'
                }
              >
                <span
                  aria-hidden
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: 'var(--accent-gradient)' }}
                >
                  {initials(s.name ?? s.email)}
                </span>
                <div className="flex-1 leading-tight">
                  <div className="text-xs font-semibold text-[color:var(--color-text-main)]">
                    {highlightMatch(s.name ?? s.email, text.trim())}
                  </div>
                  {s.name && (
                    <div className="text-[11px] text-[color:var(--color-text-muted)]">
                      {highlightMatch(s.email, text.trim())}
                    </div>
                  )}
                  {(s.jobTitle || s.clientName) && (
                    <div className="text-[10px] text-[color:var(--color-text-muted)]">
                      {[s.jobTitle, s.clientName].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                {s.source === 'contact' && (
                  <span className="rounded-full bg-[color:var(--color-bg-muted)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[color:var(--color-accent-primary)]">
                    Contact
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
