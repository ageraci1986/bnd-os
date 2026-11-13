import type { Metadata } from 'next';
import Link from 'next/link';
import { Roles, clientColorCss } from '@nexushub/domain';
import { requireUser } from '@/lib/auth';
import { getClientFilterFromSearchParams, resolveActiveClient } from '@/lib/client-filter/server';
import { getOverviewMetrics } from '@/features/overview/lib/metrics';
import { getMyCardsMetrics } from '@/features/overview/lib/my-cards';
import { getProjectProgress, type ProjectProgress } from '@/features/overview/lib/project-progress';
import {
  getRecentActivity,
  relativeShort,
  type ActivityItem,
} from '@/features/overview/lib/recent-activity';
import { getUrgentCards, urgencyOf, type UrgentCard } from '@/features/overview/lib/urgent-cards';
import { reconcileBeforeRead } from '@/features/projects/lib/reconcile';
import { loadUserScope } from '@/lib/auth/scope';
import { buildHrefWithClient } from '@/features/shell/lib/client-filter-url';

export const metadata: Metadata = {
  title: 'Tableau de bord',
};

interface OverviewPageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Paris',
});
const DAY_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
});
const plural = (n: number, one: string, many: string): string => (n > 1 ? many : one);
const pad = (n: number): string => n.toString().padStart(2, '0');

