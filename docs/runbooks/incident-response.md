# Runbook — Réponse à incident

> **Owner :** Angelo L. (jusqu'à constitution équipe ops)
> **Canaux d'alerte** : Slack `#ops`, Sentry, Better Stack uptime
> **Phases** : Détection → Confinement → Éradication → Restauration → Postmortem

## Sévérité

| Niveau   | Définition                                                          | SLA réponse |
| -------- | ------------------------------------------------------------------- | ----------- |
| **SEV1** | Service indisponible OU fuite de données confirmée                  | 15 min      |
| **SEV2** | Fonctionnalité critique cassée OU vulnérabilité haute non exploitée | 1 h         |
| **SEV3** | Bug significatif OU dégradation de performance                      | 4 h         |
| **SEV4** | Bug mineur, contournement disponible                                | 24 h        |

## Procédure générique

1. **Détection** — alerte Sentry / monitoring / signalement utilisateur
2. **Triage** : SEV ?
3. **Confinement** :
   - SEV1 sécurité : rotation immédiate des secrets compromis (cf. [`secret-rotation.md`](./secret-rotation.md))
   - Désactivation feature flag si ciblée
   - Mode maintenance si nécessaire (`/maintenance` page)
4. **Investigation** : logs Sentry + Vercel + Supabase, reproduire en staging
5. **Éradication** : correctif + test régression
6. **Validation** : staging d'abord, puis production progressive
7. **Communication** : status page + email/Slack utilisateurs si visible
8. **Postmortem** sous 5 jours ouvrés (template `postmortem.md` à créer en Phase 13)

## Scénarios prédéfinis

### A. Fuite de la `SUPABASE_SERVICE_ROLE_KEY`

1. **Roll** la clé dans Supabase immédiatement
2. Mettre à jour Vercel et redéployer
3. Vérifier les logs Supabase pour activité suspecte (Audit logs Supabase Pro)
4. Forcer la déconnexion de toutes les sessions actives (`auth.admin.signOutAllUsers()`)
5. Notifier les utilisateurs si une exfiltration est confirmée (DPO + RGPD 72h)

### B. Fuite de la `ENCRYPTION_KEY`

1. Toutes les données chiffrées doivent être considérées comme compromises (tokens OAuth Slack/Graph)
2. **Révoquer** tous les tokens OAuth côté fournisseurs (Slack `auth.revoke`, Graph `revokeSignInSessions`)
3. Forcer la **reconnexion** des intégrations (UI + email à tous les utilisateurs concernés)
4. Générer une nouvelle clé, supprimer les anciens tokens chiffrés
5. Postmortem RGPD

### C. Multi-tenant leakage suspecté

1. Mettre l'app en **mode lecture seule** via feature flag
2. Identifier l'endpoint / requête fuyant (logs Sentry)
3. Audit RLS Postgres : vérifier policies sur la table concernée
4. Patch + test "anon role" en CI
5. Notifier les workspaces affectés (RGPD 72h si confirmé)

### D. Brute force login

1. Vérifier les rate limits Upstash actifs
2. Bannir IPs récidivistes via Vercel Edge Middleware (allowlist `BANNED_IPS`)
3. Ajouter CAPTCHA temporaire (Cloudflare Turnstile, prêt mais non activé en V1)
4. Postmortem si > 100 tentatives sur un compte unique

### E. Webhook Slack/Graph spam

1. Vérifier signature dans logs (rate de rejet)
2. Si signatures valides → contacter Slack/Microsoft (compromission de leur côté ?)
3. Si signatures invalides → bloquer source IP au niveau Vercel

## Contact

| Rôle              | Contact                                 | Backup |
| ----------------- | --------------------------------------- | ------ |
| Owner sécurité    | Angelo L. — `ageraci.finance@gmail.com` | —      |
| DPO (RGPD)        | _à nommer_                              | —      |
| Provider Supabase | support.supabase.com                    | —      |
| Provider Vercel   | vercel.com/help                         | —      |
