import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from './MetricCard';

describe('<MetricCard />', () => {
  it('renders label and value', () => {
    render(<MetricCard label="Projets actifs" value="14" />);
    expect(screen.getByText('Projets actifs')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('renders the trend when provided', () => {
    render(<MetricCard label="Mes tâches" value={27} trend="↑ +2" trendTone="success" />);
    expect(screen.getByText('↑ +2')).toBeInTheDocument();
  });

  it('omits the trend when not provided', () => {
    render(<MetricCard label="Membres" value="12" />);
    expect(screen.queryByText(/↑/)).not.toBeInTheDocument();
  });

  it('applies the danger value tone (PRD §6 — Cartes bloquées)', () => {
    render(<MetricCard label="Cartes bloquées" value="03" valueTone="danger" />);
    const value = screen.getByText('03');
    expect(value.className).toMatch(/danger/);
  });
});
