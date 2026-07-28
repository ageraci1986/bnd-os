# Plan 4 — Assistant : orbe animée, accueil briefing, E2E, Storybook

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La page `/assistant` prend sa forme finale validée en maquette (orbe blob+halo animée pilotée par l'activité de l'agent, accueil avec briefing digéré + KPI), les 4 parcours E2E de la spec §8 deviennent exécutables (sign-in helper + provider mock), et Storybook est réellement installé avec les stories exigées.

**Architecture:** Orbe = classes CSS portées à plat de la maquette dans le design system (`components.css`, convention `nx-*` — mémoire projet : ne pas recoder en Tailwind), composant `AssistantOrb` interne à `AssistantChat` (les états y vivent déjà), activité dérivée `idle|thinking|responding` (+`listening` réservé). Accueil = données overview chargées côté serveur (helper partagé avec le tool `get_today_overview`, zéro tour d'agent, zéro token). E2E = pattern du repo (specs gated par env flag, exécution locale) + deux briques nouvelles : helper de connexion UI et sélection d'un provider scripté par env. Storybook : install propre (version vérifiée Context7) côté `apps/web`.

**Tech Stack:** CSS keyframes (pas de framer-motion si non installé — vérifier ; transitions d'état en CSS), Playwright existant, Storybook (nouvelle dep — **Context7 OBLIGATOIRE avant install**).

**Spec :** `docs/superpowers/specs/2026-07-27-assistant-agent-design.md` §5-§6 (orbe lignes 144-152, accueil 153-154, barre 160-161), §8 (E2E a-d, Storybook), §9 (voix hors scope — micro grisé DÉJÀ en place, `assistant-chat.tsx:470-478`, rien à faire).

**Branche :** `feat/assistant-orb-e2e`, depuis `main` après merge de la PR #18 (sanitize). Si #18 non mergée : partir de main quand même (aucun chevauchement) et le signaler.

**Écarts assumés (à reporter en PR) :**

- Pile de notices (« En discuter »/« Ignorer ») : dépend de la proactivité → **Plan 3b**, hors scope ici (la story « notice » de la spec §8 sera remplacée par une story MailDraftWidget).
- E2E (b)(c)(d) : gated par `E2E_ASSISTANT=1` + credentials env (pattern des specs mail existants — pas de Supabase seedé en CI). Le (a) tourne aussi sous ce flag. CI continue de ne lancer que le smoke.
- Chromatic : non configuré (compte/token = décision utilisateur) — stories prêtes pour, câblage en suivi.

**Conventions transverses :** identiques aux plans 5x (TDD, commits conventionnels, textes user-safe, pas de PII, tests style voisins). AUCUN secret inventé : les E2E lisent `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` de l'env locale.

---

### Task 1: CSS de l'orbe dans le design system (+ prefers-reduced-motion)

**Files:**

- Modify: `packages/ui/src/tokens/components.css` (keyframes existants : `nx-skeleton-shimmer` l.2188, `nx-fade-in` l.2204 — ajouter à la suite)

Porter la maquette (`docs/superpowers/specs/assets/2026-07-27-assistant-mockup.html` l.7-16 et l.43-51) en préfixe `nx-` :

```css
/* Orbe assistant (Plan 4) — porté de la maquette validée (blob fluide + halo).
   États par data-attribute sur .nx-orb : data-activity="idle|thinking|responding|listening".
   prefers-reduced-motion : toutes les animations remplacées par un fondu statique. */
@keyframes nx-orb-morph {
  0%,
  100% {
    border-radius: 42% 58% 55% 45%/48% 42% 58% 52%;
    transform: rotate(0deg) scale(1);
  }
  25% {
    border-radius: 58% 42% 47% 53%/40% 55% 45% 60%;
    transform: rotate(6deg) scale(1.05);
  }
  50% {
    border-radius: 45% 55% 60% 40%/55% 45% 55% 45%;
    transform: rotate(-4deg) scale(0.97);
  }
  75% {
    border-radius: 55% 45% 42% 58%/45% 60% 40% 55%;
    transform: rotate(3deg) scale(1.03);
  }
}
@keyframes nx-orb-hue {
  0%,
  100% {
    filter: hue-rotate(0);
  }
  50% {
    filter: hue-rotate(-18deg);
  }
}
@keyframes nx-orb-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes nx-orb-breathe {
  0%,
  100% {
    scale: 0.94;
    opacity: 0.7;
  }
  50% {
    scale: 1.06;
    opacity: 1;
  }
}

.nx-orb {
  position: relative;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nx-orb-ring {
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  padding: 2.5px;
  background: conic-gradient(
    from 0deg,
    rgba(139, 43, 226, 0) 8%,
    #8b2be2 35%,
    #ff2a6d 60%,
    rgba(255, 42, 109, 0) 92%
  );
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation:
    nx-orb-spin 4.5s linear infinite,
    nx-orb-breathe 2.8s ease-in-out infinite;
}
.nx-orb-blob {
  width: 76px;
  height: 76px;
  background: linear-gradient(135deg, #c98fff 0%, #8b2be2 45%, #ff2a6d 100%);
  animation:
    nx-orb-morph 6s ease-in-out infinite,
    nx-orb-hue 9s ease-in-out infinite;
  box-shadow: 0 14px 40px rgba(139, 43, 226, 0.32);
  transition: box-shadow 0.4s ease;
}
/* thinking : halo accéléré + intensifié (spec §6) */
.nx-orb[data-activity='thinking'] .nx-orb-ring {
  animation-duration: 1.6s, 1.2s;
}
.nx-orb[data-activity='thinking'] .nx-orb-blob {
  box-shadow: 0 14px 52px rgba(139, 43, 226, 0.5);
}
/* responding : blob pulse plus vif */
.nx-orb[data-activity='responding'] .nx-orb-blob {
  animation-duration: 2.4s, 9s;
}
/* listening (V1.5, posé pour Storybook) : respiration ample du halo */
.nx-orb[data-activity='listening'] .nx-orb-ring {
  animation-duration: 4.5s, 1.4s;
}

@media (prefers-reduced-motion: reduce) {
  .nx-orb-ring,
  .nx-orb-blob {
    animation: none;
  }
  .nx-orb-blob {
    border-radius: 50%;
    opacity: 0.9;
    transition:
      opacity 0.6s ease,
      box-shadow 0.6s ease;
  }
  .nx-orb[data-activity='thinking'] .nx-orb-blob,
  .nx-orb[data-activity='responding'] .nx-orb-blob {
    opacity: 1;
  }
}
```

- [ ] Step 1 : ajouter le bloc ci-dessus en fin de `components.css`. Pas de test unitaire CSS — la vérification vivra dans les tests du composant (Task 2) et les stories (Task 6).
- [ ] Step 2 : `pnpm turbo run lint` (stylelint éventuel) → vert.
- [ ] Step 3 : Commit — `feat(ui): orbe assistant (keyframes + états + reduced-motion)`

---

### Task 2: Composant `AssistantOrb` + activité dérivée

**Files:**

- Create: `apps/web/features/assistant/components/assistant-orb.tsx` (+ `assistant-orb.test.tsx`)
- Modify: `apps/web/features/assistant/components/assistant-chat.tsx` (placeholder l.322-330 remplacé ; dérivation de l'activité)

```tsx
export type OrbActivity = 'idle' | 'thinking' | 'responding' | 'listening';

/** Dérive l'état de l'orbe depuis les états du chat (spec §3.1/§6). `listening` = V1.5. */
export function deriveOrbActivity(input: {
  busy: boolean;
  streaming: boolean; // streamText non vide
}): OrbActivity {
  if (!input.busy) return 'idle';
  return input.streaming ? 'responding' : 'thinking';
}

/** Orbe décorative — aria-hidden : l'information d'activité est déjà donnée
 *  par les indicateurs textuels du fil (labels d'activité, aria-live). */
export function AssistantOrb({ activity }: { readonly activity: OrbActivity }) {
  return (
    <div className="nx-orb" data-activity={activity} aria-hidden="true" data-testid="assistant-orb">
      <div className="nx-orb-ring" />
      <div className="nx-orb-blob" />
    </div>
  );
}
```

Dans `assistant-chat.tsx` : remplacer le placeholder par `<AssistantOrb activity={deriveOrbActivity({ busy, streaming: streamText !== null && streamText !== '' })} />`.

Tests : deriveOrbActivity (4 cas : idle, thinking (busy sans stream), responding (busy + stream), pas de listening dérivé) ; rendu (data-activity + aria-hidden pinnés) ; intégration assistant-chat (l'orbe passe à thinking pendant un tour scripté puis responding au premier chunk puis idle après done — étendre un test SSE existant).

- [ ] TDD → suites `assistant-orb assistant-chat` vertes → typecheck → Commit — `feat(assistant): orbe animée pilotée par l'activité du tour`

---

### Task 3: Accueil — briefing digéré + KPI côté serveur

**Files:**

- Create: `apps/web/lib/assistant/overview-core.ts` (+ test) — extraction du corps de `get_today_overview` (read-tools.ts) en helper `loadTodayOverview(ctx)` retournant l'objet que le tool sérialise ; le tool délègue (iso — ses tests restent verts).
- Modify: `apps/web/app/(app)/assistant/page.tsx` — charge `loadTodayOverview(ctx)` et passe `overview` à `AssistantChat`.
- Modify: `apps/web/features/assistant/components/assistant-chat.tsx` (+ test) — prop `overview?: TodayOverview` : sous le hello, remplace le brief statique par une phrase digérée construite côté client à partir des données (ex. « 3 tâches dues aujourd'hui · 1 bloquée · 5 mails non lus » — RÉUTILISE le format des libellés de `KpiCards`) et rend `<KpiCards data={overview} />` (composant widget existant) au-dessus du fil, HORS aria-live. Sans prop (échec de chargement serveur — try/catch dans page.tsx, prop omise) : comportement actuel (brief statique).

Tests : overview-core (délégation iso pinnée — le tool appelle le helper) ; phrase digérée pinnée pour un jeu de données ; KpiCards rendu au-dessus du fil ; fallback sans overview.

- [ ] TDD → suites vertes → typecheck → Commit — `feat(assistant): accueil briefing digéré + KPI (données serveur, zéro token)`

---

### Task 4: Provider scripté E2E + sign-in helper + auth-gate

**Files:**

- Create: `apps/web/lib/assistant/e2e-provider.ts` (+ test)
- Modify: `apps/web/lib/assistant/provider.ts` (sélection par env)
- Modify: `apps/web/lib/env.ts` (ajouter `ASSISTANT_E2E_MOCK: optionalString(1)`)
- Create: `e2e/helpers/sign-in.ts`
- Modify: `e2e/tests/shell-auth-gate.spec.ts` (ajouter `/assistant` à APP_ROUTES)

**e2e-provider** : implémente l'interface `Provider` de `@nexushub/agent`. Comportement scripté DÉTERMINISTE piloté par le dernier message utilisateur :

- contient `e2e:briefing` → tool_use `get_today_overview` puis texte « Voici votre briefing. » ;
- contient `e2e:delete-card <uuid>` → tool_use `delete_card {cardId}` (GATED → le vrai flux confirm s'exécute) puis texte reprenant le résultat du tool (« Carte supprimée. » ou le refus) ;
- sinon → texte « [e2e] » + écho des 30 premiers caractères.
  Streaming simulé par chunks. AUCUN réseau.

**provider.ts** : dans la factory, si `getServerEnv().ASSISTANT_E2E_MOCK === '1'` ET `NODE_ENV !== 'production'` → retourne le provider scripté (comment : garde double, jamais actif en prod même si l'env fuit). Sinon comportement actuel inchangé (ses tests existants inchangés).

**sign-in.ts** :

```ts
import { expect, type Page } from '@playwright/test';

/** Connexion UI réelle. Requiert E2E_USER_EMAIL / E2E_USER_PASSWORD (compte du
 *  Supabase local/staging du dev — jamais commité). */
export async function signIn(page: Page): Promise<void> {
  const email = process.env['E2E_USER_EMAIL'];
  const password = process.env['E2E_USER_PASSWORD'];
  if (!email || !password) throw new Error('E2E_USER_EMAIL / E2E_USER_PASSWORD requis');
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/overview/);
}
```

(Adapter les sélecteurs aux labels réels du formulaire — LIRE login-form.tsx.)

Tests : e2e-provider unitaire (3 scénarios pinnés, streaming par chunks) ; sélection provider (env mock=1 + NODE_ENV test → scripté ; prod → jamais ; absent → réel) ; auth-gate `/assistant` → redirect login.

- [ ] TDD → suites vertes → typecheck → Commit — `feat(assistant): provider scripté E2E + sign-in helper`

---

### Task 5: E2E `assistant.spec.ts` — les 4 parcours de la spec §8

**Files:**

- Create: `e2e/tests/assistant.spec.ts`

Gated : `test.skip(process.env['E2E_ASSISTANT'] !== '1', 'Set E2E_ASSISTANT=1 with a signed-in-able user and ASSISTANT_E2E_MOCK=1 on the web server')`. Documenter en tête : lancer avec `ASSISTANT_E2E_MOCK=1 pnpm --filter @nexushub/web dev` + env E2E*USER*\*.

- **(a)** signIn → goto `/assistant` → hello visible, KPI (3 tuiles — labels de KpiCards) visibles, orbe `data-activity="idle"`.
- **(b)** Allow : créer une carte via l'UI projets (réutiliser les data-testid/labels réels — LIRE la page projets ; sinon via un projet existant du compte E2E documenté comme prérequis), puis `/assistant`, envoyer `e2e:delete-card <id>` → dialog de confirmation visible (texte « Suppression de carte ») → Autoriser → réponse contient « supprimée » → retour page projets : la carte n'est plus là (effet DB réel).
- **(c)** Deny : même flux, Refuser → réponse contient le refus → la carte est TOUJOURS là.
- **(d)** Timeout : même flux, ne rien cliquer → au bout du timeout serveur (120 s — test long : `test.setTimeout(180_000)`) le dialog se ferme et la réponse indique le refus automatique. (Si 120 s rend le test impraticable, le marquer `test.skip` par défaut avec flag dédié `E2E_ASSISTANT_TIMEOUT=1` et le documenter — décision laissée à l'implémenteur, à justifier.)

- [ ] Écrire les 4 specs → vérifier localement au moins (a) si l'environnement du worktree le permet (`.env.local` présent) — sinon documenter « non exécuté ici, gated » dans le rapport → Commit — `test(e2e): parcours assistant (briefing, gate allow/deny/timeout)`

---

### Task 6: Storybook — install réelle + stories

**Files:**

- Modify: `apps/web/package.json` (deps + scripts) — **AVANT TOUTE INSTALL : interroger Context7 MCP** (version stable Storybook, breaking changes, compat Next 15/React 19 — framework `@storybook/nextjs` ou successeur ; noter la version retenue dans le rapport ET dans le commit).
- Create: `apps/web/.storybook/main.ts` + `preview.ts` (import de `globals.css` pour les tokens ; stories `../features/**/*.stories.tsx`)
- Create: `apps/web/features/assistant/components/assistant-orb.stories.tsx` (4 états — idle/thinking/responding/listening)
- Create: `apps/web/features/assistant/components/widgets/kpi-cards.stories.tsx` (données nominales + zéros)
- Create: `apps/web/features/assistant/components/widgets/mail-draft-widget.stories.tsx` (lecture seule — sans actions, loadDraft mocké par un decorator qui stub le module si nécessaire ; sinon story de l'état placeholder)
- Create: `apps/web/features/assistant/components/confirm-dialog.stories.tsx` — SI le dialog est extractible à coût nul ; sinon (il est inline dans assistant-chat) créer une story d'un extrait présentational minimal N'EST PAS exigé : remplacer par `mail-list-widget.stories.tsx` (liste + mail déplié). Décision à justifier.

Storybook = côté apps/web (les composants à storifier y vivent ; packages/ui garde ses scripts pour plus tard — retirer les scripts orphelins de packages/ui/package.json est OK avec une ligne de commentaire).

- [ ] Context7 → install → config → stories → `pnpm --filter @nexushub/web storybook -- --smoke-test` (ou build) vert → suites/typecheck/lint verts → Commit — `feat(storybook): install + stories orbe, KPI, widgets mail`

---

### Task 7: Suites + docs + revue holistique → PR

- [ ] `pnpm turbo run test typecheck lint` 17/17 ; couverture agent 100 % intacte.
- [ ] `progress.md` (ligne Plan 4) + `CLAUDE.md` §11 (une ligne) — et corriger la mention Storybook de CLAUDE.md §2 si le choix d'emplacement diffère (apps/web).
- [ ] Revue holistique finale (superpowers:code-reviewer) : orbe (états, reduced-motion, aria-hidden justifié), sélection provider mock (garde prod), E2E (pas de secrets commités), Storybook (version Context7, config minimale). Verdict ready-for-PR requis.
- [ ] PR template FR habituel ; dette : notices (Plan 3b), Chromatic non câblé, E2E gated local (pas de Supabase seedé CI), timeout 120 s.

---

## Self-review

- Spec §6 : orbe (T1-T2), accueil hello+brief+KPI (T3), micro grisé (déjà fait, vérifié), notices → écart documenté (3b). §8 : E2E a-d (T4-T5), Storybook 4 stories (T6 — « notice » substituée, justifié). §3.1 : `AgentActivity`/OrbActivity aligné (listening posé, non dérivé).
- Placeholders : T5(b) laisse le choix du mécanisme de création de carte et T5(d)/T6(dialog) des décisions encadrées « à justifier » — assumé (dépend de l'UI réelle non explorée en détail), le comportement attendu est entièrement spécifié.
- Types : OrbActivity (T2) consommé T5/T6 ; loadTodayOverview (T3) consommé par page + tool ; Provider scripté (T4) consommé T5.
