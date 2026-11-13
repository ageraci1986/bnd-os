# Refonte visuelle : identité BND 2026 (« BND OS »)

Date : 2026-11-13 · Statut : design validé par Angelo (maquettes) · Auteur : Claude

## 1. Objectif

Aligner toute l'interface de l'app sur la charte « Brand New Day, Brand Guidelines 2026 » et
renommer le produit visible **NexusHub → BND OS**. La référence visuelle validée est
`mockups/bnd/index.html` (11 écrans, modes Cobalt et Ice). Aucun changement fonctionnel, aucun
changement de schéma, d'API ou de permission.

## 2. Décisions validées

| Sujet                    | Décision                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Nom et logo              | « BND OS », monogramme BND + étincelle (composant texte en attendant les fichiers maîtres SVG)                   |
| Modes                    | Cobalt (sombre) et Ice (clair) conservés, plus « Système ». La barre latérale reste Cobalt dans les deux modes   |
| Lettrage creux (outline) | Interdit dans l'UI. L'emphase d'un titre est en couleur pleine (jaune en Cobalt, bleu en Ice)                    |
| Tirets longs             | Aucun « — » dans les textes d'interface, ni trait décoratif devant les sur-titres. Séparateur : point médian     |
| Cartes Kanban            | Couloir teinté par colonne + carte à fond contrasté, contour marqué, barre gauche 3 px, pied séparé par un filet |
| Accueil Overview         | « Bienvenue ma star ! Prêt(e) à dead ça ? » sur une ligne, puis le statut du jour en paragraphe séparé           |
| Login                    | Signature « Create / Work / Slay / Repeat. », dernier mot en dégradé Aurora (text-clip), ticker jaune            |
| Couleurs clients         | Palette 12 tokens + hex libre conservées (données, pas marque), affichées en petit carré repère                  |

## 3. Système de design

### 3.1 Couleurs de marque

Cobalt `#060D1F`, Cobalt-2 `#0A1330`, Flash Yellow `#FFE000`, Plasma `#FF2E63`, Electric Blue
`#1A4BFF`, Ice `#EEF0F8`. Aurora = dégradé 4 bandes nettes (bleu, violet `#6537FF`, plasma,
jaune), utilisé uniquement en filet de 2 px sous la barre du haut et en text-clip sur le login.

Écart assumé : deux surfaces hors palette pour la lisibilité des cartes, `#161E3A` (Cobalt) et
`#F8F9FD` (Ice).

### 3.2 Tokens (valeurs `light-dark(Ice, Cobalt)`)

Les noms de tokens existants sont conservés ; seules les valeurs changent, pour que les ~3000
lignes de `components.css` et les utilitaires Tailwind suivent sans réécriture.

