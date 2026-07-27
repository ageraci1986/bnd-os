import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiCards } from './kpi-cards';

describe('<KpiCards />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the 4 compact tiles with their labels and values', () => {
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

  it('colors the blocked value with the danger token when > 0', () => {
    render(
      <KpiCards
        data={{ blockedCards: 3, dueTodayCards: 0, unreadMails: 0, unreadNotifications: 0 }}
      />,
    );
    expect(screen.getByText('3').getAttribute('style')).toContain('--color-danger');
  });

  it('keeps the blocked value on the main text token when 0', () => {
    render(
      <KpiCards
        data={{ blockedCards: 0, dueTodayCards: 7, unreadMails: 7, unreadNotifications: 7 }}
      />,
    );
    const style = screen.getByText('0').getAttribute('style');
    expect(style).toContain('--color-text-main');
    expect(style).not.toContain('--color-danger');
  });

  it('renders nothing and warns when the data shape is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = render(<KpiCards data={{}} />);
    expect(container.firstChild).toBeNull();
    expect(warn).toHaveBeenCalledWith('[assistant] widget data invalide', {
      tool: 'get_today_overview',
    });
  });

  it('renders nothing when data is not an object', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = render(<KpiCards data={null} />);
    expect(container.firstChild).toBeNull();
  });
});
