# ADR 0006 — Design system : Tokens issus de mockups + Tailwind v4 + Radix

- **Statut :** Accepté
- **Date :** 2026-04-27

## Contexte

Les maquettes ([mockups/](../../mockups/)) définissent un design system cohérent : Plus Jakarta Sans, dégradé violet→rose, mode clair/sombre via `data-theme`, tokens de couleurs/spacing/radius. Il faut le porter dans une codebase Next.js sans reproduire à la main.

## Décision

1. **Extraction directe** des variables CSS de [mockups/styles.css](../../mockups/styles.css) vers Tailwind v4 (`@theme`).
2. **Tailwind v4** retenu pour :
   - Fichier de config CSS-first (`@theme`, `@layer`)
   - Performance build (Lightning CSS)
   - Variables natives Tailwind (alignées avec celles du mockup)
3. **Radix UI** pour les primitives accessibles (Dropdown, Dialog, Tooltip, Popover, Tabs)
4. **Composants custom** pour les éléments propres à NexusHub (KanbanCard, MetricCard, ContextBar, etc.)
5. **Storybook 8** pour isoler/documenter chaque composant

## Tokens portés (inchangés)

```css
@theme {
  /* Couleurs */
  --color-bg-app: #f4f6f9;
  --color-accent-primary: #8b2be2;
  --color-accent-secondary: #ff2a6d;
  --color-success: #059669;
  --color-warning: #d97706;
  --color-danger: #e11d48;
  --color-info: #2563eb;
  /* Clients */
  --color-c-acme: #ff2a6d;
  --color-c-tech: #2563eb;
  --color-c-nova: #059669;
  --color-c-lumen: #f59e0b;
  --color-c-orbit: #8b2be2;
  /* Typo */
  --font-sans: 'Plus Jakarta Sans', system-ui, sans-serif;
  /* Radius */
  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 24px;
  /* Layout */
  --layout-sidebar-w: 260px;
  --layout-topbar-h: 72px;
}
```

Mode sombre via `[data-theme="dark"]` avec override des variables (cf. mockup).

## Composants à porter en Phase 3

Liste exhaustive issue de l'analyse mockup :

- **Atoms** : Button (primary/ghost/danger/icon), Input, Textarea, Select, Checkbox, Radio, Switch, Avatar, Tag, TagClient, BadgeAuto, ProgressBar, Spinner, Toast
- **Molecules** : Card, MetricCard, ProjectChip, ClientPill, ViewToggle, FormField, KanbanCard, ChecklistItem, CommentItem, NavItem, ClientRow
- **Organisms** : Sidebar, Topbar, ContextBar, KanbanBoard, KanbanColumn, CalendarMonth, CardModal, ProjectWizard, CommunicationList, CommunicationReader, IntegrationCard, RACITable
- **Templates** : AppShell, AuthShell

Chaque composant a sa story Storybook + tests a11y (axe-core).

## Conséquences

- Aucun framework UI massif (pas de MUI, Chakra, etc.) → bundle léger, design pixel-perfect.
- Coût : porter ~30 composants en Phase 3 (~5–7 jours).
- Visual regression via Chromatic activé dès la Phase 3.

## Critères d'acceptation Phase 3

- [ ] Comparaison side-by-side mockup HTML ↔ composant React → pixel diff < 5%
- [ ] Mode sombre fonctionnel (toutes les pages)
- [ ] axe-core : 0 violation critique sur chaque story
- [ ] Lighthouse a11y ≥ 95 sur chaque page de référence
