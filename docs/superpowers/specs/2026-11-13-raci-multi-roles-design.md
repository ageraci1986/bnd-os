# RACI des cartes : plusieurs personnes par rôle — design

**Date :** 2026-11-13 · **Statut :** validé par Angelo L.

## Problème

Demande client : « j'ai besoin de pouvoir mettre plusieurs personnes avec le même rôle dans la matrice RACI ».

Sur les **cartes**, deux index uniques partiels limitent les rôles R et A à une personne par carte :

- `card_assignees_one_responsible_per_card` : un seul R ;
- `card_assignees_one_accountable_per_card` : un seul A.

Une personne ajoutée est Responsable par défaut. Sur une carte qui a déjà un R, on ne peut donc même pas ajouter une deuxième personne : l'ajout échoue avec « Une seule personne peut être Responsable ».

Les **contacts client** acceptent déjà plusieurs contacts avec le même rôle. Ils ne sont pas concernés.

## Décision

Lever la limite pour **R et A**. C et I étaient déjà illimités.

La clé primaire `(card_id, user_id)` est conservée : une personne n'a toujours qu'**un seul** rôle sur une carte donnée.

## Changements

1. **Migration** `20261113120000_card_assignees_multi_raci` : `DROP INDEX IF EXISTS` des deux index uniques partiels. L'index non unique `card_assignees_card_id_raci_idx` est conservé.
2. **`features/projects/actions/card-assignees.ts`** :
   - supprimer `raciUniqueMessage` et le mapping P2002 associé ;
   - adapter les commentaires.
3. **`lib/assistant/tools/kanban-tools.ts`** : retirer « Un seul responsible et un seul approver par carte » de la description de l'outil.
4. **`assignees-side.tsx`** : commentaire de rollback seulement, aucun changement d'UI.
5. **Schéma Prisma** : mettre à jour le commentaire du modèle `CardAssignee`.
6. **Docs** :
   - CLAUDE.md §6.6, avec une ligne au journal ;
   - PRD (règles RACI) ;
   - progress.md.

## Tests

- Tests unitaires des actions :
  - un 2e R et un 2e A sont acceptés ;
  - plus de message d'unicité.
- Vérification en base : la migration et l'insertion de deux R sur une même carte sont jouées dans une transaction annulée, puis la migration est appliquée (`db execute` + `migrate resolve`).

## Hors périmètre

- Plusieurs rôles pour une même personne sur une carte.
- Toute modification des contacts client.
