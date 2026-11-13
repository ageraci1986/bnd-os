# Assistant voix — Lot 1 : glossaire de noms propres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Envoyer à Deepgram, avec chaque prise vocale de l'assistant, les noms propres du workspace (membres, clients, projets, contacts) pour qu'ils soient transcrits correctement.

**Architecture:** Un module pur dans `packages/domain` transforme une liste de noms en termes `keyterm` sûrs (chiffres retirés, bornés). Un module serveur récolte les noms via Prisma, dans le périmètre d'accès de l'utilisateur. `transcribeAudio` ajoute les termes à l'URL Deepgram et réessaie sans eux si Deepgram les refuse. Aucune migration, aucune dépendance, aucune variable d'environnement.

**Tech Stack:** TypeScript strict, Vitest, Prisma 6, Next.js 15 Route Handler, Deepgram `nova-3` (API par fichier, paramètre `keyterm`).

**Spec:** `docs/superpowers/specs/2026-11-13-assistant-voice-transcription-design.md` (§4). Les lots 2 et 3 auront chacun leur plan.

## Contexte à connaître avant de commencer

- **Pourquoi retirer les chiffres** : mesuré chez lleva, un terme contenant un chiffre corrompt les nombres dictés autour (« Casa 47 » envoyé comme terme → « Casa 48 » transcrit). Les termes hors-sujet, eux, sont inoffensifs.
- **Plafond Deepgram** : 500 tokens pour l'ensemble des `keyterm` d'une requête ; au-delà, Deepgram répond en erreur. D'où le budget de 800 caractères et le réessai sans termes.
- **Périmètre d'accès** : un membre peut être restreint à certains clients/projets (`WorkspaceAccess`). `loadUserScope(ctx)` rend son périmètre, `scopedClientWhere(scope)` / `scopedProjectWhere(scope)` rendent le filtre Prisma. Admin et super-admin voient tout.
- **Règles du repo** (CLAUDE.md) : toute requête Prisma filtre par `workspaceId` ; `select` explicite ; aucune PII dans les logs ; pas de `any` ; fichiers en `kebab-case`.
- **Couverture domain** : `packages/domain/vitest.config.ts` exclut `src/**/index.ts` de la mesure. Le code va donc dans `keyterms.ts`, et `index.ts` ne fait que réexporter.
- **Mocks** : les tests web créent leurs mocks avec `vi.hoisted` (les factories `vi.mock` sont hissées au-dessus des `const`).

## Structure des fichiers

| Fichier                                                     | Action   | Responsabilité                                              |
| ----------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `packages/domain/src/voice-glossary/keyterms.ts`            | créer    | noms → termes `keyterm` sûrs (pur)                          |
| `packages/domain/src/voice-glossary/keyterms.test.ts`       | créer    | tests du module pur                                         |
| `packages/domain/src/voice-glossary/index.ts`               | créer    | réexport                                                    |
| `packages/domain/src/index.ts`                              | modifier | exporter le module                                          |
| `apps/web/lib/assistant/voice/glossary-repo.ts`             | créer    | récolte Prisma des noms, dans le périmètre de l'utilisateur |
| `apps/web/lib/assistant/voice/glossary-repo.test.ts`        | créer    | tests de la récolte                                         |
| `apps/web/lib/assistant/voice/stt.ts`                       | modifier | paramètre `keyterms`, réessai sans termes sur 400           |
| `apps/web/lib/assistant/voice/stt.test.ts`                  | modifier | tests associés                                              |
| `apps/web/app/api/assistant/voice/transcribe/route.ts`      | modifier | brancher récolte → termes → transcription                   |
| `apps/web/app/api/assistant/voice/transcribe/route.test.ts` | modifier | tests associés                                              |
| `docs/security.md`, `CLAUDE.md`, `progress.md`              | modifier | documentation                                               |

---

### Task 0 : Worktree isolé

Le checkout principal porte des modifications sans rapport. Tout le lot se fait dans un worktree.

- [ ] **Step 1 : Créer le worktree depuis `main`**

```bash
cd /Users/angelogeraci/Documents/Application/BND-OS
git fetch origin main
git worktree add .worktrees/voice-glossary -b feat/voice-glossary origin/main
```

- [ ] **Step 2 : Y copier le spec et ce plan (non suivis dans le checkout principal)**

```bash
cp docs/superpowers/specs/2026-11-13-assistant-voice-transcription-design.md .worktrees/voice-glossary/docs/superpowers/specs/
cp docs/superpowers/plans/2026-11-13-voice-glossary.md .worktrees/voice-glossary/docs/superpowers/plans/
cd .worktrees/voice-glossary
pnpm install --frozen-lockfile
```

- [ ] **Step 3 : Vérifier que la base est verte avant de toucher au code**

```bash
pnpm --filter @nexushub/domain test
pnpm --filter @nexushub/web exec vitest run lib/assistant/voice app/api/assistant/voice
```

Attendu : tout passe. Si un test échoue ici, s'arrêter et le signaler : ce n'est pas causé par ce lot.

- [ ] **Step 4 : Commit du spec et du plan**

