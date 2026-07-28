import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryPanel, type MemoryPanelEntry } from './memory-panel';

// Vitest hoists vi.mock above all imports — anything the factory closes
// over must come from vi.hoisted() (mirrors mail-attachment-row.test.tsx).
const { createSpy, updateSpy, deleteSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(),
  updateSpy: vi.fn(),
  deleteSpy: vi.fn(),
}));

vi.mock('../actions/memory', () => ({
  createMemoryAction: (...a: unknown[]) => createSpy(...a),
  updateMemoryAction: (...a: unknown[]) => updateSpy(...a),
  deleteMemoryAction: (...a: unknown[]) => deleteSpy(...a),
}));

const ENTRIES: readonly MemoryPanelEntry[] = [
  { name: 'prefere-reunions-le-matin', fact: 'Préfère les réunions le matin' },
  { name: 'client-favori-acme', fact: 'Travaille surtout avec le client Acme' },
];

beforeEach(() => {
  createSpy.mockReset();
  updateSpy.mockReset();
  deleteSpy.mockReset();
  createSpy.mockResolvedValue({ status: 'idle' });
  updateSpy.mockResolvedValue({ status: 'idle' });
  deleteSpy.mockResolvedValue({ status: 'idle' });
});

describe('<MemoryPanel />', () => {
  it('renders one row per entry with its name label and fact', () => {
    render(<MemoryPanel entries={ENTRIES} csrfToken="tok" />);
    expect(screen.getByText('prefere-reunions-le-matin')).toBeInTheDocument();
    expect(screen.getByText('client-favori-acme')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Préfère les réunions le matin')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Travaille surtout avec le client Acme')).toBeInTheDocument();
  });

  it('shows the empty state text when there are no entries', () => {
    render(<MemoryPanel entries={[]} csrfToken="tok" />);
    expect(screen.getByText(/n'a encore rien retenu/)).toBeInTheDocument();
    expect(screen.queryByText('prefere-reunions-le-matin')).not.toBeInTheDocument();
  });

  it('submits the add-fact form and calls createMemoryAction with the CSRF token and fact', async () => {
    const user = userEvent.setup();
    render(<MemoryPanel entries={[]} csrfToken="tok-123" />);

    await user.type(
      screen.getByLabelText('Retenir un nouveau fait'),
      'Aime les points hebdo le lundi',
    );
    await user.click(screen.getByRole('button', { name: 'Retenir' }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const formData = createSpy.mock.calls[0]![1] as FormData;
    expect(formData.get('_csrf')).toBe('tok-123');
    expect(formData.get('fact')).toBe('Aime les points hebdo le lundi');
  });

  it('shows the create error message when createMemoryAction reports a failure', async () => {
    createSpy.mockResolvedValue({ status: 'error', message: 'Le fait est vide — rien à retenir.' });
    const user = userEvent.setup();
    render(<MemoryPanel entries={[]} csrfToken="tok" />);

    await user.click(screen.getByRole('button', { name: 'Retenir' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Le fait est vide — rien à retenir.',
    );
  });

  it('submits an entry edit form and calls updateMemoryAction with name + fact', async () => {
    const user = userEvent.setup();
    render(<MemoryPanel entries={ENTRIES} csrfToken="tok-abc" />);

    const input = screen.getByDisplayValue('Préfère les réunions le matin');
    await user.clear(input);
    await user.type(input, 'Préfère les réunions en fin de matinée');
    await user.click(screen.getAllByRole('button', { name: 'Enregistrer' })[0]!);

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const formData = updateSpy.mock.calls[0]![1] as FormData;
    expect(formData.get('_csrf')).toBe('tok-abc');
    expect(formData.get('name')).toBe('prefere-reunions-le-matin');
    expect(formData.get('fact')).toBe('Préfère les réunions en fin de matinée');
  });

  it('shows the update error message when updateMemoryAction reports a failure', async () => {
    updateSpy.mockResolvedValue({ status: 'error', message: 'Fait introuvable.' });
    const user = userEvent.setup();
    render(<MemoryPanel entries={ENTRIES} csrfToken="tok" />);

    await user.click(screen.getAllByRole('button', { name: 'Enregistrer' })[0]!);

    expect(await screen.findByRole('alert')).toHaveTextContent('Fait introuvable.');
  });

  it('submits a delete form and calls deleteMemoryAction with the entry name', async () => {
    const user = userEvent.setup();
    render(<MemoryPanel entries={ENTRIES} csrfToken="tok-xyz" />);

    await user.click(screen.getByRole('button', { name: 'Supprimer le fait client-favori-acme' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    const formData = deleteSpy.mock.calls[0]![1] as FormData;
    expect(formData.get('_csrf')).toBe('tok-xyz');
    expect(formData.get('name')).toBe('client-favori-acme');
  });

  it('shows the delete error message when deleteMemoryAction reports a failure', async () => {
    deleteSpy.mockResolvedValue({ status: 'error', message: 'Fait introuvable.' });
    const user = userEvent.setup();
    render(<MemoryPanel entries={ENTRIES} csrfToken="tok" />);

    await user.click(
      screen.getByRole('button', { name: 'Supprimer le fait prefere-reunions-le-matin' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Fait introuvable.');
  });
});
