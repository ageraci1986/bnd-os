import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { renderWidget } from './index';

describe('renderWidget', () => {
  it('routes get_today_overview to KpiCards', () => {
    render(
      <>
        {renderWidget('get_today_overview', {
          blockedCards: 1,
          dueTodayCards: 0,
          unreadMails: 0,
          unreadNotifications: 0,
        })}
      </>,
    );
    expect(screen.getByText('Bloquées')).toBeInTheDocument();
  });

  it('routes get_project_board to BoardWidget', () => {
    render(
      <>
        {renderWidget('get_project_board', {
          id: 'p1',
          name: 'Refonte site',
          columns: [],
        })}
      </>,
    );
    expect(screen.getByText('Refonte site')).toBeInTheDocument();
  });

  it('routes search_mails to MailListWidget', () => {
    render(
      <>
        {renderWidget('search_mails', [
          {
            id: 'm1',
            subject: 'Sujet',
            fromEmail: 'a@b.test',
            fromName: 'Alice',
            receivedAt: '2026-07-27T10:00:00.000Z',
            isRead: true,
            folder: 'inbox',
          },
        ])}
      </>,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('routes list_projects to ProjectListWidget', () => {
    render(
      <>
        {renderWidget('list_projects', [{ id: 'p1', name: 'Refonte', client: 'Acme', cards: 3 }])}
      </>,
    );
    expect(screen.getByText('Refonte')).toBeInTheDocument();
  });

  it('returns null for an unknown tool name', () => {
    expect(renderWidget('some_other_tool', {})).toBeNull();
  });

  it('delegates the invalid-data silent fallback to the routed widget', () => {
    // renderWidget always returns an element for a whitelisted tool name — the
    // widget itself is responsible for rendering nothing on a bad data shape.
    const { container } = render(<>{renderWidget('get_today_overview', {})}</>);
    expect(container.textContent).toBe('');
  });
});