```bash
git add docs/superpowers/specs/2026-11-13-assistant-voice-transcription-design.md docs/superpowers/plans/2026-11-13-voice-glossary.md
git commit -m "docs(assistant): spec et plan lot 1 de la retranscription vocale"
```

Toutes les tâches suivantes s'exécutent depuis `.worktrees/voice-glossary`.

---

### Task 1 : Module pur `toKeyterms`

**Files:**

- Create: `packages/domain/src/voice-glossary/keyterms.ts`
- Create: `packages/domain/src/voice-glossary/index.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/voice-glossary/keyterms.test.ts`

- [ ] **Step 1 : Écrire les tests (ils échouent)**

`packages/domain/src/voice-glossary/keyterms.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { MAX_KEYTERMS, MAX_KEYTERMS_TOTAL_CHARS, toKeyterms } from './keyterms';

describe('toKeyterms', () => {
  it('garde un nom complet en un seul terme', () => {
    expect(toKeyterms(['Angelo Geraci'])).toEqual(['Angelo Geraci']);
  });

  it('retire les chiffres : un terme chiffré corrompt les nombres dictés autour', () => {
    // Mesuré chez lleva : « Casa 47 » envoyé tel quel → « Casa 48 » transcrit.
    expect(toKeyterms(['Casa 47'])).toEqual(['Casa']);
    expect(toKeyterms(['Studio 54 Paris'])).toEqual(['Studio Paris']);
  });

  it('aucun terme rendu ne contient de chiffre', () => {
    const out = toKeyterms(['Agence 2000', 'B2B Lab', '4 Saisons', 'Web3 Factory']);
    expect(out.length).toBeGreaterThan(0);
    for (const term of out) expect(term).not.toMatch(/\d/);
  });

  it('normalise les espaces et retire la ponctuation en bordure', () => {
    expect(toKeyterms(['  Château   du Mylord  '])).toEqual(['Château du Mylord']);
    expect(toKeyterms(['(Izybizi)', '« Nova »'])).toEqual(['Izybizi', 'Nova']);
  });

  it('conserve tirets et apostrophes internes', () => {
    expect(toKeyterms(['Spa-Francorchamps', "L'Oréal"])).toEqual(['Spa-Francorchamps', "L'Oréal"]);
  });

  it('écarte les termes de moins de 3 caractères', () => {
    expect(toKeyterms(['AB', 'ABC', '3M', ''])).toEqual(['ABC']);
  });

  it('écarte les termes de plus de 40 caractères', () => {
    expect(toKeyterms(['x'.repeat(41), 'x'.repeat(40)])).toEqual(['x'.repeat(40)]);
  });

  it('dédoublonne sans tenir compte de la casse ni des accents, en gardant la première forme', () => {
    expect(toKeyterms(['Hélène Durand', 'helene durand', 'HELENE DURAND'])).toEqual([
      'Hélène Durand',
    ]);
  });

  it('dédoublonne après retrait des chiffres', () => {
    expect(toKeyterms(['Casa 47', 'Casa 48'])).toEqual(['Casa']);
  });

  it(`plafonne à ${String(MAX_KEYTERMS)} termes en conservant l'ordre d'entrée`, () => {
    const names = Array.from(
      { length: 60 },
      (_, i) => `Nom${'abcdefghij'[i % 10]!}${'klmnopqrst'[Math.floor(i / 10)]!}`,
    );
    const out = toKeyterms(names);
    expect(out).toHaveLength(MAX_KEYTERMS);
    expect(out[0]).toBe('Nomak');
    expect(out).toEqual(names.slice(0, MAX_KEYTERMS));
  });

  it('borne le total de caractères, sans dépasser le budget', () => {
    // 40 termes de 40 caractères = 1600 : le budget coupe avant le plafond de nombre.
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
    const names = Array.from({ length: 40 }, (_, i) => `${alphabet[i]!}`.repeat(40));
    const out = toKeyterms(names);
    const total = out.reduce((sum, t) => sum + t.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_KEYTERMS_TOTAL_CHARS);
    expect(out).toHaveLength(Math.floor(MAX_KEYTERMS_TOTAL_CHARS / 40));
  });

  it('un terme trop long pour le budget restant est sauté, pas le reste de la liste', () => {
    const filler = Array.from({ length: 19 }, (_, i) => 'abcdefghijklmnopqrs'[i]!.repeat(40));
    // 19 × 40 = 760, + 30 = 790 : il reste 10 caractères de budget.
    const out = toKeyterms([...filler, 'w'.repeat(30), 'z'.repeat(20), 'Bob']);
    expect(out).toContain('w'.repeat(30));
    expect(out).not.toContain('z'.repeat(20)); // 810 > 800 : sauté
    expect(out).toContain('Bob'); // 793 : la liste continue après un terme sauté
  });

  it('rend une liste vide pour une entrée vide', () => {
    expect(toKeyterms([])).toEqual([]);
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

```bash
pnpm --filter @nexushub/domain exec vitest run src/voice-glossary
```

Attendu : ÉCHEC, `Failed to resolve import "./keyterms"`.

- [ ] **Step 3 : Écrire l'implémentation**

`packages/domain/src/voice-glossary/keyterms.ts` :

```ts
/**
 * Glossaire de noms propres pour la reconnaissance vocale (Deepgram `keyterm`).
 *
 * Les noms propres sont le point faible de toute transcription : un client,
 * un patronyme, un projet n'existent dans aucun modèle acoustique. Les
 * donner d'avance les corrige (« Angelo Jurassi » → « Angelo Geraci »).
 *
 * Deux mesures (faites sur l'API réelle, côté lleva) décident de ce module :
 *
 *   1. Un terme CONTENANT UN CHIFFRE corrompt les nombres dictés autour :
 *      « Casa 47 » envoyé comme terme faisait transcrire « Casa 48 ».
 *      D'où le retrait systématique des chiffres.
 *   2. Les termes hors-sujet sont INOFFENSIFS. On peut ratisser large : seul
 *      l'oubli coûte.
 *
 * Module PUR : aucune dépendance, utilisable côté serveur comme client.
 */

