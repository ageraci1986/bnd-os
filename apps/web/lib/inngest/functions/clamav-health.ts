import 'server-only';
import { Redis } from '@upstash/redis';
import { prisma } from '@nexushub/db';
import { getServerEnv } from '@/lib/env';
import { getEmail } from '@/lib/email';
import { probeClamav } from '@/lib/ops/clamav-probe';
import { inngestClient } from '../client';

/**
 * Surveillance ClamAV (spec `docs/superpowers/specs/2026-10-05-clamav-monitoring-design.md` §2).
 *
 * Contexte : le 2026-09-05 clamd est mort d'OOM sans que personne ne soit
 * prévenu pendant un mois — toutes les PJ (mail + cartes) étaient refusées
 * (fail-closed). Ce cron sonde clamd toutes les 10 min et prévient les
 * super-admins par email.
 *
 * Règles (cœur pur `runClamavHealth`) :
 *  - succès → `fails = 0` ; si une alerte avait été envoyée → email
 *    « Antivirus rétabli » + `alertSentAt = null` ;
 *  - échec → `fails += 1` ; si `fails >= 2` et (aucune alerte envoyée OU
 *    dernier envoi > 6 h) → email « Antivirus hors service » +
 *    `alertSentAt = now` (seulement si au moins un envoi a abouti — sinon
 *    le tick suivant réessaie).
 *  - `CLAMAV_HOST` absent → considéré en panne (même sémantique fail-closed
 *    que le scan) — voir `probeFromConfig`.
 *
 * Isolation : chaque destinataire est envoyé indépendamment ; un échec
 * n'empêche pas les suivants. Logs : comptes uniquement (CLAUDE.md §4.7).
 *
 * PINNED (voir `clamav-health-imports.test.ts`) : aucun import
 * `@nexushub/agent` / provider / registry — pas de tour d'agent ici.
 *
 * PATTERN : cœur pur + export Inngest « fil électrique » (même rationale que
 * `blocked-cards-scan.ts` — pas de harnais de test Inngest dans ce repo).
 */

export const CLAMAV_FAILS_KEY = 'ops:clamav:fails';
export const CLAMAV_ALERT_SENT_KEY = 'ops:clamav:alert_sent';

/** Seuil d'échecs consécutifs avant alerte (2 × 10 min). */
export const ALERT_THRESHOLD = 2;
/** Délai minimal entre deux alertes « hors service » pour une même panne. */
export const REALERT_AFTER_MS = 6 * 60 * 60 * 1000;
/** Période du cron — sert à estimer la durée de la panne dans l'email. */
const CHECK_INTERVAL_MIN = 10;

export const RUNBOOK_REF = 'docs/runbooks/card-attachments.md §4';

export interface ClamavHealthState {
  readonly fails: number;
  /** Horodatage (ms) du dernier email « hors service », `null` si aucun en cours. */
  readonly alertSentAt: number | null;
}

