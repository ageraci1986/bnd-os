import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const replace = vi.fn();
let search = 'client=acme';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/projects/calendar',
  useSearchParams: () => new URLSearchParams(search),
}));

import { MyCardsToggle } from './my-cards-toggle';

beforeEach(() => replace.mockReset());

describe('<MyCardsToggle />', () => {
  it('turns mine on and keeps other params', () => {
    search = 'client=acme';
    render(<MyCardsToggle />);
    const btn = screen.getByRole('button', { name: /mes cartes/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(replace).toHaveBeenCalledWith('/projects/calendar?client=acme&mine=1', {
      scroll: false,
    });
  });

  it('turns mine off', () => {
    search = 'mine=1';
    render(<MyCardsToggle />);
    const btn = screen.getByRole('button', { name: /mes cartes/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(replace).toHaveBeenCalledWith('/projects/calendar', { scroll: false });
  });
});
