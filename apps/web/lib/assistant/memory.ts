/**
 * Mémoire long terme de l'assistant (spec §5, Plan 3a).
 *
 * Un fait durable par ligne, strictement personnel (workspace + user).
 * Ce module est le cœur réutilisé à la fois par les tools de l'agent
 * (`remember_fact` / `update_fact` / `forget_fact`) et par les Server
 * Actions de l'onglet Mémoire — la validation et les règles de nommage ne
 * doivent exister qu'à un seul endroit.
 *
 * SECURITY: chaque requête Prisma porte `workspaceId: ctx.workspaceId,
 * userId: ctx.userId` (CLAUDE.md §4.4) — y compris les mutations
 * (`updateMany`/`deleteMany` plutôt que `update`/`delete` par id) pour que
 * le scope soit vérifié au niveau de la requête elle-même, pas seulement
 * lors d'un lookup préalable.
 */
import 'server-only';
import { prisma } from '@nexushub/db';
import type { AuthContext } from '@/lib/auth';

/** Plafond du nombre de faits mémorisés par utilisateur (spec §5). */
export const MEMORY_MAX_FACTS = 50;
/** Longueur max d'un fait — « un petit fait par entrée ». */
export const MEMORY_FACT_MAX_CHARS = 500;

/** Nb max de mots conservés par `slugifyFact`. */
const SLUG_MAX_WORDS = 6;
/** Longueur max du slug généré (aligné sur `AssistantMemory.name` — VarChar(80)). */
const SLUG_MAX_CHARS = 80;
/** Nom de repli quand le fait ne contient aucun caractère alphanumérique. */
const SLUG_FALLBACK = 'fait';
/** Nb max de noms listés dans les messages « fait introuvable ». */
const NOT_FOUND_LIST_MAX = 10;

/** Nb max de tentatives de `create` face aux courses sur la contrainte unique. */
const REMEMBER_MAX_ATTEMPTS = 3;

export interface MemoryEntry {
  readonly name: string;
  readonly fact: string;
}

/**
 * `instanceof Prisma.PrismaClientKnownRequestError` doesn't reliably hold
 * across Turbopack's RSC module boundary (Prisma is loaded twice and the
 * class identity diverges), so we sniff by error.code directly — same
 * convention as `features/projects/actions/card-assignees.ts`.
 */
function prismaErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/**
 * Slugifie un fait en nom stable : minuscules, ascii (accents
 * translittérés), non-alphanumérique → `-`, 6 premiers mots max, ≤ 80
 * caractères, repli sur `'fait'` si rien ne reste après nettoyage.
 */
export function slugifyFact(fact: string): string {
  const ascii = fact.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip diacritics
  const dashed = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (dashed === '') return SLUG_FALLBACK;

  const words = dashed
    .split('-')
    .filter((w) => w.length > 0)
    .slice(0, SLUG_MAX_WORDS);
  const capped = words.join('-').slice(0, SLUG_MAX_CHARS).replace(/-+$/g, '');
  return capped === '' ? SLUG_FALLBACK : capped;
}

/**
 * Ajoute un suffixe `-N` à un slug tout en respectant `SLUG_MAX_CHARS`
 * (tronque la base plutôt que de dépasser la limite de colonne).
 */
function withSuffix(base: string, suffix: number): string {
  const suffixStr = `-${suffix}`;
  const maxBaseLen = Math.max(SLUG_MAX_CHARS - suffixStr.length, 1);
  const truncatedBase = base.slice(0, maxBaseLen).replace(/-+$/g, '') || SLUG_FALLBACK;
  return `${truncatedBase}${suffixStr}`;
}

/** Les faits de l'utilisateur, plus anciens d'abord, plafonné à MEMORY_MAX_FACTS. */
export async function loadMemories(ctx: AuthContext): Promise<readonly MemoryEntry[]> {
  const rows = await prisma.assistantMemory.findMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
    orderBy: { createdAt: 'asc' },
    take: MEMORY_MAX_FACTS,
    select: { name: true, fact: true },
  });
  return rows.map((row) => ({ name: row.name, fact: row.fact }));
}

