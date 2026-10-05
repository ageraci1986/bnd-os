# ClamAV — auto-réparation + alerte

- **Date :** 2026-10-05 · **Branche :** `chore/clamav-infra` (PR #38) · **Statut :** validé (Angelo L.)
- **Contexte :** clamd est mort d'OOM le 2026-09-05 ; le conteneur Fly (`nexushub-clamav`) est resté vivant
  (`/init` finit par `exec tail -f /dev/null`), donc jamais relancé ; personne n'a été prévenu pendant un mois
  (toutes les PJ refusées, fail-closed). Cause racine corrigée (`ConcurrentDatabaseReload no`) ; il reste à
  rendre une future panne **auto-réparable** et **visible**.

## 1. Auto-réparation (Fly)

- `infra/clamav/supervise.sh` monté via `[[files]]` (`/usr/local/bin/clamav-supervise.sh`) et utilisé comme
  entrypoint (`[experimental] entrypoint`) :
  1. lance `/init` (comportement d'origine de l'image) en arrière-plan ;
  2. attend que clamd réponde à `clamdscan --ping` (timeout de démarrage 30 min, comme `/init`) ;
  3. boucle toutes les 60 s : `clamdscan --ping 3:10` (3 tentatives espacées de 10 s, tolère un reload de base) ;
     échec → log + `exit 1`.
- `fly.toml` : `[[restart]] policy = "always"` → Fly relance la machine, clamd recharge sa base (1–2 min).

## 2. Alerte (app web, Inngest)

- Fonction Inngest `clamav-health`, cron `*/10 * * * *`.
- Sonde : connexion TCP `CLAMAV_HOST:CLAMAV_PORT`, envoi `zPING\0`, réponse `PONG` attendue, timeout 5 s.
  `CLAMAV_HOST` absent → considéré en panne (même sémantique fail-closed que le scan).
- État dans Redis (Upstash, client existant ; repli mémoire hors prod) : `ops:clamav:fails` (compteur
  d'échecs consécutifs), `ops:clamav:alert_sent` (bool).
- Règles :
  - succès → `fails = 0` ; si `alert_sent` → email « Antivirus rétabli » + `alert_sent = false` ;
  - échec → `fails += 1` ; si `fails >= 2` et (`alert_sent` faux ou dernier envoi > 6 h) → email « Antivirus
    hors service » + `alert_sent = true` (horodaté).
- Destinataires : utilisateurs `isSuperAdmin = true` (aucun nouveau secret / env). Email via `getEmail()`
  (Resend). Contenu : statut, depuis quand, impact (« les pièces jointes mail et cartes sont refusées »),
  lien runbook ; aucune donnée utilisateur.
- Cœur pur `runClamavHealth(deps)` testé (pattern `blocked-cards-scan.ts`), export Inngest = simple fil ;
  garde d'imports (pas d'agent/provider/registry).

## 3. Tests

- Cœur : succès sans alerte, 1 échec (pas d'email), 2 échecs (email), 3e échec < 6 h (pas de doublon),
  > 6 h (relance), rétablissement (email « rétabli »), host absent.
- Sonde : PONG → ok ; timeout / réponse inattendue / refus → ko (serveur TCP local de test).
- Supervision Fly : vérifiée manuellement (kill de clamd → redémarrage machine), documentée dans le runbook.
