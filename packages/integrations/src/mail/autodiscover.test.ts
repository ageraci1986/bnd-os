import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autodiscoverMail } from './autodiscover';

const ISPDB_OK = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="ovh.net">
    <incomingServer type="imap">
      <hostname>ssl0.ovh.net</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>ssl0.ovh.net</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

const ISPDB_STARTTLS = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="ex.com">
    <incomingServer type="imap"><hostname>imap.ex.com</hostname><port>143</port><socketType>STARTTLS</socketType></incomingServer>
    <outgoingServer type="smtp"><hostname>smtp.ex.com</hostname><port>587</port><socketType>STARTTLS</socketType></outgoingServer>
  </emailProvider>
</clientConfig>`;

describe('autodiscoverMail', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns both imap and smtp when both are present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(ISPDB_OK, { status: 200 })),
    );
    const r = await autodiscoverMail('me@ovh.net');
    expect(r.imap).toEqual({ host: 'ssl0.ovh.net', port: 993, secure: true });
    expect(r.smtp).toEqual({ host: 'ssl0.ovh.net', port: 465, secure: true });
  });

  it('sets requireTls=true when socketType is STARTTLS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(ISPDB_STARTTLS, { status: 200 })),
    );
    const r = await autodiscoverMail('me@ex.com');
    expect(r.imap).toMatchObject({
      host: 'imap.ex.com',
      port: 143,
      secure: false,
      requireTls: true,
    });
    expect(r.smtp).toMatchObject({
      host: 'smtp.ex.com',
      port: 587,
      secure: false,
      requireTls: true,
    });
  });

  it('returns null for both slots when all endpoints miss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    expect(await autodiscoverMail('nobody@nowhere.example')).toEqual({ imap: null, smtp: null });
  });

  it('rejects when input is not an email', async () => {
    expect(await autodiscoverMail('not-an-email')).toEqual({ imap: null, smtp: null });
  });
});
