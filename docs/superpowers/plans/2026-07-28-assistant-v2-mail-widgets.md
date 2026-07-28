# Plan 5c — Assistant V2 : widgets mail interactifs, brouillon éditable, deep-link

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le chat assistant devient un client mail embarqué (corps dépliables, actions par mail), le brouillon rédigé par l'agent est éditable inline et autosauvé (source de vérité = `mail_drafts` en DB, partagé avec Communications), et « Ouvrir dans Communications » atterrit sur LE mail visé.

**Architecture:** Approche A validée en spec (§6-§7) : lecture/navigation en DIRECT (Server Actions existantes appelées depuis les widgets clients — `fetchMailBody` owner-gated, `markEmailRead`), contenu et mutations via L'AGENT (boutons → injection d'un message structuré dans le chat → tools existants/nouveaux, gate conservé). Nouveau canal de widget interactif : `renderWidget` reçoit un contexte d'actions (`sendMessage`) fourni par `assistant-chat`. Nouveau tool gated `send_draft` qui consomme le brouillon PERSISTÉ (describeForConfirm relit la DB — ce que l'utilisateur a édité inline est exactement ce qui est confirmé/envoyé).

**Tech Stack:** existant uniquement (React 19, Server Actions, Zod, Vitest). Aucune nouvelle dépendance, aucune migration.

**Spec :** `docs/superpowers/specs/2026-07-28-assistant-v2-widgets-crud-design.md` §6-§7 · **Exploration factuelle :** rapport du 2026-07-28 (fetchMailBody, MailDraft `@@unique([workspaceId,userId])`, RecipientField, compose-panel autosave 2 s, send_mail sans draftId, page Communications sans param `mail`).

**Branche :** `feat/assistant-v2-mail-widgets`, depuis `main` **après merge de la PR #15** (fait). Si l'état ne correspond pas : stopper et demander.

**Décisions actées (issues de l'exploration — font foi) :**

- **Pas de nouvel endpoint HTTP** pour le corps : le widget appelle la Server Action `fetchMailBody` (ownership `integration.ownerUserId` déjà enforce). HTML affiché via `dangerouslySetInnerHTML` sur `bodyHtmlSanitized` UNIQUEMENT (même pattern et même justification que `mail-reader.tsx:122-126` — sanitize partagé `@nexushub/integrations/mail`) ; fallback `bodyText`.
- **Toggle non-lu** : nouvelle Server Action mono-mail `markEmailUnread` wrappant `setMailStateCore(ctx, {mailIds:[id], op:'unread'})` (owner-only — asymétrie avec `markEmailRead` workspace-scopé DOCUMENTÉE dans les deux fichiers ; si le mail n'est pas à soi → `affected: 0`, le widget affiche « boîte d'un autre membre »).
- **Brouillon unique par user** (`@@unique([workspaceId,userId])`) : le widget chat et le ComposePanel partagent la même ligne — c'est le comportement spec (« survit au rechargement, visible dans Communications »). Le widget n'ouvre PAS le ComposePanel.
- **`send_draft`** (nouveau, gated) plutôt qu'étendre send_mail : décharge le modèle de re-fournir les champs, et garantit éditions inline = contenu confirmé = contenu envoyé.
- **Deep-link** : `?mailbox=<integrationId>&mail=<emailId>` — résolution de page SERVEUR (le mail visé peut être en page N : compter les mails plus récents dans le filtre courant et calculer `page`), sélection initiale dans MailList, `markEmailRead` déclenché à l'arrivée (parité avec le clic).
- **Pas de refresh temps réel** de l'inbox (rien n'existe — hors périmètre, dette listée) ; en revanche le widget met à jour son propre état localement (optimiste).

**Conventions transverses :** identiques aux plans 5a/5b (describes gated : safeParse brut → lookup véridique → déclaratif si refus certain ; textes user-safe ; pas de PII dans logs/audits ; tests style voisins ; widgets HORS aria-live ; historique chat texte-only inviolable — les états de widgets ne repartent JAMAIS au serveur).

---

### Task 1: Canal d'actions des widgets + `send(textOverride)`

**Files:** `apps/web/features/assistant/components/assistant-chat.tsx`, `apps/web/features/assistant/components/widgets/index.tsx` (+ tests des deux)

