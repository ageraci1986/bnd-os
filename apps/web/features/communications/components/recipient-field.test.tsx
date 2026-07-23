import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { RecipientField } from './recipient-field';

vi.mock('../actions/search-recipients', () => ({
  searchRecipients: vi.fn(),
}));

import { searchRecipients } from '../actions/search-recipients';

const searchSpy = vi.mocked(searchRecipients);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  searchSpy.mockResolvedValue({
    ok: true,
    suggestions: [
      {
        email: 'elena@belgo.eu',
        name: 'Elena Rossi',
        source: 'contact',
        jobTitle: 'CMO',
        clientName: 'Belgo',
        raci: 'R',
      },
      {
        email: 'be.collections@bnp.fr',
        name: null,
        source: 'mail',
        jobTitle: null,
        clientName: null,
        raci: null,
      },
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(value: readonly string[] = []) {
  const onChange = vi.fn();
  const utils = render(
    <RecipientField label="À" value={value} onChange={onChange} placeholder="ph" />,
  );
  const input = screen.getByPlaceholderText('ph') as HTMLInputElement;
  return { ...utils, input, onChange };
}

describe('RecipientField', () => {
  it('renders existing chips', () => {
    setup(['a@x.fr', 'b@x.fr']);
    expect(screen.getByText('a@x.fr')).toBeInTheDocument();
    expect(screen.getByText('b@x.fr')).toBeInTheDocument();
  });

  it('commits typed text as chip on Enter when no dropdown match', async () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'raw@x.fr' } });
    // Debounce fire is irrelevant here — before the debounce fires we hit Enter.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['raw@x.fr']);
    expect(input.value).toBe('');
  });

  it('debounces the search 150ms and shows dropdown', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'be' } });
    // Before debounce fires
    expect(searchSpy).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(searchSpy).toHaveBeenCalledWith({ query: 'be', limit: 10 });
    expect(screen.getByText('Elena Rossi')).toBeInTheDocument();
  });

  it('Enter commits the highlighted suggestion', async () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'be' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(screen.getByText('Elena Rossi')).toBeInTheDocument();
    // Highlight is row 0 by default → Enter commits elena@belgo.eu
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['elena@belgo.eu']);
  });

  it('comma commits typed text (even if dropdown open)', async () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'noone@nowhere.zz' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    fireEvent.keyDown(input, { key: ',' });
    expect(onChange).toHaveBeenCalledWith(['noone@nowhere.zz']);
  });

  it('Backspace on empty input removes last chip', () => {
    const { input, onChange } = setup(['a@x.fr', 'b@x.fr']);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['a@x.fr']);
  });

  it('click × on chip removes it', () => {
    const { onChange } = setup(['a@x.fr', 'b@x.fr']);
    const removeBtn = screen.getByRole('button', { name: /Retirer a@x\.fr/ });
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith(['b@x.fr']);
  });

  it('Escape closes dropdown, keeps typed text', async () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'be' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(screen.getByText('Elena Rossi')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('Elena Rossi')).not.toBeInTheDocument();
    expect(input.value).toBe('be'); // text preserved
  });

  it('invalid email chip renders with the invalid style + aria', () => {
    setup(['bogus']);
    const chip = screen.getByText('bogus').closest('[data-invalid]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute('data-invalid', 'true');
  });

  it('no-match: dropdown closes silently (Gmail behavior)', async () => {
    searchSpy.mockResolvedValueOnce({ ok: true, suggestions: [] });
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'zzz' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(searchSpy).toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
