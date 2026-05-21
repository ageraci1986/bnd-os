// SECURITY: this module imports the Prisma client which holds DATABASE_URL.
// Never import from this file in a 'use client' file or shared client bundle.
import 'server-only';
import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

const NODE_ENV = process.env['NODE_ENV'];

/**
 * Allow a few concurrent connections per instance behind the Supabase pooler
 * (pgbouncer, transaction mode). The env URL ships `connection_limit=1`, which
 * forces EVERY concurrent query — including a request's `Promise.all` reads and
 * the burst of server actions a single user interaction fires — to serialise on
 * one connection, stacking round-trip latency. 5 keeps pooler pressure low while
 * letting parallel queries actually run in parallel.
 */
const PERF_CONNECTION_LIMIT = 5;
function resolveDatabaseUrl(): string | undefined {
  const url = process.env['DATABASE_URL'];
  if (!url) return undefined;
  if (/[?&]connection_limit=\d+/.test(url)) {
    return url.replace(/([?&])connection_limit=\d+/, `$1connection_limit=${PERF_CONNECTION_LIMIT}`);
  }
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${PERF_CONNECTION_LIMIT}`;
}

const databaseUrl = resolveDatabaseUrl();

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  });

if (NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

// Runtime re-export of the `Prisma` namespace — needed for instanceof checks
// against PrismaClientKnownRequestError and friends. The namespace also acts
// as a type, so this single export covers both uses.
export { Prisma } from '@prisma/client';
export type {
  ActivityKind,
  AuditAction,
  IntegrationKind,
  IntegrationScope,
  IntegrationStatus,
  InvitationStatus,
  NotificationChannel,
  NotificationKind,
  ProjectMemberRole,
  RACI,
  Role,
} from '@prisma/client';
