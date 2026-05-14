'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, type Prisma } from '@nexushub/db';
import {
  NotFoundError,
  validateKanbanTemplateColumns,
  validateKanbanTemplateName,
  type KanbanTemplateColumnDef,
} from '@nexushub/domain';
import { requireUser } from '@/lib/auth';

function prismaErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

const NameSchema = z
  .string()
  .max(120)
  .transform((raw) => validateKanbanTemplateName(raw))
  .superRefine((res, ctx) => {
    if (res.ok) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: res.code === 'EMPTY' ? 'Nom requis' : 'Nom trop long (max 80)',
    });
  })
  .transform((res) => (res.ok ? res.value : ''));

const ColumnsSchema = z
  .array(z.unknown())
  .max(20)
  .default([])
  .transform((arr, ctx) => {
    const validated = validateKanbanTemplateColumns(arr);
    if (validated === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Colonnes invalides.' });
      return [] as readonly KanbanTemplateColumnDef[];
    }
    return validated;
  });

const CreateSchema = z.object({ name: NameSchema, columns: ColumnsSchema });
const UpdateSchema = CreateSchema.extend({ id: z.string().uuid() });
const DeleteSchema = z.object({ id: z.string().uuid() });
const DuplicateSchema = z.object({ id: z.string().uuid() });

export type KanbanTemplateMutationResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

export async function createKanbanTemplate(input: {
  name: string;
  columns: readonly KanbanTemplateColumnDef[];
}): Promise<KanbanTemplateMutationResult> {
  const ctx = await requireUser();
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Données invalides.' };
  }

  try {
    const created = await prisma.kanbanTemplate.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        columns: {
          create: parsed.data.columns.map((c, idx) => ({
            name: c.name,
            position: (idx + 1) * 1024,
            stepChecklist: [...c.stepChecklist],
          })),
        },
      },
      select: { id: true },
    });
    revalidatePath('/templates/kanban');
    return { ok: true, id: created.id };
  } catch (err) {
    if (prismaErrorCode(err) === 'P2002') {
      return { ok: false, message: 'Un template porte déjà ce nom.' };
    }
    throw err;
  }
}

export async function updateKanbanTemplate(input: {
  id: string;
  name: string;
  columns: readonly KanbanTemplateColumnDef[];
}): Promise<KanbanTemplateMutationResult> {
  const ctx = await requireUser();
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Données invalides.' };
  }

  const tpl = await prisma.kanbanTemplate.findFirst({
    where: { id: parsed.data.id, workspaceId: ctx.workspaceId },
    select: { id: true },
  });
  if (!tpl) throw new NotFoundError('KanbanTemplate');

  try {
    // Rebuild the columns from scratch in a transaction: simpler than
    // diffing individual rows and the column list is small (≤ 20).
    await prisma.$transaction(async (tx) => {
      await tx.kanbanTemplate.update({
        where: { id: tpl.id },
        data: { name: parsed.data.name },
      });
      await tx.kanbanTemplateColumn.deleteMany({ where: { templateId: tpl.id } });
      if (parsed.data.columns.length > 0) {
        await tx.kanbanTemplateColumn.createMany({
          data: parsed.data.columns.map((c, idx) => ({
            templateId: tpl.id,
            name: c.name,
            position: (idx + 1) * 1024,
            stepChecklist: [...c.stepChecklist],
          })),
        });
      }
    });
    revalidatePath('/templates/kanban');
    return { ok: true, id: tpl.id };
  } catch (err) {
    if (prismaErrorCode(err) === 'P2002') {
      return { ok: false, message: 'Un template porte déjà ce nom.' };
    }
    throw err;
  }
}

export async function deleteKanbanTemplate(input: {
  id: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant invalide.' };

  const tpl = await prisma.kanbanTemplate.findFirst({
    where: { id: parsed.data.id, workspaceId: ctx.workspaceId },
    select: { id: true, isBuiltin: true },
  });
  if (!tpl) return { ok: false, message: 'Template introuvable.' };
  if (tpl.isBuiltin)
    return { ok: false, message: 'Les templates système ne peuvent pas être supprimés.' };

  await prisma.kanbanTemplate.delete({ where: { id: tpl.id } });
  revalidatePath('/templates/kanban');
  return { ok: true };
}

export async function duplicateKanbanTemplate(input: {
  id: string;
}): Promise<KanbanTemplateMutationResult> {
  const ctx = await requireUser();
  const parsed = DuplicateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant invalide.' };

  const source = await prisma.kanbanTemplate.findFirst({
    where: { id: parsed.data.id, workspaceId: ctx.workspaceId },
    select: {
      name: true,
      columns: {
        orderBy: { position: 'asc' },
        select: { name: true, stepChecklist: true },
      },
    },
  });
  if (!source) return { ok: false, message: 'Template introuvable.' };

  // Find a unique name by appending " (copie)" / " (copie N)" so the
  // workspace's @@unique([workspaceId, name]) is not violated.
  const baseName = source.name + ' (copie)';
  let candidate = baseName;
  let suffix = 2;
  // Tight cap so we don't loop forever on pathological inputs.
  for (let i = 0; i < 50; i++) {
    const exists = await prisma.kanbanTemplate.findFirst({
      where: { workspaceId: ctx.workspaceId, name: candidate },
      select: { id: true },
    });
    if (!exists) break;
    candidate = `${baseName} ${suffix}`;
    suffix++;
  }

  try {
    const created = await prisma.kanbanTemplate.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: candidate,
        columns: {
          create: source.columns.map((c, idx) => ({
            name: c.name,
            position: (idx + 1) * 1024,
            stepChecklist: [...c.stepChecklist],
          })),
        },
      },
      select: { id: true },
    });
    revalidatePath('/templates/kanban');
    return { ok: true, id: created.id };
  } catch (err) {
    if (prismaErrorCode(err) === 'P2002') {
      return { ok: false, message: 'Conflit de nom — réessaie.' };
    }
    throw err;
  }
}

// Helper used in tests / other server actions if they import the type.
export type _PrismaInputJson = Prisma.InputJsonValue;
