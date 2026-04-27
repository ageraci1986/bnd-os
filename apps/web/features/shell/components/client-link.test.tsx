import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

declare global {
  var __NH_MOCK_SEARCH__: URLSearchParams;
}

// Initialise the shared search params before vi.mock runs.
globalThis.__NH_MOCK_SEARCH__ = new URLSearchParams('view=list');

vi.mock('next/navigation', () => ({
  usePathname: () => '/overview',
  useSearchParams: () => globalThis.__NH_MOCK_SEARCH__,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ClientLink, AllClientsLink } from './client-link';

beforeEach(() => {
  globalThis.__NH_MOCK_SEARCH__ = new URLSearchParams('view=list');
});

describe('<ClientLink />', () => {
  it('renders an anchor pointing to the same path with ?client=<slug>', () => {
    render(<ClientLink slug="acme" name="Acme Brands" colorToken="c-acme" count={5} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/overview?view=list&client=acme');
  });

  it('marks itself active when current ?client matches', () => {
    globalThis.__NH_MOCK_SEARCH__ = new URLSearchParams('client=acme');
    render(<ClientLink slug="acme" name="Acme" colorToken="c-acme" />);
    expect(screen.getByRole('link').getAttribute('aria-current')).toBe('true');
  });

  it('is not active when ?client points elsewhere', () => {
    globalThis.__NH_MOCK_SEARCH__ = new URLSearchParams('client=tech');
    render(<ClientLink slug="acme" name="Acme" colorToken="c-acme" />);
    expect(screen.getByRole('link').getAttribute('aria-current')).toBeNull();
  });
});

describe('<AllClientsLink />', () => {
  it('builds an href that drops ?client', () => {
    globalThis.__NH_MOCK_SEARCH__ = new URLSearchParams('client=acme&view=list');
    render(<AllClientsLink count={5} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/overview?view=list');
  });

  it('is active when no ?client is present', () => {
    globalThis.__NH_MOCK_SEARCH__ = new URLSearchParams('');
    render(<AllClientsLink count={3} />);
    expect(screen.getByRole('link').getAttribute('aria-current')).toBe('true');
  });

  it('is not active when ?client is set', () => {
    globalThis.__NH_MOCK_SEARCH__ = new URLSearchParams('client=acme');
    render(<AllClientsLink count={3} />);
    expect(screen.getByRole('link').getAttribute('aria-current')).toBeNull();
  });
});
