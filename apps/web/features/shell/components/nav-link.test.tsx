import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

declare global {
  var __NH_NAV_PATHNAME__: string;
  var __NH_NAV_SEARCH__: URLSearchParams;
}

globalThis.__NH_NAV_PATHNAME__ = '/overview';
globalThis.__NH_NAV_SEARCH__ = new URLSearchParams();

vi.mock('next/navigation', () => ({
  usePathname: () => globalThis.__NH_NAV_PATHNAME__,
  useSearchParams: () => globalThis.__NH_NAV_SEARCH__,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { NavLink } from './nav-link';

beforeEach(() => {
  globalThis.__NH_NAV_PATHNAME__ = '/overview';
  globalThis.__NH_NAV_SEARCH__ = new URLSearchParams();
});

describe('<NavLink />', () => {
  it('renders an anchor pointing to href', () => {
    render(<NavLink href="/projects" icon="◱" label="Projets" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/projects');
  });

  it('marks itself active on exact pathname match', () => {
    globalThis.__NH_NAV_PATHNAME__ = '/projects';
    render(<NavLink href="/projects" icon="◱" label="Projets" />);
    expect(screen.getByRole('link').getAttribute('aria-current')).toBe('page');
  });

  it('marks itself active on nested pathname match', () => {
    globalThis.__NH_NAV_PATHNAME__ = '/projects/abc-123';
    render(<NavLink href="/projects" icon="◱" label="Projets" />);
    expect(screen.getByRole('link').getAttribute('aria-current')).toBe('page');
  });

  it('is not active for sibling pathnames', () => {
    globalThis.__NH_NAV_PATHNAME__ = '/team';
    render(<NavLink href="/projects" icon="◱" label="Projets" />);
    expect(screen.getByRole('link').getAttribute('aria-current')).toBeNull();
  });

  it('preserves the active client filter in the href', () => {
    globalThis.__NH_NAV_SEARCH__ = new URLSearchParams('client=acme');
    render(<NavLink href="/projects" icon="◱" label="Projets" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/projects?client=acme');
  });

  it('renders the count badge when count > 0', () => {
    render(<NavLink href="/projects" icon="◱" label="Projets" count={14} />);
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('does not render a count badge for count = 0', () => {
    render(<NavLink href="/projects" icon="◱" label="Projets" count={0} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
