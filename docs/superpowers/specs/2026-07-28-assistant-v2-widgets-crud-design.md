# Assistant V2 — widgets interactifs, CRUD complet, fiabilité des actions

**Date :** 2026-07-28 · **Statut :** validé par Angelo L. (brainstorm + maquette companion)
**Maquette :** [assets/2026-07-28-assistant-v2-widgets-mockup.html](./assets/2026-07-28-assistant-v2-widgets-mockup.html)
**Spec parent :** [2026-07-27-assistant-agent-design.md](./2026-07-27-assistant-agent-design.md) (architecture agent, gate, widgets, mémoire — inchangée)

## 1. Origine — retours de test (preview Plans 1→3a)

1. « Montre-moi mes mails » affiche une liste passive — Angelo veut un **client mail embarqué** dans le chat, avec toutes les actions.
2. Cliquer un mail redirige vers Communications **sans ouvrir le mail en question**.
3. Un mail rédigé par l'agent doit apparaître en **aperçu structuré prêt à l'envoi**, pas en texte.
4. Des actions manquent (ex. supprimer un projet) — **tout le CRUD** doit être disponible via l'agent.
5. « Dans ma liste de course, ajoute… » a été refusé — l'agent doit **résoudre les noms** en langage naturel.
6. **Bug fiabilité** : l'agent a affirmé un déplacement de cartes « fait » alors que le widget board affiché montrait l'état d'avant (lecture pré-mutation rendue comme état final).

## 2. Décisions produit (actées en brainstorm)

| Sujet                | Décision                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Périmètre CRUD       | **Tout** : projets, clients & contacts, colonnes & checklist, équipe & templates, mails (envoi toujours confirmé)                  |
| Actions widget mail  | Lire + ouvrir (deep-link), Répondre/Transférer, lu/non-lu, Archiver/Supprimer                                                      |
| Aperçu brouillon     | **Éditable des deux côtés** : inline par l'utilisateur ET retouches via le chat                                                    |
| Architecture widgets | **Approche A — hybride** : lecture/navigation en direct, contenu & mutations via l'agent                                           |
| Parité agent         | Toute action widget est **aussi** faisable par l'agent seul, y compris en masse (« marque toutes les notifs d'applis comme lues ») |
| Gate                 | Principe inchangé : destructif ou sortant = Autoriser/Refuser ; création/modification = direct                                     |

## 3. Fiabilité des actions (correctif du point 6)

Trois couches, toutes obligatoires :

1. **Lecture-après-écriture** : chaque tool mutant relit l'état en DB _après_ sa transaction et le renvoie dans son résultat JSON. Ex. `move_card` → `{moved: true, nowInColumn: "Fait", position: 1}` (relu, pas déduit). S'applique à tous les tools mutants existants et nouveaux.
2. **Widget toujours frais** : règle system prompt — après des mutations Kanban sur un projet, relire le board (`get_project_board`). Côté client, **dédup par `projectId`** : si plusieurs widgets board du même projet apparaissent dans le même tour, seul le plus récent est rendu. Un board périmé ne peut plus contredire le texte.
3. **Règle de prompt** : ne jamais affirmer une action sans le résultat `ok` du tool correspondant dans le tour courant ; en cas d'échec, le dire tel quel.

Tests : unit pinnant le champ post-état de chaque tool mutant ; test client du dédup board ; test prompt (présence des règles).

## 4. Résolution de noms en langage naturel (point 5)

