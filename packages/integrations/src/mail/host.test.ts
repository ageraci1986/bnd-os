import { describe, it, expect } from 'vitest';
import { normalizeMailHost } from './host';

describe('normalizeMailHost', () => {
  it.each([
    ['ex3.mail.ovh.net', 'ex3.mail.ovh.net'],
    ['  ex3.mail.ovh.net  ', 'ex3.mail.ovh.net'],
    ['http://ex3.mail.ovh.net/', 'ex3.mail.ovh.net'],
    ['https://ex3.mail.ovh.net/owa/?x=1#y', 'ex3.mail.ovh.net'],
    ['imaps://imap.example.com:993', 'imap.example.com'],
    ['IMAP.Example.COM.', 'imap.example.com'],
    ['imap.example.com:993', 'imap.example.com'],
    ['user@imap.example.com', 'imap.example.com'],
    ['192.168.1.10', '192.168.1.10'],
    ['[::1]:993', '[::1]'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeMailHost(input)).toBe(expected);
  });

  it('returns an empty string when nothing usable remains', () => {
    expect(normalizeMailHost('http://')).toBe('');
  });
});
