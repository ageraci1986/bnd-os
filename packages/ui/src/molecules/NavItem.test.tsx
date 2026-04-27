import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavItem } from './NavItem';

describe('<NavItem />', () => {
  it('renders icon + label', () => {
    render(<NavItem icon="◈" label="Dashboard" />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('◈')).toBeInTheDocument();
  });

  it('shows the count when > 0', () => {
    render(<NavItem icon="◱" label="Projets" count={14} />);
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('hides the count when 0', () => {
    render(<NavItem icon="◱" label="Projets" count={0} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('hides the count when undefined', () => {
    const { container } = render(<NavItem icon="◱" label="Projets" />);
    // Only the icon and label should be there; no count badge
    expect(container.querySelectorAll('span').length).toBeLessThan(4);
  });

  it('renders the "new" tone with a gradient inline style', () => {
    render(<NavItem icon="✉" label="Mails" count={23} countTone="new" />);
    const badge = screen.getByText('23');
    expect(badge.getAttribute('style')).toMatch(/linear-gradient/);
  });

  it('applies the active class when active', () => {
    render(<NavItem icon="◈" label="Dashboard" active />);
    expect(screen.getByText('Dashboard').parentElement?.className).toMatch(
      /accent-gradient-soft|accent-primary/,
    );
  });
});
