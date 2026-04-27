import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Vitest hoists vi.mock above all imports, so anything it references
// must come from `vi.hoisted()` (not a top-level `const`).
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/overview',
  useRouter: () => ({
    replace,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams('client=acme&view=list'),
}));

import { ClientFilterChip } from './client-filter-chip';

beforeEach(() => {
  replace.mockClear();
});

describe('<ClientFilterChip />', () => {
  it('shows the "all clients" label when active is null', () => {
    render(<ClientFilterChip active={null} totalClients={5} />);
    expect(screen.getByText(/Tous les clients · 5 actifs/)).toBeInTheDocument();
  });

  it('uses singular when totalClients = 1', () => {
    render(<ClientFilterChip active={null} totalClients={1} />);
    expect(screen.getByText(/1 actif$/)).toBeInTheDocument();
  });

  it('shows the client name when filter is active', () => {
    render(
      <ClientFilterChip active={{ name: 'Acme Brands', colorToken: 'c-acme' }} totalClients={5} />,
    );
    expect(screen.getByText('Acme Brands')).toBeInTheDocument();
  });

  it('clears the filter via router.replace, preserving other params', () => {
    render(<ClientFilterChip active={{ name: 'Acme', colorToken: 'c-acme' }} totalClients={5} />);
    fireEvent.click(screen.getByRole('button', { name: /Retirer le filtre/i }));
    expect(replace).toHaveBeenCalledOnce();
    const [href, opts] = replace.mock.calls[0]!;
    // Pathname kept, client= dropped, view= preserved
    expect(href).toBe('/overview?view=list');
    expect(opts).toEqual({ scroll: false });
  });
});
