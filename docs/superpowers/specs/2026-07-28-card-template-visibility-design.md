# Card template visibility & default bootstrap — Design

**Date** : 2026-07-28 · **Statut** : validé par Angelo L.
**Origine** : bug UX — projet créé depuis le kanban template « Gestion de projet » → cartes sans template → modal sans description, et aucun chemin UI pour voir/éditer le template de carte.

## Cause racine

1. Le kanban template « Gestion de projet » (workspace-créé) a `default_card_template_id = NULL`.
2. Le workspace n'a **aucun** `CardTemplate` avec `is_default = true` (le seul existant, « To-do », ne l'est pas).
3. La cascade de résolution de `create-card.ts` (explicite → projet → défaut workspace) retombe sur « aucun template » → `Card.templateId = NULL`.
4. `TemplateItemsRender` ne rend la description que si le template contient un item `description` ; sans template, le modal n'affiche ni champs ni description.
5. L'éditeur `/templates/cards` existe mais rien n'y mène depuis une carte, et il ne supporte pas de deep-link.

## Décisions produit (2026-07-28)

| Question | Décision |
| --- | --- |
| Description dans le modal | **Via template uniquement** (statu quo de rendu) — on garantit que le template par défaut contient la description |
| Voir/modifier le template depuis une carte | **Lien vers l'éditeur existant** avec deep-link, pas d'édition inline |
| Template par défaut garanti | **Oui** — bootstrap à la création de workspace + migration data pour l'existant, **avec backfill** des cartes sans template |

## Changements

### 1. Deep-link éditeur de templates de cartes

- `apps/web/app/(app)/templates/cards/page.tsx` lit `searchParams.template`.
- `EditorShell` accepte une prop `initialSelectedId?: string` ; si l'id correspond à un template listé, il est sélectionné au mount, sinon comportement actuel (premier de la liste).
- Aucun changement d'URL pendant l'édition (le paramètre ne sert qu'à l'ouverture).

### 2. Lien « Modifier le template » dans le modal carte

Dans le rail latéral du modal (`card-modal.tsx`), sous le `TemplatePicker` :

- `card.templateId` non nul → lien « Modifier le template » → `/templates/cards?template=<id>`.
- `card.templateId` nul → texte « Aucun template appliqué » + lien « Gérer les templates » → `/templates/cards`.
- Visible Admin **et** Membre (CRUD templates ouvert aux deux — CLAUDE.md §6.7). Masqué en mode lecture seule (viewer).
- Navigation standard (`next/link`) ; le modal se ferme naturellement par changement de page.

### 3. Bootstrap workspace

Dans `apps/web/features/super-admin/actions/create-workspace-with-admin.ts`, juste après `prisma.workspace.create` : créer

```ts
prisma.cardTemplate.create({
  data: {
    workspaceId,
    name: 'Standard',
    isDefault: true,
    items: [
      { id: 'description', type: 'description' },
      { id: 'checklist', type: 'checklist', items: [] },
    ],
  },
})
```

La cascade existante de `create-card.ts` (fallback `isDefault: true`) fait le reste : toute nouvelle carte a un template avec description. Aucun changement dans la cascade.

### 4. Migration data (SQL, appliquée manuellement sur Supabase avant merge — cf. runbook déploiement)

Pour chaque workspace sans template par défaut actif :

1. S'il existe déjà un template actif nommé « Standard » → le marquer `is_default = true`.
2. Sinon → insérer le template « Standard » ci-dessus avec `is_default = true`.
3. Puis backfill : `UPDATE cards SET template_id = <défaut du workspace> WHERE template_id IS NULL AND deleted_at IS NULL` (scopé par workspace).

Trade-off assumé : une carte volontairement mise « Sans template » est re-templatée. Accepté (données quasi inexistantes en staging).

## Hors scope

- Édition inline du template dans le modal.
- Description hors template (description native visible sans template).
- Backfill de `default_card_template_id` des kanban templates existants (réglable via l'éditeur Kanban existant).

## Tests

- **Deep-link** : sélection initiale de l'éditeur — `?template=` valide / invalide / absent.
- **Modal** : rendu du lien selon `templateId` présent / absent / lecture seule.
- **Bootstrap** : le test de `create-workspace-with-admin` vérifie la création du template par défaut (items description + checklist, `isDefault`).
- **Migration** : vérification SQL sur staging après application (aucun workspace sans défaut, aucune carte active sans template).
