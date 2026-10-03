# Lot B — Dark mode

- **Date :** 2026-10-03
- **Branche / worktree :** `feature/dark-mode` (basée sur `feature/optim`, PR #35) — `.worktrees/dark-mode`
- **Statut :** validé en brainstorming (Angelo L.)
- **Décision antérieure levée :** progress.md reportait le mode sombre en V1.5 ; il est avancé suite aux retours utilisateurs.

## Objectif

Proposer un thème **Clair / Sombre / Système** sur toute l'application, sans flash au chargement, compatible
avec la CSP stricte (§4.6, pas de script inline), mémorisé sur le compte utilisateur.

## Approche retenue

Rendu serveur de l'attribut `data-theme` à partir d'un cookie + CSS natif `light-dark()` piloté par
`color-scheme`. Écartées : `next-themes` (nouvelle dépendance + script inline à nonce) et un rendu 100 % client
(flash à chaque chargement). `light-dark()` est supporté par les 2 dernières versions stables de Chrome, Edge,
Firefox et Safari (ADR 0001 #13).

## 1. Données

- Enum Prisma `ThemePreference { system, light, dark }`, colonne `User.theme ThemePreference @default(system)`.
  Migration additive versionnée dans `packages/db/prisma/migrations/`, **appliquée manuellement sur Supabase
  avant le merge** (Vercel n'exécute pas les migrations).
- RLS : la colonne vit sur `User` ; aucune policy nouvelle (l'utilisateur ne modifie que sa propre ligne via
  Server Action, `where: { id: ctx.userId }`).
- Cookie `nx-theme` : valeur `system | light | dark`, `httpOnly`, `Secure` (prod), `SameSite=Lax`, `Path=/`,
  `Max-Age` 1 an. Il ne contient aucune donnée sensible ; il sert uniquement au rendu serveur sans flash.
- Domain `packages/domain/src/theme/index.ts` (pur, testé 100 %) :
  - `THEME_PREFERENCES = ['system', 'light', 'dark'] as const`, type `ThemePreference` ;
  - `parseThemePreference(value: unknown): ThemePreference` → `system` si inconnu ;
  - `oppositeTheme(effective: 'light' | 'dark'): 'light' | 'dark'` (bouton topbar).

## 2. Rendu & tokens

- `apps/web/app/layout.tsx` (root) lit le cookie via `cookies()` → `<html data-theme={pref}>`.
- `packages/ui/src/tokens/tokens.css` :
  - chaque token de couleur devient `light-dark(<valeur claire>, <valeur sombre>)` (fonds, textes, bordures,
    statuts, palette clients 12 tokens, ombres, `--glass-bg`, dégradés accent si nécessaire) ;
  - suppression des deux blocs `[data-theme='dark']` (valeurs fusionnées dans les `light-dark()`) ;
  - pilotage : `:root, [data-theme='system'] { color-scheme: light dark; }`,
    `[data-theme='light'] { color-scheme: light; }`, `[data-theme='dark'] { color-scheme: dark; }`.
  - Les variables Tailwind v4 (`@theme`) continuent de référencer ces tokens ; vérifier que les utilitaires
    générés (`bg-[color:var(--color-…)]`) suivent sans changement.
- Couleur de texte sur couleur client : nouveau token par couleur `--color-<token>-fg` (`light-dark()`), et
  `clientColorForeground(value)` (domain) retourne `var(--color-<token>-fg)` pour un token, garde le calcul
  WCAG noir/blanc pour un hex libre. Le helper de garde `packages/ui/src/client-color.ts` est inchangé.
- Couleurs libres `#rrggbb` : rendues à l'identique dans les deux thèmes (pas d'ajustement automatique).
- Règles `[data-theme='dark'] …` existantes dans `components.css` et `apps/web/styles/globals.css` : converties en
  `light-dark()` ou conservées sous forme `:where([data-theme='dark']) …` + `@media (prefers-color-scheme: dark)
{ [data-theme='system'] … }` lorsqu'une conversion n'est pas possible (ex. images/dégradés de fond du body).
- **Nettoyage des couleurs en dur** (≈ 60 occurrences, ~26 fichiers `.tsx` + règles `components.css`) :
  - `bg-red-50 / text-red-700 / border-red-300` → `--color-danger-bg / --color-danger / --color-danger` ;
  - `bg-white` → `--color-bg-card` ; gris Tailwind → `--color-text-muted / -soft / --color-border-light` ;
  - hex de dégradé de marque (`#8B2BE2`, `#FF2A6D`) → `var(--accent-gradient)` ;
  - `bg-black/40` des overlays de modale : conservé (lisible dans les deux thèmes) ;
  - icônes SVG à couleur fixe → `currentColor`.
- Corps des mails HTML (`mail-reader.tsx`, `bodyHtmlSanitized`) : affiché sur une surface claire « papier »
  (`color-scheme: light`, fond blanc, texte sombre) quel que soit le thème, car les mails externes supposent un
  fond blanc.
- `viewport.themeColor` (media queries clair/sombre) : inchangé.

## 3. Interface

- **Topbar** : composant client `ThemeToggle` (bouton icône ☀️/🌙 SVG, `aria-label` « Passer en mode
  sombre / clair »). Le thème effectif est lu sur `<html data-theme>` ; s'il vaut `system`,
  `matchMedia('(prefers-color-scheme: dark)')`. Clic → applique immédiatement `oppositeTheme(effectif)` sur
  `<html>`, puis appelle la Server Action. En cas d'échec : rollback de l'attribut + toast d'erreur.
- **Paramètres** : section « Apparence » (au-dessus des préférences assistant) avec 3 options radio
  (Système / Clair / Sombre). Sauvegarde automatique + toast de confirmation (ADR 0001 #10), application
  immédiate sur `<html>`.
- **Server Action** `features/settings/actions/set-theme-preference.ts` : `requireUser` → Zod
  `z.enum(THEME_PREFERENCES)` → `prisma.user.update({ where: { id: ctx.userId }, data: { theme } })` → pose le
  cookie `nx-theme`. Pas d'audit (préférence personnelle, hors liste §4.7.3).
- **Synchronisation nouvel appareil** : le layout `(app)` charge `user.theme` ; un composant client `ThemeSync`
  compare à l'attribut `<html data-theme>` et, s'ils diffèrent, applique la valeur du compte et appelle une
  Server Action légère qui ne fait que poser le cookie. Un seul flash possible, au premier chargement sur un
  appareil sans cookie.
- Pages `(auth)` : suivent le cookie s'il existe, sinon `system`.
- Textes en dur FR, comme les écrans voisins (Paramètres et topbar ne sont pas encore sous next-intl).

## 4. Tests

- **Domain** : `parseThemePreference`, `oppositeTheme` (100 %).
- **Server Action** : Zod (valeur invalide refusée), userId de session uniquement, écriture DB, cookie posé.
- **Composants** : `ThemeToggle` (bascule depuis light, dark, system + OS sombre ; rollback sur erreur),
  sélecteur Apparence (sélection, toast), `ThemeSync` (aligne quand différent, ne fait rien sinon).
- **Garde-fou** : test Vitest qui scanne `apps/web/{app,features,components}/**/*.tsx` (hors tests/stories) et
  échoue si apparaissent des hex littéraux ou des classes `bg-white`, `bg-(red|gray|green|amber|slate)-\d+`,
  `text-(red|gray|…)-\d+`, `border-(red|gray|…)-\d+`, hors liste d'exceptions documentée.
- **Manuel (preview Vercel)** : parcours des 14 écrans des maquettes en clair, sombre et système (OS clair/sombre).

## Risques & notes

- Migration DB : à appliquer sur Supabase avant merge (cf. runbook déploiement).
- Contraste WCAG AA à vérifier en sombre sur les textes muted et les badges de statut.
- La branche dépend de la PR #35 (lot A) ; rebaser sur `main` après son merge.
