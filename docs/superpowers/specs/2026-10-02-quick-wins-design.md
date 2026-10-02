# Lot A — Quick wins (renommage projet, widget « Mes cartes », filtre perso, palette clients, calendrier terminé)

- **Date :** 2026-10-02
- **Branche / worktree :** `feature/optim` — `.worktrees/optim`
- **Statut :** validé en brainstorming (Angelo L.)
- **Hors périmètre :** Dark mode (lot B) et pièces jointes de cartes (lot C) — specs séparées.

## Contexte

Retours utilisateurs regroupés en 7 points, découpés en 3 lots. Ce lot A couvre les 5 points petits et
indépendants. Chaque point s'appuie sur de l'existant :

| #   | Besoin                                         | Existant réutilisé                                                                  |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Renommer rapidement un projet                  | `updateProjectCore` (`features/projects/lib/project-core.ts`), `NameSchema`         |
| 2   | Widget « Mes cartes » → calendrier             | `getOverviewMetrics`, `MetricCard`, table `CardAssignee`, `/projects/calendar`      |
| 3   | Filtrer ses cartes dans un projet              | `card-filter.ts` (`asg`), `project-filters-bar.tsx`                                 |
| 4   | Palette clients plus large + couleur libre     | `CLIENT_COLOR_TOKENS`, `tokens.css`, `ClientDot` (accepte déjà une couleur littérale) |
| 5   | Calendrier : carte en dernière colonne barrée  | `isLastUserColumn` (`packages/domain/src/kanban`)                                   |

## 1. Renommer un projet

**UX**

- Composant client `ProjectTitleEditor` (`features/projects/components/project-title-editor.tsx`).
- Mode lecture : titre + bouton crayon (`aria-label` « Renommer le projet »).
  - Sur la carte `/projects` : crayon visible au survol / focus (`group-hover`, `focus-visible`), positionné
    **hors** du `<Link>` (même pattern que `DeleteProjectButton`) pour ne pas déclencher la navigation.
  - Dans le header `/projects/[id]` : crayon à droite du `<h1>`, visible au survol / focus.
- Mode édition : `<input>` pré-rempli, focus + sélection du texte.
  - Entrée ou blur → enregistre. Échap → annule et restaure.
  - Valeur trimée vide ou identique → aucun appel, retour en lecture.
- Mise à jour optimiste ; en cas d'erreur, rollback + toast d'erreur (système de toasts app existant).

**Serveur**

- Server Action `features/projects/actions/update-project-name.ts` :
  `requireUser` → validation Zod `{ projectId: uuid, name: NameSchema }` → CSRF double-submit (pattern des
  actions existantes) → `updateProjectCore(ctx, { projectId, name })` → `revalidatePath('/projects')` et
  `revalidatePath('/projects/[id]', 'layout')`.
- Permissions : celles de `updateProjectCore` (viewer refusé, scope workspace). Aucune règle nouvelle.
- Audit : aucun (`updateProjectCore` n'audite pas, et le renommage ne figure pas dans la liste §4.7.3 des
  événements audités).

## 2. Widget « Mes cartes » (Overview)

**Métrique**

- `getOverviewMetrics` retourne en plus `myOpenCards` et `myOverdueCards`, dans le même `$transaction`.
- **Carte ouverte** = `deletedAt: null`, `archivedAt: null`, `assignees: { some: { userId } }` (tout rôle RACI),
  et **pas** dans la dernière colonne utilisateur de son projet. Les cartes en colonne Bloqué **comptent**
  (elles sont ouvertes et en retard).
- **En retard** = carte ouverte avec `dueDate < now()`.
- Le scope existant (`scopedCardWhere`) et le filtre client actif (`clientId`) s'appliquent.
- Exclusion de la dernière colonne : on charge les colonnes (`id`, `projectId`, `position`, `isBlockedSystem`)
  des projets accessibles, on calcule l'id de dernière colonne utilisateur par projet via `isLastUserColumn`,
  puis `columnId: { notIn: lastColumnIds }`.
  - Helper pur dans `packages/domain/src/kanban` : `lastUserColumnIds(columns) → string[]` (testé 100 %).

**UI**

- `MetricCard` (`packages/ui`) accepte `href?: string`. Avec `href`, la carte est rendue comme un lien
  (focus visible, hover). Sans `href`, rendu inchangé. Story Storybook mise à jour (variante lien).
- Libellé « Mes cartes », valeur `myOpenCards`, sous-ligne « dont X en retard » (tonalité `danger` si X > 0),
  traduite FR/EN (ICU pluriel).
- Clic → `/projects/calendar?mine=1` (+ `&client=<slug>` si filtre client actif).

