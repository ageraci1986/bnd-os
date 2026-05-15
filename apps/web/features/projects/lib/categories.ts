import 'server-only';
import { prisma } from '@nexushub/db';
import { isBuiltinCardCategory, type UserScope } from '@nexushub/domain';
import { scopedCardWhere } from '@/lib/auth/scope';

/**
 * Distinct non-builtin categoryTag values used by any non-deleted card in
 * the workspace. Lets users re-pick a custom category they already coined
 * in another card without re-typing it. Scope-filtered so a restricted
 * User only sees tags from cards they have access to.
 */
export async function listCustomCategories(
  workspaceId: string,
  scope?: UserScope,
): Promise<readonly string[]> {
  const rows = await prisma.card.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      categoryTag: { not: null },
      ...(scope ? scopedCardWhere(scope) : {}),
    },
    distinct: ['categoryTag'],
    select: { categoryTag: true },
  });
  return rows
    .map((r) => r.categoryTag)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .filter((t) => !isBuiltinCardCategory(t))
    .sort((a, b) => a.localeCompare(b));
}
