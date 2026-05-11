# Spec — Refonte `/templates/cards`

> Date : 2026-05-11 · Auteur : Angelo L. + Claude (Opus 4.7) · Statut : à valider

## 1. Contexte et motivation

La page actuelle `/templates/cards` est l'éditeur des templates de carte (modèles de tâches structurées). Elle souffre de plusieurs problèmes d'UX :

1. **Densité verticale** — la liste des champs s'étend en accordéon, l'expansion inline d'un champ pousse les autres champs hors du viewport.
2. **Hiérarchie floue** — les boutons "Enregistrer" et "Supprimer le template" sont noyés en bas, sans dirty state visible.
3. **Deux flux d'ajout** — "Ajout rapide" (champs prédéfinis) et "Champ personnalisé" sont mentalement disjoints alors que l'utilisateur veut juste "ajouter un champ".
4. **Pas d'aperçu** — l'auteur du template ne voit le résultat qu'en allant créer une carte dans un projet.
5. **Concepts secondaires en surface** — la notion de `group` (`overview` / `details` / `notes` / `custom`) est exposée à l'utilisateur alors qu'elle n'est utilisée nulle part pour le rendu.

L'objectif est une refonte qui rend l'auteur de template **direct, visuel et clair** : tu vois ce que tu construis, tu réorganises en glissant, tu n'as qu'un seul bouton "+ Ajouter un item".

## 2. Décisions structurantes (validées en brainstorming)

| #   | Décision                                                                                    |
| --- | ------------------------------------------------------------------------------------------- |
| A   | Layout 3 colonnes : Liste templates · Éditeur · Aperçu live                                 |
| A1  | Aperçu = fidèle au modal carte de `/projects`, données placeholder                          |
| B3  | Édition d'un item dans un **drawer** qui slide depuis la **gauche** (recouvre la colonne 1) |
| C1  | Réorganisation des items via **drag & drop** (@dnd-kit, déjà utilisé pour le Kanban)        |
| D1  | Suppression de la notion `group` du domain                                                  |
|     | Ajout d'un nouveau type d'item **`section`** (label seul, divider visuel)                   |
| E2  | La description de la carte devient un **item système** drag-and-droppable dans la liste     |
| F2  | Édition dans le drawer en **live update** (pas de bouton Appliquer/Annuler)                 |
| G1  | Sauvegarde **explicite** via bouton "Enregistrer" en haut de l'éditeur (avec dirty state)   |

## 3. Architecture

### 3.1 Modèle de données

#### Avant

```ts
// CardTemplate.fields: JSONB
type CardField = {
  id: string;
  type: 'text' | 'longtext' | 'select' | 'link' | 'checkbox' | 'date' | 'number';
  label: string;
  group?: 'overview' | 'details' | 'notes' | 'custom';
  options?: string[];
  placeholder?: string;
};

// CardTemplate.descriptionPosition: TEXT
type DescriptionPosition = 'before-fields' | 'after-fields' | 'hidden';
```

#### Après

```ts
// CardTemplate.items: JSONB (remplace fields + descriptionPosition)
type CardTemplateItem =
  | {
      id: string;
      type: 'text' | 'longtext' | 'select' | 'link' | 'checkbox' | 'date' | 'number';
      label: string;
      options?: string[]; // select only
      placeholder?: string;
    }
  | {
      id: string;
      type: 'section';
      label: string;
    }
  | {
      id: 'description'; // singleton id réservé
      type: 'description';
    };
```

**Invariants** :

- L'item `description` est singleton — au plus un par template, id figé à `'description'`.
- L'ordre du tableau `items` détermine l'ordre de rendu dans la carte.
- `Card.fieldValues` reste indexé par `item.id` (clés `id` des items de type input). Pas de changement de schéma sur la carte.

#### Migration

1. Ajouter colonne `items JSONB NOT NULL DEFAULT '[]'` à `card_templates`.
2. Migration de données ponctuelle. Comme la transformation (strip `group` de chaque field, insérer le marker description à la position dictée par `description_position`) est complexe à faire en SQL pur, on l'exécute en **TypeScript via un script `prisma/migrations-data/2026-05-11-card-template-items.ts`** lancé entre les deux migrations de schéma. Le script :
   - lit chaque `card_template` avec `fields` et `description_position`,
   - applique en mémoire : `items = fields.map(({ group, ...rest }) => rest)` avec injection du marker `{ id: 'description', type: 'description' }` à la bonne position selon `description_position` (en début pour `before-fields`, en fin pour `after-fields`, omis pour `hidden`),
   - persiste via `UPDATE card_templates SET items = $1 WHERE id = $2`.
     Le script est idempotent : il ne ré-écrit pas si `items` est déjà non-vide.
3. Une fois le code basculé et déployé, drop des colonnes `fields` et `description_position` (migration suivante).

