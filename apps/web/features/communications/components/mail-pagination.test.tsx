import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Vitest hoists vi.mock above all imports, so anything it references
// must come from `vi.hoisted()` (not a top-level `const`).
const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/communications',
  useRouter: () => ({
    push,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () =>
    new URLSearchParams(
      'client=acme&mailbox=int-1&mail=6f9619ff-8b86-4d01-b42d-00cf4fc964ff&page=2',
    ),
}));

import { MailPagination } from './mail-pagination';

beforeEach(() => {
  push.mockClear();
});

describe('<MailPagination /> goto', () => {
  it('drops the mail deep-link param but preserves client and mailbox on Next', () => {
    render(<MailPagination page={2} totalPages={5} totalCount={230} />);
    fireEvent.click(screen.getByRole('button', { name: /Suivant/i }));
    expect(push).toHaveBeenCalledOnce();
    const [href] = push.mock.calls[0]!;
    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/communications');
    expect(url.searchParams.get('client')).toBe('acme');
    expect(url.searchParams.get('mailbox')).toBe('int-1');
    expect(url.searchParams.get('page')).toBe('3');
    expect(url.searchParams.has('mail')).toBe(false);
  });

  it('drops the mail param on Previous too (back to page 1 removes page as well)', () => {
    render(<MailPagination page={2} totalPages={5} totalCount={230} />);
    fireEvent.click(screen.getByRole('button', { name: /Précédent/i }));
    expect(push).toHaveBeenCalledOnce();
    const [href] = push.mock.calls[0]!;
    const url = new URL(href, 'http://localhost');
    expect(url.searchParams.get('client')).toBe('acme');
    expect(url.searchParams.get('mailbox')).toBe('int-1');
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('mail')).toBe(false);
  });
});
