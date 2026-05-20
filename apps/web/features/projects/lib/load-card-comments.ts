/**
 * Single Prisma round-trip + HTML render for the comments thread of a
 * card. Returns DTOs ready for the client.
 *
 * SECURITY:
 *  - Caller has already verified the card is in scope. This helper does
 *    not re-check scope (would duplicate the parent's effort).
 *  - HTML is sanitised here so the client never sees raw markdown.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import { markdown } from '@nexushub/integrations';
import { Roles, type Role } from '@nexushub/domain';
import type { CardCommentDTO } from './comment-dto';

interface LoadCardCommentsInput {
  readonly cardId: string;
  readonly currentUserId: string;
  readonly currentRole: Role;
}

const EDIT_THRESHOLD_MS = 1000;

function displayName(user: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return full.length > 0 ? full : user.email;
}

function initials(user: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const first = user.firstName?.[0] ?? '';
  const last = user.lastName?.[0] ?? '';
  const combined = `${first}${last}`.trim().toUpperCase();
  return combined.length > 0 ? combined : (user.email[0] ?? '?').toUpperCase();
}

export async function loadCardComments(
  input: LoadCardCommentsInput,
): Promise<readonly CardCommentDTO[]> {
  const rows = await prisma.comment.findMany({
    where: { cardId: input.cardId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      body: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  const canModerate = input.currentRole === Roles.Admin;

  return rows.map((row): CardCommentDTO => {
    const isEdited = row.updatedAt.getTime() - row.createdAt.getTime() > EDIT_THRESHOLD_MS;
    return {
      id: row.id,
      body: row.body,
      bodyHtml: markdown.renderMarkdownToSafeHtml(row.body),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      isEdited,
      author: {
        id: row.author.id,
        displayName: displayName(row.author),
        initials: initials(row.author),
      },
      isMine: row.author.id === input.currentUserId,
      canModerate,
    };
  });
}
