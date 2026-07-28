'use client';
import { useState, useTransition } from 'react';
import { notify } from '@/features/shell/components/toaster';
import {
  updateAssistantPreferences,
  type UpdateAssistantPreferencesInput,
} from '../actions/update-assistant-preferences';

export interface AssistantPreferencesKinds {
  readonly agent_card_blocked: boolean;
  readonly agent_mail_important: boolean;
}

export interface AssistantPreferencesProps {
  readonly proactivity: boolean;
  readonly briefingOptIn: boolean;
  readonly kinds: AssistantPreferencesKinds;
}

type ToggleKey = 'proactivity' | 'briefingOptIn' | keyof AssistantPreferencesKinds;

interface LocalState {
  readonly proactivity: boolean;
  readonly briefingOptIn: boolean;
  readonly kinds: AssistantPreferencesKinds;
}

/**
 * Settings → Assistant section (Plan 3b Task 8). ADR #10: save is
 * automatic — every toggle flip fires the Server Action immediately
 * (optimistic update, rollback + error toast on failure) instead of a
 * submit button, and a success toast confirms the write.
 *
 * UX DECISION (documented per plan instructions — do not "fix" this by
 * adding a 3rd toggle): the `agent_briefing` NotificationPreference kind
 * has NO dedicated per-kind toggle here. `createAgentNotice` (notice-core.ts)
 * gates a briefing notice on BOTH `Membership.assistantBriefingOptIn` AND
 * the `agent_briefing` in_app `NotificationPreference` row — showing a 3rd
 * "Briefing" switch next to the opt-in switch would be two controls for one
 * outcome. Only the opt-in switch is exposed; the `agent_briefing`
 * NotificationPreference row is left at its schema default (`enabled: true`)
 * and is never written by this UI. That leaves 4 switches total: master
 * proactivity, briefing opt-in, "Cartes bloquées", "Mails importants".
 *
 * The 3 sub-switches (briefing opt-in + the 2 per-kind switches) are
 * disabled whenever the master proactivity switch is off: `createAgentNotice`
 * checks `assistantProactivity` before anything else regardless of kind, so
 * none of them have any effect while the kill switch is off. The master
 * switch itself always stays interactive so the user can turn it back on.
 */
export function AssistantPreferences({
  proactivity,
  briefingOptIn,
  kinds,
}: AssistantPreferencesProps) {
  const [state, setState] = useState<LocalState>({ proactivity, briefingOptIn, kinds });
  const [pendingKey, setPendingKey] = useState<ToggleKey | null>(null);
  const [, startTransition] = useTransition();

  function toggle(key: ToggleKey, next: boolean) {
    const previous = state;
    const optimistic: LocalState =
      key === 'proactivity'
        ? { ...state, proactivity: next }
        : key === 'briefingOptIn'
          ? { ...state, briefingOptIn: next }
          : { ...state, kinds: { ...state.kinds, [key]: next } };

    const input: UpdateAssistantPreferencesInput =
      key === 'proactivity'
        ? { proactivity: next }
        : key === 'briefingOptIn'
          ? { briefingOptIn: next }
          : { kinds: { [key]: next } };

    setState(optimistic);
    setPendingKey(key);

    startTransition(async () => {
      const result = await updateAssistantPreferences(input);
      setPendingKey(null);
      if (!result.ok) {
        setState(previous);
        notify({ tone: 'error', message: result.message });
        return;
      }
      notify({ tone: 'success', message: 'Préférences enregistrées' });
    });
  }

  const subDisabled = !state.proactivity;

  return (
    <section className="rounded-xl border border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5">
      <h2 className="text-base font-bold">Assistant</h2>
      <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
        Contrôle les suggestions proactives de l&apos;assistant (briefing, cartes bloquées, mails
        importants).
      </p>
      <div className="mt-4 divide-y divide-[color:var(--color-border-soft)]">
        <ToggleRow
          label="Proactivité de l'assistant"
          description="Coupe l'ensemble des notices proactives (briefing, cartes bloquées, mails importants)."
          checked={state.proactivity}
          disabled={pendingKey === 'proactivity'}
          onChange={(next) => toggle('proactivity', next)}
        />
        <ToggleRow
          label="Briefing matinal (07:30, jours ouvrés)"
          description="Résumé quotidien envoyé en début de journée."
          checked={state.briefingOptIn}
          disabled={subDisabled || pendingKey === 'briefingOptIn'}
          onChange={(next) => toggle('briefingOptIn', next)}
        />
        <ToggleRow
          label="Cartes bloquées"
          description="Notice quand une carte assignée passe en colonne Bloqué."
          checked={state.kinds.agent_card_blocked}
          disabled={subDisabled || pendingKey === 'agent_card_blocked'}
          onChange={(next) => toggle('agent_card_blocked', next)}
        />
        <ToggleRow
          label="Mails importants"
          description="Notice quand un mail jugé important arrive."
          checked={state.kinds.agent_mail_important}
          disabled={subDisabled || pendingKey === 'agent_mail_important'}
          onChange={(next) => toggle('agent_mail_important', next)}
        />
      </div>
    </section>
  );
}

interface ToggleRowProps {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (next: boolean) => void;
}

function ToggleRow({ label, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-0.5 text-xs text-[color:var(--color-text-muted)]">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: checked ? 'var(--color-accent-primary)' : 'var(--color-bg-muted)' }}
      >
        <span
          aria-hidden="true"
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
        />
      </button>
    </div>
  );
}
