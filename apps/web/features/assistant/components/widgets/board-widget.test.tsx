import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { BoardWidget } from './board-widget';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

function makeCards(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `card-${i}`,
    title: `Carte ${i}`,
    due: i === 0 ? '2026-08-01T00:00:00.000Z' : null,
  }));
}

describe('<BoardWidget />', () => {
  it('renders the project name, columns and a link to the project', () => {
    render(
      <BoardWidget
        data={{
          id: PROJECT_ID,
          name: 'Refonte site',
          columns: [
            { id: 'col-1', name: 'À faire', blocked: false, cards: makeCards(2) },
            { id: 'col-2', name: 'Bloqué', blocked: true, cards: makeCards(1) },
          ],
        }}
      />,
    );
    expect(screen.getByText('Refonte site')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Refonte site' })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}`,
    );
    expect(screen.getByText('À faire')).toBeInTheDocument();
    expect(screen.getByText('Bloqué')).toBeInTheDocument();
    expect(screen.getAllByText('Carte 0')).toHaveLength(2);
  });

  it('shows only 5 cards per column and a "+N autres" summary beyond that', () => {
    render(
      <BoardWidget
        data={{
          id: PROJECT_ID,
          name: 'Projet',
          columns: [{ id: 'col-1', name: 'Backlog', blocked: false, cards: makeCards(8) }],
        }}
      />,
    );
    expect(screen.getByText('Carte 4')).toBeInTheDocument();
    expect(screen.queryByText('Carte 5')).not.toBeInTheDocument();
    expect(screen.getByText('+3 autres')).toBeInTheDocument();
  });

  it('appends "(liste partielle)" when the column is truncated server-side', () => {
    render(
      <BoardWidget
        data={{
          id: PROJECT_ID,
          name: 'Projet',
          columns: [
            { id: 'col-1', name: 'Backlog', blocked: false, cards: makeCards(7), truncated: true },
          ],
        }}
      />,
    );
    expect(screen.getByText('+2 autres (liste partielle)')).toBeInTheDocument();
  });

  it('renders nothing and warns when the data shape is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = render(<BoardWidget data={{ foo: 'bar' }} />);
    expect(container.firstChild).toBeNull();
    expect(warn).toHaveBeenCalledWith('[assistant] widget data invalide', {
      tool: 'get_project_board',
    });
  });
});
