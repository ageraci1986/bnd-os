import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { CalendarView, type CalendarCardItem } from './calendar-view';

function card(i: number, isoDate = '2026-10-15'): CalendarCardItem {
  return {
    id: `card-${i}`,
    projectId: 'p-1',
    title: `Carte ${i}`,
    shortRef: i,
    isoDate,
    clientColorToken: 'c-acme',
    columnIsBlocked: false,
  };
}

function renderMonth(cards: readonly CalendarCardItem[], clientSlug: string | null = null) {
  return render(
    <CalendarView
      year={2026}
      month1={10}
      cards={cards}
      basePath="/projects/calendar"
      clientSlug={clientSlug}
      legend={[]}
    />,
  );
}

describe('<CalendarView /> — busy days', () => {
  it('shows 3 cards and a "+N autres" toggle when a day has more', () => {
    renderMonth([1, 2, 3, 4, 5].map((i) => card(i)));
    const toggle = screen.getByText('+2 autres');
    expect(toggle.closest('summary')).not.toBeNull();
    expect(toggle.closest('details')?.open).toBe(false);
  });

  it('expands the day to reveal every card', () => {
    renderMonth([1, 2, 3, 4, 5].map((i) => card(i)));
    fireEvent.click(screen.getByText('+2 autres'));
    expect(screen.getByText('+2 autres').closest('details')?.open).toBe(true);
    for (const i of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('link', { name: `Carte ${i}` })).toBeInTheDocument();
    }
  });

  it('renders no toggle when the day has 3 cards or fewer', () => {
    renderMonth([1, 2, 3].map((i) => card(i)));
    expect(screen.queryByText(/autres?$/)).toBeNull();
  });

  it('keeps the client filter on card links', () => {
    renderMonth([card(1)], 'acme');
    expect(screen.getByRole('link', { name: 'Carte 1' }).getAttribute('href')).toBe(
      '/projects/p-1?card=card-1&client=acme',
    );
  });
});