/** Plafond généreux : le bruit ne coûte rien, l'oubli si. */
export const MAX_KEYTERMS = 40;

/**
 * Deepgram refuse une requête dont les `keyterm` dépassent 500 tokens au
 * total. 800 caractères laisse de la marge même sur des noms que le
 * tokenizer découpe finement (~2 caractères par token au pire).
 */
export const MAX_KEYTERMS_TOTAL_CHARS = 800;

const MIN_TERM_CHARS = 3;
const MAX_TERM_CHARS = 40;

/** Chiffres retirés, espaces normalisés, ponctuation de bordure retirée. */
function clean(raw: string): string {
  return raw
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
}

/** Clé de dédoublonnage : sans accents, sans casse. */
function fold(term: string): string {
  return term.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Transforme des noms bruts en termes sûrs à envoyer à Deepgram.
 * L'ordre d'entrée est conservé : c'est lui qui survit aux plafonds, donc
 * l'appelant place les noms les plus importants en premier.
 */
export function toKeyterms(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const name of names) {
    if (out.length >= MAX_KEYTERMS) break;
    const term = clean(name);
    if (term.length < MIN_TERM_CHARS || term.length > MAX_TERM_CHARS) continue;
    const key = fold(term);
    if (seen.has(key)) continue;
    if (total + term.length > MAX_KEYTERMS_TOTAL_CHARS) continue;
    seen.add(key);
    out.push(term);
    total += term.length;
  }
  return out;
}
```

`packages/domain/src/voice-glossary/index.ts` :

```ts
export { MAX_KEYTERMS, MAX_KEYTERMS_TOTAL_CHARS, toKeyterms } from './keyterms';
```

Dans `packages/domain/src/index.ts`, ajouter à la fin :

```ts
export * from './voice-glossary/index';
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter @nexushub/domain exec vitest run src/voice-glossary --coverage --coverage.include='src/voice-glossary/**'
```

Attendu : 13 tests verts, `keyterms.ts` à 100 % lignes et branches. Si une branche n'est pas couverte, ajouter le test manquant avant de continuer.

- [ ] **Step 5 : Test de mutation manuel sur le retrait des chiffres**

Commenter temporairement la ligne `.replace(/\d+/g, ' ')` dans `clean`, relancer les tests.
Attendu : au moins « retire les chiffres » et « aucun terme rendu ne contient de chiffre » échouent. Rétablir la ligne, relancer : tout passe. (Ce garde-fou est la raison d'être du module ; s'il peut sauter sans qu'un test tombe, les tests ne protègent rien.)

- [ ] **Step 6 : Typecheck, lint, commit**

```bash
pnpm --filter @nexushub/domain typecheck && pnpm --filter @nexushub/domain lint
git add packages/domain/src/voice-glossary packages/domain/src/index.ts
git commit -m "feat(domain): glossaire de noms propres pour la reconnaissance vocale"
```

---

### Task 2 : Récolte des noms `loadProperNouns`

**Files:**

- Create: `apps/web/lib/assistant/voice/glossary-repo.ts`
- Test: `apps/web/lib/assistant/voice/glossary-repo.test.ts`

- [ ] **Step 1 : Écrire les tests (ils échouent)**

`apps/web/lib/assistant/voice/glossary-repo.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  membership: { findMany: vi.fn() },
  client: { findMany: vi.fn() },
  project: { findMany: vi.fn() },
  contact: { findMany: vi.fn() },
  workspace: { findUnique: vi.fn() },
}));
const scopeMock = vi.hoisted(() => ({ loadUserScope: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@nexushub/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/scope', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadUserScope: scopeMock.loadUserScope,
}));

import { loadProperNouns } from './glossary-repo';

