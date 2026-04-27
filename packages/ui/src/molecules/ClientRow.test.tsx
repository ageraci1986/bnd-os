import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientRow } from './ClientRow';

describe('<ClientRow />', () => {
  it('renders the client name', () => {
    render(<ClientRow name="Acme Brands" colorToken="c-acme" />);
    expect(screen.getByText('Acme Brands')).toBeInTheDocument();
  });

  it('shows the count when > 0', () => {
    render(<ClientRow name="TechGroup" colorToken="c-tech" count={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('hides the count when 0', () => {
    render(<ClientRow name="Orbit" colorToken="c-orbit" count={0} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('applies the active class when active', () => {
    render(<ClientRow name="Acme Brands" colorToken="c-acme" active />);
    expect(screen.getByText('Acme Brands').parentElement?.className).toMatch(/bg-hover|text-main/);
  });
});
