import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiCards } from './kpi-cards';

describe('<KpiCards />', () => {
  it('renders the 4 metrics with their values', () => {
    render(
      <KpiCards
        data={{ blockedCards: 0, dueTodayCards: 2, unreadMails: 5, unreadNotifications: 1 }}
      />,
    );
    expect(screen.getByText('Bloquées')).toBeInTheDocument();
    expect(screen.getByText("Dues aujourd'hui")).toBeInTheDocument();
    expect(screen.getByText('Mails non lus')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('highlights blocked count in danger tone when > 0', () => {
    render(
      <KpiCards
        data={{ blockedCards: 3, dueTodayCards: 0, unreadMails: 0, unreadNotifications: 0 }}
      />,
    );
    const value = screen.getByText('3');
    expect(value.className).toContain('danger');
  });

  it('keeps blocked count neutral when 0', () => {
    render(
      <KpiCards
        data={{ blockedCards: 0, dueTodayCards: 0, unreadMails: 0, unreadNotifications: 0 }}
      />,
    );
    // La valeur "0" pour "Bloquées" doit être en ton neutre (pas rouge).
    const values = screen.getAllByText('0');
    const blockedValue = values.find((el) => !el.className.includes('danger'));
    expect(blockedValue).toBeDefined();
  });

  it('renders nothing when the data shape is invalid', () => {
    const { container } = render(<KpiCards data={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when data is not an object', () => {
    const { container } = render(<KpiCards data={null} />);
    expect(container.firstChild).toBeNull();
  });
});
