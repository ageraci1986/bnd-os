import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autodiscoverImap } from './autodiscover';

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
  </emailProvider>
</clientConfig>`;

describe('autodiscoverImap', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the incoming IMAP server from Mozilla ISPDB', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('autoconfig.thunderbird.net')) {
          return new Response(ISPDB_OK, { status: 200 });
        }
        return new Response('', { status: 404 });
      }),
    );
    const r = await autodiscoverImap('me@ovh.net');
    expect(r).toEqual({ host: 'ssl0.ovh.net', port: 993, secure: true });
  });

  it('falls back to .well-known when ISPDB has no entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('autoconfig.thunderbird.net')) return new Response('', { status: 404 });
        if (url.includes('.well-known')) return new Response(ISPDB_OK, { status: 200 });
        return new Response('', { status: 404 });
      }),
    );
    const r = await autodiscoverImap('me@custom.tld');
    expect(r?.host).toBe('ssl0.ovh.net');
  });

  it('returns null when all endpoints miss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    expect(await autodiscoverImap('nobody@nowhere.example')).toBeNull();
  });

  it('returns null on malformed XML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<not xml', { status: 200 })),
    );
    expect(await autodiscoverImap('me@ovh.net')).toBeNull();
  });

  it('rejects when input is not an email', async () => {
    expect(await autodiscoverImap('not-an-email')).toBeNull();
  });
});
