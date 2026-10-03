import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({ setThemePreference: vi.fn(), notify: vi.fn() }));
vi.mock('../actions/set-theme-preference', () => ({ setThemePreference: m.setThemePreference }));
vi.mock('@/features/shell/components/toaster', () => ({ notify: m.notify }));

import { AppearancePreferences } from './appearance-preferences';

beforeEach(() => {
  m.setThemePreference.mockReset().mockResolvedValue({ ok: true });
  m.notify.mockReset();
  document.documentElement.dataset['theme'] = 'system';
});

describe('<AppearancePreferences />', () => {
  it('shows the saved preference as checked', () => {
    render(<AppearancePreferences theme="dark" />);
    expect(screen.getByRole('radio', { name: 'Sombre' })).toBeChecked();
  });

  it('applies, saves and confirms a new choice', async () => {
    render(<AppearancePreferences theme="system" />);
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Clair' })));
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(m.setThemePreference).toHaveBeenCalledWith('light');
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });

  it('rolls back on failure', async () => {
    m.setThemePreference.mockResolvedValue({ ok: false, message: 'Thème invalide.' });
    render(<AppearancePreferences theme="system" />);
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Sombre' })));
    expect(document.documentElement.dataset['theme']).toBe('system');
    expect(screen.getByRole('radio', { name: 'Système' })).toBeChecked();
    expect(m.notify).toHaveBeenCalledWith({ tone: 'error', message: 'Thème invalide.' });
  });
});
