/**
 * Bootstrap an Admin user.
 *
 * Creates the first Admin of a workspace by:
 *  1. Calling supabase.auth.admin.createUser() with email+password
 *  2. Letting the DB trigger `handle_new_auth_user` mirror the user into
 *     public.users
 *  3. Inserting a Membership { workspace, user, role: 'admin' }
 *
 * Idempotent: if the user already exists in auth.users, we reuse the row.
 * If a Membership already exists for that workspace, we upgrade the role
 * to 'admin' (rather than failing).
 *
 * Safety:
 *  - Uses the SUPABASE_SERVICE_ROLE_KEY (never exposed in code).
 *  - Refuses passwords shorter than 12 chars (matches the dashboard rule).
 *  - Aborts if the workspace doesn't exist — run `db:seed` first.
 *
 * Run:
 *   pnpm --filter @nexushub/db db:bootstrap-admin \
 *     --email you@example.com \
 *     --password "a-very-long-passphrase" \
 *     [--workspace-slug studio-atlas]
 *
 * The --workspace-slug defaults to "studio-atlas" (the slug used by db:seed).
 */
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

// CLI scripts run interactive transactions; force the direct connection
// (the pgbouncer transaction pooler does not support them).
const directUrl = process.env['DIRECT_URL'];
const prisma = new PrismaClient({
  log: ['warn', 'error'],
  ...(directUrl ? { datasources: { db: { url: directUrl } } } : {}),
});

interface CliArgs {
  email: string;
  password: string;
  workspaceSlug: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== 'string' || !token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (typeof value !== 'string' || value.startsWith('--')) {
      throw new Error(`CLI: missing value for --${key}`);
    }
    args.set(key, value);
    i += 1;
  }

  const email = args.get('email');
  const password = args.get('password');
  const workspaceSlug = args.get('workspace-slug') ?? 'studio-atlas';

  if (!email || !email.includes('@')) {
    throw new Error('CLI: --email <user@example.com> is required');
  }
  if (!password || password.length < 12) {
    throw new Error('CLI: --password must be at least 12 characters');
  }
  return { email: email.toLowerCase(), password, workspaceSlug };
}

function getEnvOrThrow(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Missing env var: ${name}`);
  }
  return v;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const supabaseUrl = getEnvOrThrow('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = getEnvOrThrow('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 0. Workspace must exist (run db:seed first if not).
  const workspace = await prisma.workspace.findUnique({
    where: { slug: args.workspaceSlug },
    select: { id: true, name: true },
  });
  if (!workspace) {
    throw new Error(
      `Workspace "${args.workspaceSlug}" not found. Run \`pnpm --filter @nexushub/db db:seed\` first.`,
    );
  }

  // 1. Create or reuse the auth.users row.
  let userId: string | null = null;
  const existing = await prisma.user.findUnique({
    where: { email: args.email },
    select: { id: true },
  });
  if (existing) {
    userId = existing.id;
    console.warn(`[bootstrap-admin] reusing existing user ${userId}`);
  } else {
    const created = await admin.auth.admin.createUser({
      email: args.email,
      password: args.password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(
        `Supabase admin.createUser failed: ${created.error?.message ?? 'no user returned'}`,
      );
    }
    userId = created.data.user.id;
    console.warn(`[bootstrap-admin] created auth user ${userId}`);
  }

  // 2. Upsert membership at admin role.
  const membership = await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
    update: { role: 'admin' },
    create: { workspaceId: workspace.id, userId, role: 'admin' },
    select: { id: true, role: true },
  });
  console.warn(
    `[bootstrap-admin] membership ${membership.id} role=${membership.role} for workspace=${workspace.name}`,
  );

  // 3. Audit log entry — optional (safe if it fails).
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: workspace.id,
        actorId: userId,
        action: 'invitation_accepted', // re-use accepted action; bootstrap is a self-accept
        subjectType: 'membership',
        subjectId: membership.id,
        data: { method: 'bootstrap_admin_cli' },
      },
    });
  } catch (err) {
    console.error('[bootstrap-admin] audit log failed (non-fatal):', err);
  }

  console.warn(`\n✅ Admin ready. Sign in at /login with:\n   email: ${args.email}\n`);
}

main()
  .catch((err: unknown) => {
    console.error('[bootstrap-admin] ❌', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
