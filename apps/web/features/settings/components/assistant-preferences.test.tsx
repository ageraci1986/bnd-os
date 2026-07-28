import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssistantPreferences } from './assistant-preferences';

const { updateAssistantPreferencesSpy, notifySpy } = vi.hoisted(() => ({
  updateAssistantPreferencesSpy: vi.fn(),
  notifySpy: vi.fn(),
}));

vi.mock('../actions/update-assistant-preferences', () => ({
  updateAssistantPreferences: (...a: unknown[]) => updateAssistantPreferencesSpy(...a),
}));
vi.mock('@/features/shell/components/toaster', () => ({
  notify: (...a: unknown[]) => notifySpy(...a),
}));

function baseProps() {
  return {
    proactivity: true,
    briefingOptIn: true,
    kinds: { agent_card_blocked: true, agent_mail_important: false },
  };
}

beforeEach(() => {
  updateAssistantPreferencesSpy.mockReset();
  notifySpy.mockReset();
});

describe('<AssistantPreferences />', () => {
  it('renders exactly 4 switches — no 3rd redundant "Briefing" per-kind toggle', () => {
    render(<AssistantPreferences {...baseProps()} />);
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.getByRole('switch', { name: "Proactivité de l'assistant" })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Briefing matinal/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Cartes bloquées' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Mails importants' })).toBeInTheDocument();
  });

  it('reflects the initial props on each switch aria-checked', () => {
    render(<AssistantPreferences {...baseProps()} />);
    expect(screen.getByRole('switch', { name: "Proactivité de l'assistant" })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Cartes bloquées' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Mails importants' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('disables the 3 sub-toggles when the master proactivity switch is off', () => {
    render(<AssistantPreferences {...baseProps()} proactivity={false} />);
    expect(screen.getByRole('switch', { name: /Briefing matinal/ })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Cartes bloquées' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Mails importants' })).toBeDisabled();
    // Master itself always stays interactive so the user can turn it back on.
    expect(screen.getByRole('switch', { name: "Proactivité de l'assistant" })).toBeEnabled();
  });

  it('clicking a disabled sub-toggle does not call the action', () => {
    render(<AssistantPreferences {...baseProps()} proactivity={false} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Cartes bloquées' }));
    expect(updateAssistantPreferencesSpy).not.toHaveBeenCalled();
  });

  it('flipping the master switch calls the action with { proactivity }, optimistically updates, and toasts on success', async () => {
    updateAssistantPreferencesSpy.mockResolvedValue({ ok: true });
    render(<AssistantPreferences {...baseProps()} />);

    const master = screen.getByRole('switch', { name: "Proactivité de l'assistant" });
    fireEvent.click(master);

    // Optimistic: flips immediately, before the action resolves.
    expect(master).toHaveAttribute('aria-checked', 'false');
    expect(updateAssistantPreferencesSpy).toHaveBeenCalledWith({ proactivity: false });

    await waitFor(() =>
      expect(notifySpy).toHaveBeenCalledWith({
        tone: 'success',
        message: 'Préférences enregistrées',
      }),
    );
  });

  it('flipping "Cartes bloquées" calls the action with the exact kinds payload', async () => {
    updateAssistantPreferencesSpy.mockResolvedValue({ ok: true });
    render(<AssistantPreferences {...baseProps()} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Cartes bloquées' }));

    expect(updateAssistantPreferencesSpy).toHaveBeenCalledWith({
      kinds: { agent_card_blocked: false },
    });
    await waitFor(() => expect(notifySpy).toHaveBeenCalled());
  });

  it('flipping "Mails importants" calls the action with the exact kinds payload', async () => {
    updateAssistantPreferencesSpy.mockResolvedValue({ ok: true });
    render(<AssistantPreferences {...baseProps()} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Mails importants' }));

    expect(updateAssistantPreferencesSpy).toHaveBeenCalledWith({
      kinds: { agent_mail_important: true },
    });
  });

  it('flipping the briefing opt-in calls the action with { briefingOptIn }', async () => {
    updateAssistantPreferencesSpy.mockResolvedValue({ ok: true });
    render(<AssistantPreferences {...baseProps()} />);

    fireEvent.click(screen.getByRole('switch', { name: /Briefing matinal/ }));

    expect(updateAssistantPreferencesSpy).toHaveBeenCalledWith({ briefingOptIn: false });
  });

  it('rolls back the optimistic update and toasts an error when the action fails', async () => {
    updateAssistantPreferencesSpy.mockResolvedValue({ ok: false, message: 'Échec serveur.' });
    render(<AssistantPreferences {...baseProps()} />);

    const master = screen.getByRole('switch', { name: "Proactivité de l'assistant" });
    fireEvent.click(master);
    expect(master).toHaveAttribute('aria-checked', 'false');

    await waitFor(() => expect(master).toHaveAttribute('aria-checked', 'true'));
    expect(notifySpy).toHaveBeenCalledWith({ tone: 'error', message: 'Échec serveur.' });
  });
});
