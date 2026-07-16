import { XMLParser } from 'fast-xml-parser';

export interface MailServerConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  /** STARTTLS required on a non-TLS port (587). Distinguishes from implicit TLS (465/993). */
  readonly requireTls?: boolean;
}

export interface AutodiscoverMailResult {
  readonly imap: MailServerConfig | null;
  readonly smtp: MailServerConfig | null;
}

const HTTP_TIMEOUT_MS = 3_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  processEntities: false, // no XXE
  isArray: (name) => name === 'incomingServer' || name === 'outgoingServer',
});

function domainOf(email: string): string | null {
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

async function fetchWithTimeout(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'error' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function pickServer(servers: unknown, type: 'imap' | 'smtp'): MailServerConfig | null {
  const list = Array.isArray(servers) ? servers : servers ? [servers] : [];
  for (const s of list) {
    const obj = s as { type?: string; hostname?: string; port?: string; socketType?: string };
    if (obj.type !== type || !obj.hostname || !obj.port) continue;
    const port = Number(obj.port);
    if (!Number.isFinite(port)) continue;
    const secure =
      obj.socketType === 'SSL' || obj.socketType === 'TLS' || port === 993 || port === 465;
    const config: MailServerConfig = secure
      ? { host: obj.hostname, port, secure: true }
      : {
          host: obj.hostname,
          port,
          secure: false,
          requireTls: obj.socketType === 'STARTTLS' || port === 587,
        };
    return config;
  }
  return null;
}

function parseIspdb(xml: string): AutodiscoverMailResult {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return { imap: null, smtp: null };
  }
  const provider = (
    doc as {
      clientConfig?: { emailProvider?: { incomingServer?: unknown; outgoingServer?: unknown } };
    }
  )?.clientConfig?.emailProvider;
  if (!provider) return { imap: null, smtp: null };
  return {
    imap: pickServer(provider.incomingServer, 'imap'),
    smtp: pickServer(provider.outgoingServer, 'smtp'),
  };
}

export async function autodiscoverMail(email: string): Promise<AutodiscoverMailResult> {
  const domain = domainOf(email);
  if (!domain) return { imap: null, smtp: null };
  const urls = [
    `https://autoconfig.thunderbird.net/v1.1/${domain}`,
    `https://autoconfig.${domain}/mail/config-v1.1.xml`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
  ];
  for (const url of urls) {
    const xml = await fetchWithTimeout(url);
    if (!xml) continue;
    const hit = parseIspdb(xml);
    if (hit.imap || hit.smtp) return hit;
  }
  return { imap: null, smtp: null };
}
