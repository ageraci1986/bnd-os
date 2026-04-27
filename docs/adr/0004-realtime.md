# ADR 0004 — Realtime : Supabase Realtime

- **Statut :** Accepté
- **Date :** 2026-04-27

## Contexte

Le Kanban et les communications nécessitent une synchronisation temps réel multi-utilisateurs :

- Carte déplacée, créée, supprimée
- Checklist cochée → progression auto
- Carte passe en Bloqué
- Nouveau message Slack / mail
- Présence (qui regarde ce projet ?)

## Options évaluées

| Critère                    | Supabase Realtime |  Pusher   | Socket.io self-hosted |
| -------------------------- | :---------------: | :-------: | :-------------------: |
| Native Postgres CDC        |        ✅         |    ❌     |          ❌           |
| Broadcast (channel custom) |        ✅         |    ✅     |          ✅           |
| Presence                   |        ✅         |    ✅     |      ✅ (manuel)      |
| Coût                       |    Inclus Pro     | ~50$/mois |     infra à gérer     |
| Latence                    |      < 100ms      |  < 50ms   |        dépend         |

## Décision

**Supabase Realtime** retenu pour V1 :

- Inclus dans le plan Supabase (pas de service additionnel)
- 3 modes utilisés :
  - **Postgres CDC** : écoute des changements de tables (`cards`, `checklist_items`, `comments`)
  - **Broadcast** : événements applicatifs (auto-move countdown annulé, signal "user is typing")
  - **Presence** : qui regarde le projet en temps réel (avatars en haut du Kanban)

## Channels

| Channel                           | Type                    | Membres                            | Cas d'usage                                        |
| --------------------------------- | ----------------------- | ---------------------------------- | -------------------------------------------------- |
| `workspace:<id>`                  | Postgres CDC            | tous les membres du workspace      | Activité globale, métriques Overview               |
| `project:<id>`                    | Postgres CDC + Presence | tous les membres du projet         | Kanban + presence avatars                          |
| `card:<id>`                       | Broadcast               | utilisateurs ayant le modal ouvert | Countdown auto-move, "typing", édition concurrente |
| `comm:<workspace_id>:<client_id>` | Postgres CDC            | membres du workspace               | Communications filtrées par client                 |

## Sécurité

- RLS Postgres s'applique aux subscriptions Realtime (mêmes policies que les requêtes).
- Aucun token sensible diffusé en broadcast.
- Le serveur **diffuse les events**, jamais le client → un client malicieux ne peut pas faire passer une carte d'un workspace à l'autre.

## Fallback

Si Realtime indisponible (incident Supabase), polling 5s sur le Kanban (graceful degradation). Toast informatif "Synchronisation en différé".

## Conséquences

- Hooks `useKanbanRealtime(projectId)`, `useCardRealtime(cardId)`, `usePresence(projectId)`.
- Debounce updates locales 50ms pour éviter les saccades.
- Test E2E multi-onglet : ouvrir Kanban dans 2 navigateurs, déplacer carte, vérifier sync < 1s.