export default async function OverviewPage({ searchParams }: OverviewPageProps) {
  const ctx = await requireUser();
  const sp = (await searchParams) ?? {};
  const filter = getClientFilterFromSearchParams(sp);
  const mineOnly = sp['urgent'] === 'mine';

  // Parallelism strategy: every promise that only depends on `ctx` runs
  // concurrently from the start. Reconcile-on-read is awaited before the card
  // reads so a card that just went overdue already sits in Bloqué.
  const reconcilePromise = reconcileBeforeRead(ctx.workspaceId);
  const scope = await loadUserScope(ctx);
  const activeClient = await resolveActiveClient(filter, ctx.workspaceId, scope);
  await reconcilePromise;

  const common = {
    workspaceId: ctx.workspaceId,
    scope,
    ...(activeClient ? { clientId: activeClient.id } : {}),
  };
  const [metrics, myCards, urgent, progress, activity] = await Promise.all([
    getOverviewMetrics(common),
    getMyCardsMetrics({ ...common, userId: ctx.userId }),
    getUrgentCards({ ...common, userId: ctx.userId, mineOnly }),
    getProjectProgress(common),
    getRecentActivity(common),
  ]);

  const isAdmin = ctx.role === Roles.Admin;
  const slug = activeClient?.slug ?? null;
  const now = new Date();
  const calm = urgent.dueToday === 0 && urgent.blocked === 0;

  return (
    <div className="mx-auto max-w-7xl">
      <span className="bnd-kicker">
        {DATE_FMT.format(now)}
        {activeClient ? ` · ${activeClient.name}` : ''}
      </span>
      <h1 className="bnd-hero">
        {calm ? (
          <>
            Rien d&apos;urgent.
            <br />
            <em>Tout roule.</em>
          </>
        ) : (
          <>
            {urgent.dueToday} {plural(urgent.dueToday, 'livrable', 'livrables')}.
            <br />
            <em>
              {urgent.blocked} {plural(urgent.blocked, 'blocage', 'blocages')}.
            </em>
          </>
        )}
      </h1>
      <p className="bnd-lead">
        <b>Bienvenue ma star ! Prêt(e) à dead ça ?</b>
      </p>
      <p className="bnd-lead">
        {calm ? (
          'Aucun livrable dû aujourd’hui et aucune carte bloquée.'
        ) : (
          <>
            <b>
              {urgent.dueToday} {plural(urgent.dueToday, 'livrable', 'livrables')}
            </b>{' '}
            {plural(urgent.dueToday, 'est dû', 'sont dus')} aujourd’hui et{' '}
            <b>
              {urgent.blocked} {plural(urgent.blocked, 'carte', 'cartes')}
            </b>{' '}
            {plural(urgent.blocked, 'est bloquée', 'sont bloquées')} par une échéance dépassée.
          </>
        )}
      </p>

      <div className="bnd-kpis">
        {activeClient ? (
          <Kpi label="Client actif" value={activeClient.name} text />
        ) : (
          <Kpi label="Clients actifs" value={pad(metrics.clients)} />
        )}
        <Kpi label="Projets actifs" value={pad(metrics.projects)} />
        <Kpi
          label={activeClient ? 'Membres impliqués' : 'Membres équipe'}
          value={pad(metrics.members)}
        />
        <Kpi
          label="Cartes bloquées"
          value={pad(metrics.blockedCards)}
          alert={metrics.blockedCards > 0}
          note={metrics.blockedCards > 0 ? 'échéance dépassée' : 'aucun retard'}
        />
        <Kpi
          label="Mes cartes"
          value={pad(myCards.open)}
          note={myCards.overdue > 0 ? `dont ${myCards.overdue} en retard` : 'ouvertes'}
          href={buildHrefWithClient('/projects/calendar', 'mine=1', slug)}
          ariaLabel={`Mes cartes : ${myCards.open} ouvertes${myCards.overdue > 0 ? `, dont ${myCards.overdue} en retard` : ''}. Ouvrir le calendrier`}
        />
      </div>

      {metrics.projects === 0 ? (
        <EmptyProjectsCard activeClientName={activeClient?.name ?? null} isAdmin={isAdmin} />
      ) : (
        <div className="bnd-grid3">
          <UrgentPanel items={urgent.items} mineOnly={mineOnly} slug={slug} now={now} />
          <ProgressPanel items={progress} slug={slug} />
          <ActivityPanel items={activity} slug={slug} now={now} />
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  alert = false,
  text = false,
  href,
  ariaLabel,
}: {
  label: string;
  value: string;
  note?: string;
  alert?: boolean;
  text?: boolean;
  href?: string;
  ariaLabel?: string;
}) {
  const inner = (
    <>
      {text ? null : (
        <span className="bnd-kpi-ghost" aria-hidden="true">
          {value}
        </span>
      )}
      <div className="bnd-label">{label}</div>
      <div className={text ? 'bnd-kpi-value is-text' : 'bnd-kpi-value'}>{value}</div>
      <div className="bnd-kpi-note">{note ?? ''}</div>
    </>
  );
  const className = `bnd-kpi${alert ? ' is-alert' : ''}`;
  return href ? (
    <Link href={href} aria-label={ariaLabel} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function UrgentPanel({
  items,
  mineOnly,
  slug,
  now,
}: {
  items: readonly UrgentCard[];
  mineOnly: boolean;
  slug: string | null;
  now: Date;
}) {
  return (
    <section className="bnd-panel" aria-labelledby="ov-urgent">
      <div className="bnd-panel-h">
        <h2 id="ov-urgent">Tâches urgentes</h2>
        <nav className="bnd-seg" aria-label="Filtrer les tâches urgentes">
          <Link href={buildHrefWithClient('/overview', '', slug)} aria-current={!mineOnly}>
            Toutes
          </Link>
          <Link
            href={buildHrefWithClient('/overview', 'urgent=mine', slug)}
            aria-current={mineOnly}
          >
            Mes cartes
          </Link>
        </nav>
      </div>
      {items.length === 0 ? (
        <p className="bnd-empty">
          {mineOnly
            ? 'Aucune de vos cartes n’est bloquée ni due d’ici demain.'
            : 'Aucune carte bloquée ni due d’ici demain.'}
        </p>
      ) : (
        items.map((card) => {
          const u = urgencyOf(card, now);
          return (
            <Link
              key={card.id}
              href={buildHrefWithClient(`/projects/${card.projectId}`, `card=${card.id}`, slug)}
              className="bnd-row"
            >
              <span
                className="bnd-row-bar"
                style={{ background: clientColorCss(card.clientColorToken) }}
                aria-hidden="true"
              />
              <span className="bnd-row-body">
                <span className="bnd-row-title block">{card.title}</span>
                <span className="bnd-row-meta block">
                  {card.clientName} · {card.projectName}
                </span>
              </span>
              {u.kind === 'blocked' ? (
                <span className="bnd-badge is-danger">
                  Bloqué{u.daysLate > 0 ? ` +${u.daysLate} j` : ''}
                </span>
              ) : u.kind === 'late' ? (
                <span className="bnd-badge is-danger">Retard +{u.daysLate} j</span>
              ) : u.kind === 'today' ? (
                <span className="bnd-badge is-warning">Aujourd’hui</span>
              ) : (
                <span className="bnd-badge">Demain</span>
              )}
              <span className="bnd-row-ref">#{card.shortRef.toString().padStart(3, '0')}</span>
            </Link>
          );
        })
      )}
    </section>
  );
}

function ProgressPanel({
  items,
  slug,
}: {
  items: readonly ProjectProgress[];
  slug: string | null;
}) {
  return (
    <section className="bnd-panel" aria-labelledby="ov-progress">
      <div className="bnd-panel-h">
        <h2 id="ov-progress">Avancement projets</h2>
        <Link href={buildHrefWithClient('/projects', '', slug)} className="bnd-panel-link">
          Voir tout →
        </Link>
      </div>
      {items.map((p) => (
        <Link
          key={p.id}
          href={buildHrefWithClient(`/projects/${p.id}`, '', slug)}
          className="bnd-prog"
        >
          <span className="bnd-prog-top">
            <span className="min-w-0 truncate">{p.name}</span>
            <span className="bnd-mono">{p.percent}%</span>
          </span>
          <span
            className="bnd-prog-track block"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={p.percent}
            aria-label={`Avancement de ${p.name}`}
          >
            <span
              className={p.blocked > 0 ? 'bnd-prog-fill is-danger' : 'bnd-prog-fill'}
              style={{ width: `${p.percent}%` }}
            />
          </span>
          <span className="bnd-row-meta block">
            {p.clientName}
            {p.blocked > 0
              ? ` · ${p.blocked} ${plural(p.blocked, 'carte bloquée', 'cartes bloquées')}`
              : p.endDate
                ? ` · fin ${DAY_FMT.format(p.endDate)}`
                : ` · ${p.done}/${p.total} ${plural(p.total, 'carte', 'cartes')}`}
          </span>
        </Link>
      ))}
    </section>
  );
}

const ACTIVITY_VERB: Record<ActivityItem['kind'], string> = {
  card_created: 'a créé la carte',
  card_completed: 'Carte terminée :',
  comment_added: 'a commenté',
  project_created: 'Nouveau projet :',
};

function ActivityPanel({
  items,
  slug,
  now,
}: {
  items: readonly ActivityItem[];
  slug: string | null;
  now: Date;
}) {
  return (
    <section className="bnd-panel" aria-labelledby="ov-activity">
      <div className="bnd-panel-h">
        <h2 id="ov-activity">Activité</h2>
      </div>
      {items.length === 0 ? (
        <p className="bnd-empty">Aucune activité récente.</p>
      ) : (
        items.map((item) => (
          <Link
            key={item.key}
            href={buildHrefWithClient(
              `/projects/${item.projectId}`,
              item.cardId ? `card=${item.cardId}` : '',
              slug,
            )}
            className="bnd-act"
          >
            <span className={item.actor ? 'bnd-avatar' : 'bnd-avatar is-system'} aria-hidden="true">
              {item.actor ? item.actor.initials : '◆'}
            </span>
            <span className="min-w-0">
              {item.actor ? <b>{item.actor.name} </b> : null}
              {ACTIVITY_VERB[item.kind]} « {item.title} »
              <time dateTime={item.at.toISOString()}>{relativeShort(item.at, now)}</time>
            </span>
          </Link>
        ))
      )}
    </section>
  );
}

function EmptyProjectsCard({
  activeClientName,
  isAdmin,
}: {
  activeClientName: string | null;
  isAdmin: boolean;
}) {
  const title = activeClientName
    ? `Aucun projet pour ${activeClientName}`
    : 'Aucun projet pour le moment';
  const body = activeClientName
    ? 'Ce client n’a pas encore de projet actif. Créez-en un pour démarrer un Kanban.'
    : 'Lancez votre premier projet pour ouvrir un Kanban et inviter votre équipe.';

  return (
    <div className="bnd-panel mt-4 p-6">
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-[color:var(--color-text-muted)]">{body}</p>
      {isAdmin ? (
        <Link
          href="/projects"
          className="text-on-accent mt-4 inline-flex rounded-sm bg-[color:var(--color-accent-primary)] px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em]"
        >
          Créer un projet →
        </Link>
      ) : null}
    </div>
  );
}