## 3. Bascule « Mes cartes »

- Nouveau paramètre URL `mine=1`, parsé par `parseProjectCardFilter` / écrit par `writeProjectCardFilter`.
- Côté serveur, `buildCardFilterClauses` ajoute `assignees: { some: { userId: <session.userId> } }`.
  L'id utilisateur provient **exclusivement** de la session (`requireUser`), jamais de l'URL.
- Combinable avec tous les autres filtres (dont `asg`, en ET logique).
- UI : bouton bascule « Mes cartes » (`aria-pressed`) dans `project-filters-bar` → présent dans les vues
  Kanban, Liste et Calendrier d'un projet. Compte dans l'indicateur « filtres actifs » / « Réinitialiser ».
- Calendrier global `/projects/calendar` : supporte `mine=1` et affiche la même bascule (destination du
  widget #2). Le paramètre est conservé par la navigation mois précédent/suivant.

## 4. Palette clients

**Tokens**

- `CLIENT_COLOR_TOKENS` passe de 5 à 12 : les 5 existants + `c-red`, `c-orange`, `c-lime`, `c-teal`,
  `c-cyan`, `c-indigo`, `c-slate`.
- `tokens.css` : valeur claire **et** valeur sombre (`[data-theme='dark']`) pour chacun, + alias `--c-*`.
- `ClientColorToken` (`packages/ui/src/atoms/ClientDot.tsx`) et la classe CSS par token
  (`components.css`) étendus. La liste locale dupliquée de `client-form.tsx` est supprimée au profit d'une
  source unique (tokens + libellés traduits).

**Couleur libre**

- Dans `client-form`, après les 12 pastilles, un bouton « + » (`aria-label` « Couleur personnalisée »)
  ouvre un `<input type="color">`. La couleur choisie devient la sélection courante et apparaît comme
  13e pastille.
- Stockage : la valeur `#rrggbb` (minuscule) est enregistrée telle quelle dans `Client.colorToken`
  (`VarChar(32)` → **pas de migration**).
- Validation Zod : `z.union([z.enum(CLIENT_COLOR_TOKENS), z.string().regex(/^#[0-9a-f]{6}$/)])`,
  après normalisation en minuscules.

**Rendu unifié**

- Helper pur `resolveClientColor(value)` dans `packages/domain/src/clients` :
  - token connu → `{ background: 'var(--color-<token>)', foreground: <token fg> }` ;
  - hex valide → `{ background: hex, foreground: '#000' | '#fff' }` choisi par contraste WCAG (luminance
    relative, ratio le plus élevé) ;
  - valeur inconnue → repli sur `c-acme`.
- `ClientDot`, `ClientMono` (gradients codés en dur remplacés : gradient dérivé pour les tokens, aplat
  pour les hex) et les autres consommateurs de `colorToken` passent par ce helper.

## 5. Calendrier : carte terminée barrée

- `CalendarCardItem` gagne `isDone: boolean`, calculé côté serveur : la colonne de la carte est la dernière
  colonne utilisateur de son projet (helper `lastUserColumnIds` du §2).
- Calendrier projet (`/projects/[id]/calendar`) : colonnes du projet déjà disponibles.
- Calendrier global (`/projects/calendar`) : chargement des colonnes des projets présents dans le mois.
- `calendar-item` : classe `done` → titre `line-through`, opacité réduite ; texte accessible « (terminée) »
  pour les lecteurs d'écran. Une carte à la fois `done` et bloquée est impossible (dernière colonne jamais
  bloquée, §6.3).

## Tests

- **Domain (Vitest, 100 %)** : `lastUserColumnIds`, `resolveClientColor` (tokens, hex clair/sombre,
  invalide), liste des 12 tokens.
- **Web (Vitest)** : `parseProjectCardFilter` / `writeProjectCardFilter` avec `mine`, `buildCardFilterClauses`
  (userId de session), schéma Zod couleur client, `getOverviewMetrics` (exclusion dernière colonne, Bloqué
  inclus, filtre client), Server Action `updateProjectName` (succès, nom vide, viewer refusé).
- **Composants** : `ProjectTitleEditor` (Entrée, Échap, blur, rollback erreur), `MetricCard` avec `href`.
- **E2E (Playwright)** : renommer un projet depuis le header ; clic widget « Mes cartes » → calendrier
  filtré.

## Risques & notes

- Couleur libre : contraste garanti pour le texte (helper), pas pour la distinction entre deux clients
  aux teintes proches — acceptable.
- Couleurs libres et dark mode (lot B) : un hex est rendu identique en clair et en sombre. Le lot B pourra
  ajuster la luminosité si nécessaire.
- Aucune migration DB dans ce lot.
