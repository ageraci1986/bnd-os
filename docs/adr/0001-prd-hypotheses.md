# ADR 0001 — Validation des 15 hypothèses PRD §10

- **Statut :** Accepté
- **Date :** 2026-04-27
- **Décideur :** Angelo L.
- **Documents liés :** [PRD-NexusHub.md §10](../../PRD-NexusHub.md), [CLAUDE.md §9](../../CLAUDE.md)

## Contexte

Le PRD v0.1 listait 15 hypothèses ou ambiguïtés à trancher avant développement. Cette ADR consigne les décisions actées en atelier produit le 2026-04-27.

## Décisions

| #   | Hypothèse                                   | Décision                                                                                                                                   | Justification                                                                                                        |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Durée validité lien d'invitation            | **72h**                                                                                                                                    | Délai standard cohérent avec les habitudes des équipes (week-end inclus). Suffisant sans devenir un risque sécurité. |
| 2   | Archivage carte 30j en dernière colonne     | **Oui, opt-in par projet**                                                                                                                 | Évite l'archivage sauvage. Réglage "Archivage auto Done après 30j" dans paramètres projet.                           |
| 3   | Navigation calendrier                       | **Précédent / Suivant + bouton "Aujourd'hui" + sélecteur mois/année**                                                                      | Pattern UX standard. Mémoire du dernier mois consulté en URL.                                                        |
| 4   | Bandeau d'alerte carte en Bloqué            | **Oui, rouge, en tête du modal, CTA "Modifier l'échéance"**                                                                                | Rendre l'action de déblocage immédiate.                                                                              |
| 5   | Rôles projet (étape 4 wizard)               | **Lead / Member** (2 rôles uniquement V1)                                                                                                  | Suffisant pour V1. Le Lead pilote les écarts d'échéance.                                                             |
| 6   | Modification du rôle d'un membre existant   | **Oui, Admin uniquement**                                                                                                                  | Permet promotion/dégradation sans recréation. Audit log obligatoire.                                                 |
| 7   | Protection du dernier Admin                 | **Oui, contrainte DB + UI**                                                                                                                | `CHECK (admins_count >= 1)` via trigger Postgres. UI désactivée.                                                     |
| 8   | Gestion intégrations par Membre             | **Slack = Admin (workspace) ; Exchange = délégué (chacun connecte sa boîte)**                                                              | Slack mappe canaux → clients (workspace). Exchange est par défaut une boîte personnelle.                             |
| 9   | Profil utilisateur                          | **Avatar (upload Supabase Storage) + nom/prénom + changement mot de passe + langue** dans Settings                                         | Standard.                                                                                                            |
| 10  | Sauvegarde Paramètres                       | **Automatique avec toast confirmation**                                                                                                    | Réduit la friction. Debounce 500ms côté client.                                                                      |
| 11  | Types d'événements notifiables              | **Liste fixe V1 (5 types)** : carte assignée, commentaire, carte bloquée, nouveau mail client, mention Slack. Granularité on/off par type. | Périmètre limité, extensible V1.5.                                                                                   |
| 12  | Niveau accessibilité                        | **WCAG 2.1 AA**                                                                                                                            | Standard du marché B2B. Vérifié par axe-core et Lighthouse.                                                          |
| 13  | Navigateurs supportés                       | **Chrome / Edge / Firefox / Safari — 2 dernières versions stables**                                                                        | Cohérent avec public agence. Pas d'IE, pas de polyfills lourds.                                                      |
| 14  | Suppression d'un client avec projets actifs | **Interdite. Message d'erreur listant les projets concernés avec liens d'archivage**                                                       | Protège les données. L'utilisateur doit archiver les projets d'abord.                                                |
| 15  | Suppression d'un projet                     | **Soft delete + corbeille 30j, restauration par Admin**                                                                                    | Sécurité contre accident. Champ `deleted_at` + UI corbeille dans Settings projet.                                    |

## Conséquences

- Les contraintes DB (dernier-Admin, soft delete) doivent être implémentées en Phase 2.
- Les tests E2E doivent couvrir : invitation expirée à 72h, refus de suppression client avec projets, restauration depuis corbeille.
- Les hypothèses 11 (notifications) et 5 (rôles projet) figent le modèle de données dès Phase 2.

## Révision

Cette ADR peut être amendée si une hypothèse se révèle inadéquate à l'usage. Toute modification doit faire l'objet d'un commit avec message `docs(adr): amend ADR 0001 #N`.
