import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { MailListWidget } from './mail-list-widget';

describe('<MailListWidget />', () => {
  it('renders sender, subject and a link to /communications for each mail', () => {
    render(
      <MailListWidget
        data={[
          {
            id: 'mail-1',
            subject: 'Point client',
            fromEmail: 'alice@acme.test',
            fromName: 'Alice',
            receivedAt: '2026-07-27T10:00:00.000Z',
            isRead: false,
            folder: 'inbox',
          },
          {
            id: 'mail-2',
            subject: null,
            fromEmail: 'bob@acme.test',
            fromName: null,
            receivedAt: '2026-07-20T10:00:00.000Z',
            isRead: true,
            folder: 'inbox',
          },
        ]}
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Point client')).toBeInTheDocument();
    expect(screen.getByText('bob@acme.test')).toBeInTheDocument();
    expect(screen.getByText('(sans objet)')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/communications');
  });

  it('shows an unread dot only for unread mails', () => {
    render(
      <MailListWidget
        data={[
          {
            id: 'mail-1',
            subject: 'Sujet',
            fromEmail: 'a@b.test',
            fromName: null,
            receivedAt: '2026-07-27T10:00:00.000Z',
            isRead: false,
            folder: 'inbox',
          },
        ]}
      />,
    );
    expect(screen.getByLabelText('non lu')).toBeInTheDocument();
  });

  it('caps the list at 10 mails', () => {
    const mails = Array.from({ length: 15 }, (_, i) => ({
      id: `mail-${i}`,
      subject: `Sujet ${i}`,
      fromEmail: `u${i}@b.test`,
      fromName: null,
      receivedAt: '2026-07-27T10:00:00.000Z',
      isRead: true,
      folder: 'inbox',
    }));
    render(<MailListWidget data={mails} />);
    expect(screen.getAllByRole('link')).toHaveLength(10);
  });

  it('renders nothing and warns when the data shape is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = render(<MailListWidget data={{}} />);
    expect(container.firstChild).toBeNull();
    expect(warn).toHaveBeenCalledWith('[assistant] widget data invalide', {
      tool: 'search_mails',
    });
    warn.mockRestore();
  });
});
