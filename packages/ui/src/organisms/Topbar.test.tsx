import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Topbar } from './Topbar';

describe('<Topbar />', () => {
  it('renders the left + right slots', () => {
    render(<Topbar left={<span>search</span>} right={<button>act</button>} />);
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'act' })).toBeInTheDocument();
  });

  it('is a banner landmark (semantic <header>)', () => {
    render(<Topbar />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