const ctx = { userId: 'u1', workspaceId: 'w1', role: 'user' as const, isSuperAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  scopeMock.loadUserScope.mockResolvedValue({ kind: 'workspace' });
  prismaMock.membership.findMany.mockResolvedValue([
    { userId: 'u2', user: { firstName: 'Hélène', lastName: 'Durand' } },
    { userId: 'u1', user: { firstName: 'Angelo', lastName: 'Geraci' } },
  ]);
  prismaMock.client.findMany.mockResolvedValue([{ name: 'Izybizi' }, { name: 'Casa 47' }]);
  prismaMock.project.findMany.mockResolvedValue([{ name: 'Refonte site' }]);
  prismaMock.contact.findMany.mockResolvedValue([{ firstName: 'Marc', lastName: 'Lefèvre' }]);
  prismaMock.workspace.findUnique.mockResolvedValue({ name: 'BND Agency' });
});

describe('loadProperNouns', () => {
  it("rend les noms dans l'ordre de priorité, l'utilisateur courant en tête", async () => {
    await expect(loadProperNouns(ctx)).resolves.toEqual([
      'Angelo Geraci',
      'Hélène Durand',
      'Izybizi',
      'Casa 47',
      'Refonte site',
      'Marc Lefèvre',
      'BND Agency',
    ]);
  });

  it('rend les noms BRUTS (chiffres compris) : le nettoyage appartient à toKeyterms', async () => {
    expect(await loadProperNouns(ctx)).toContain('Casa 47');
  });

  it('tolère un prénom ou un nom absent, et ignore un membre sans aucun des deux', async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      { userId: 'u1', user: { firstName: 'Angelo', lastName: null } },
      { userId: 'u2', user: { firstName: null, lastName: null } },
      { userId: 'u3', user: { firstName: null, lastName: 'Durand' } },
    ]);
    const out = await loadProperNouns(ctx);
    expect(out.slice(0, 2)).toEqual(['Angelo', 'Durand']);
    expect(out).not.toContain('');
  });

  it('filtre TOUTES les requêtes par workspaceId', async () => {
    await loadProperNouns(ctx);
    expect(prismaMock.membership.findMany.mock.calls[0]![0].where).toEqual({ workspaceId: 'w1' });
    expect(prismaMock.client.findMany.mock.calls[0]![0].where.AND[0]).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      archivedAt: null,
    });
    expect(prismaMock.project.findMany.mock.calls[0]![0].where.AND[0]).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      archivedAt: null,
    });
    expect(prismaMock.contact.findMany.mock.calls[0]![0].where).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
    });
    expect(prismaMock.workspace.findUnique.mock.calls[0]![0].where).toEqual({ id: 'w1' });
  });

  it("applique le périmètre d'un membre restreint aux clients, projets ET contacts", async () => {
    scopeMock.loadUserScope.mockResolvedValue({
      kind: 'restricted',
      clientIds: ['c1'],
      projectIds: [],
    });
    await loadProperNouns(ctx);
    expect(scopeMock.loadUserScope).toHaveBeenCalledWith(ctx);
    expect(prismaMock.client.findMany.mock.calls[0]![0].where.AND[1]).toEqual({
      id: { in: ['c1'] },
    });
    expect(prismaMock.project.findMany.mock.calls[0]![0].where.AND[1]).toEqual({
      clientId: { in: ['c1'] },
    });
    expect(prismaMock.contact.findMany.mock.calls[0]![0].where.client.AND[1]).toEqual({
      id: { in: ['c1'] },
    });
  });

  it('borne chaque lecture et ne sélectionne que les noms', async () => {
    await loadProperNouns(ctx);
    expect(prismaMock.membership.findMany.mock.calls[0]![0].take).toBe(11);
    expect(prismaMock.client.findMany.mock.calls[0]![0]).toMatchObject({
      take: 12,
      select: { name: true },
    });
    expect(prismaMock.project.findMany.mock.calls[0]![0]).toMatchObject({
      take: 8,
      select: { name: true },
    });
    expect(prismaMock.contact.findMany.mock.calls[0]![0]).toMatchObject({
      take: 8,
      select: { firstName: true, lastName: true },
    });
  });

  it('ne lève jamais : une panne Prisma rend une liste vide', async () => {
    prismaMock.client.findMany.mockRejectedValue(new Error('db down'));
    await expect(loadProperNouns(ctx)).resolves.toEqual([]);
  });

  it('ne lève jamais : une panne du chargement de périmètre rend une liste vide', async () => {
    scopeMock.loadUserScope.mockRejectedValue(new Error('scope down'));
    await expect(loadProperNouns(ctx)).resolves.toEqual([]);
    expect(prismaMock.client.findMany).not.toHaveBeenCalled();
  });

  it('tolère un workspace introuvable', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue(null);
    expect(await loadProperNouns(ctx)).not.toContain('BND Agency');
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

```bash
pnpm --filter @nexushub/web exec vitest run lib/assistant/voice/glossary-repo.test.ts
```

Attendu : ÉCHEC, `Failed to resolve import "./glossary-repo"`.

- [ ] **Step 3 : Écrire l'implémentation**

`apps/web/lib/assistant/voice/glossary-repo.ts` :

```ts
import 'server-only';
import { prisma } from '@nexushub/db';
import {
  loadUserScope,
  scopedClientWhere,
  scopedProjectWhere,
  type ScopeAuthContext,
} from '@/lib/auth/scope';

/**
 * Récolte des noms propres du workspace pour le glossaire vocal (spec
 * 2026-11-13 §4.2). Rend les noms BRUTS, par ordre de priorité — le
 * nettoyage (chiffres, bornes) appartient à `toKeyterms` (domain).
 *
 * - Toujours filtré par `workspaceId` ET par le périmètre d'accès de
 *   l'utilisateur : un membre restreint ne reçoit jamais le nom d'un client
 *   qu'il ne peut pas voir (les termes partiront au navigateur au lot 2).
 * - Quotas par table pour qu'aucune catégorie n'affame les autres sous le
 *   plafond de 40 termes : 11 + 12 + 8 + 8 + 1 = 40.
 * - Ne lève JAMAIS : une transcription sans glossaire vaut mieux qu'une
 *   panne. Aucun nom n'est loggé (CLAUDE.md §4.7).
 */

const MEMBERS_TAKE = 11; // utilisateur courant compris
const CLIENTS_TAKE = 12;
const PROJECTS_TAKE = 8;
const CONTACTS_TAKE = 8;

function fullName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ');
}

export async function loadProperNouns(ctx: ScopeAuthContext): Promise<string[]> {
  try {
    const scope = await loadUserScope(ctx);
    const visibleClients = {
      AND: [{ workspaceId: ctx.workspaceId, deletedAt: null }, scopedClientWhere(scope)],
    };
    const [members, clients, projects, contacts, workspace] = await Promise.all([
      prisma.membership.findMany({
        where: { workspaceId: ctx.workspaceId },
        select: { userId: true, user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'asc' },
        take: MEMBERS_TAKE,
      }),
      prisma.client.findMany({
        where: {
          AND: [
            { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: null },
            scopedClientWhere(scope),
          ],
        },
        select: { name: true },
        orderBy: { updatedAt: 'desc' },
        take: CLIENTS_TAKE,
      }),
      prisma.project.findMany({
        where: {
          AND: [
            { workspaceId: ctx.workspaceId, deletedAt: null, archivedAt: null },
            scopedProjectWhere(scope),
          ],
        },
        select: { name: true },
        orderBy: { updatedAt: 'desc' },
        take: PROJECTS_TAKE,
      }),
      prisma.contact.findMany({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, client: visibleClients },
        select: { firstName: true, lastName: true },
        orderBy: { updatedAt: 'desc' },
        take: CONTACTS_TAKE,
      }),
      prisma.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true } }),
    ]);

    // L'utilisateur courant d'abord : c'est son propre nom qu'il dicte le plus.
    const self = members.filter((m) => m.userId === ctx.userId);
    const others = members.filter((m) => m.userId !== ctx.userId);

    return [
      ...[...self, ...others].map((m) => fullName(m.user.firstName, m.user.lastName)),
      ...clients.map((c) => c.name),
      ...projects.map((p) => p.name),
      ...contacts.map((c) => fullName(c.firstName, c.lastName)),
      ...(workspace === null ? [] : [workspace.name]),
    ].filter((name) => name !== '');
  } catch {
    return [];
  }
}
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter @nexushub/web exec vitest run lib/assistant/voice/glossary-repo.test.ts
```

Attendu : 9 tests verts.

- [ ] **Step 5 : Typecheck, lint, commit**

```bash
pnpm --filter @nexushub/web typecheck && pnpm --filter @nexushub/web lint
git add apps/web/lib/assistant/voice/glossary-repo.ts apps/web/lib/assistant/voice/glossary-repo.test.ts
git commit -m "feat(assistant): récolte des noms propres du workspace pour la voix"
```

Si le lint custom « workspace_id » signale `prisma.workspace.findUnique({ where: { id } })` : c'est la table racine, filtrée par son propre identifiant issu de la session. Suivre la convention déjà utilisée ailleurs dans le repo pour ce cas (`grep -rn "prisma.workspace.findUnique" apps/web/lib`) plutôt que d'ajouter une désactivation.

---

### Task 3 : `transcribeAudio` envoie les termes

**Files:**

- Modify: `apps/web/lib/assistant/voice/stt.ts`
- Test: `apps/web/lib/assistant/voice/stt.test.ts`

- [ ] **Step 1 : Ajouter les tests (ils échouent)**

Dans `apps/web/lib/assistant/voice/stt.test.ts`, ajouter ces cas à l'intérieur du `describe('transcribeAudio', …)`, après le dernier `it` :

```ts
const okBody = JSON.stringify({
  results: { channels: [{ alternatives: [{ transcript: 'ok' }] }] },
});

it('ajoute un paramètre keyterm par terme, encodé', async () => {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(okBody, { status: 200 }));
  await transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Angelo Geraci', 'Izybizi']);
  const url = new URL(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]));
  expect(url.searchParams.getAll('keyterm')).toEqual(['Angelo Geraci', 'Izybizi']);
  expect(url.searchParams.get('model')).toBe('nova-3');
  expect(url.searchParams.get('language')).toBe('multi');
  expect(url.searchParams.get('smart_format')).toBe('true');
});

it('sans terme, aucun paramètre keyterm', async () => {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(okBody, { status: 200 }));
  await transcribeAudio(new ArrayBuffer(4), 'audio/webm');
  const url = new URL(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]));
  expect(url.searchParams.getAll('keyterm')).toEqual([]);
});

it('réessaie UNE fois sans termes quand Deepgram répond 400 à une requête avec termes', async () => {
  (fetch as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce(new Response('Keyterm limit exceeded', { status: 400 }))
    .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
  await expect(transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Izybizi'])).resolves.toBe('ok');
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls).toHaveLength(2);
  expect(new URL(String(calls[1]![0])).searchParams.getAll('keyterm')).toEqual([]);
});

it('ne réessaie pas un 400 sans termes', async () => {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('bad', { status: 400 }));
  await expect(transcribeAudio(new ArrayBuffer(4), 'audio/webm')).rejects.toBeInstanceOf(
    SttProviderError,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('ne réessaie pas un autre statut que 400, même avec des termes', async () => {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('down', { status: 503 }));
  await expect(
    transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Izybizi']),
  ).rejects.toBeInstanceOf(SttProviderError);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('un second 400 après réessai jette SttProviderError', async () => {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('bad', { status: 400 }));
  await expect(
    transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Izybizi']),
  ).rejects.toBeInstanceOf(SttProviderError);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("l'erreur ne contient jamais un terme du glossaire (PII)", async () => {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('down', { status: 500 }));
  const err = await transcribeAudio(new ArrayBuffer(4), 'audio/webm', ['Angelo Geraci']).catch(
    (e: unknown) => e,
  );
  expect(String((err as Error).message)).not.toContain('Geraci');
});
```

`mockResolvedValue` avec une seule `Response` réutilisée : le corps d'un 4xx/5xx n'est jamais lu par le code, donc pas d'erreur « body already used ».

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

```bash
pnpm --filter @nexushub/web exec vitest run lib/assistant/voice/stt.test.ts
```

Attendu : les 6 tests existants passent ; « ajoute un paramètre keyterm », « réessaie UNE fois » et « un second 400 » échouent.

- [ ] **Step 3 : Modifier l'implémentation**

Dans `apps/web/lib/assistant/voice/stt.ts`, remplacer la constante `DEEPGRAM_URL` par :

```ts
const DEEPGRAM_LISTEN_URL = 'https://api.deepgram.com/v1/listen';

/**
 * `keyterm` se répète (un paramètre par terme). Les termes sont les noms
 * propres du workspace, déjà nettoyés et bornés par `toKeyterms` (domain).
 */
function buildListenUrl(keyterms: readonly string[]): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'multi',
    smart_format: 'true',
  });
  for (const term of keyterms) params.append('keyterm', term);
  return `${DEEPGRAM_LISTEN_URL}?${params.toString()}`;
}
```

Puis remplacer la fonction `transcribeAudio` entière par :

```ts
export async function transcribeAudio(
  audio: ArrayBuffer,
  contentType: string,
  keyterms: readonly string[] = [],
): Promise<string> {
  const env = getServerEnv();
  // Garde double identique au provider Anthropic (jamais actif en production).
  if (env.ASSISTANT_E2E_MOCK === '1' && env.NODE_ENV !== 'production') {
    return E2E_MOCK_TRANSCRIPT;
  }
  if (env.DEEPGRAM_API_KEY === undefined) throw new SttNotConfiguredError('DEEPGRAM absent');
  const apiKey = env.DEEPGRAM_API_KEY;
  const send = (terms: readonly string[]): Promise<Response> =>
    fetch(buildListenUrl(terms), {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': contentType },
      body: audio,
    });

  let res = await send(keyterms);
  // Le glossaire ne doit JAMAIS casser la transcription : si Deepgram refuse
  // la requête (ex. plafond de 500 tokens de keyterms dépassé), on réessaie
  // une fois sans termes plutôt que de rendre une erreur à l'utilisateur.
  if (res.status === 400 && keyterms.length > 0) res = await send([]);
  if (!res.ok) {
    // Statut seul — jamais le corps (détails de compte) ni l'URL (noms propres).
    throw new SttProviderError(`deepgram status ${String(res.status)}`);
  }
  const data = (await res.json().catch(() => null)) as DeepgramResponse | null;
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
}
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter @nexushub/web exec vitest run lib/assistant/voice/stt.test.ts
```

Attendu : 13 tests verts.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/lib/assistant/voice/stt.ts apps/web/lib/assistant/voice/stt.test.ts
git commit -m "feat(assistant): termes de glossaire envoyés à Deepgram, réessai sans termes sur refus"
```

---

### Task 4 : Brancher la route `/transcribe`

**Files:**

- Modify: `apps/web/app/api/assistant/voice/transcribe/route.ts`
- Test: `apps/web/app/api/assistant/voice/transcribe/route.test.ts`

- [ ] **Step 1 : Adapter les mocks et ajouter les tests (ils échouent)**

Dans `apps/web/app/api/assistant/voice/transcribe/route.test.ts` :

a) Ajouter `loadProperNouns` à l'objet `vi.hoisted` :

```ts
const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  assertCsrfHeader: vi.fn(),
  check: vi.fn(),
  transcribeAudio: vi.fn(),
  loadProperNouns: vi.fn(),
}));
```

b) Ajouter ce mock sous les `vi.mock` existants :

```ts
vi.mock('@/lib/assistant/voice/glossary-repo', () => ({
  loadProperNouns: mocks.loadProperNouns,
}));
```

c) Dans le `beforeEach`, ajouter :

```ts
mocks.loadProperNouns.mockResolvedValue(['Angelo Geraci', 'Casa 47']);
```

d) Ajouter ces cas à la fin du `describe` :

```ts
it('passe à la transcription les termes du glossaire, nettoyés (sans chiffres)', async () => {
  await POST(makeReq(new Uint8Array(4)));
  expect(mocks.loadProperNouns).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'u1', workspaceId: 'w1' }),
  );
  expect(mocks.transcribeAudio).toHaveBeenCalledWith(expect.anything(), 'audio/webm', [
    'Angelo Geraci',
    'Casa',
  ]);
});

