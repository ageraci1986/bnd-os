import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ syncThemeCookie: vi.fn() }));
vi.mock('@/features/settings/actions/set-theme-preference', () => ({
  syncThemeCookie: m.syncThemeCookie,
}));

import { ThemeSync } from './theme-sync';

beforeEach(() => m.syncThemeCookie.mockReset().mockResolvedValue({ ok: true, theme: 'dark' }));

describe('<ThemeSync />', () => {
  it('applies the account theme and syncs the cookie when they differ', async () => {
    document.documentElement.dataset['theme'] = 'system';
    render(<ThemeSync theme="dark" />);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    await waitFor(() => expect(m.syncThemeCookie).toHaveBeenCalledOnce());
  });

  it('does nothing when already aligned', () => {
    document.documentElement.dataset['theme'] = 'light';
    render(<ThemeSync theme="light" />);
    expect(m.syncThemeCookie).not.toHaveBeenCalled();
  });
});
