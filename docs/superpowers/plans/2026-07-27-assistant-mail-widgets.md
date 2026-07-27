# Assistant NexusHub — Plan 2b : Mail + widgets structurés — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'agent lit les corps de mails (chargement paresseux, boîtes du propriétaire), prépare des brouillons de réponse et envoie des mails avec un dialog de confirmation lisible (destinataires + objet + extrait) ; les résultats des tools de lecture s'affichent en **widgets** dans le fil (cartes KPI, mini-Kanban, liste de mails) au lieu de texte brut.

**Architecture:** Petite extension du seam `packages/agent` (description de confirmation par tool via `describeForConfirm`, nom du tool dans le contrat `Confirmer`, sortie du tool dans l'événement `tool_end`) ; nouvel événement SSE `tool_result {tool, data}` (whitelist + plafond de taille, Zod des deux côtés) ; module `mail-tools.ts` wrappant le pipeline mail existant (`fetchMailBody`, `saveDraft`, `sendMail`) ; composants widgets réutilisant `MetricCard` de `@nexushub/ui`. Plus les 4 suivis de la revue finale 2a (réponse atomique du ConfirmStore, test d'intégration du confirmer, orderBy, refine calendaire).

**Tech Stack:** existant uniquement. Aucune nouvelle dépendance.