export interface ClamavHealthEmail {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface ClamavHealthDeps {
  readonly probe: () => Promise<boolean>;
  readonly getState: () => Promise<ClamavHealthState>;
  readonly setState: (state: ClamavHealthState) => Promise<void>;
  readonly listRecipients: () => Promise<readonly string[]>;
  readonly sendEmail: (email: ClamavHealthEmail) => Promise<void>;
  readonly now: () => number;
}

export type ClamavHealthAction = 'none' | 'alert' | 'recovery';

export interface ClamavHealthResult {
  readonly up: boolean;
  readonly fails: number;
  readonly action: ClamavHealthAction;
  readonly recipients: number;
  readonly sent: number;
  readonly failed: number;
}

/* ---------- Contenu des emails (statique : aucune donnée utilisateur) ---- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function buildDownEmail(
  fails: number,
  now: number,
): { subject: string; text: string; html: string } {
  const sinceMin = (fails - 1) * CHECK_INTERVAL_MIN;
  const since = formatUtc(now - sinceMin * 60_000);
  const subject = '[NexusHub] Antivirus hors service';
  const lines = [
    "L'antivirus ClamAV de NexusHub ne répond plus.",
    '',
    `Statut : hors service (${fails} contrôles consécutifs en échec).`,
    `Depuis : environ ${since} (≈ ${sinceMin} min).`,
    '',
    'Impact : les pièces jointes mail et cartes sont refusées tant que le service est indisponible.',
    '',
    `Procédure : ${RUNBOOK_REF}.`,
    '',
    'Un nouvel email sera envoyé au rétablissement (rappel toutes les 6 h si la panne persiste).',
  ];
  const html = [
    `<p>L'antivirus ClamAV de NexusHub ne répond plus.</p>`,
    `<p><strong>Statut :</strong> hors service (${fails} contrôles consécutifs en échec).<br>`,
    `<strong>Depuis :</strong> environ ${escapeHtml(since)} (≈ ${sinceMin} min).</p>`,
    `<p><strong>Impact :</strong> les pièces jointes mail et cartes sont refusées tant que le service est indisponible.</p>`,
    `<p><strong>Procédure :</strong> <code>${escapeHtml(RUNBOOK_REF)}</code>.</p>`,
    `<p>Un nouvel email sera envoyé au rétablissement (rappel toutes les 6 h si la panne persiste).</p>`,
  ].join('');
  return { subject, text: lines.join('\n'), html };
}

export function buildRecoveryEmail(now: number): { subject: string; text: string; html: string } {
  const at = formatUtc(now);
  const subject = '[NexusHub] Antivirus rétabli';
  const text = [
    "L'antivirus ClamAV de NexusHub répond de nouveau.",
    '',
    `Statut : rétabli (${at}).`,
    '',
    'Impact : les pièces jointes mail et cartes sont de nouveau acceptées.',
    '',
    `Procédure (post-incident) : ${RUNBOOK_REF}.`,
  ].join('\n');
  const html = [
    `<p>L'antivirus ClamAV de NexusHub répond de nouveau.</p>`,
    `<p><strong>Statut :</strong> rétabli (${escapeHtml(at)}).</p>`,
    `<p><strong>Impact :</strong> les pièces jointes mail et cartes sont de nouveau acceptées.</p>`,
    `<p><strong>Procédure (post-incident) :</strong> <code>${escapeHtml(RUNBOOK_REF)}</code>.</p>`,
  ].join('');
  return { subject, text, html };
}

/* ---------- Cœur pur ----------------------------------------------------- */

async function sendToAll(
  deps: ClamavHealthDeps,
  content: { subject: string; text: string; html: string },
): Promise<{ recipients: number; sent: number; failed: number }> {
  const recipients = await deps.listRecipients();
  let sent = 0;
  let failed = 0;
  for (const to of recipients) {
    try {
      await deps.sendEmail({ to, ...content });
      sent += 1;
    } catch {
      // Isolation par destinataire — aucun détail loggé (PII : adresse).
      failed += 1;
    }
  }
  return { recipients: recipients.length, sent, failed };
}

export async function runClamavHealth(deps: ClamavHealthDeps): Promise<ClamavHealthResult> {
  const up = await deps.probe();
  const state = await deps.getState();
  const now = deps.now();

  if (up) {
    if (state.alertSentAt === null) {
      if (state.fails !== 0) await deps.setState({ fails: 0, alertSentAt: null });
      return { up, fails: 0, action: 'none', recipients: 0, sent: 0, failed: 0 };
    }
    const counts = await sendToAll(deps, buildRecoveryEmail(now));
    await deps.setState({ fails: 0, alertSentAt: null });
    return { up, fails: 0, action: 'recovery', ...counts };
  }

  const fails = state.fails + 1;
  const shouldAlert =
    fails >= ALERT_THRESHOLD &&
    (state.alertSentAt === null || now - state.alertSentAt > REALERT_AFTER_MS);

  if (!shouldAlert) {
    await deps.setState({ fails, alertSentAt: state.alertSentAt });
    return { up, fails, action: 'none', recipients: 0, sent: 0, failed: 0 };
  }

  const counts = await sendToAll(deps, buildDownEmail(fails, now));
  // Horodaté seulement si au moins un envoi a abouti : sinon le prochain
  // tick réessaie au lieu de se croire « déjà prévenu » pendant 6 h.
  await deps.setState({ fails, alertSentAt: counts.sent > 0 ? now : state.alertSentAt });
  return { up, fails, action: 'alert', ...counts };
}

/* ---------- Adaptateurs prod ---------------------------------------------- */

/**
 * `CLAMAV_HOST` absent → en panne, sans tentative réseau (fail-closed, même
 * sémantique que `uploadAttachment` / le scan des cartes).
 */
export function probeFromConfig(
  config: { readonly host: string | undefined; readonly port: number },
  probe: (opts: { host: string; port: number }) => Promise<boolean> = probeClamav,
): Promise<boolean> {
  if (!config.host) return Promise.resolve(false);
  return probe({ host: config.host, port: config.port });
}

export interface ClamavStateStore {
  readonly get: () => Promise<ClamavHealthState>;
  readonly set: (state: ClamavHealthState) => Promise<void>;
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function createRedisStateStore(redis: Redis): ClamavStateStore {
  return {
    async get() {
      const [fails, alertSentAt] = await Promise.all([
        redis.get<unknown>(CLAMAV_FAILS_KEY),
        redis.get<unknown>(CLAMAV_ALERT_SENT_KEY),
      ]);
      return { fails: toNumber(fails) ?? 0, alertSentAt: toNumber(alertSentAt) };
    },
    async set(state) {
      await redis.set(CLAMAV_FAILS_KEY, state.fails);
      if (state.alertSentAt === null) await redis.del(CLAMAV_ALERT_SENT_KEY);
      else await redis.set(CLAMAV_ALERT_SENT_KEY, state.alertSentAt);
    },
  };
}

export function createMemoryStateStore(): ClamavStateStore {
  let current: ClamavHealthState = { fails: 0, alertSentAt: null };
  return {
    get: async () => current,
    set: async (state) => {
      current = state;
    },
  };
}

let _store: ClamavStateStore | null = null;

/**
 * Upstash quand configuré ; repli mémoire hors production réelle (même
 * politique que `lib/rate-limit` / `ConfirmStore`). En production sans
 * Upstash → erreur explicite (le run Inngest échoue, visible au dashboard).
 */
function getStateStore(): ClamavStateStore {
  if (_store) return _store;
  const env = getServerEnv();
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    _store = createRedisStateStore(
      new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
    );
    return _store;
  }
  if (process.env['VERCEL_ENV'] === 'production') {
    throw new Error('clamav-health: Upstash Redis credentials missing in production.');
  }
  _store = createMemoryStateStore();
  return _store;
}

/** Prisma leaf — adresses des super-admins (jamais loggées). */
export async function listSuperAdminEmails(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { isSuperAdmin: true },
    select: { email: true },
  });
  return rows.map((row) => row.email);
}

function prodDeps(): ClamavHealthDeps {
  const env = getServerEnv();
  const store = getStateStore();
  return {
    probe: () => probeFromConfig({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT }),
    getState: store.get,
    setState: store.set,
    listRecipients: listSuperAdminEmails,
    sendEmail: async ({ to, subject, html, text }) => {
      await getEmail().send({ to, subject, text, htmlSanitized: html, tag: 'notification' });
    },
    now: () => Date.now(),
  };
}

export const clamavHealth = inngestClient.createFunction(
  { id: 'clamav-health', triggers: [{ cron: '*/10 * * * *' }] },
  async ({ step }) => {
    const result = await step.run('check', () => runClamavHealth(prodDeps()));
    // Comptes seulement — jamais d'adresse (CLAUDE.md §4.7).
    console.warn('[inngest] clamav-health', result);
    return result;
  },
);