### 3.2 Couche domain (`packages/domain/src/card-templates/`)

- Renommer `CardField` → `CardTemplateItem` avec la nouvelle union.
- Nouveau validator `validateCardTemplateItems(items: unknown): readonly CardTemplateItem[]` qui :
  - rejette plus d'un item de type `description`,
  - assure l'unicité des `id` (sauf le singleton `'description'`),
  - valide la forme par type (options requis pour select, etc.),
  - normalise les labels (trim, longueur max).
- `pruneFieldValues(values, items)` adapté pour ignorer les items `section` et `description` (ils n'ont pas de valeur stockée).
- `defaultLabelForType(type, lang)` pour générer les labels par défaut à la création (`"Nouveau champ texte"`, `"Nouvelle section"`).
- Suppression des constantes/types liés à `group` et `DESCRIPTION_POSITIONS`.

### 3.3 Couche UI

#### Structure de la page

```
app/(app)/templates/cards/page.tsx (server)
└── features/templates/cards/editor-shell.tsx (client)
    ├── TemplatesList (colonne 1)
    ├── TemplateEditor (colonne 2)
    │   ├── EditorHeader (nom + Save + dirty indicator)
    │   ├── ItemsList (dnd-kit)
    │   │   └── ItemRow (poignée, icône, label, badge, actions)
    │   ├── AddItemPopover (+ Ajouter un item)
    │   └── DangerZone (Supprimer)
    ├── TemplatePreview (colonne 3)
    │   └── réutilise un wrapper "preview-mode" autour du composant existant
    │       qui rend la carte dans `/projects` (sans actions interactives)
    └── EditItemDrawer (overlay sur colonne 1, slide depuis la gauche)
        └── champs d'édition dynamiques selon item.type
```

#### Composant `TemplatePreview`

Réutilise les **mêmes classes CSS** que le modal carte de `/projects` pour fidélité 1:1. On extrait du composant `card-modal` actuel un sous-composant "card body" pur (sans header, sans actions, sans drawer interne) :

- Props : `items: CardTemplateItem[]`, `templateName: string`.
- Génère des valeurs placeholder :
  - `text` / `longtext` → "Lorem ipsum dolor sit amet…" tronqué.
  - `select` → première option ou "—".
  - `link` → "https://example.com".
  - `checkbox` → `false`.
  - `date` → date du jour formatée.
  - `number` → "42".
- Description placeholder : "Description de la carte (placeholder)…".
- Aucun submit, aucun appel serveur, aucune action.

#### State management

- `useReducer` local dans `editor-shell.tsx` qui gère :
  - `templates: TemplateDTO[]` (chargé via prop server initial).
  - `selectedId: string | null`.
  - `draft: { name, items } | null` — copie locale du template en édition.
  - `editingItemId: string | null` — pilote le drawer.
  - `isDirty: boolean` — calculé par diff du draft vs. l'original.
- Persistance : bouton "Enregistrer" → server action `updateCardTemplate({ id, name, items })`. Sur succès → met à jour les templates en mémoire et `isDirty = false`.
- Création : "+ Nouveau" → server action `createCardTemplate({ name, items })`, retourne le nouveau template, le sélectionne, ouvre l'éditeur.
- Suppression : confirmation via Radix `AlertDialog` → server action `deleteCardTemplate({ id })`. Gestion d'erreur si template utilisé (message déjà géré côté action).
- Dirty guard V1 : warning natif `window.beforeunload` si `isDirty` (couvre fermeture d'onglet et reload). L'intercept des navigations intra-app via `next/navigation` n'est pas en V1 (l'utilisateur garde la responsabilité de cliquer "Enregistrer" avant de naviguer).

#### Drag & drop

- @dnd-kit `SortableContext` avec `verticalListSortingStrategy` sur `items`.
- `PointerSensor` + `KeyboardSensor` pour accessibilité.
- `useId()` Next pour préfixer les ids (évite mismatch hydration).
- `onDragEnd` → reorder local du draft.

#### Drawer

- Composant `EditItemDrawer` positionné en `absolute` au-dessus de la colonne 1, animation `transform: translateX(-100% → 0)` (Framer Motion).
- Champs rendus selon `item.type` :
  - **text / longtext / link / number** : Label + Placeholder.
  - **select** : Label + Placeholder + éditeur d'options (liste éditable avec drag + suppression + bouton "+ Ajouter une option").
  - **checkbox / date** : Label uniquement.
  - **section** : Label uniquement.
  - **description** : pas de champ éditable (juste un message "Élément système, position contrôlée par drag & drop").
- Champ "Type" en haut (sélecteur) pour basculer le type d'un item — visible **sauf** pour `description` (singleton non-changeable) et `section` (changer une section en input ne fait pas sens, on cache).
- Conversion de type : si l'utilisateur passe `text → select`, on conserve `label` et `placeholder`, on initialise `options: []`. Inverse (`select → text`) : on retire `options`. Les valeurs déjà stockées dans `Card.fieldValues` ne sont pas migrées (elles seront simplement ignorées au rendu si incompatibles, et nettoyées au prochain `changeCardTemplate`).
- Live update : chaque keystroke met à jour le draft via `dispatch({ type: 'updateItem', id, patch })`. L'aperçu se re-render à chaque update.
- Fermeture : croix, touche Escape, ou clic sur la zone hors-drawer (colonnes 2/3 grisées) → ferme. Cliquer sur un autre item dans la liste **bascule** le drawer sur ce nouvel item sans fermeture intermédiaire. Aucun bouton "Annuler" / "Appliquer".
- "Supprimer" en pied de drawer → retire l'item du draft + ferme.

#### Popover "+ Ajouter un item"

- Radix Popover ancré au bouton.
- Liste de types avec icône et libellé :
  - Texte court / Texte long / Liste déroulante / Lien / Case à cocher / Date / Nombre
  - séparateur
  - Section
  - Description (disabled avec hint "déjà présente" si l'item description est déjà dans le draft)
- Clic → génère un `id` (slug du label par défaut + suffix unique via `generateCustomFieldId`), append à la fin de `items`, ouvre le drawer sur ce nouvel item.

## 4. Server actions affectées

- `createCardTemplate({ name, items })` — Zod schema accepte la nouvelle union.
- `updateCardTemplate({ id, name, items })` — Zod schema, validation singleton description.
- `deleteCardTemplate({ id })` — inchangé (déjà géré, refuse si cartes utilisent le template).
- `changeCardTemplate({ cardId, templateId })` — adapter `pruneFieldValues` pour ignorer items section/description.

## 5. Rendu du modal carte (`/projects`)

Le composant `card-modal` actuel boucle sur `templateFields`. À adapter pour boucler sur `items` :

```tsx
{items.map((item) => {
  if (item.type === 'section') return <SectionHeader label={item.label} key={item.id} />;
  if (item.type === 'description') return <DescriptionBlock card={card} key={item.id} />;
  return <FieldInput item={item} value={fieldValues[item.id]} onChange={…} key={item.id} />;
})}
```

Suppression du double bloc conditionnel `descriptionPosition === 'before-fields'` / `after-fields`.

## 6. Hors scope V1

- Responsive < 1280px (toggle aperçu) et < 960px (onglets) — desktop-first V1.
- Copier un item d'un template à un autre — V1.5.
- Versioning / historique des templates — V2+.
- Internationalisation des labels d'item (FR/EN par item) — V1.5.
- Auto-save / restauration — pas en V1 (G1 retenu).
- Undo/Redo dans l'éditeur — pas en V1.

## 7. Tests requis

### Unitaires (`packages/domain`)

- `validateCardTemplateItems` :
  - rejette deux items `description`,
  - rejette ids dupliqués,
  - rejette `select` sans options,
  - normalise labels (trim, max length).
- `pruneFieldValues` ignore section/description, garde les input items, drop les orphan keys.

### Intégration (Vitest + DB de test)

- `createCardTemplate` accepte un payload avec items mélangés (input + section + description).
- `updateCardTemplate` reorder réussit, suppression d'un item supprime aussi les valeurs orphan dans les cartes liées (au prochain change-template).
- Migration : seed avec 3 templates dans l'ancien format, exécution migration, vérifier équivalence des items.

### E2E (Playwright)

- Créer un template, ajouter 2 champs + 1 section + 1 description, sauver, ouvrir une carte qui l'utilise dans `/projects` → vérifier l'ordre dans le modal.
- Drag & drop : réordonner deux champs dans l'éditeur, sauver, vérifier l'ordre dans le modal de carte.
- Drawer : ouvrir l'édition d'un champ, changer le label → vérifier que l'aperçu se met à jour live, fermer le drawer, vérifier que le bouton "Enregistrer" est en dirty state.

## 8. Sécurité / perfs

- Toutes les server actions passent par `requireUser({ role: 'Member' })` (existant).
- `where: { workspaceId }` systématique sur les queries Prisma (existant).
- Validation Zod côté server (existant) — schémas mis à jour pour la nouvelle union.
- L'aperçu live ne fait aucun appel serveur (purement client) → pas de souci de N+1 ou rate-limit.
- Drag & drop debounced pour le state local n'est pas nécessaire (les updates sont synchrones et peu coûteuses).

## 9. Plan de déploiement

1. Migration Prisma (1) : ajout colonne `items`, backfill data.
2. Code basculé sur `items` (lecture + écriture).
3. Migration Prisma (2) : drop `fields` + `description_position`.
4. Verif Sentry pendant 48h.