| Token                               | Ice                                 | Cobalt                              |
| ----------------------------------- | ----------------------------------- | ----------------------------------- |
| `bg-app`                            | `#EEF0F8`                           | `#060D1F`                           |
| `bg-sidebar`                        | `#060D1F`                           | `#060D1F`                           |
| `bg-card`                           | `#F8F9FD`                           | `#0A1330`                           |
| `bg-card-alt`, `bg-muted` (couloir) | `rgba(6,13,31,.07)`                 | `rgba(238,240,248,.035)`            |
| `bg-hover`                          | `rgba(6,13,31,.045)`                | `rgba(238,240,248,.05)`             |
| `text-main`                         | `#060D1F`                           | `#EEF0F8`                           |
| `text-soft`                         | `rgba(6,13,31,.82)`                 | `rgba(238,240,248,.82)`             |
| `text-muted`                        | `rgba(6,13,31,.66)`                 | `rgba(238,240,248,.64)`             |
| `text-ghost`                        | `rgba(6,13,31,.42)`                 | `rgba(238,240,248,.38)`             |
| `border-light`                      | `rgba(6,13,31,.13)`                 | `rgba(238,240,248,.10)`             |
| `border-soft`                       | `rgba(6,13,31,.08)`                 | `rgba(238,240,248,.06)`             |
| `accent-primary` (aplat d'action)   | `#FFE000`                           | `#FFE000`                           |
| `accent-secondary`                  | `#FF2E63`                           | `#FF2E63`                           |
| `accent-text` (liens, sur-titres)   | `#1A4BFF`                           | `#FFE000`                           |
| `success` / `success-bg`            | `#060D1F` / `rgba(6,13,31,.07)`     | `#EEF0F8` / `rgba(238,240,248,.08)` |
| `warning` / `warning-bg`            | `#060D1F` / `#FFE000`               | `#FFE000` / `rgba(255,224,0,.12)`   |
| `danger` / `danger-bg`              | `#D4144A`\* / `rgba(255,46,99,.12)` | `#FF2E63` / `rgba(255,46,99,.14)`   |
| `info` / `info-bg`                  | `#1A4BFF` / `rgba(26,75,255,.10)`   | `#7C9BFF`\* / `rgba(26,75,255,.22)` |

\* Variantes de texte dérivées pour tenir le contraste WCAG AA (Plasma sur Ice = 3,2:1, bleu
sur Cobalt = 3:1). Les aplats restent aux valeurs exactes de la charte.

Nouveaux tokens : `--color-on-accent` (`#060D1F`, texte posé sur jaune ou plasma),
`--color-sidebar-fg` (Ice, fixe), `--color-bg-card-raised` (`#F8F9FD` / `#161E3A`, cartes
Kanban et événements calendrier), `--color-border-strong` (`.22` d'opacité), `--font-mono`.

Conséquence à traiter : `accent-primary` devient jaune, donc tout texte blanc posé dessus
(`text-white` sur bouton principal, badges) passe à `on-accent`. Le focus clavier passe au bleu
(`#1A4BFF`) et ne dépend plus de `accent-primary`.

### 3.3 Forme

- Rayon : 2 px partout (`--radius-*` et l'échelle Tailwind `rounded-*` ramenées à 2 px ;
  `rounded-full` aussi, donc avatars carrés). Exceptions qui restent rondes : indicateurs de
  chargement, pastille de l'étincelle/orbe, curseur des toggles (carré 2 px).
- Ombres : `--shadow-*` à `none`, utilitaires `shadow-*` neutralisés. La séparation se fait par
  filets 1 à 2 px. Les modals se détachent par un voile Cobalt 82 % et un contour.
- Dégradés : `--accent-gradient` devient un aplat jaune ; le fond radial du `body` est
  supprimé ; `--glass-bg` devient opaque.
- Grille 8 px (8 / 16 / 24 / 40 / 64).

### 3.4 Typographie

- Inter (400, 500, 600, 700, 800, 900) remplace Plus Jakarta Sans via `next/font/google` ;
  JetBrains Mono (400, 700) pour dates, compteurs, identifiants, pourcentages.
- Titre de page : 900, capitales, `-0.035em`, interligne 0,92. Chiffre clé : 900, `-0.045em`,
  avec numéral fantôme en fond.
- Label / sur-titre / bouton : 700, capitales, `+0.14em`, 10 à 11 px.
- Titres de cartes et corps : casse normale, 400 à 700.

### 3.5 Composants (voir l'onglet « Fondations » des maquettes)

Bouton principal jaune texte Cobalt ; secondaire contour ; destructif Plasma. Badges : Bloqué
(Plasma), Aujourd'hui (jaune), Auto (bleu), Terminé (contour). RACI : R bleu, A jaune, C et I
en contour. Sélecteur segmenté et toggle carrés. Barre latérale : index mono 01 à 09, élément
actif avec barre jaune à gauche. Barre du haut : fil d'Ariane en capitales + filet Aurora.

## 4. Périmètre par écran

Overview, Kanban, modal carte, calendrier, communications, clients, équipe, paramètres,
assistant, login : alignés sur leur onglet de maquette. Templates, intégrations, création de
projet, inscription par invitation, mot de passe oublié : mêmes composants, sans maquette
dédiée. L'orbe de l'assistant devient l'étincelle BND (états et `prefers-reduced-motion`
conservés). E-mails transactionnels (invitation, notification de commentaire) : nom, couleurs
et pile de polices mis à jour.

## 5. Renommage « BND OS »

Tous les textes visibles par l'utilisateur : métadonnées de page, barre latérale, écrans
d'auth, e-mails, prompt système et descriptions d'outils de l'assistant, Storybook. Hors
périmètre : noms de paquets (`@nexushub/*`), variables d'environnement, noms de projets
d'hébergement, domaine d'envoi, noms de buckets et de jobs.

## 6. Hors périmètre

Fonctionnalités, schéma DB, permissions, responsive mobile, logo définitif (fichiers maîtres
à fournir), photographie, gabarits sociaux de la charte.

## 7. Découpage en PR

1. **Fondations** : tokens, polices, rayons, ombres, dégradés, focus, texte sur accent ;
   garde-fous de test.
2. **Composants et shell** : sweep de `components.css` (rayons, ombres, dégradés résiduels),
   barre latérale, barre du haut, boutons, badges, titres de page, logo, renommage UI.
3. **Écrans** : Overview (accueil, chiffres clés), Kanban (couloirs, cartes), modal carte,
   calendrier, login, assistant (étincelle).
4. **Finitions** : e-mails, prompt assistant, Storybook, E2E, docs (CLAUDE.md §2 et journal,
   progress.md), remplacement de `mockups/styles.css` comme source par `mockups/bnd/`.

## 8. Tests et vérification

- Test CSS sur `tokens.css` : valeurs de marque exactes, `--radius-*` ≤ 3 px, `--shadow-*` à
  `none`.
- Garde-fou étendu : aucun `—` dans les fichiers de traduction ; aucun `text-stroke` dans le
  CSS applicatif ; `no-hardcoded-colors` conservé.
- Tests existants mis à jour là où ils lisent le nom « NexusHub » ou une classe modifiée.
- Contraste AA vérifié par calcul sur les paires texte/fond des tokens (test unitaire).
- Vérification visuelle : captures Playwright des écrans principaux dans les deux modes,
  comparées aux maquettes, avant chaque PR.
- `pnpm ci:local` vert avant chaque push.

## 9. Risques

- **Texte blanc sur jaune** : tout usage de `accent-primary` comme fond avec texte clair
  devient illisible. Recensement systématique en PR 1.
- **`rounded-full` neutralisé** : éléments censés rester ronds à exempter explicitement.
- **Contenu HTML des mails** affiché sur surface claire : inchangé (règle du lot B).
- **Volume** : `components.css` fait 3083 lignes ; le maintien des noms de tokens limite la
  réécriture, mais la PR 2 dépassera probablement la cible de 400 lignes.
