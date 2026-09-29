import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { search } = vi.hoisted(() => ({ search: { value: '' } }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/p-1',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

import { ContextBarHost } from './context-bar-host';

const clients = [
  { slug: 'acme-brands', name: 'Acme Brands', colorToken: 'c-acme' },
  { slug: 'nova', name: 'Nova', colorToken: 'c-nova' },
];

beforeEach(() => {
  search.value = '';
});

describe('<ContextBarHost />', () => {
  it('shows the active client chip from the ?client= URL param', () => {
    search.value = 'client=acme-brands';
    render(<ContextBarHost workspaceName="WS" clients={clients} />);
    expect(screen.getByText('Acme Brands')).toBeInTheDocument();
  });

  it('falls back to "all clients" without a filter', () => {
    render(<ContextBarHost workspaceName="WS" clients={clients} />);
    expect(screen.getByText(/Tous les clients · 2 actifs/)).toBeInTheDocument();
  });

  it('ignores an unknown slug', () => {
    search.value = 'client=ghost';
    render(<ContextBarHost workspaceName="WS" clients={clients} />);
    expect(screen.getByText(/Tous les clients/)).toBeInTheDocument();
  });
});
