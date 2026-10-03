import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({ setThemePreference: vi.fn(), notify: vi.fn() }));
vi.mock('@/features/settings/actions/set-theme-preference', () => ({
  setThemePreference: m.setThemePreference,
}));
vi.mock('@/features/shell/components/toaster', () => ({ notify: m.notify }));

import { ThemeToggle } from './theme-toggle';

function setOsDark(dark: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: dark }) as never;
}

beforeEach(() => {
  m.setThemePreference.mockReset().mockResolvedValue({ ok: true });
  m.notify.mockReset();
  setOsDark(false);
});

describe('<ThemeToggle />', () => {
  it('switches light → dark', async () => {
    document.documentElement.dataset['theme'] = 'light';
    render(<ThemeToggle />);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Passer en mode sombre' })),
    );
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(m.setThemePreference).toHaveBeenCalledWith('dark');
  });

  it('switches dark → light', async () => {
    document.documentElement.dataset['theme'] = 'dark';
    render(<ThemeToggle />);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Passer en mode clair' })),
    );
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('resolves system with the OS setting', async () => {
    document.documentElement.dataset['theme'] = 'system';
    setOsDark(true);
    render(<ThemeToggle />);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Passer en mode clair' })),
    );
    expect(m.setThemePreference).toHaveBeenCalledWith('light');
  });

  it('rolls back and toasts on failure', async () => {
    document.documentElement.dataset['theme'] = 'light';
    m.setThemePreference.mockResolvedValue({ ok: false, message: 'x' });
    render(<ThemeToggle />);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Passer en mode sombre' })),
    );
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
  });
});
