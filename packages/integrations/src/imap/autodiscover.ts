import { XMLParser } from 'fast-xml-parser';

export interface AutodiscoverResult {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
}

const HTTP_TIMEOUT_MS = 3_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  processEntities: false, // no XXE
  isArray: (name) => name === 'incomingServer',
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

function pickImap(xml: string): AutodiscoverResult | null {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return null;
  }
  // Navigate: clientConfig.emailProvider.incomingServer[] where type=imap
  const cfg = (doc as { clientConfig?: { emailProvider?: { incomingServer?: unknown } } })
    ?.clientConfig?.emailProvider?.incomingServer;
  const servers = Array.isArray(cfg) ? cfg : cfg ? [cfg] : [];
  for (const s of servers) {
    const obj = s as { type?: string; hostname?: string; port?: string; socketType?: string };
    if (obj.type !== 'imap' || !obj.hostname || !obj.port) continue;
    const port = Number(obj.port);
    if (!Number.isFinite(port)) continue;
    const secure = obj.socketType === 'SSL' || obj.socketType === 'TLS' || port === 993;
    return { host: obj.hostname, port, secure };
  }
  return null;
}

export async function autodiscoverImap(email: string): Promise<AutodiscoverResult | null> {
  const domain = domainOf(email);
  if (!domain) return null;
  const urls = [
    `https://autoconfig.thunderbird.net/v1.1/${domain}`,
    `https://autoconfig.${domain}/mail/config-v1.1.xml`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
  ];
  for (const url of urls) {
    const xml = await fetchWithTimeout(url);
    if (!xml) continue;
    const hit = pickImap(xml);
    if (hit) return hit;
  }
  return null;
}
