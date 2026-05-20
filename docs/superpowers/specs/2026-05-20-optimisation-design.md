# Optimisations — Design Spec

> **Date** : 2026-05-20
> **Branche** : `optimisation`
> **Scope** : 4 améliorations indépendantes (Kanban « terminé », deadline fin-de-journée, login=landing, éditeur de commentaire WYSIWYG)

## Vision

Quatre ajustements UX/produit sans lien fonctionnel direct, regroupés sur une même branche. Chacun est isolé et testable séparément.

| #   | Sujet                             | Décision                                                                      |
| --- | --------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Carte dernière colonne = terminée | Visuel Kanban (check plein + titre barré) ; l'exemption Bloqué est déjà codée |
| 2   | Deadline à fin de journée         | Comparaison par jour calendaire Europe/Paris, pas de migration                |
| 3   | Login = landing                   | `/` redirige (authentifié → `/overview`, sinon → `/login`)                    |
| 4   | Éditeur de commentaire            | Tiptap WYSIWYG, stockage **Markdown** (compat. existant)                      |

> Note utilisateur « prendre la version payante de Vercel » : hors-scope, ignorée.

---

## 1. Visuel « terminé » dans le Kanban

### Constat

- Le domaine exempte **déjà** la dernière colonne user du passage auto en Bloqué : `shouldMoveToBlocked` (`packages/domain/src/kanban/index.ts`) retourne `false` si `isLastUserColumn(current, columns)`. Rien à corriger côté routage.
- La **list view** affiche déjà, pour une carte en dernière colonne : `CardCompletedBadge` (check plein) + titre `line-through` grisé (`apps/web/features/projects/components/list-view.tsx` ~L363-376).
- Le **Kanban** affiche toujours `CardAdvanceCheckbox` (désactivé en dernière colonne) et ne barre jamais le titre.

### Changement

Aligner le Kanban sur la list view :

- `KanbanCard` reçoit un nouveau prop `isLastUserColumn: boolean`.
- Si `isLastUserColumn` → rendre `CardCompletedBadge` (composant existant, réutilisé tel quel) à la place de `CardAdvanceCheckbox`, et appliquer `line-through` + couleur muted au `.kcard-title`.
- Sinon → comportement actuel inchangé (`CardAdvanceCheckbox`).

### Câblage

`kanban-board.tsx` connaît déjà `lastUserColumnId` (passé à `kanban-column` en L259). Il faut le propager :
`KanbanBoard` → `KanbanColumn` → `KanbanCard`. Le `DragOverlay` (rendu transient de la carte en cours de drag) reçoit aussi le flag.

Aucune donnée serveur nouvelle : l'état « terminé » est dérivé de `card.columnId === lastUserColumnId`, comme en list view.

### Tests

- Domaine : ajouter/confirmer un test `shouldMoveToBlocked` → `false` pour une carte en dernière colonne user avec échéance dépassée.
- (UI Kanban non testée unitairement — cohérent avec le reste du Kanban ; vérif visuelle au smoke test.)

---

## 2. Deadline considérée à fin de journée (Europe/Paris)

### Constat

- Les échéances sont saisies via un input date (`YYYY-MM-DD`) et stockées par `new Date(v)` → minuit UTC (`checklist-schemas.ts` `UpdateCardDueDateSchema`).
- Le routage Bloqué compare l'instant : `card.dueDate.getTime() >= now.getTime()` → une carte due « aujourd'hui » est en retard dès 00h01.
- Le **filtre** « En retard » (`card-filter.ts`) utilise déjà `dueDate < startOfTodayUtc()` (donc « due aujourd'hui » n'est pas en retard) — comportement déjà proche du souhait, mais en UTC.

### Changement

