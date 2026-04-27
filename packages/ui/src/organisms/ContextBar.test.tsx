import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextBar } from './ContextBar';

describe('<ContextBar />', () => {
  it('renders all crumbs in order', () => {
    render(
      <ContextBar
        crumbs={[
          { label: 'Studio Atlas' },
          { label: 'Projets' },
          { label: 'Campagne Été 2025', current: true },
        ]}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Studio Atlas')).toBeInTheDocument();
    expect(screen.getByText('Projets')).toBeInTheDocument();
    expect(screen.getByText('Campagne Été 2025')).toBeInTheDocument();
  });

  it('marks the current crumb as <strong>', () => {
    render(
      <ContextBar crumbs={[{ label: 'Studio Atlas' }, { label: 'Dashboard', current: true }]} />,
    );
    expect(screen.getByText('Dashboard').tagName).toBe('STRONG');
  });

  it('renders the right slot when provided', () => {
    render(<ContextBar crumbs={[{ label: 'Home' }]} right={<span>chip</span>} />);
    expect(screen.getByText('chip')).toBeInTheDocument();
  });

  it('exposes a navigation landmark with breadcrumb label', () => {
    render(<ContextBar crumbs={[{ label: 'Home' }]} />);
    expect(screen.getByRole('navigation', { name: /fil/i })).toBeInTheDocument();
  });
});