it('glossaire vide : la transcription part quand même, sans terme', async () => {
  mocks.loadProperNouns.mockResolvedValue([]);
  const res = await POST(makeReq(new Uint8Array(4)));
  expect(res.status).toBe(200);
  expect(mocks.transcribeAudio).toHaveBeenCalledWith(expect.anything(), 'audio/webm', []);
});

it('ne récolte pas le glossaire pour une requête refusée (415, 413, 400)', async () => {
  await POST(makeReq(new Uint8Array(4), 'application/json'));
  await POST(makeReq(new Uint8Array(2_000_001)));
  await POST(makeReq(new Uint8Array(0)));
  expect(mocks.loadProperNouns).not.toHaveBeenCalled();
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

```bash
pnpm --filter @nexushub/web exec vitest run app/api/assistant/voice/transcribe
```

Attendu : « passe à la transcription les termes » et « glossaire vide » échouent (`transcribeAudio` est appelé avec deux arguments) ; les autres passent.

- [ ] **Step 3 : Modifier la route**

Dans `apps/web/app/api/assistant/voice/transcribe/route.ts` :

a) Ajouter les imports :

```ts
import { toKeyterms } from '@nexushub/domain';
import { loadProperNouns } from '@/lib/assistant/voice/glossary-repo';
```

b) Remplacer :