Nouveau helper **domaine pur** (DST-safe, via `Intl`, pas de calcul d'offset) :

```ts
// packages/domain/src/kanban/index.ts (ou un util date dédié)
const DUE_TIME_ZONE = 'Europe/Paris';

/** "YYYY-MM-DD" du jour calendaire d'une date dans la TZ donnée. */
function calendarDayInTz(d: Date, timeZone: string): string {
  // en-CA donne le format ISO YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Une échéance est « dépassée » quand le jour calendaire courant (Paris)
 * est strictement après le jour calendaire de l'échéance (Paris).
 * → due le 20/5 devient en retard le 21/5 à 00h00 Paris.
 */
export function isDueDateOverdue(
  dueDate: Date,
  now: Date,
  timeZone: string = DUE_TIME_ZONE,
): boolean {
  return calendarDayInTz(now, timeZone) > calendarDayInTz(dueDate, timeZone);
}
```

Utilisation :

- `shouldMoveToBlocked` : remplacer `if (card.dueDate.getTime() >= now.getTime()) return false;` par `if (!isDueDateOverdue(card.dueDate, now)) return false;`.
- `shouldRestoreFromBlocked` : remplacer `return card.dueDate.getTime() >= now.getTime();` par `return !isDueDateOverdue(card.dueDate, now);` (on restaure tant que l'échéance n'est pas dépassée).
- **Cohérence filtre** : `card-filter.ts` mode `overdue` → comparer au start-of-today **Paris** plutôt qu'UTC. Ajouter un helper `startOfTodayInParis()` (instant UTC correspondant à 00h00 Paris du jour courant) et l'utiliser dans la clause `{ dueDate: { lt: ... } }`. (Décalage marginal mais évite qu'une carte « due aujourd'hui » apparaisse en retard entre minuit UTC et minuit Paris.)

Comparaison par chaîne `YYYY-MM-DD` : sûre lexicographiquement (format ISO), gère le DST automatiquement (Intl), aucune arithmétique d'offset.

**Pas de migration** : le stockage des échéances ne change pas.

### Tests

- `isDueDateOverdue` : due aujourd'hui (Paris) → `false` ; due hier → `true` ; instants autour de minuit Paris ; cas DST (mars/octobre) ; due dans le futur → `false`.
- `shouldMoveToBlocked` / `shouldRestoreFromBlocked` : scénarios « due aujourd'hui ne bloque pas », « due hier bloque », « repousser au futur restaure ».

---

## 3. Login comme page d'accueil

### Constat

`apps/web/app/page.tsx` est une page marketing « bootstrap en cours » avec un bouton « Se connecter » → `/login`. La page de login (`app/(auth)/login/page.tsx`) existe et gère `?next=`.

### Changement

Remplacer `app/page.tsx` par un Server Component qui redirige sans rien rendre :

```tsx
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';

export default async function HomePage() {
  const ctx = await getAuthContext(); // null si non authentifié (ne throw pas)
  redirect(ctx ? '/overview' : '/login');
}
```

- Utilise `getAuthContext()` (variante non-throwing déjà existante dans `lib/auth`) — pas `requireUser()` qui redirige déjà vers `/login`.
- Supprime tout le contenu welcome + le bouton.
- `redirect()` lève par conception (type `never`) → pas de JSX à retourner.

### Tests

Pas de test unitaire (page de redirection triviale). Vérif au smoke : `/` non connecté → `/login` ; `/` connecté → `/overview`.

---

## 4. Éditeur de commentaire WYSIWYG (Tiptap, stockage Markdown)

### Constat

`CommentEditor` (`apps/web/features/projects/components/comment-editor.tsx`) est un `<textarea>` ; les boutons B/I/U/lien insèrent du Markdown brut (`**bold**`, `<u>`, `[label](url)`). Le body est stocké en Markdown et rendu via `@nexushub/integrations/markdown` (`marked` + `sanitize-html`).

### Changement

Remplacer le textarea par un éditeur **Tiptap** (WYSIWYG), **en conservant le Markdown comme format de stockage** pour ne rien casser en aval.

**Dépendances** (versions à valider via Context7 avant install) :
`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-underline`, `@tiptap/extension-link`, `tiptap-markdown`.

**Schéma restreint** à la whitelist du sanitizer (`renderMarkdownToSafeHtml` autorise : `p, br, strong, em, u, code, pre, blockquote, ul, ol, li, a`). Configurer StarterKit pour **désactiver** ce qui sort de la whitelist (titres, image, horizontal rule, etc.) et activer : bold, italic, code, codeBlock, blockquote, bulletList, orderedList, listItem, hardBreak, paragraph. Ajouter `Underline` + `Link` (avec `openOnClick: false`, `autolink`, protocoles `https`/`mailto`).

**Intégration formulaire** (les Server Actions lisent `body` depuis `FormData`, inchangées) :

- L'éditeur Tiptap est un composant client contrôlé. Un `<input type="hidden" name="body">` reçoit, à chaque `onUpdate`, la sérialisation Markdown du document (`editor.storage.markdown.getMarkdown()`).
- `CommentEditorHandle` garde `clear()` (vider le doc + l'input caché) et `focus()`.
- Raccourcis Cmd/Ctrl+Enter (submit), B/I/U/K : Tiptap gère nativement B/I/U/K via ses extensions ; on conserve le hook Cmd/Ctrl+Enter pour `onSubmitShortcut`.

**Toolbar** : mêmes 4 boutons (gras, italique, souligné, lien) ; ils togglent les marks Tiptap (`editor.chain().focus().toggleBold().run()`, etc.) au lieu d'insérer du Markdown. État actif reflété (bouton mis en évidence quand le mark est actif sur la sélection).

**Mode édition** : préremplir l'éditeur en parsant le Markdown stocké (`tiptap-markdown` parse à l'initialisation via `content` + extension Markdown).

**SSR / Next 15** : `useEditor({ immediatelyRender: false, ... })` pour éviter le mismatch d'hydratation (Tiptap rend côté client uniquement).

**Compatibilité** : les commentaires existants (Markdown) sont parsés à l'identique ; le rendu en lecture (`bodyHtml` via sanitize-html) ne change pas. `underline` non standard en Markdown → `tiptap-markdown` le sérialise en `<u>…</u>`, déjà autorisé par le sanitizer.

### Styles

Adapter `.nx-comment-editor*` : la zone d'édition devient la surface Tiptap (`.ProseMirror`) au lieu du textarea ; conserver la toolbar et les bordures arrondies. Styles minimaux pour le contenu rendu dans l'éditeur (gras/italique/listes/citation/code).

### Tests

- L'éditeur Tiptap est un composant client riche → pas de test unitaire (cohérent avec les autres composants UI du projet). Couverture par smoke manuel : taper du texte, appliquer gras/italique/souligné/lien, vérifier qu'aucun `**` n'apparaît, envoyer, vérifier le rendu, éditer un commentaire existant.
- Le helper markdown (`@nexushub/integrations/markdown`) est déjà couvert (21 tests) et inchangé.

---

## Hors-scope

- Mentions @, réactions, temps réel (déjà listés hors-V1 dans le spec card-comments).
- Migration des échéances existantes (inutile : la comparaison par jour calendaire gère le stock existant).
- Plan payant Vercel (note utilisateur, sans action code).

## Risques connus

- **Tiptap + bundle Next** : ProseMirror est conséquent (~plusieurs dizaines de Ko). Acceptable pour un éditeur ; chargé uniquement dans le modal carte (client). Vérifier que le build Vercel passe (pas de souci SSR attendu avec `immediatelyRender: false`).
- **Round-trip Markdown ↔ Tiptap** : un Markdown exotique d'un ancien commentaire pourrait se re-sérialiser légèrement différemment à l'édition. Risque faible vu la whitelist réduite ; le contenu reste sémantiquement équivalent.
- **Fuseau deadline** : on fige Europe/Paris en V1 (pas encore de TZ par utilisateur). Si la TZ par user arrive plus tard (Settings), passer `timeZone` au helper.

## Documentation associée

- Domaine Kanban : `packages/domain/src/kanban/index.ts`
- Reconcile-on-read : `apps/web/features/projects/lib/reconcile.ts`
- Filtre cartes : `apps/web/features/projects/lib/card-filter.ts`
- Éditeur actuel : `apps/web/features/projects/components/comment-editor.tsx`
- Rendu markdown : `packages/integrations/src/markdown/index.ts`
- Mémoire pipeline deploy/migrations : `.claude/memory/reference_deploy_migrations.md`