/** Valide un fait entrant ; renvoie le fait trimé ou un message d'erreur montrable. */
function validateFact(fact: string): { ok: true; fact: string } | { ok: false; message: string } {
  const trimmed = fact.trim();
  if (trimmed === '') {
    return { ok: false, message: 'Le fait est vide — rien à retenir.' };
  }
  if (trimmed.length > MEMORY_FACT_MAX_CHARS) {
    return {
      ok: false,
      message: `Ce fait est trop long (max ${MEMORY_FACT_MAX_CHARS} caractères) — un petit fait par entrée.`,
    };
  }
  return { ok: true, fact: trimmed };
}

/** Liste (tronquée) des noms de faits existants, pour les messages « introuvable ». */
async function listExistingNames(ctx: AuthContext): Promise<string> {
  const rows = await prisma.assistantMemory.findMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
    orderBy: { createdAt: 'asc' },
    take: NOT_FOUND_LIST_MAX,
    select: { name: true },
  });
  const names = rows.map((row) => row.name);
  return names.length > 0 ? names.join(', ') : '(aucun)';
}

async function notFoundMessage(ctx: AuthContext, name: string): Promise<string> {
  const list = await listExistingNames(ctx);
  return `Aucun fait nommé « ${name} ». Faits existants : ${list}.`;
}

/**
 * Crée un fait. Erreurs montrables : vide, trop long, plafond atteint
 * (consolider), doublon de nom (suffixe -2, -3…).
 */
export async function rememberFact(
  ctx: AuthContext,
  fact: string,
): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  const validated = validateFact(fact);
  if (!validated.ok) return validated;

  const count = await prisma.assistantMemory.count({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
  });
  if (count >= MEMORY_MAX_FACTS) {
    return {
      ok: false,
      message: 'Mémoire pleine — consolidez ou supprimez des faits avant d’en ajouter.',
    };
  }

  const baseName = slugifyFact(validated.fact);

  // La recherche de suffixe puis le `create` ne sont pas atomiques : une
  // création concurrente peut prendre le nom entre les deux (P2002 sur la
  // contrainte unique). On re-cherche alors un nom libre, borné à
  // REMEMBER_MAX_ATTEMPTS tentatives avant un message montrable.
  for (let attempt = 0; attempt < REMEMBER_MAX_ATTEMPTS; attempt += 1) {
    const name = await findFreeName(ctx, baseName);
    try {
      await prisma.assistantMemory.create({
        data: { workspaceId: ctx.workspaceId, userId: ctx.userId, name, fact: validated.fact },
      });
      return { ok: true, name };
    } catch (err) {
      if (prismaErrorCode(err) !== 'P2002') throw err;
    }
  }
  return { ok: false, message: 'Impossible d’enregistrer le fait — réessayez.' };
}

/** Premier nom libre dérivé du slug de base : base, puis base-2, base-3… */
async function findFreeName(ctx: AuthContext, baseName: string): Promise<string> {
  let name = baseName;
  let suffix = 2;
  while (
    (await prisma.assistantMemory.findFirst({
      where: { workspaceId: ctx.workspaceId, userId: ctx.userId, name },
      select: { id: true },
    })) !== null
  ) {
    name = withSuffix(baseName, suffix);
    suffix += 1;
  }
  return name;
}

/** Corrige le fait d'un nom existant. */
export async function updateFact(
  ctx: AuthContext,
  name: string,
  fact: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const validated = validateFact(fact);
  if (!validated.ok) return validated;

  const { count } = await prisma.assistantMemory.updateMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId, name },
    data: { fact: validated.fact },
  });
  if (count === 0) {
    return { ok: false, message: await notFoundMessage(ctx, name) };
  }
  return { ok: true };
}

/** Supprime un fait par son nom. */
export async function forgetFact(
  ctx: AuthContext,
  name: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { count } = await prisma.assistantMemory.deleteMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId, name },
  });
  if (count === 0) {
    return { ok: false, message: await notFoundMessage(ctx, name) };
  }
  return { ok: true };
}
