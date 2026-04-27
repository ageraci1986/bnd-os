/**
 * NexusHub — dev seed.
 *
 * Populates a fresh Supabase staging DB with:
 * - 1 workspace "Studio Atlas"
 * - 5 clients (Acme, TechGroup, Nova, Lumen, Orbit) — cf. mockups
 * - 5 project types (Campagne, Ongoing, Lancement, Spot TV, Social Media)
 * - 5 kanban templates (Campagne créa, Production vidéo, Social Media, Standard, Vide)
 * - 5 email templates with variable placeholders
 * - 14 projects spread across clients with columns + sample cards
 *
 * Idempotent: deletes the seed workspace first, then re-creates everything.
 * No `auth.users` rows are created — the seed is data-only.
 * Memberships, comments, and project members are populated lazily once
 * the Admin user signs in for the first time (Phase 2.3).
 *
 * Run: pnpm --filter @nexushub/db db:seed
 *   (requires DATABASE_URL + DIRECT_URL in env, e.g. .env.local at repo root)
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient({ log: ['warn', 'error'] });

const WORKSPACE_SLUG = 'studio-atlas';

// ---------- Templates -------------------------------------------------------

const KANBAN_TEMPLATES = [
  {
    name: 'Campagne créa',
    columns: ['Brief', 'Stratégie', 'Créa', 'Validation', 'Livré'],
  },
  {
    name: 'Production vidéo',
    columns: ['Pré-prod', 'Tournage', 'Montage', 'Post-prod', 'Livré'],
  },
  {
    name: 'Social Media',
    columns: ['Idéation', 'Création', 'Programmé', 'Publié'],
  },
  { name: 'Standard', columns: ['À faire', 'En cours', 'Done'] },
  { name: 'Vide', columns: [] },
] as const;

const PROJECT_TYPES = [
  { name: 'Campagne', icon: '🎯', description: 'Campagne marketing' },
  { name: 'Ongoing', icon: '🔁', description: 'Mission récurrente' },
  { name: 'Lancement', icon: '🚀', description: 'Lancement produit' },
  { name: 'Spot TV', icon: '📺', description: 'Production publicitaire' },
  { name: 'Social Media', icon: '📱', description: 'Contenu social' },
] as const;

const EMAIL_TEMPLATES = [
  {
    name: 'Accusé réception',
    subject: 'Bien reçu — {project_name}',
    body: "Bonjour {contact_name},\n\nJ'ai bien reçu ton message concernant {project_name}. Je reviens vers toi sous 24h avec un plan d'action.\n\nÀ très vite,\n{sender_name}",
    variables: ['contact_name', 'project_name', 'sender_name'],
  },
  {
    name: "Plan d'action",
    subject: "Plan d'action — {project_name} ({date})",
    body: "Bonjour {contact_name},\n\nVoici le plan d'action proposé pour {project_name} :\n\n1. ...\n2. ...\n3. ...\n\nDis-moi si ça te convient.\n\nCordialement,\n{sender_name}",
    variables: ['contact_name', 'project_name', 'sender_name', 'date'],
  },
  {
    name: 'Demande de validation',
    subject: 'Validation requise — {project_name}',
    body: 'Bonjour {contact_name},\n\nLes livrables pour {project_name} sont prêts pour ta validation. Merci de nous faire un retour avant le {date}.\n\n{sender_name}',
    variables: ['contact_name', 'project_name', 'sender_name', 'date'],
  },
  {
    name: 'Relance',
    subject: 'Relance — {project_name}',
    body: 'Bonjour {contact_name},\n\nPetite relance concernant {project_name} : pourrais-tu nous faire un retour cette semaine ? Cela nous permettra de tenir le planning.\n\nMerci,\n{sender_name}',
    variables: ['contact_name', 'project_name', 'sender_name'],
  },
  {
    name: 'Livraison finale',
    subject: 'Livraison — {project_name}',
    body: "Bonjour {contact_name},\n\nNous sommes ravis de te livrer {project_name}. Tu trouveras tous les éléments en pièce jointe (et dans le dossier {client_name}).\n\nN'hésite pas si tu as la moindre question.\n\n{sender_name}",
    variables: ['contact_name', 'client_name', 'project_name', 'sender_name'],
  },
] as const;

// ---------- Clients (cf. mockups) -------------------------------------------

const CLIENTS = [
  {
    name: 'Acme Brands',
    slug: 'acme',
    colorToken: 'c-acme',
    initials: 'AB',
    domains: ['acme.com', 'acmebrands.fr'],
    contacts: [
      {
        firstName: 'Sophie',
        lastName: 'Roux',
        jobTitle: 'Marketing Director',
        email: 'sophie@acme.com',
        raci: 'approver' as const,
      },
      {
        firstName: 'Lucas',
        lastName: 'Martin',
        jobTitle: 'Brand Manager',
        email: 'lucas@acme.com',
        raci: 'consulted' as const,
      },
    ],
  },
  {
    name: 'TechGroup SA',
    slug: 'tech',
    colorToken: 'c-tech',
    initials: 'TG',
    domains: ['techgroup.io'],
    contacts: [
      {
        firstName: 'Julien',
        lastName: 'Tournier',
        jobTitle: 'CMO',
        email: 'julien@techgroup.io',
        raci: 'approver' as const,
      },
    ],
  },
  {
    name: 'Nova Editions',
    slug: 'nova',
    colorToken: 'c-nova',
    initials: 'NE',
    domains: ['nova-editions.fr'],
    contacts: [
      {
        firstName: 'Marie',
        lastName: 'Dubois',
        jobTitle: 'Editrice',
        email: 'marie@nova-editions.fr',
        raci: 'responsible' as const,
      },
    ],
  },
  {
    name: 'Lumen & Co',
    slug: 'lumen',
    colorToken: 'c-lumen',
    initials: 'LC',
    domains: ['lumenco.com'],
    contacts: [
      {
        firstName: 'Léa',
        lastName: 'Petit',
        jobTitle: 'Communication',
        email: 'lea@lumenco.com',
        raci: 'consulted' as const,
      },
    ],
  },
  {
    name: 'Orbit Studio',
    slug: 'orbit',
    colorToken: 'c-orbit',
    initials: 'OS',
    domains: ['orbit.studio'],
    contacts: [
      {
        firstName: 'Rémi',
        lastName: 'Lambert',
        jobTitle: 'Founder',
        email: 'remi@orbit.studio',
        raci: 'informed' as const,
      },
    ],
  },
] as const;

// 14 projects — distributed across the 5 clients (cf. PRD/mockups context)
const PROJECTS: readonly {
  client: (typeof CLIENTS)[number]['slug'];
  name: string;
  type: (typeof PROJECT_TYPES)[number]['name'];
  template: (typeof KANBAN_TEMPLATES)[number]['name'];
  description?: string;
  startDate?: string;
  endDate?: string;
}[] = [
  {
    client: 'acme',
    name: 'Campagne Été 2026',
    type: 'Campagne',
    template: 'Campagne créa',
    startDate: '2026-03-01',
    endDate: '2026-04-28',
  },
  {
    client: 'acme',
    name: 'Refonte Packaging',
    type: 'Lancement',
    template: 'Standard',
    startDate: '2026-02-15',
    endDate: '2026-06-30',
  },
  { client: 'acme', name: 'Social Acme Q2', type: 'Social Media', template: 'Social Media' },
  {
    client: 'tech',
    name: 'Lancement Q2 produit',
    type: 'Lancement',
    template: 'Campagne créa',
    startDate: '2026-03-15',
    endDate: '2026-05-15',
  },
  { client: 'tech', name: 'Refonte site corporate', type: 'Lancement', template: 'Standard' },
  { client: 'tech', name: 'TechGroup Ongoing', type: 'Ongoing', template: 'Standard' },
  { client: 'nova', name: 'Social Media Ongoing', type: 'Ongoing', template: 'Social Media' },
  { client: 'nova', name: 'Catalogue Automne', type: 'Campagne', template: 'Campagne créa' },
  {
    client: 'lumen',
    name: 'Spot TV Printemps',
    type: 'Spot TV',
    template: 'Production vidéo',
    startDate: '2026-02-01',
    endDate: '2026-04-22',
  },
  { client: 'lumen', name: 'Lumen Ongoing', type: 'Ongoing', template: 'Standard' },
  { client: 'lumen', name: 'Newsletter mensuelle', type: 'Ongoing', template: 'Standard' },
  { client: 'orbit', name: 'Identité visuelle', type: 'Lancement', template: 'Standard' },
  { client: 'orbit', name: 'Pitch deck investisseurs', type: 'Campagne', template: 'Standard' },
  { client: 'orbit', name: 'Vidéo manifesto', type: 'Spot TV', template: 'Production vidéo' },
];

// Sample cards inserted on the first user-column of each project (cf. mockups 03-overview)
const SAMPLE_CARDS: Record<
  string,
  readonly { title: string; categoryTag?: string; dueDateOffsetDays?: number }[]
> = {
  'Campagne Été 2026': [
    { title: 'Valider la DA de la key visual', categoryTag: 'design', dueDateOffsetDays: -2 },
    { title: 'Brief copy hero', categoryTag: 'copy', dueDateOffsetDays: 5 },
  ],
  'Lancement Q2 produit': [
    { title: 'Livrer les maquettes formats Meta', categoryTag: 'design', dueDateOffsetDays: 0 },
  ],
  'Social Media Ongoing': [
    { title: 'Brief créatif social media — mai', categoryTag: 'strategy', dueDateOffsetDays: 0 },
  ],
  'Spot TV Printemps': [
    { title: 'Relecture script spot 30"', categoryTag: 'video', dueDateOffsetDays: 1 },
  ],
  'Refonte Packaging': [
    { title: 'Export final packaging — BAT', categoryTag: 'design', dueDateOffsetDays: -5 },
  ],
};

// ---------- Seed entrypoint -------------------------------------------------

async function main(): Promise<void> {
  console.warn(`[seed] Resetting workspace "${WORKSPACE_SLUG}"…`);

  // 1. Clean slate (cascade deletes everything via FKs)
  await prisma.workspace.deleteMany({ where: { slug: WORKSPACE_SLUG } });

  // 2. Workspace
  const workspace = await prisma.workspace.create({
    data: {
      id: randomUUID(),
      slug: WORKSPACE_SLUG,
      name: 'Studio Atlas',
      defaultLocale: 'fr',
      defaultTimezone: 'Europe/Paris',
    },
  });
  console.warn(`[seed] Created workspace ${workspace.id}`);

  // 3. Clients + contacts
  const clientIdBySlug = new Map<string, string>();
  for (const c of CLIENTS) {
    const client = await prisma.client.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        name: c.name,
        colorToken: c.colorToken,
        initials: c.initials,
        domains: [...c.domains],
        contacts: {
          create: c.contacts.map((ct) => ({
            workspaceId: workspace.id,
            firstName: ct.firstName,
            lastName: ct.lastName,
            jobTitle: ct.jobTitle ?? null,
            email: ct.email,
            raci: ct.raci,
          })),
        },
      },
    });
    clientIdBySlug.set(c.slug, client.id);
  }
  console.warn(`[seed] Created ${CLIENTS.length} clients with contacts`);

  // 4. Project types
  const typeIdByName = new Map<string, string>();
  for (const t of PROJECT_TYPES) {
    const type = await prisma.projectType.create({
      data: {
        workspaceId: workspace.id,
        name: t.name,
        icon: t.icon,
        description: t.description,
        isBuiltin: true,
      },
    });
    typeIdByName.set(t.name, type.id);
  }

  // 5. Kanban templates
  for (const t of KANBAN_TEMPLATES) {
    await prisma.kanbanTemplate.create({
      data: {
        workspaceId: workspace.id,
        name: t.name,
        isBuiltin: true,
        columns: {
          create: t.columns.map((name, i) => ({ name, position: (i + 1) * 10 })),
        },
      },
    });
  }

  // 6. Email templates
  for (const e of EMAIL_TEMPLATES) {
    await prisma.emailTemplate.create({
      data: {
        workspaceId: workspace.id,
        name: e.name,
        subject: e.subject,
        body: e.body,
        variables: [...e.variables],
      },
    });
  }
  console.warn(
    `[seed] Created ${PROJECT_TYPES.length} project types, ${KANBAN_TEMPLATES.length} kanban templates, ${EMAIL_TEMPLATES.length} email templates`,
  );

  // 7. Projects + columns (copy-on-create from template) + sample cards
  const now = Date.now();
  for (const p of PROJECTS) {
    const clientId = clientIdBySlug.get(p.client);
    if (!clientId) throw new Error(`Unknown client slug: ${p.client}`);

    const tmpl = KANBAN_TEMPLATES.find((t) => t.name === p.template);
    if (!tmpl) throw new Error(`Unknown kanban template: ${p.template}`);

    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        clientId,
        typeId: typeIdByName.get(p.type) ?? null,
        name: p.name,
        description: p.description ?? null,
        startDate: p.startDate ? new Date(p.startDate) : null,
        endDate: p.endDate ? new Date(p.endDate) : null,
        archiveAutoDone: false,
      },
    });

    // Copy template columns + always append the system "Bloqué" column.
    const userColumns = tmpl.columns.map((name, i) => ({
      projectId: project.id,
      name,
      position: (i + 1) * 10,
      isBlockedSystem: false,
    }));
    const blockedColumn = {
      projectId: project.id,
      name: 'Bloqué',
      position: 9999,
      isBlockedSystem: true,
    };
    await prisma.column.createMany({ data: [...userColumns, blockedColumn] });

    // Optional sample cards on the first user column.
    const samples = SAMPLE_CARDS[p.name];
    if (samples && userColumns.length > 0) {
      const firstColumn = await prisma.column.findFirstOrThrow({
        where: { projectId: project.id, isBlockedSystem: false },
        orderBy: { position: 'asc' },
      });
      let cardPos = 0;
      for (const s of samples) {
        cardPos += 1;
        await prisma.card.create({
          data: {
            workspaceId: workspace.id,
            projectId: project.id,
            columnId: firstColumn.id,
            title: s.title,
            categoryTag: s.categoryTag ?? null,
            dueDate:
              s.dueDateOffsetDays !== undefined
                ? new Date(now + s.dueDateOffsetDays * 86400 * 1000)
                : null,
            position: cardPos * 10,
            // short_ref auto-assigned by the DB trigger from migration 003.
          } as Parameters<typeof prisma.card.create>[0]['data'],
        });
      }
    }
  }
  console.warn(`[seed] Created ${PROJECTS.length} projects with columns + sample cards`);

  console.warn('[seed] ✅ Done.');
}

main()
  .catch((err: unknown) => {
    console.error('[seed] ❌ Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