**Base:** branche `feat/assistant-mail-widgets` (depuis `main` post-merge PR #10). Conventions établies : `defineTool` + `safeDb`/`safeMutation`, messages FR montrables, gardes `workspaceId` systématiques, mocks `vi.hoisted`.

**Décisions produit actées (Angelo, 2026-07-27) :** corps de mails = **boîtes du propriétaire uniquement** (convention `fetch-mail-body`) ; rendu esthétique = **widgets déterministes depuis les données de tools**, pas de markdown.

---

### Task 1: Seam agent — `describeForConfirm`, `Confirmer(description, tool)`, `tool_end.output`

**Files:**

- Modify: `packages/agent/src/types.ts`
- Modify: `packages/agent/src/registry.ts`
- Modify: `packages/agent/src/run-turn.ts`
- Modify: `packages/agent/src/run-turn.test.ts`, `registry.test.ts`

Coverage 100 % imposée — chaque branche nouvelle est testée.

- [ ] **Step 1: Types**

Dans `types.ts` :

- `ToolSpec` gagne `readonly describeForConfirm?: (input: never) => string;` (doc : « description humaine de l'action pour le dialog de confirmation ; à défaut, describeAction générique »).
- `Confirmer` devient `(description: string, tool: string) => Promise<boolean>;`.
- `AgentEvent` : `confirm_request` gagne `readonly tool: string` ; `tool_end` gagne `readonly output: string`.

- [ ] **Step 2: `defineTool`** (registry.ts) : `DefineToolInput<T>` gagne `readonly describeForConfirm?: (input: T) => string;` ; transmis avec le même unique cast que `handler`.

- [ ] **Step 3: `run-turn.ts` — `executeGated`**

```ts
  if (spec !== null && spec.gated) {
    const description = buildConfirmDescription(spec, name, input);
    deps.onEvent?.({ type: 'confirm_request', tool: name, description });
    let allowed: boolean;
    try {
      allowed = await deps.confirmer(description, name);
    } catch { /* branche existante inchangée */ }
    ...
  }
```

avec :

```ts
function buildConfirmDescription(spec: ToolSpec, name: string, input: unknown): string {
  if (spec.describeForConfirm !== undefined) {
    try {
      return spec.describeForConfirm(input as never);
    } catch {
      // Une description qui lève ne doit jamais bloquer le gate : repli générique.
    }
  }
  return describeAction(name, input);
}
```

Et `tool_end` émet désormais `{ type: 'tool_end', name, isError: result.isError, output: result.output }`.

- [ ] **Step 4: Tests** — mettre à jour les confirmers de test (2 args) ; nouveaux cas : describeForConfirm utilisé quand présent ; describeForConfirm qui throw → repli describeAction (gate fonctionne) ; confirm_request porte `tool` ; confirmer reçoit `(description, name)` ; tool_end porte `output`. `autoDeny` : signature inchangée compatible (2 args ignorés).

- [ ] **Step 5:** `pnpm --filter @nexushub/agent test` (100 %), lint, typecheck. Commit `feat(agent): per-tool confirm descriptions and tool output events`.

---

### Task 2: ConfirmStore — réponse atomique (SET NX)

**Files:**

- Modify: `apps/web/lib/assistant/confirm-store.ts` + test

Suivi revue finale 2a (Minor 2). Principe : la réponse est écrite sur une **clé dédiée** `assistant:confirm:{id}:answer` en `SET NX` — le premier écrivain gagne, atomiquement.

- [ ] **Step 1: Backend** — `ConfirmBackend` gagne `setAnswerIfAbsent(id: string, allowed: boolean): Promise<boolean>` (true si écrit, false si déjà présent) et `getAnswer(id): Promise<boolean | null>` :
  - Redis : `this.redis.set(KEY_PREFIX + id + ':answer', allowed, { nx: true, ex: TTL_SECONDS })` → `'OK' | null` → boolean ; `get` sur la même clé.
  - Memory : Map dédiée, même sémantique.
- [ ] **Step 2: `answer()`** — garde ownership/existence inchangée (GET record) ; puis `setAnswerIfAbsent` : false → `'already_answered'` ; true → `'ok'` (le record n'est plus muté).
- [ ] **Step 3: `awaitAnswer()`** — poll `getAnswer(id)` (null = pending) ; le `finally` supprime record ET answer key.
- [ ] **Step 4: Tests** — deux `answer()` concurrents (Promise.all, backend mémoire) → exactement un `'ok'` et un `'already_answered'` ; sémantique existante préservée (tous les tests actuels verts, adaptés si nécessaire au nouveau backend contract).
- [ ] **Step 5:** vert + commit `fix(assistant): atomic first-answer-wins in confirm store`.

---

### Task 3: SSE `tool_result` + route (émission whitelistée, audit par nom de tool)

**Files:**

- Modify: `apps/web/lib/assistant/chat-schema.ts` (+ test)
- Modify: `apps/web/app/api/assistant/chat/route.ts`
- Modify: `apps/web/features/assistant/lib/sse.ts` (rien à changer si le schéma est la source — vérifier)

- [ ] **Step 1: Schéma** — `ChatSseEventSchema` gagne :

```ts
  z.object({ type: z.literal('tool_result'), tool: z.string(), data: z.unknown() }),
```

et `confirm_request` gagne `tool: z.string()`.

- [ ] **Step 2: Route — émission** — constantes :

```ts
const WIDGET_TOOLS = new Set([
  'get_today_overview',
  'get_project_board',
  'search_mails',
  'list_projects',
]);
const WIDGET_DATA_MAX_CHARS = 8_000;
```

Dans `onEvent`, branche `tool_end` : après le `send` existant et l'audit, si `WIDGET_TOOLS.has(event.name) && !event.isError && event.output.length <= WIDGET_DATA_MAX_CHARS`, `try { send({ type: 'tool_result', tool: event.name, data: JSON.parse(event.output) }); } catch { /* sortie non-JSON : pas de widget */ }`.

- [ ] **Step 3: Route — confirmer** — signature `(description, tool)` ; `confirm_request` émis avec `tool` ; l'audit `assistant_gate` utilise `tool` directement (suppression du `description.split(' ')[0]` — suivi revue 2a Minor 3).

- [ ] **Step 4: Tests schéma** (tool_result accepté, confirm_request sans tool refusé) ; suites vertes ; commit `feat(assistant): structured tool_result SSE events`.

---

### Task 4: Test d'intégration du confirmer (route)

**Files:**

- Create: `apps/web/app/api/assistant/chat/route.test.ts`

Suivi revue finale 2a (Important 1). Mocks `vi.hoisted` : `@/lib/auth` (ctx), `@/lib/csrf`, `@/lib/rate-limit`, `@/lib/audit`, `@/lib/assistant/tools` (registry avec UN tool gated factice + un tool lecture factice), `@/lib/assistant/provider` (provider scripté : tool_use gated → end_turn), `@/lib/assistant/confirm-store` (store contrôlable : `createPending` → 'a'.repeat(32), `awaitAnswer` résolu par le test), `@nexushub/db` (workspace.findUnique).

Cas minimum :

1. Happy path gated : POST → lire le stream SSE complet → séquence contient `confirm_request {id, tool, description}` puis `confirm_resolved {allowed:true}` puis `done` ; le handler du tool a tourné ; audits `assistant_gate` (tool + allowed) et `assistant_turn` appelés.
2. Deny : awaitAnswer → false → tool jamais exécuté, `confirm_resolved {allowed:false}`.
3. `awaitAnswer` rejette → `confirm_resolved {allowed:false}` émis quand même (invariant), tool non exécuté, turn continue.
4. tool_result émis pour un tool whitelisté avec sortie JSON, absent pour sortie > 8 000 chars.

Vert + commit `test(assistant): chat route confirmer integration coverage`.

---

### Task 5: Read tools — corps de mail paresseux + reliquats

**Files:**

- Modify: `apps/web/lib/assistant/tools/read-tools.ts` + test

- [ ] **Step 1: `read_mail` paresseux** — quand le mail est trouvé mais `bodyText` ET `bodyHtmlSanitized` sont null/inutilisables : appeler `fetchMailBody({ emailId })` (`@/features/communications/actions/fetch-mail-body` — il revalide ownership en interne et met la DB en cache) ; `ok:true` → utiliser son `bodyText`/`bodyHtmlSanitized` ; `ok:false` → renvoyer `Erreur : ${message}` (messages déjà montrables). Cap 5000 conservé. Tests : body null + fetch ok → corps renvoyé ; fetch ko → message ; body déjà présent → fetchMailBody PAS appelé.
- [ ] **Step 2: `get_team_members`** — `orderBy: { user: { email: 'asc' } }` (suivi 2a Minor 4). Test pinné.
- [ ] **Step 3:** vert + commit `feat(assistant): lazy mail body loading in read_mail`.

---

### Task 6: Refine calendaire sur les dates des tools kanban

**Files:**

- Modify: `apps/web/lib/assistant/tools/kanban-tools.ts` + test

Suivi revue 2a (residual I2) : sur `set_card_due_date.dueDate` et `create_project.startDate/endDate`, compléter le regex par `.refine((d) => d === null || !Number.isNaN(new Date(d).getTime()), 'Date invalide.')` (adapter au nullable/optional de chaque champ). Tests : `'2026-02-30'` rejeté, `'2026-08-01'` accepté. Vert + commit `fix(assistant): reject calendar-invalid dates in tool schemas`.

---

### Task 7: Tools mail (`mail-tools.ts`)

**Files:**

- Create: `apps/web/lib/assistant/tools/mail-tools.ts` + test
- Modify: `apps/web/lib/assistant/tools/index.ts`

5 tools via `defineTool`, handlers en `safeMutation`-équivalent (réutiliser le wrapper : l'extraire de kanban-tools vers un module partagé `tools/safe-mutation.ts` si nécessaire — petite refacto autorisée, testée).

| Tool                  | Gate     | Wrappe                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_my_mailboxes`   | ⚡       | `prisma.integration.findMany({ where: { workspaceId, ownerUserId: ctx.userId, kind: { in: ['graph','imap'] }, status: 'active' }, select: { id, kind, externalAccountLabel, externalAccountId } })` — JAMAIS `encryptedTokens`. Sortie : `[{ integrationId, kind, label }]` (label = externalAccountLabel ?? externalAccountId ?? kind). Description : « nécessaire avant create_mail_draft / send_mail ».                                   |
| `create_mail_draft`   | ⚡       | `saveDraft` (`@/features/communications/actions/mail-drafts`) avec `kind:'new_mail'`. Input : fromIntegrationId (uuid), toRecipients (array email 1..20), cc/bcc optionnels, subject (≤998), bodyHtml (≤100_000 côté tool). Description : « ATTENTION : un seul brouillon par utilisateur — écrase le brouillon en cours ; visible dans Communications ». Sortie ok : `{ draftSaved: true, id }` + rappel qu'il faut send_mail pour envoyer. |
| `prepare_reply_draft` | ⚡       | `saveDraft` avec `kind:'reply'` + `replyToId` (uuid du mail d'origine). Mêmes champs. Description : pour « discuter des réponses » — itérer sur le texte AVANT de sauver.                                                                                                                                                                                                                                                                    |
| `send_mail`           | 🛑 gated | `sendMail` (`.../send-mail`). Input : fromIntegrationId, mode ('new_mail'\|'reply'\|'reply_all'), replyToId?, to/cc/bcc, subject, bodyHtml. Mapping des `code` d'échec → messages FR (RATE_LIMIT → « quota d'envoi atteint, réessayez plus tard », MAILBOX_NOT_FOUND → « boîte introuvable ou non connectée », SMTP_NOT_CONFIGURED, etc.). Sortie ok : `{ sent: true, emailMessageId }`. **`describeForConfirm`** : voir Step 2.             |
| `mark_email_read`     | ⚡       | `markEmailRead` (`.../mark-email-read`).                                                                                                                                                                                                                                                                                                                                                                                                     |

- [ ] **Step 1: Tests d'abord** (mocks des modules d'actions) : catalogue (5 noms, seul send_mail gated) ; list_my_mailboxes scoping ownerUserId + jamais encryptedTokens dans le select (assertion sur l'arg Prisma) ; create_mail_draft passe kind new_mail ; send_mail mapping d'un code d'échec ; describeForConfirm de send_mail (voir Step 2) ; parité jsonSchema/Zod (réutiliser le helper du test kanban).

- [ ] **Step 2: `describeForConfirm` de send_mail** — JAMAIS le bodyHtml brut dans la description :

```ts
describeForConfirm: (input) => {
  const to = input.toRecipients.join(', ');
  const extra = input.ccRecipients?.length ? ` (+${input.ccRecipients.length} cc)` : '';
  const excerpt = input.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return `Envoyer un mail à ${to}${extra} — objet « ${input.subject} » : ${excerpt}…`;
},
```

Test : la description contient destinataires + objet + extrait, PAS de balise HTML, longueur bornée.

- [ ] **Step 3: Enregistrer** dans `tools/index.ts` après kanban. Vert + commit `feat(assistant): mail tools with human-readable send confirmation`.

---

### Task 8: Widgets — composants

**Files:**

- Create: `apps/web/features/assistant/components/widgets/kpi-cards.tsx` (+ test)
- Create: `apps/web/features/assistant/components/widgets/board-widget.tsx` (+ test)
- Create: `apps/web/features/assistant/components/widgets/mail-list-widget.tsx` (+ test)
- Create: `apps/web/features/assistant/components/widgets/project-list-widget.tsx` (+ test)
- Create: `apps/web/features/assistant/components/widgets/index.tsx` (+ test) — le dispatcher

Chaque widget : composant pur, props = `data: unknown`, **parse Zod local** (schéma du shape produit par le tool correspondant — copier depuis les sorties réelles des tools) ; parse KO → `null` (pas de crash, le texte du modèle reste). Tokens design system exclusivement. Détails :

- `KpiCards` (get_today_overview) : rangée de 4 `MetricCard` (`@nexushub/ui`) — Bloquées (valueTone 'danger' si >0), Dues aujourd'hui, Mails non lus, Notifications.
- `BoardWidget` (get_project_board) : nom du projet + colonnes en flex horizontal scrollable ; par colonne : nom, compteur, jusqu'à 5 cartes (titre tronqué, échéance colorée `--color-danger` si colonne bloquée), « +N autres » ; lien `/projects/{id}`.
- `MailListWidget` (search_mails) : lignes expéditeur / objet / date relative / pastille non-lu (`--accent-primary`), max 10, lien `/communications`.
- `ProjectListWidget` (list_projects) : cartes compactes nom + client + nb cartes, lien `/projects/{id}`.
- `index.tsx` : `renderWidget(tool: string, data: unknown): ReactNode | null` — switch sur le nom du tool, sinon null.

Tests : chaque widget avec data valide (rendu des éléments clés) et data invalide (null, silencieux) ; dispatcher route les 4 noms et renvoie null pour un inconnu.

Vert + commit `feat(assistant): result widgets (kpi, board, mails, projects)`.

---

### Task 9: Intégration widgets dans le chat

**Files:**

- Modify: `apps/web/features/assistant/components/assistant-chat.tsx` + test

- [ ] **Step 1:** État : `streamWidgets: { tool: string; data: unknown }[]` ; événement `tool_result` → append. `DisplayMessage` gagne `widgets?: { tool: string; data: unknown }[]` ; au commit (done/partiel), les widgets accumulés sont attachés au message assistant puis `streamWidgets` reset (aussi dans le `finally`).
- [ ] **Step 2:** Rendu : dans la bulle assistant (et sous le streamText), après le texte : `message.widgets?.map(w => renderWidget(w.tool, w.data))`. Les widgets pendant le stream s'affichent sous la bulle streamée (hors aria-live).
- [ ] **Step 3:** Dialog : le titre utilise l'événement `confirm_request.tool` (« ⚡ Confirmation — send_mail » devient un libellé FR par tool via un petit map, fallback nom brut).
- [ ] **Step 4:** Tests : stream avec tool_result get_today_overview → KPI rendues pendant le stream et persistées après done ; tool_result inconnu → rien ; historyRef ne contient JAMAIS les widgets (payload texte uniquement — assertion sur le body du fetch suivant).
- [ ] **Step 5:** vert + commit `feat(assistant): render structured widgets in chat thread`.

---

### Task 10: Vérification de bout en bout

1. `pnpm typecheck && pnpm lint && pnpm test` — tout vert (agent 100 %).
2. Manuel (`pnpm dev`) : « mon briefing » → cartes KPI dans le fil ; « montre le Kanban de X » → mini-board ; « mails non lus » → liste ; « lis le mail de Y » → corps chargé paresseusement ; « prépare une réponse » → brouillon visible dans Communications ; « envoie-le » → dialog avec destinataires/objet/extrait → Autoriser → envoyé (vérifier audit `assistant_gate {tool:'send_mail'}`).
3. progress.md + CLAUDE.md §11. Commit final.

---

## Self-review

- **Couverture** : feedback utilisateur #1 (widgets, Tasks 3+8+9), #3 (corps mails + réponses, Tasks 5+7) ; suivis revue 2a : atomic answer (T2), test intégration confirmer (T4), describeAction coupling (T1+T3), orderBy (T5), refine calendaire (T6). Hors scope : clients/contacts/team tools (2c ou fold Plan 3), split read-tools par domaine (opportuniste si un fichier est touché).
- **Placeholders** : les contrats sont complets ; le code des mécanismes nouveaux est fourni ; les shapes widgets se lisent dans les sorties des tools existants (référencés).
- **Types** : `tool_end.output` (T1) consommé par la route (T3) ; `tool_result` (T3) consommé par le chat (T9) via `renderWidget` (T8) ; `Confirmer(description, tool)` (T1) aligné route (T3) et tests intégration (T4).
