# Runbook — Rotation des secrets

> **Fréquence** : trimestrielle pour les secrets 🔴 critiques, semestrielle pour les 🟠 élevés, annuelle pour les 🟡 moyens.
> **Référence** : [docs/security.md §3](../security.md)

## Procédure générique

1. Annoncer la rotation dans #ops (Slack interne) avec fenêtre planifiée.
2. Générer la **nouvelle valeur** localement (jamais sur un environnement partagé).
3. Pour les clés à versioning (ex: `ENCRYPTION_KEY`), incrémenter `KEY_VERSION` et garder l'ancienne valeur active jusqu'à migration des données.
4. Mettre à jour la valeur dans **Vercel** (`Production` puis `Preview`) — utiliser **Encrypted Env**.
5. Redéployer (ou rollover automatique selon le service).
6. **Vérifier** le bon fonctionnement (smoke test E2E sur staging d'abord).
7. **Révoquer** l'ancienne valeur côté fournisseur (Supabase / Slack / Graph / Resend / etc.).
8. **Archiver** la rotation dans `docs/runbooks/rotations.log` (date, secret, raison, opérateur).
9. Mettre à jour la date "dernière rotation" dans [`docs/security.md §3`](../security.md).

## Secrets spécifiques

### `ENCRYPTION_KEY` (chiffrement tokens OAuth)

⚠ Cette rotation est plus complexe car les données chiffrées (tokens stockés en DB) doivent être ré-encryptées.

1. Générer la nouvelle clé : `openssl rand -base64 32`
2. Ajouter en env avec un **nouveau version number** : `ENCRYPTION_KEY_V2`, `ENCRYPTION_KEY_VERSION=2`
3. Garder `ENCRYPTION_KEY_V1` accessible pour le décryptage des données existantes
4. Lancer le job Inngest `crypto.reencrypt_v1_to_v2` (idempotent, page-by-page)
5. Une fois 100 % migré, supprimer `ENCRYPTION_KEY_V1`
6. Documenter dans `rotations.log`

### `SUPABASE_SERVICE_ROLE_KEY`

1. Régénérer dans Supabase Dashboard → Settings → API → "Roll service_role key"
2. Mettre à jour Vercel
3. Redéployer (la clé tournée invalide les anciennes immédiatement)
4. Vérifier les jobs Inngest qui dépendent de cette clé

### `SLACK_SIGNING_SECRET`

1. Slack App → Basic Information → "Reissue signing secret"
2. Mettre à jour Vercel
3. Redéployer
4. Vérifier réception d'un événement Slack de test

### `GRAPH_CLIENT_SECRET`

1. Azure AD → App registrations → NexusHub → Certificates & secrets → New
2. Garder l'ancienne valide jusqu'à confirmation
3. Mettre à jour Vercel et redéployer
4. Tester un OAuth flow complet
5. Supprimer l'ancien secret dans Azure

### `INVITATION_SECRET`

1. Générer : `openssl rand -hex 32`
2. Mettre à jour Vercel et redéployer
3. ⚠ Toutes les invitations en cours seront invalidées → notifier les Admins
4. Optionnel : double-secret window (V1) où l'ancienne signature reste valide 72h

## En cas d'urgence (compromission)

Suivre [`docs/runbooks/incident-response.md`](./incident-response.md) — la rotation devient prioritaire et bypass la procédure planifiée.
