'use client';

import { useState } from 'react';
import { markNotificationRead } from '@/features/notifications/actions/mark-read';
import type { AgentNotice } from '@/features/notifications/lib/agent-notice-mapping';
import type { WidgetActions } from './widgets';

export type { AgentNotice };

export interface NoticeStackProps {
  /** Notices non lues, chargées côté serveur par `app/(app)/assistant/page.tsx`. */
  readonly notices: readonly AgentNotice[];
  /** Canal `sendMessage`/`busy` — voir `widgets/index.tsx`. Sans lui, « En discuter » n'a pas de destination : masqué. */
  readonly actions?: WidgetActions;
}

/** Pills calquées sur `.ap-btn` de la maquette (mail-list-widget.tsx suit la même convention de tokens). */
const PILL_BASE =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[10.5px] font-bold disabled:opacity-50';
const PILL_GRAD = `${PILL_BASE} bg-[image:var(--accent-gradient)] text-white shadow-[0_4px_12px_rgba(139,43,226,0.3)]`;
const PILL_GHOST = `${PILL_BASE} border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-hover)]`;

/**
 * Pile de notices proactives (Plan 3b Task 7) — bandeau `.ap-notice` de la
 * maquette (`docs/superpowers/specs/assets/2026-07-27-assistant-mockup.html`
 * l.63-67/136-141) : dégradé léger, 🔔, message, « En discuter » (pill grad,
 * visible seulement si `actions` est fourni) / « Ignorer » (pill ghost).
 *
 * État local `dismissedIds` : purement optimiste, la source de vérité reste
 * le serveur (`readAt`) — un rechargement de page réinterroge les notices
 * non lues, une notice dont le `markRead` a échoué peut donc réapparaître.
 *
 * SÉCURITÉ (anti-injection, notice-core.ts) : `notice.discuss` est injecté
 * TEL QUEL dans `sendMessage` — jamais reconstruit ni concaténé ici. Il vient
 * de `createAgentNotice` (nos crons uniquement), qui garantit qu'il ne
 * contient que des ids/verbes, jamais de contenu externe brut.
 */
export function NoticeStack({ notices, actions }: NoticeStackProps) {
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => new Set());

  const visible = notices.filter((n) => !dismissedIds.has(n.id));
  if (visible.length === 0) return null;

  function dismiss(id: string): void {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function restore(id: string): void {
    setDismissedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  /**
   * « En discuter » : injecte la suggestion puis marque lu. PAS de rollback
   * si `markNotificationRead` échoue — une fois le message injecté dans le
   * chat, faire réapparaître la notice serait incohérent avec ce que
   * l'utilisateur vient de faire. Conséquence documentée (dette mineure,
   * Task 7) : la notice reste non lue côté serveur (dot sidebar / KPI
   * Notices légèrement en retard) jusqu'à ce qu'un `markRead` ultérieur
   * réussisse ou que le cron dédup l'écrase.
   */
  function handleDiscuss(notice: AgentNotice): void {
    actions?.sendMessage(notice.discuss);
    dismiss(notice.id);
    void markNotificationRead({ notificationId: notice.id }).catch(() => undefined);
  }

  /** « Ignorer » : optimiste, rollback (la notice réapparaît) si `{ok:false}` ou si la promesse rejette. */
  function handleIgnore(notice: AgentNotice): void {
    dismiss(notice.id);
    markNotificationRead({ notificationId: notice.id })
      .then((res) => {
        if (!res.ok) restore(notice.id);
      })
      .catch(() => restore(notice.id));
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {visible.map((notice) => (
        <div
          key={notice.id}
          role="group"
          aria-label="Notice de l'assistant"
          className="flex w-full items-center gap-2.5 rounded-2xl border border-[color:rgba(139,43,226,0.18)] bg-[image:var(--accent-gradient-soft)] px-3.5 py-2.5"
        >
          <span aria-hidden="true" className="text-sm">
            🔔
          </span>
          <span className="flex-1 text-[11.5px] text-[color:var(--color-text-main)]">
            {notice.message}
          </span>
          {actions !== undefined && (
            <button
              type="button"
              className={PILL_GRAD}
              disabled={actions.busy}
              aria-label={`En discuter — ${notice.message}`}
              onClick={() => handleDiscuss(notice)}
            >
              En discuter
            </button>
          )}
          <button
            type="button"
            className={PILL_GHOST}
            aria-label={`Ignorer — ${notice.message}`}
            onClick={() => handleIgnore(notice)}
          >
            Ignorer
          </button>
        </div>
      ))}
    </div>
  );
}
