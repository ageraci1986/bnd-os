'use client';
import { useEffect, useState, useCallback } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastEventDetail {
  readonly tone: ToastTone;
  readonly message: string;
  /** Override the default auto-dismiss delay (ms). */
  readonly durationMs?: number;
  /** Optional CTA rendered next to the message, e.g. "Réessayer". */
  readonly action?: ToastAction;
}

export const TOAST_EVENT = 'nx:toast';

interface ToastEntry extends ToastEventDetail {
  readonly id: string;
}

const DEFAULT_DURATION_MS = 4500;

/**
 * Fire a transient toast notification.
 *
 * Server-action error/success messages that would otherwise be rendered
 * inline (red banner under the form) should go through this so the UI
 * stays clean — especially on dense pages like /team where multiple
 * rows might each carry their own message.
 */
export function notify(detail: ToastEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ToastEventDetail>(TOAST_EVENT, { detail }));
}

/**
 * Toast viewport. Mounted once near the root of the (app) shell.
 * Subscribes to `TOAST_EVENT` and stacks entries top-right.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastEventDetail>).detail;
      if (!detail || typeof detail.message !== 'string') return;
      const id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
      const entry: ToastEntry = {
        id,
        tone: detail.tone,
        message: detail.message,
        ...(detail.durationMs !== undefined ? { durationMs: detail.durationMs } : {}),
        ...(detail.action !== undefined ? { action: detail.action } : {}),
      };
      setToasts((prev) => [...prev, entry]);
      const delay = entry.durationMs ?? DEFAULT_DURATION_MS;
      window.setTimeout(() => dismiss(id), delay);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
    >
      {toasts.map((t) => {
        const tone = t.tone === 'error' ? 'danger' : t.tone === 'success' ? 'success' : 'info';
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border bg-[color:var(--color-bg-card)] px-4 py-3 shadow-lg"
            style={{
              borderColor: `var(--color-${tone})`,
              borderLeftWidth: 4,
            }}
          >
            <p className="flex-1 text-sm font-medium leading-snug">{t.message}</p>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 whitespace-nowrap text-xs font-bold text-[color:var(--color-accent-primary)] hover:underline"
              >
                {t.action.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Fermer la notification"
              className="-mr-1 -mt-1 rounded p-1 text-xs text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)]"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