- **Nouveau tool `find_projects(query)`** : recherche partielle **insensible aux accents** (extension `unaccent`, déjà activée par #8) sur `projects.name`, scopée workspace + scope utilisateur, renvoie `{id, name, clientName, cardCount}` (max 10). Pas de nouvel index nécessaire en V1 (volumes agence) ; à revoir si besoin.
- Clients/contacts : le `list_clients` existant suffit (volumes faibles).
- **Règle system prompt** : quand l'utilisateur nomme un élément sans préciser sa nature (« ma liste de courses », « mon handover »), chercher d'abord (`find_projects`, `list_clients`) avant de refuser. Plusieurs candidats → demander lequel. Zéro candidat → le dire et proposer de créer.

## 5. CRUD complet — nouveaux tools (point 4)

Tous wrappent des cores/actions existants (zéro logique métier dupliquée dans les tools), `workspace_id` sur chaque requête, `safeMutation`, audit `assistant_tool_run` inchangé, lecture-après-écriture (§3.1). ⚡ = `gated: true` (flux Autoriser/Refuser existant).

| Domaine   | Tool                                             | Gate                           | Notes                                                                                                                                                           |
| --------- | ------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projets   | `update_project`                                 | —                              | nom, description, dates, statut                                                                                                                                 |
|           | `delete_project`                                 | ⚡                             | soft delete + corbeille 30 j (ADR #15)                                                                                                                          |
| Clients   | `create_client`, `update_client`                 | —                              |                                                                                                                                                                 |
|           | `delete_client`                                  | ⚡                             | refusé si projets actifs, message avec la liste (ADR #14)                                                                                                       |
| Contacts  | `create_contact`, `update_contact`               | —                              |                                                                                                                                                                 |
|           | `delete_contact`                                 | ⚡                             |                                                                                                                                                                 |
|           | `set_project_raci`                               | —                              | une valeur RACI par contact par projet (§6.6 CLAUDE.md)                                                                                                         |
| Colonnes  | `add_column`, `rename_column`, `reorder_columns` | —                              | colonne Bloqué intouchable (refus explicite)                                                                                                                    |
|           | `delete_column`                                  | ⚡ si elle contient des cartes | sinon direct                                                                                                                                                    |
| Checklist | `set_checklist_item`                             | —                              | coche/décoche un item ; déclenche l'auto-progression domain existante (1800 ms côté UI ; côté agent l'avancement suit les règles domain au même titre que l'UI) |
| Équipe    | `invite_member`                                  | ⚡                             | email sortant (Resend), Admin only                                                                                                                              |
|           | `remove_member`                                  | ⚡                             | Admin only, protection dernier Admin (domain + DB)                                                                                                              |
|           | `change_member_role`                             | —                              | Admin only                                                                                                                                                      |
| Templates | `create_template`, `update_template`             | —                              | modifier un template n'impacte pas les projets existants (copy-on-create)                                                                                       |
|           | `delete_template`                                | ⚡                             |                                                                                                                                                                 |
| Mails     | `mark_mail_read`, `mark_mail_unread`             | —                              | unitaire **et en masse** : `mailIds[]` (max 100) issus de `search_mails` ; réversible, boîtes de l'utilisateur uniquement                                       |
|           | `archive_mail`                                   | ⚡                             | boîtes de l'utilisateur uniquement                                                                                                                              |
|           | `delete_mail`                                    | ⚡                             | boîtes de l'utilisateur uniquement                                                                                                                              |

Admin only = enforce par l'admin guard existant du registry **et** revérifié dans le core (serveur d'abord).

## 6. Widget mail interactif (points 1-2) — approche A

`MailListWidget` v2, rendu depuis `search_mails` (tool_result, pipeline inchangé) :

- **Déplier une ligne** → charge le corps via un endpoint dédié `GET /api/assistant/mail-body` réutilisant la logique d'ownership de `read_mail` (boîtes de l'utilisateur uniquement, sanitize HTML partagé existant). Direct, zéro tour d'agent.
- **Lu / non-lu** : toggle direct (server action existante), optimiste avec rollback.
- **« Tout marquer lu »** (en-tête du widget) : direct, sur les mails listés dans le widget.
- **Répondre / Transférer** : injecte un message structuré dans le chat (« Réponds au mail 〈objet〉 de 〈expéditeur〉 [mailId] ») → tour d'agent → widget brouillon (§7). L'agent garde le contexte complet (mémoire, ton).
- **Archiver / Supprimer** : injecte de même un message → l'agent appelle `archive_mail`/`delete_mail` → gate. Chemin unique, audité.
- **« Ouvrir dans Communications »** : deep-link `/communications?mailbox=<id>&mail=<id>` — la page Communications accepte ces params et ouvre le mail à l'arrivée (corrige le point 2 ; servira aussi aux notices du Plan 3b).

Après rechargement de page, la conversation est éphémère (V1 inchangé) : les widgets disparaissent avec elle.

## 7. Widget brouillon éditable (point 3)

`MailDraftWidget`, rendu quand l'agent prépare un mail (nouveau, réponse, transfert) via un tool `prepare_mail_draft` (non gated — rien ne part) :

- **Mini-formulaire dans le chat** : chips À/Cc/Cci (composants du composer existant), Objet, Corps — tout éditable inline.
- **Source de vérité = `mail_drafts` en DB** : `prepare_mail_draft` crée le brouillon ; chaque édition inline est autosauvée (debounce, indicateur « ✓ sauvegardé »). Conséquences : le brouillon survit au rechargement (visible dans Communications), et une retouche demandée via le chat part du contenu **actuel** — l'agent le relit via un tool `get_draft` avant de modifier (`update_draft`).
- **Envoyer** : le clic envoie un message structuré → l'agent appelle `send_mail(draftId)` → **gate existant** avec énumération exhaustive des destinataires (Cci jamais tronqués). Unique chemin d'envoi, audité. La confirmation affiche l'état DB du brouillon (donc tes éditions inline).
- **Garder en brouillon** : bouton de clôture douce (déjà sauvé) — retrouvable dans Communications.

## 8. Sécurité

- Aucune nouvelle entrée sans **Zod** (tools, endpoint mail-body, actions d'autosave).
- Actions widget directes = server actions existantes (CSRF double-submit, RLS, scope).
- Corps de mail : ownership strict inchangé (« mes boîtes uniquement »), aussi sur le nouvel endpoint.
- `safeMutation`/`safeDb` sur tous les nouveaux tools — aucune erreur interne ne fuit vers le modèle ou l'utilisateur ; logs = nom du tool uniquement (pas de PII, §4.7).
- Gate : mêmes nonces/ConfirmStore/timeout fail-closed ; `describeForConfirm` obligatoire pour chaque nouveau tool gated (delete_project affiche le nom du projet et le nombre de cartes ; delete_client la liste de ses projets ; invite_member l'email et le rôle…).
- Bulk mail : plafond 100 IDs, revérification d'ownership de **chaque** mailbox concernée côté serveur.

## 9. Tests

- **Unit** : chaque nouveau tool (dont champ post-état §3.1 pinné, refus Bloqué, protection dernier Admin, plafond bulk, ownership) ; cores extraits testés isolément.
- **Integration** (route chat) : nouveaux widgets dans le flux SSE ; gate sur chaque nouveau tool ⚡ ; `prepare_mail_draft` → `get_draft` → `send_mail(draftId)` bout en bout.
- **Client** : dédup board par projectId ; autosave brouillon (debounce + rollback) ; injection de messages structurés depuis les widgets ; deep-link Communications.
- Couverture : règles repo inchangées (domain 100 %, seuils 80/70).

## 10. Découpage en plans (PR par plan, depuis main)

1. **Plan 5a — Fiabilité + résolution + CRUD projets/Kanban** : §3 complet, `find_projects`, tools projets/colonnes/checklist. Corrige le bug vu en test → part en premier.
2. **Plan 5b — CRUD clients/contacts/équipe/templates + mails en masse** : reste du §5 (dont admin-only et bulk).
3. **Plan 5c — Widgets interactifs** : §6 + §7 + deep-link Communications + endpoint mail-body.

Chaque plan livre un logiciel testable seul ; 5c dépend de 5a-5b uniquement pour `archive_mail`/`delete_mail` (boutons masqués tant que les tools n'existent pas si 5c partait avant — ordre nominal : 5a → 5b → 5c).

## 11. Hors périmètre (inchangé)

Proactivité Inngest (Plan 3b), orbe animée/E2E/voix (Plan 4), restauration corbeille via agent, pièces jointes dans le brouillon widget (V1.5 composer existant reste la référence).
