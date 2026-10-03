import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({ setThemePreference: vi.fn(), notify: vi.fn() }));
vi.mock('@/features/settings/actions/set-theme-preference', () => ({
  setThemePreference: m.setThemePreference,
}));
vi.mock('@/features/shell/components/toaster', () => ({ notify: m.notify }));

import { ThemeToggle } from './theme-toggle';

const os = { dark: false, listeners: new Set<() => void>() };

function setOsDark(dark: boolean) {
  os.dark = dark;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    get matches() {
      return os.dark;
    },
    addEventListener: (_: string, cb: () => void) => os.listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => os.listeners.delete(cb),
  })) as never;
}

function flipOs(dark: boolean) {
  os.dark = dark;
  for (const cb of os.listeners) cb();
}

beforeEach(() => {
  m.setThemePreference.mockReset().mockResolvedValue({ ok: true });
  m.notify.mockReset();
  os.listeners.clear();
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
  it('follows an external data-theme change (Settings, ThemeSync)', async () => {
    document.documentElement.dataset['theme'] = 'light';
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Passer en mode sombre' })).toBeTruthy();
    await act(async () => {
      document.documentElement.dataset['theme'] = 'dark';
      // laisse le MutationObserver notifier (microtâche)
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Passer en mode clair' })).toBeTruthy();
  });

  it('follows an OS change while on system', async () => {
    document.documentElement.dataset['theme'] = 'system';
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Passer en mode sombre' })).toBeTruthy();
    act(() => flipOs(true));
    expect(screen.getByRole('button', { name: 'Passer en mode clair' })).toBeTruthy();
  });

  it('unsubscribes from the OS media query on unmount', () => {
    document.documentElement.dataset['theme'] = 'system';
    const { unmount } = render(<ThemeToggle />);
    expect(os.listeners.size).toBeGreaterThan(0);
    unmount();
    expect(os.listeners.size).toBe(0);
  });
});
