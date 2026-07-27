import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ProjectListWidget } from './project-list-widget';

describe('<ProjectListWidget />', () => {
  it('renders a list item per project with name, client and card count', () => {
    render(
      <ProjectListWidget
        data={[
          { id: 'p1', name: 'Refonte site', client: 'Acme', cards: 12 },
          { id: 'p2', name: 'Campagne été', client: 'Bolt', cards: 1 },
        ]}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Refonte site')).toBeInTheDocument();
    expect(screen.getByText(/Acme · 12 cartes/)).toBeInTheDocument();
    expect(screen.getByText(/Bolt · 1 carte/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Refonte site/ })).toHaveAttribute(
      'href',
      '/projects/p1',
    );
  });

  it('renders nothing and warns when the data shape is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = render(<ProjectListWidget data={{}} />);
    expect(container.firstChild).toBeNull();
    expect(warn).toHaveBeenCalledWith('[assistant] widget data invalide', {
      tool: 'list_projects',
    });
    warn.mockRestore();
  });

  it('renders an empty container for an empty list', () => {
    render(<ProjectListWidget data={[]} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
