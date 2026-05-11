/**
 * One-shot data migration: backfill card_templates.items from the legacy
 * (fields[], description_position) shape. Idempotent — skips rows where
 * `items` is already non-empty.
 *
 * Run via: pnpm --filter @nexushub/db migrate-data:card-template-items
 */
import {
  isDescriptionPosition,
  migrateFieldsToItems,
  validateCardFields,
  type CardTemplateDescriptionPosition,
} from '@nexushub/domain';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.cardTemplate.findMany({
      select: { id: true, fields: true, descriptionPosition: true, items: true },
    });

    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      if (Array.isArray(row.items) && (row.items as unknown[]).length > 0) {
        skipped++;
        continue;
      }

      const fields = validateCardFields(row.fields) ?? [];
      const descPos: CardTemplateDescriptionPosition = isDescriptionPosition(
        row.descriptionPosition,
      )
        ? row.descriptionPosition
        : 'after-fields';

      const items = migrateFieldsToItems(fields, descPos);
      await prisma.cardTemplate.update({
        where: { id: row.id },
        data: { items: items as unknown as object[] },
      });
      updated++;
    }

    console.warn(`Backfill done: ${updated} updated, ${skipped} skipped (already populated).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