```ts
  try {
    const transcript = await transcribeAudio(audio, contentType);
```

par :

```ts
  // Glossaire de noms propres (spec 2026-11-13 §4) : récolté APRÈS toutes les
  // validations (aucune lecture DB pour une requête refusée), dans le
  // périmètre d'accès de l'utilisateur. `loadProperNouns` ne lève jamais.
  const keyterms = toKeyterms(await loadProperNouns(ctx));
  try {
    const transcript = await transcribeAudio(audio, contentType, keyterms);
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

```bash
pnpm --filter @nexushub/web exec vitest run app/api/assistant/voice/transcribe lib/assistant/voice
```

Attendu : tout vert (13 tests route, 13 stt, 9 glossary-repo, plus tts inchangé).

- [ ] **Step 5 : Typecheck, lint, commit**

```bash
pnpm --filter @nexushub/web typecheck && pnpm --filter @nexushub/web lint
git add apps/web/app/api/assistant/voice/transcribe
git commit -m "feat(assistant): glossaire de noms propres branché sur la transcription vocale"
```

---

### Task 5 : Documentation

**Files:**

- Modify: `docs/security.md`
- Modify: `CLAUDE.md`
- Modify: `progress.md`

- [ ] **Step 1 : `docs/security.md`, section « 4.1 Assistant voix »**

Après le point 5 (« **Rate limiting** Upstash par utilisateur… »), ajouter :

```markdown
6. **Glossaire de noms propres** (2026-11-13) : chaque requête STT envoie à Deepgram, en paramètres `keyterm`, jusqu'à 40 noms du workspace (membres, clients, projets, contacts) pour fiabiliser leur transcription. Ces noms sont déjà présents dans l'audio, mais c'est une donnée explicite de plus chez le fournisseur. Garde-fous : récolte filtrée par `workspace_id` **et** par le périmètre d'accès de l'utilisateur (`loadUserScope`) ; chiffres retirés ; aucun terme dans les logs ni dans les messages d'erreur (l'URL de requête n'est jamais reportée) ; en cas de refus des termes par Deepgram, réessai sans eux.
```

Dans le tableau du journal en fin de fichier, ajouter la ligne :

```markdown
| 2026-11-13 | §4.1.6 — Assistant voix : glossaire de noms propres envoyé à Deepgram (`keyterm`), scopé workspace + périmètre d'accès, jamais loggé | Angelo L. + Claude |
```

- [ ] **Step 2 : `CLAUDE.md`, §11 Journal**

Ajouter à la fin du tableau (avant la ligne « > **Règle :** ») :

```markdown
| 2026-11-13 | Voix lot 1 — glossaire de noms propres (`packages/domain/voice-glossary` : chiffres retirés, 40 termes / 800 car.) récolté dans le périmètre d'accès (`glossary-repo.ts`) et envoyé à Deepgram en `keyterm` ; réessai sans termes sur 400 ; spec `2026-11-13-assistant-voice-transcription-design.md` (lots 2 flux direct et 3 correction à venir) | Angelo L. + Claude |
```

- [ ] **Step 3 : `progress.md`**

Ajouter à la fin du tableau journal (avant la ligne « > **Règle :** chaque session de travail… ») :

```markdown
| 2026-11-13 | Assistant | Voix lot 1/3 | **Retranscription vocale — glossaire de noms propres** (spec `docs/superpowers/specs/2026-11-13-assistant-voice-transcription-design.md`, plan `docs/superpowers/plans/2026-11-13-voice-glossary.md`, branche `feat/voice-glossary`). Analyse de la pile vocale lleva : même modèle Deepgram, l'écart vient du glossaire, du flux direct et de la correction. Lot 1 : `toKeyterms` (domain, pur, 100 % — chiffres retirés car un terme chiffré corrompt les nombres dictés, plafonds 40 termes / 800 car.), `loadProperNouns` (membres, clients, projets, contacts, dans le périmètre `WorkspaceAccess`, ne lève jamais), `transcribeAudio` envoie les `keyterm` et réessaie sans eux sur 400. Aucune migration ni dépendance. **Reste** : lot 2 (flux direct WebSocket + jeton éphémère + texte en direct + CSP), lot 3 (correction Haiku au relâchement) ; hors périmètre décidé : dictée dans les autres champs, mode mains libres. |
```

- [ ] **Step 4 : Format et commit**

```bash
pnpm exec prettier --write docs/security.md CLAUDE.md progress.md
git add docs/security.md CLAUDE.md progress.md
git commit -m "docs: glossaire vocal (sécurité, journal, avancement)"
```

---

### Task 6 : Vérification finale

- [ ] **Step 1 : CI locale complète**

```bash
pnpm ci:local
```

Attendu : install, sécurité, lint + format, typecheck, tests, build et E2E smoke verts. Ne désactiver aucun test ni aucune règle pour faire passer : corriger la cause.

- [ ] **Step 2 : Essai réel (nécessite `DEEPGRAM_API_KEY` dans `.env.local`, présent depuis le 2026-11-13)**

Copier `.env.local` du checkout principal si le worktree n'en a pas :

```bash
[ -f apps/web/.env.local ] || cp ../../apps/web/.env.local apps/web/.env.local
pnpm --filter @nexushub/web dev
```

Ouvrir `/assistant`, maintenir ⌥ Option, dicter une phrase qui cite : son propre nom complet, un client du workspace, un contact. Exemple : « Crée une carte pour Angelo Geraci sur le projet de \<client\>, et préviens \<contact\>. »

Attendu : les trois noms sont orthographiés comme dans BND. Refaire la même dictée sur `main` (sans le lot) pour comparer, et noter le résultat avant/après dans la description de la PR.

- [ ] **Step 3 : Vérifier qu'un nombre dicté n'est pas corrompu**

Si un client du workspace a un chiffre dans son nom, dicter une phrase qui le cite avec un autre nombre (« facture de 48 euros pour \<client\> »). Attendu : le nombre dicté est transcrit tel quel.

- [ ] **Step 4 : Ouvrir la PR**

```bash
git push -u origin feat/voice-glossary
gh pr create --title "feat(assistant): glossaire de noms propres pour la voix (lot 1/3)" --body "$(cat <<'EOF'
## Contexte
La retranscription vocale de l'assistant ratait les noms propres (clients, contacts, membres). Analyse de la pile lleva : même modèle Deepgram, l'écart vient de ce qui l'entoure. Lot 1 sur 3 du spec `docs/superpowers/specs/2026-11-13-assistant-voice-transcription-design.md`.

## Changements
- `packages/domain/voice-glossary` : `toKeyterms` (chiffres retirés, 40 termes / 800 caractères)
- `glossary-repo.ts` : récolte membres, clients, projets, contacts, dans le périmètre d'accès de l'utilisateur
- `transcribeAudio` : paramètres `keyterm`, réessai sans termes si Deepgram répond 400
- Route `/api/assistant/voice/transcribe` branchée

## Tests
- Domain 100 % sur le nouveau module, test de mutation manuel sur le retrait des chiffres
- Récolte : filtrage workspace, périmètre restreint, ne lève jamais
- STT : encodage des termes, réessai, aucune fuite de terme dans les erreurs
- Essai réel avant/après : (à compléter)

## Risques sécurité
- Les noms du workspace partent chez Deepgram en paramètres de requête (documenté dans `docs/security.md` §4.1.6). Jamais loggés.
- Membre restreint : ne reçoit que les noms de son périmètre.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Compléter la ligne « Essai réel avant/après » avec le résultat du Step 2 avant de demander la revue.