- `send()` accepte un paramètre optionnel `send(textOverride?: string)` : si fourni, utilisé à la place de `input` (l'input n'est PAS vidé dans ce cas ; les gardes `busy`/longueur s'appliquent pareil). Deps du useCallback ajustées.
- Nouveau type `WidgetActions = { readonly sendMessage: (text: string) => void; readonly busy: boolean }` (défini dans `widgets/index.tsx`, exporté). `renderWidget(tool, data, actions?)` — 3e argument optionnel transmis aux widgets qui le déclarent (MailListWidget en Task 4, MailDraftWidget en Task 6 ; les autres widgets l'ignorent, AUCUN changement pour eux).
- `assistant-chat` construit `actions = { sendMessage: (t) => void send(t), busy }` et le passe aux deux sites `renderWidget` (messages commités ET stream). Un widget d'un message ANCIEN peut donc encore injecter (voulu : « Répondre » sur un mail affiché il y a 3 tours doit marcher) — mais `busy` le désactive pendant un tour.
- Tests : send(override) envoie le texte fourni sans toucher l'input (payload pinné) ; renderWidget passe actions au widget cible et pas de régression sur les autres ; busy=true → boutons désactivés (testé en Task 4 sur le widget réel).

Commit : `feat(assistant): canal d'actions widgets (sendMessage) + send override`

---

### Task 2: Deep-link Communications `?mailbox=&mail=`

**Files:** `apps/web/app/(app)/communications/page.tsx`, `apps/web/features/communications/components/mail-list.tsx` (+ tests ; en créer pour la résolution de page si la page n'en a pas — extraire la résolution dans un helper pur testable `apps/web/features/communications/lib/resolve-mail-page.ts`)

- `page.tsx` lit `sp['mail']` (uuid sinon ignoré). Si présent : vérifier que le mail appartient au workspace + au filtre courant (mailbox/client/deletedAt/archivedAt) via un findFirst select `{id, receivedAt}` ; si trouvé, calculer la page : `count` des mails du même filtre avec `receivedAt >` (ou `=` et id tie-break identique à l'orderBy réel de la page — REPRENDRE l'orderBy exact) puis `page = floor(count / PAGE_SIZE) + 1` (helper pur `resolveMailPage({newerCount, pageSize})` testé) ; ce `page` calculé SUPPLANTE `sp['page']`. Introuvable → comportement actuel inchangé (pas d'erreur).
- `MailList` : prop optionnelle `initialSelectedId?: string` — si fournie ET présente dans la liste, initialise `selectedId` avec, ET déclenche le même flux que le clic (optimiste isRead + `markEmailRead`) une seule fois à l'init (parité avec le clic ; pas de markEmailRead si le mail est déjà lu).
- Tests : helper de résolution (0 plus récents → page 1 ; 50 → page 2 ; tie-break) ; MailList initialSelectedId (sélection + markEmailRead appelé une fois, pas si déjà lu, ignoré si absent de la liste).

Commit : `feat(comm): deep-link ?mail= vers un mail précis (résolution de page + sélection)`

---

### Task 3: Action `markEmailUnread` + `integrationId` dans search_mails

**Files:** `apps/web/features/communications/actions/mark-email-unread.ts` (nouveau + test), `apps/web/lib/assistant/tools/read-tools.ts` (+ test), `apps/web/features/assistant/components/widgets/mail-list-widget.tsx` (schéma seulement — le rendu vient en Task 4)

- `markEmailUnread({emailId})` : Server Action wrappant `setMailStateCore(ctx, {mailIds:[emailId], op:'unread'})` → `{ok:true, affected}` ; commentaires croisés (asymétrie owner-only vs markEmailRead workspace) dans les DEUX fichiers d'actions.
- `search_mails` : ajoute `integrationId: true` au select et au JSON de sortie (nécessaire au deep-link `?mailbox=` du widget). Le schéma Zod du widget (`MailRowSchema`) gagne `integrationId: z.string().optional()` (tolérant — les anciens messages sans le champ ne cassent pas).
- Tests : action (délégation, mono-id) ; search_mails select pinné ; schéma widget tolérant.

Commit : `feat(comm): markEmailUnread mono-mail + integrationId dans search_mails`

---

### Task 4: MailListWidget v2 — client mail embarqué

**Files:** `apps/web/features/assistant/components/widgets/mail-list-widget.tsx` (+ test) — devient un composant client interactif (`'use client'` si le dispatcher ne l'impose pas déjà).

Chaque ligne (données du widget + état local) :

- **Dépli** : clic sur la ligne → si pas encore chargé, `fetchMailBody({emailId})` (état loading/erreur locale ; erreur = message user-safe de l'action, typiquement boîte d'un autre membre) ; affiche `bodyHtmlSanitized` via `dangerouslySetInnerHTML` dans un conteneur borné (max-height + overflow, styles neutres — MÊME justification de sécurité que mail-reader.tsx, commentaire l'exigeant) sinon `bodyText` en `<pre>` soft-wrap. Re-clic → replie (corps gardé en cache local).
- **Toggle lu/non-lu** : bouton par ligne — lu → `markEmailRead({emailId})`, non-lu → `markEmailUnread({emailId})` ; optimiste avec rollback si `{ok:false}` ou `affected:0` (dans ce cas, message inline « boîte d'un autre membre »).
- **« Tout marquer lu »** (en-tête, si ≥ 2 non-lus affichés) : `actions.sendMessage('Marque comme lus ces mails : <ids des non-lus affichés, séparés par des virgules>')` — passe par l'agent (tool bulk owner-only) pour rester dans le pipeline audité.
- **Répondre / Transférer** : `actions.sendMessage('Prépare une réponse au mail <id> (objet « <objet tronqué 80> »)')` / transfert équivalent. Boutons désactivés si `actions.busy`.
- **Archiver / Supprimer** : `actions.sendMessage('Archive le mail <id>')` /『Supprime』 — l'agent passe par archive_mail/delete_mail (gate).
- **« Ouvrir dans Communications »** : `<Link href={/communications?mailbox=${integrationId}&mail=${id}}>` (si integrationId absent des données : lien non paramétré actuel).
- Sans `actions` fourni (rendu legacy), le widget reste purement affichage (comportement actuel) — rétrocompatible.
- A11y : boutons avec aria-label, dépli aria-expanded, focus visible ; le widget reste HORS aria-live.

Tests (testing-library, style assistant-chat.test.tsx) : dépli → fetchMailBody appelé une fois puis cache ; HTML sanitizé rendu / fallback texte ; erreur ownership affichée ; toggle lu optimiste + rollback ; chaque bouton injecte le message EXACT attendu (pinné) ; busy désactive ; deep-link href pinné ; sans actions → aucun bouton d'action rendu.

Commit : `feat(assistant): MailListWidget interactif (corps, lu/non-lu, actions, deep-link)`

---

### Task 5: Tools brouillon — `get_draft` + `send_draft` (gated) + widgets draft

**Files:** `apps/web/lib/assistant/tools/mail-tools.ts` (+ test), `apps/web/lib/assistant/widget-tools.ts`

- **`get_draft`** (read, non gated, safeDb) : charge via `loadDraft()` (action existante — draft de l'utilisateur courant uniquement par construction). Sortie JSON : `{exists:boolean, draft?: {kind, replyToId, to, cc, bcc, subject, bodyText: <bodyHtml strippé via stripMailHtmlToText, borné 5000>, updatedAt}}`. JAMAIS le bodyHtml brut vers le modèle. Description : « Lit VOTRE brouillon en cours (celui du widget/du composer). À appeler avant toute retouche demandée par l'utilisateur — ses éditions inline priment. »
- **`send_draft`** (gated ⚡, safeMutation) : schéma `{}` (aucun input du modèle — le brouillon persisté fait foi). describeForConfirm ASYNC : charge le draft en DB ; absent → « Envoyer un brouillon ? Aucun brouillon en cours — l'envoi sera refusé. » (déclaratif) ; sinon RÉUTILISE le même format d'énumération que send_mail (mode, À/Cc tronqués à 5, **Cci JAMAIS tronqués**, objet, extrait 200 chars, budget 1900 avec repli compté — factorise les helpers existants de send_mail plutôt que dupliquer). Handler : `loadDraft()` → absent → failure « Aucun brouillon à envoyer. » ; sinon mappe vers `sendMail({fromIntegrationId, mode: kind (new_mail|reply|reply_all ; kind 'forward' → mode… VÉRIFIE comment le composer envoie un forward via sendMail et fais pareil), replyToId, to/cc/bcc, subject, bodyHtml, composeAttachments})` ; succès → `deleteDraft()` (cohérent avec le flux composer — VÉRIFIE ce que fait le composer après envoi et aligne) → JSON `{sent:true, emailMessageId}` ; échec → failure(message curé comme send_mail).
- **Widgets draft** : ajoute `create_mail_draft` et `prepare_reply_draft` à WIDGET_TOOLS (leurs sorties actuelles doivent devenir un JSON structuré du draft si ce n'est pas le cas — vérifie et ajuste la sortie de ces tools : `{draftSaved:true, kind, to, cc, bcc, subject, bodyText (strippé, borné), replyToId}` — c'est CE JSON que le MailDraftWidget rendra en Task 6). Cap 8 Ko respecté.
- Prompt système (`system-prompt.ts`) : une phrase ajoutée au paragraphe fiabilité existant : « Pour les mails : prépare les brouillons avec create_mail_draft/prepare_reply_draft, relis get_draft avant toute retouche (les éditions inline de l'utilisateur priment), envoie avec send_draft. » (+ pins de test).
- Tests : get_draft (strip + borne + exists:false) ; send_draft (describe : absent déclaratif, énumération Cci exhaustive pinnée, budget) ; handler (mapping kind→mode, delete après succès, échec curé) ; allowlist widgets ; prompt pinné.

Commit : `feat(assistant): get_draft + send_draft gated (le brouillon persisté fait foi)`

---

### Task 6: MailDraftWidget — brouillon éditable autosauvé

**Files:** `apps/web/features/assistant/components/widgets/mail-draft-widget.tsx` (nouveau + test), `widgets/index.tsx` (dispatch des 2 tools draft)

- Rendu depuis le JSON de create_mail_draft/prepare_reply_draft. Formulaire : `RecipientField` ×3 (À/Cc/Cci — composant existant réutilisé tel quel), input Objet, corps en **textarea** (pas RichTextEditor en V1 du widget : le draft vient de l'agent en texte ; à l'autosave le corps est converti en HTML minimal `<p>` par paragraphe — VÉRIFIE comment le composer produit bodyHtml et réutilise l'helper s'il existe ; sinon échappe le texte et wrappe, PAS de dangerouslySetInnerHTML ici). En-tête « ✏️ Brouillon — <Réponse|Nouveau|Transfert> » + indicateur « ✓ sauvegardé / … » .
- **Autosave** : debounce 2 000 ms (même valeur que le composer) → `saveDraft({fromIntegrationId, kind, replyToId, to, cc, bcc, subject, bodyHtml})`. fromIntegrationId/kind/replyToId proviennent du JSON initial du widget (le modèle les a fournis au tool) — invariants non éditables dans le widget.
- **Boutons** : « 📤 Envoyer » → `actions.sendMessage('Envoie le brouillon actuel (send_draft)')` (désactivé si busy ou autosave en vol — flush l'autosave d'abord : await du save en cours avant d'injecter) ; « 💾 Garder en brouillon » → flush save + état « sauvegardé, retrouvable dans Communications » (le widget reste affiché, inerte).
- Hint sous les boutons : « éditable ici, ou demandez une retouche dans le chat ».
- Si `actions` absent → rendu lecture seule.
- Un SEUL MailDraftWidget actif par tour : si un nouveau tool_result draft arrive dans le même tour, il REMPLACE le précédent (même mécanique que la dédup board — étend `appendWidget` : les tools draft se remplacent entre eux SANS clé, il n'y a qu'un draft par user).
- Tests : édition → autosave debounce (fake timers) avec payload exact ; flush avant envoi (ordre save→sendMessage pinné) ; message d'envoi exact ; remplacement dans appendWidget ; lecture seule sans actions ; aucun bodyHtml brut affiché sans échappement.

Commit : `feat(assistant): MailDraftWidget éditable autosauvé (source de vérité DB)`

---

### Task 7: Suites + docs + revue holistique → PR

- `pnpm turbo run test typecheck lint` 17/17 ; couverture agent 100 %.
- progress.md (ligne 5c) + CLAUDE.md §11.
- Revue holistique finale (superpowers:code-reviewer) : flux complets (« montre mes mails » → dépli → Répondre → widget draft → édition inline → Envoyer → gate Cci → envoyé + draft supprimé ; deep-link depuis widget → mail ouvert page N), invariant historique texte-only re-vérifié, XSS (dangerouslySetInnerHTML uniquement sur bodyHtmlSanitized), dette PR. Verdict ready-for-PR requis.

---

## Self-review

- Spec §6 : dépli (T4), lu/non-lu (T3+T4), tout-marquer-lu (T4), Répondre/Transférer (T4→T5/T6), Archiver/Supprimer via agent (T4), deep-link (T2+T4). §7 : widget éditable (T6), autosave DB partagée (T6), retouche chat via get_draft (T5), Envoyer via gate (T5), Garder en brouillon (T6). ✅
- Points laissés à la vérification de l'implémenteur (explicites) : mapping forward→sendMail, comportement post-envoi du composer, helper texte→bodyHtml. Chacun avec instruction « vérifie et aligne ».
- Dette héritée listée pour la PR : pas de refresh live de l'inbox depuis le chat ; read_mail (tool) texte-only inchangé ; attachments non éditables dans le widget (composer reste la référence) ; draft unique partagé chat/composer (comportement, pas bug).
