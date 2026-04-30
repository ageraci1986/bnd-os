import 'server-only';
import { prisma } from '@nexushub/db';
import { isBuiltinCardCategory } from '@nexushub/domain';

/**
 * Distinct non-builtin categoryTag values used by any non-deleted card in
 * the workspace. Lets users re-pick a custom category they already coined
 * in another card without re-typing it.
 */
export async function listCustomCategories(workspaceId: string): Promise<readonly string[]> {
  const rows = await prisma.card.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      categoryTag: { not: null },
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
