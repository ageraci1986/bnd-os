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
    isDone: false,
  };
}

function renderMonth(
  cards: readonly CalendarCardItem[],
  clientSlug: string | null = null,
  extraParams?: Readonly<Record<string, string>>,
) {
  return render(
    <CalendarView
      year={2026}
      month1={10}
      cards={cards}
      basePath="/projects/calendar"
      clientSlug={clientSlug}
      legend={[]}
      {...(extraParams ? { extraParams } : {})}
    />,
  );
}

describe('<CalendarView /> — busy days', () => {
  it('shows 3 cards and a collapsed "+N autres" toggle when a day has more', () => {
    renderMonth([1, 2, 3, 4, 5].map((i) => card(i)));
    const toggle = screen.getByRole('button', { name: '+2 autres' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Carte 4' })).toBeNull();
  });

  it('expands the day with "Réduire" placed after the last card', () => {
    renderMonth([1, 2, 3, 4, 5].map((i) => card(i)));
    fireEvent.click(screen.getByRole('button', { name: '+2 autres' }));
    for (const i of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('link', { name: `Carte ${i}` })).toBeInTheDocument();
    }
    const collapse = screen.getByRole('button', { name: 'Réduire' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    const last = screen.getByRole('link', { name: 'Carte 5' });
    expect(last.compareDocumentPosition(collapse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('collapses back to 3 cards on "Réduire"', () => {
    renderMonth([1, 2, 3, 4, 5].map((i) => card(i)));
    fireEvent.click(screen.getByRole('button', { name: '+2 autres' }));
    fireEvent.click(screen.getByRole('button', { name: 'Réduire' }));
    expect(screen.queryByRole('link', { name: 'Carte 5' })).toBeNull();
    expect(screen.getByRole('button', { name: '+2 autres' })).toBeInTheDocument();
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

describe('<CalendarView /> — done cards & params', () => {
  it('strikes through a card that sits in the last column', () => {
    renderMonth([{ ...card(1), isDone: true }]);
    const link = screen.getByRole('link', { name: /Carte 1/ });
    expect(link.className).toMatch(/\bdone\b/);
    expect(link).toHaveTextContent('(terminée)');
  });

  it('keeps extra params (mine) on month navigation', () => {
    render(
      <CalendarView
        year={2026}
        month1={10}
        cards={[]}
        basePath="/projects/calendar"
        clientSlug="acme"
        legend={[]}
        extraParams={{ mine: '1' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Mois suivant' })).toHaveAttribute(
      'href',
      '/projects/calendar?month=2026-11&client=acme&mine=1',
    );
  });
});
