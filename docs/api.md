# API contracts — NexusHub

> Catalogue des endpoints exposés par `apps/web`. Mis à jour à chaque feature.
>
> **Convention** : préférer les **Server Actions** pour les mutations issues de l'UI. Les **Route Handlers** (`app/api/*/route.ts`) sont réservés aux webhooks externes et aux clients tiers.
>
> **Format** : OpenAPI 3.1 généré en Phase 11 depuis les schémas Zod (`zod-to-openapi`).

---

## Endpoints (squelette)

| Endpoint                            | Méthode | Auth                          | Description                   | Phase |
| ----------------------------------- | ------- | ----------------------------- | ----------------------------- | ----- |
| `/api/inngest`                      | POST    | Inngest signing               | Worker handler                | 5–6   |
| `/api/webhooks/slack/events`        | POST    | Slack signature               | Slack Events API              | 6.1   |
| `/api/webhooks/slack/oauth`         | GET     | OAuth state                   | Callback OAuth Slack          | 6.1   |
| `/api/webhooks/graph/notifications` | POST    | clientState + validationToken | Webhook Graph                 | 6.2   |
| `/api/webhooks/graph/oauth`         | GET     | OAuth state                   | Callback OAuth Graph          | 6.2   |
| `/api/integrations/graph/auth`      | GET     | session                       | Initie OAuth Graph (per-user) | 6.2   |
| `/api/auth/callback`                | GET     | session                       | Callback Supabase Auth        | 2.3   |
| `/api/healthz`                      | GET     | public                        | Health probe                  | 1     |

## Server Actions (par feature)

| Action                                                              | Permissions                                      | Phase |
| ------------------------------------------------------------------- | ------------------------------------------------ | ----- |
| `createInvitation`                                                  | Admin                                            | 2.3   |
| `acceptInvitation`                                                  | public + token                                   | 2.3   |
| `removeMember`                                                      | Admin (avec dernier-Admin protégé)               | 9.1   |
| `changeMemberRole`                                                  | Admin                                            | 9.1   |
| `createClient`, `updateClient`, `deleteClient`                      | Member (deleteClient → bloqué si projets actifs) | 4     |
| `createContact`, `updateContact`, `setRACI`                         | Member                                           | 4     |
| `createProject`, `updateProject`, `archiveProject`, `deleteProject` | Member                                           | 5.1   |
| `createCard`, `updateCard`, `moveCard`, `archiveCard`               | Member                                           | 5.3   |
| `addChecklistItem`, `toggleChecklistItem`, `removeChecklistItem`    | Member                                           | 5.4   |
| `createComment`, `updateComment`, `deleteComment`                   | Member (own only)                                | 5.4   |
| `createKanbanTemplate`, `updateKanbanTemplate`                      | Member                                           | 7.2   |
| `createEmailTemplate`, `updateEmailTemplate`                        | Member                                           | 7.1   |
| `connectSlackWorkspace`, `disconnectSlack`                          | Admin                                            | 6.1   |
| `connectGraphMailbox`, `disconnectGraph`                            | Self                                             | 6.2   |
| `updateUserSettings`                                                | Self                                             | 9.2   |
| `togglePushSubscription`                                            | Self                                             | 9.3   |

## Conventions de réponse

```ts
// Succès
{ ok: true, data: T }

// Erreur métier
{ ok: false, error: { code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | ..., message: string, issues?: ZodIssue[] } }
```

Les Server Actions retournent `ActionResult<T>` (helper côté `lib/security/action.ts`).
