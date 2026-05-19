# Card Comments — Design Spec

> **Date** : 2026-05-19
> **Scope** : commentaires sur cartes Kanban + notifications email instantanées
> **Statut** : Phase B.3 (commentaires Viewer-writable, jusqu'ici différé)

## Vision produit

Donner à **tous les utilisateurs ayant accès à une carte** (Admin, User in-scope, Viewer in-scope) la possibilité de poster, modifier et supprimer leurs propres commentaires. Notifier par mail les **assignés** de la carte (RACI) lorsqu'un commentaire est ajouté — sauf l'auteur. Le markdown est supporté pour les commentaires (réutilisable pour d'autres surfaces : intégrations Slack, future feature « Notes » type Notion).

## Décisions actées en brainstorming (2026-05-19)

| #   | Décision                      | Choix                                                                             |
| --- | ----------------------------- | --------------------------------------------------------------------------------- |
| 1   | Qui reçoit le mail de notif ? | Assignés (R/A/C/I) de la carte, sauf l'auteur                                     |
| 2   | Édition / suppression         | Auteur édite (overwrite, badge « modifié »), auteur supprime, Admin supprime tout |
| 3   | Format du body                | Markdown sanitisé (DOMPurify)                                                     |
| 4   | Fréquence email               | Instant (un mail par commentaire)                                                 |
| 5   | Real-time updates             | Non en V1 (router.refresh côté auteur)                                            |
| 6   | Audit log dédié               | Non en V1 (la row Comment trace déjà tout)                                        |

## Architecture

### Data model

`Comment` (existe déjà en DB, on s'en sert tel quel) :

```prisma
model Comment {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  cardId    String    @map("card_id") @db.Uuid
  authorId  String    @map("author_id") @db.Uuid
  body      String    // markdown brut, sanitization au render
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
}
```

- `body` stocke le **markdown brut** — la sanitization se fait à chaque render, pas à l'écriture (single source of truth, peut être re-sanitisé si la whitelist DOMPurify évolue)
- `updatedAt > createdAt + 1s` → l'UI rend un badge `(modifié)` à côté du timestamp
- `deletedAt` set au soft-delete → l'UI rend une ligne grise « <auteur> a supprimé son commentaire » avec date, sans le body

`Notification` : ajouter `email` à l'enum `NotificationChannel` (actuellement `push | slack`).

### Migration DB

```sql
ALTER TYPE "public"."NotificationChannel" ADD VALUE 'email';
```

Pas de table à créer, tout existe déjà.

### Server actions

| Action                               | Auth                                  | Validation                       |
| ------------------------------------ | ------------------------------------- | -------------------------------- |
| `createComment({ cardId, body })`    | `requireUser` + scope sur la carte    | `body` : 1-10000 chars, markdown |
| `updateComment({ commentId, body })` | author only                           | `body` : 1-10000 chars           |
| `deleteComment({ commentId })`       | author OR workspace Admin de la carte | soft delete                      |

Viewer peut `createComment`, `updateComment`/`deleteComment` sur ses propres commentaires. Pas de toggle ou guard spécial pour Viewer ici — c'est explicitement la seule mutation autorisée.

**Pas d'action `listComments`** : les commentaires sont chargés directement dans le Server Component qui ouvre la carte (`/projects/[id]/page.tsx`), comme les autres données du modal.

#### Workflow de `createComment`

```
1. requireUser
2. assertCsrfFromFormData (le formulaire utilise une Server Action via useTransition)
3. Validate body avec Zod (1-10000 chars)
4. Fetch card → workspaceId + clientId + assignees + author user
5. Scope check (scopedCardWhere) — refuse si hors scope
6. INSERT Comment row (body stocké brut)
7. Recipients = card.assignees.map(a => a.userId).filter(uid => uid !== ctx.userId)
8. For each recipient (Promise.allSettled in parallel) :
   a. INSERT Notification row (kind=card_commented, channel=email, sentAt=null)
   b. Send email via getEmail().send(...)
   c. UPDATE Notification.sentAt = now() (en cas de succès)
9. revalidatePath(`/projects/{projectId}`)
10. Return { ok: true, commentId }
```

Promise.allSettled : si Resend retourne 500 pour un recipient, les autres partent quand même. La row Notification garde `sentAt = null` pour les échecs (utile pour future feature « retry pending notifs »).

#### Workflow de `updateComment`

```
1. requireUser
2. assertCsrfFromFormData
3. Validate body avec Zod
4. Fetch comment → cardId, authorId, deletedAt
5. Refuse si deletedAt !== null
6. Refuse si comment.authorId !== ctx.userId
7. UPDATE body, updatedAt
8. revalidatePath(`/projects/{projectId}`)
```

**Pas de notification email** sur édit (signal/bruit faible — le user qui édite vient juste de poster).

#### Workflow de `deleteComment`

```
1. requireUser
2. assertCsrfFromFormData
3. Fetch comment → cardId, authorId
4. Authorized si :
   - ctx.userId === comment.authorId, OR
   - ctx.role === Admin && card.workspaceId === ctx.workspaceId
   - (Le super-admin n'est PAS un cas spécial ici — s'il a besoin de modérer, il passe par
     la suppression de workspace via /super-admin. Évite les chemins exotiques en V1.)
5. UPDATE deletedAt = now()
6. revalidatePath(`/projects/{projectId}`)
```

Pas de hard delete. Le body reste en DB pour traçabilité légale potentielle (mais n'est plus rendu dans l'UI).

### Rendu markdown

Nouveau package : `packages/integrations/src/markdown/` (réutilisable hors comments).

```ts
import { renderMarkdownToSafeHtml } from '@nexushub/integrations/markdown';
const html = renderMarkdownToSafeHtml(rawMarkdown); // string
```

Implémentation :

- `marked` pour parser markdown → HTML
- `isomorphic-dompurify` pour sanitize (fonctionne server-side via jsdom et client-side via window)
- Whitelist stricte des balises :
  - **Autorisées** : `p, br, strong, em, code, pre, blockquote, ul, ol, li, a`
  - **Sur les `a`** : `href` obligatoire, schemes whitelist `https://` et `mailto:`, ajout auto de `rel="noopener noreferrer" target="_blank"`
- **Interdits** : `img`, `iframe`, `script`, `style`, attributs `on*`, `href="javascript:"`, `data:` URIs

Tests unitaires couvrant : XSS classique (`<script>`), event handlers (`<a onclick>`), URI schemes (`javascript:`, `data:`), markdown standard (bold, italic, link, code).

### UI

Trois nouveaux composants dans `apps/web/features/projects/components/` :

| Composant            | Type             | Responsabilité                                                                                                                                                                                                                      |
| -------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CardCommentsThread` | Server Component | Affiche la liste des commentaires, chargés par le parent `/projects/[id]/page.tsx`. Reçoit `comments`, `currentUser`, `csrfToken`                                                                                                   |
| `CardCommentItem`    | Client Component | Une ligne : avatar + nom + date relative + body HTML rendu (via `dangerouslySetInnerHTML` sur le HTML sanitisé). Actions « Modifier » / « Supprimer » conditionnées par auteur/admin. Inline edit mode (textarea en place du body). |
| `CardCommentForm`    | Client Component | Textarea markdown + bouton « Envoyer ». Submit via Ctrl/Cmd+Enter. Pas de preview côté V1.                                                                                                                                          |

Intégration dans `CardModal` (existant) : nouvelle section « Commentaires (N) » sous la checklist, scrollable, form de saisie en bas.

Le parent `/projects/[id]/page.tsx` (et `.../list/page.tsx`) charge les commentaires :

```ts
prisma.comment.findMany({
  where: { cardId: openCard.id, deletedAt: null },
  orderBy: { createdAt: 'asc' },
  select: {
    id: true,
    body: true,
    createdAt: true,
    updatedAt: true,
    author: { select: { id: true, firstName: true, lastName: true, email: true } },
  },
});
```

Le HTML rendu est généré côté serveur via `renderMarkdownToSafeHtml(comment.body)` et passé en prop au composant client, qui le rend via `dangerouslySetInnerHTML` (safe puisque déjà sanitisé).

### Email notification

Template aligné sur les invitations existantes, dans `apps/web/features/notifications/email/templates.ts` (nouveau dossier — on prépare l'arborescence pour les futures notifs).

- **Subject** : `[NexusHub] <Prénom Nom> a commenté « <titre carte> »`
- **From** : `NexusHub <app@brandnewday.agency>` (déjà configuré)
- **Body** (HTML + text version) :
  - Salutation : `Salut <Prénom>,`
  - Phrase d'introduction : `<Prénom Nom> vient de commenter la carte <#shortRef> · <titre> dans le projet <projet> (<client>).`
  - **Extrait du commentaire** : premier 200 chars du body **en texte brut** (markdown stripped). Pas de HTML dans l'email pour limiter le risque de mauvais rendu sur les clients mail.
  - CTA bouton : « Voir le commentaire » → `<NEXT_PUBLIC_APP_URL>/projects/<projectId>?card=<cardId>` (ouverture du modal directement)
  - Footer : « Tu reçois cet email parce que tu es assigné à cette carte. »

### RLS / sécurité

Policies Postgres sur `public.comments` :

```sql
-- SELECT : accessible si le user est membre du workspace de la carte
CREATE POLICY comments_select_workspace ON comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cards c
      WHERE c.id = comments.card_id
        AND c.workspace_id = ANY (workspace_ids_for_current_user())
    )
  );

-- INSERT/UPDATE/DELETE : refusé via RLS, géré uniquement par les server actions
CREATE POLICY comments_no_direct_writes ON comments
  FOR ALL USING (false) WITH CHECK (false);
```

Les Server Actions tournent en tant que service-role et bypass RLS, mais font leurs propres checks (auth + scope). RLS est ceinture + bretelles.

Policies Postgres sur `public.notifications` : déjà existantes via `workspaceId`, rien à modifier.

### Tests

Unitaires (vitest) :

- `renderMarkdownToSafeHtml` : 10+ specs (XSS, schemes, markdown standard)
- `createComment` : auth, scope, Viewer accepté, body validation, recipients = assignees - author, parallel send
- `updateComment` : author-only, refuse non-author, body validation
- `deleteComment` : author + Admin + super-admin, soft delete confirmed

Pas d'E2E Playwright pour V1 (couverture trop chère vs intérêt — les unit tests + smoke manuel suffisent).

### Performance

- Markdown render est synchronously CPU-bound, ~1-2ms par commentaire. Pour 50 commentaires = 100ms max. Acceptable.
- Email envois : Promise.allSettled parallèle. Worst case 5 recipients × 200ms = 1s sur l'action (mais le user voit le commentaire apparaître immédiatement grâce à `useOptimistic` côté client + revalidatePath).

## Hors-scope V1

À noter pour itérations suivantes (dans cet ordre de priorité estimé) :

1. **@mentions** + autocomplete users du workspace + email aussi aux mentionnés
2. **Configurable email preferences** par user (instant / digest / mute par carte / mute par projet)
3. **Real-time updates** via Supabase Realtime channel `card:<id>`
4. **Réactions emoji** (👍 ✅ 👀)
5. **Threading / réponses inline**
6. **Pièces jointes** (dépendance : Storage Supabase wireé, prévu V1.5)
7. **Edit history complet** (qui a modifié quoi, quand)
8. **Inngest dispatch** pour le pipe email (V2 quand les jobs background seront en place)

## Risques connus

- **Resend down** : un email perdu n'est pas critique (notif manquée). La row Notification avec `sentAt = null` est notre filet — feature future « renvoyer les notifs en échec » possible.
- **XSS via markdown** : DOMPurify est le standard de l'industrie, on a une whitelist stricte, on teste les cas connus. Pas de risque réel si la lib est à jour.
- **Bruit email** : si beaucoup d'activité sur une carte populaire, les assignés peuvent être submergés. Pas un risque pour les 1-10 premiers users. Le digest (Phase 2) résout ça.
- **Volumétrie comments** : table `comments` peut grossir vite (cardId indexé déjà). Si > 1000 commentaires par carte un jour, pagination à prévoir — pas un souci pour V1.

## Documentation associée

- Code Comment model : `packages/db/prisma/schema.prisma` (modèle existant)
- Email adapter : `apps/web/lib/email/index.ts` + `packages/integrations/src/email/index.ts`
- Email template patterns : `apps/web/features/invitations/email/templates.ts`
- Resend runbook : `docs/runbooks/resend-domain-setup.md`
- Mémoire « card comments deferred » : peut être supprimée après merge (cf. `.claude/memory/project_comments_deferred.md`)
