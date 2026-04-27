// SECURITY: this module imports the Prisma client which holds DATABASE_URL.
// Never import from this file in a 'use client' file or shared client bundle.
import 'server-only';
import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

const NODE_ENV = process.env['NODE_ENV'];

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
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
