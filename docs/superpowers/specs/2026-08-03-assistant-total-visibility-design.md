# Assistant — Visibilité totale (notifications + exhaustivité) — Design

> Spec validée par brainstorm le 2026-08-03. Origine : retours de test d'Angelo — (1) « notification: 1 » dans le briefing, inexplicable par l'agent ; (2) « marque tous les mails de notifications comme lus » impossible (pagination absente, bulk borné à la page de recherche).

## Décisions produit (Q&A Angelo)

| Sujet                   | Décision                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| Mutations de masse mail | **Bulk par filtre serveur** (compte réel dans la confirmation) **ET** pagination des lectures. |
| Notifications           | **Lire + marquer lu, sans confirmation** (réversible, strictement personnel).                  |

## État des lieux (audit 2026-08-03)

| Outil                                             | Limite actuelle                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `search_mails`                                    | `limit` ≤ 25 (défaut 10), pas d'offset ni de total                                                    |
| Outils bulk mail (`mark_read`/`archive`/`delete`) | par liste d'ids (max `MAIL_BULK_MAX` = 100), ids issus de la page de recherche                        |
| `list_projects`                                   | take 50, pas d'indicateur de troncature                                                               |
| `get_team_members`                                | take 50 + `truncated`                                                                                 |
| `get_project_board`                               | 100 cartes/colonne                                                                                    |
| Checklists                                        | 50 items + flag                                                                                       |
| Notifications                                     | **aucun outil** (le modèle `Notification` existe : kind, data JSON, readAt, index `[userId, readAt]`) |

## 1. Outils notifications (nouveaux, non gated)

### `list_notifications`

- Portée : `workspaceId` + **`userId` strict** (jamais celles d'un autre membre).
- Entrée : `{ unreadOnly?: boolean (défaut true), limit?: 1..50 (défaut 20), offset?: number ≥ 0 }`.
- Sortie : `{ total, offset, notifications: [{ id, kind, label, title, createdAt, read }] }` où `label` est le libellé FR humain du `kind` et `title` le contexte extrait du `data` JSON — en **réutilisant le mapping existant** des notices (`features/notifications/agent-notice-mapping.ts` et le rendu de la pile de notices), pas une nouvelle table de correspondance.
- Le `data` JSON n'est **jamais** renvoyé brut (anti-injection : mêmes règles que les widgets — contenu résumé, pas de payload arbitraire dans le prompt).

### `mark_notifications_read`

- Entrée : `{ ids: uuid[] (1..100) }` **ou** `{ all: true }` (exclusif — Zod union).
- `updateMany` scoppé `workspaceId + userId + readAt: null` ; renvoie le **compte réellement modifié** (lecture-après-écriture, règle de fiabilité V2 §3).
- Non gated : action réversible, strictement personnelle — même chemin sémantique que le mark-read de l'UI (`features/notifications/mark-read.ts`), à réutiliser/factoriser si possible.
- Audit : non requis (pas dans la liste §4.7 ; cohérent avec le mark-read UI qui n'audite pas).

## 2. Mutations mail en masse par filtre serveur (gated)

Trois nouveaux outils symétriques des outils à ids : `mark_mails_read_by_filter`, `archive_mails_by_filter`, `delete_mails_by_filter`.

### Filtre (Zod, partagé)

```
{
  fromContains?: string (3..120)     // match insensible casse/accents sur fromEmail OU fromName
  subjectContains?: string (3..120)
  folder?: enum (mêmes valeurs que search_mails)
  isRead?: boolean
  receivedBefore?: date ISO
  receivedAfter?: date ISO
}
```

- **Au moins un critère requis** (`.refine`) — un filtre vide est rejeté : jamais de « tout » implicite.
- Owner-only : même `where` de propriété que `setMailStateCore` (boîtes de l'utilisateur uniquement) + `workspaceId` + `deletedAt: null` (+ exclusions cohérentes avec l'outil à ids équivalent : ex. archive ignore les déjà-archivés dans le compte annoncé).

### Confirmation (gate)

- `describeForConfirm` : re-parse **brut** (pattern anti-injection existant), puis `count()` en DB avec **exactement le même `where`** que l'exécution → « Marquer **143 mails** de “notifications@github.com” comme lus ? », avec la note « local à NexusHub » pour archive/delete. 0 résultat → « Aucun mail ne correspond — rien ne sera fait. » (le tool s'exécute et renvoie 0 sans erreur).
- TOCTOU assumé et documenté : le compte est celui du moment de la confirmation ; l'exécution re-filtre avec le même `where` (jamais plus large).

### Exécution

- Un seul `updateMany`, **sans plafond**. Retour : compte réellement modifié + reformulation du filtre appliqué.
- Audit `assistant_mail_bulk_filter` (tool, filtre normalisé, compte — jamais de contenu de mail).

## 3. Pagination des lectures

- **`search_mails`** : + `offset?: number ≥ 0` ; sortie devient `{ total, offset, mails }`. Page max 25 conservée (budget widget 8 Ko). Le widget mail-list continue de recevoir la même forme de `mails` (adapter `parse-widget-data`/widget si la forme d'enveloppe change — le widget affiche la page courante, le total peut être affiché en pied de widget si trivial, sinon hors scope).
- **Autres listes plafonnées** (`list_projects`, `get_team_members`, checklists de `get_card`, colonnes de `get_project_board`) : la sortie gagne systématiquement `total` (count DB) et/ou `truncated: true` quand le plafond est atteint. **Pas d'offset ajouté** sur ces listes (plafonds irréalistes pour une agence 5-20 personnes — YAGNI) ; l'agent doit signaler la troncature et proposer d'affiner.

## 4. Prompt système

`system-prompt.ts` gagne une section « Exhaustivité » : (1) si `total > mails.length`, boucler avec `offset` avant de conclure ; (2) pour « tous les… » en mutation mail, utiliser les outils `*_by_filter` (jamais des boucles d'ids) ; (3) toujours annoncer une troncature (« j'ai vu 50 projets sur 63 »). Tests de régression du prompt (présence des instructions).

## 5. Sécurité (rappels CLAUDE.md §4)

- `workspaceId` sur toutes les requêtes ; notifications `userId` strict ; mails owner-only via le `where` du core existant.
- Zod sur toutes les entrées ; filtres bornés (longueurs, dates ISO) ; `fromContains` passe par une requête paramétrée (unaccent comme `find_projects` si SQL brut, sinon `mode: 'insensitive'` Prisma).
- describeForConfirm sur re-parse brut ; le label de confirmation reprend le filtre, pas de contenu de mail.
- Aucun nouveau secret, aucune migration de schéma (index `[userId, readAt]` existant suffit).

## 6. Tests

- Unit outils : filtres (chaque critère + combinaisons + rejet filtre vide), scope owner-only/userId, comptes exacts, pagination (total/offset), mark all vs ids.
- Describe : table de vérité compte annoncé = compte du `where` d'exécution ; 0 résultat ; re-parse brut (entrées malformées).
- Prompt : instructions présentes.
- Widgets : mail-list inchangé fonctionnellement avec la nouvelle enveloppe.

## Hors scope

Widget notifications dans le chat (la pile de notices UI existe), pagination des écrans UI, bulk par filtre sur les cartes Kanban, offset sur les listes non-mail.
