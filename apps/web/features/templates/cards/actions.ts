'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, type Prisma } from '@nexushub/db';
import {
  NotFoundError,
  validateCardTemplateItems,
  validateCardTemplateName,
  type CardTemplateItem,
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
  .transform((raw) => validateCardTemplateName(raw))
  .superRefine((res, ctx) => {
    if (res.ok) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: res.code === 'EMPTY' ? 'Nom requis' : 'Nom trop long (max 80)',
    });
  })
  .transform((res) => (res.ok ? res.value : ''));

const BodySchema = z.string().max(8000).default('');
const ChecklistSchema = z
  .array(z.string().max(200))
  .max(50)
  .default([])
  .transform((items) => items.map((s) => s.trim()).filter((s) => s.length > 0));

const ItemsSchema = z
  .array(z.unknown())
  .max(60)
  .default([])
  .transform((arr, ctx) => {
    const validated = validateCardTemplateItems(arr);
    if (validated === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Définition d'items invalide.",
      });
      return [] as readonly CardTemplateItem[];
    }
    return validated;
  });

const CreateSchema = z.object({
  name: NameSchema,
  body: BodySchema,
  items: ItemsSchema,
  defaultChecklist: ChecklistSchema,
  isDefault: z.boolean().default(false),
});

const UpdateSchema = CreateSchema.extend({ id: z.string().uuid() });
const DeleteSchema = z.object({ id: z.string().uuid() });

export type TemplateMutationResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

export async function createCardTemplate(input: {
  name: string;
  body: string;
  items: readonly CardTemplateItem[];
  defaultChecklist: string[];
  isDefault: boolean;
}): Promise<TemplateMutationResult> {
  const ctx = await requireUser();
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Données invalides.' };
  }

  try {
    if (parsed.data.isDefault) {
      await prisma.cardTemplate.updateMany({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, isDefault: true },
        data: { isDefault: false },
      });
    }
    const created = await prisma.cardTemplate.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: parsed.data.name,
        body: parsed.data.body,
        items: parsed.data.items as unknown as Prisma.InputJsonValue,
        defaultChecklist: parsed.data.defaultChecklist,
        isDefault: parsed.data.isDefault,
      },
      select: { id: true },
    });
    revalidatePath('/templates/cards');
    return { ok: true, id: created.id };
  } catch (err) {
    if (prismaErrorCode(err) === 'P2002') {
      return { ok: false, message: 'Un template porte déjà ce nom.' };
    }
    throw err;
  }
}

export async function updateCardTemplate(input: {
  id: string;
  name: string;
  body: string;
  items: readonly CardTemplateItem[];
  defaultChecklist: string[];
  isDefault: boolean;
}): Promise<TemplateMutationResult> {
  const ctx = await requireUser();
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Données invalides.' };
  }

  const tpl = await prisma.cardTemplate.findFirst({
    where: { id: parsed.data.id, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true, isDefault: true },
  });
  if (!tpl) throw new NotFoundError('CardTemplate');

  try {
    if (parsed.data.isDefault && !tpl.isDefault) {
      await prisma.cardTemplate.updateMany({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          isDefault: true,
          NOT: { id: tpl.id },
        },
        data: { isDefault: false },
      });
    }
    await prisma.cardTemplate.update({
      where: { id: tpl.id },
      data: {
        name: parsed.data.name,
        body: parsed.data.body,
        items: parsed.data.items as unknown as Prisma.InputJsonValue,
        defaultChecklist: parsed.data.defaultChecklist,
        isDefault: parsed.data.isDefault,
      },
    });
    revalidatePath('/templates/cards');
    return { ok: true, id: tpl.id };
  } catch (err) {
    if (prismaErrorCode(err) === 'P2002') {
      return { ok: false, message: 'Un template porte déjà ce nom.' };
    }
    throw err;
  }
}

export async function deleteCardTemplate(input: {
  id: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await requireUser();
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Identifiant invalide.' };

  const tpl = await prisma.cardTemplate.findFirst({
    where: { id: parsed.data.id, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!tpl) return { ok: false, message: 'Template introuvable.' };

  await prisma.cardTemplate.update({
    where: { id: tpl.id },
    data: { deletedAt: new Date(), isDefault: false },
  });
  revalidatePath('/templates/cards');
  return { ok: true };
}
