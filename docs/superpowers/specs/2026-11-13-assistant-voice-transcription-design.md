# Assistant voix — qualité de la retranscription (parité lleva)

- **Date** : 2026-11-13
- **Statut** : design validé, en attente de relecture du spec
- **Référence** : pile vocale de lleva.io (`src/lib/stt/`, `src/hooks/use-dictation.ts`, `docs/claude/platform/dictee-vocale.md`)
- **Spec précédent** : [2026-08-03-assistant-voice-design.md](./2026-08-03-assistant-voice-design.md)

## 1. Problème

La retranscription du mode voix de l'assistant est en retrait par rapport à celle de lleva, alors que le modèle est le même (Deepgram `nova-3`, `language=multi`, `smart_format`). L'écart vient de ce qui entoure le modèle :

|              | BND OS aujourd'hui                                                 | lleva                                                     |
| ------------ | ------------------------------------------------------------------ | --------------------------------------------------------- |
| Transport    | Enregistrement complet (opus), envoyé au serveur après relâchement | Flux direct navigateur → Deepgram (WebSocket), PCM 16 kHz |
| Affichage    | Rien pendant la parole, puis « Transcription… »                    | Texte en direct                                           |
| Noms propres | Aucune aide                                                        | Glossaire `keyterm` tiré du compte                        |
| Fin de prise | Fichier envoyé tel quel                                            | `Finalize` pour obtenir le définitif                      |
| Correction   | Aucune                                                             | Passe Haiku bornée, repli sur le brut                     |

Symptômes constatés par l'utilisateur : noms propres mal compris, mots ou fins de phrase faux, absence de retour pendant la parole puis attente.

## 2. Objectif et périmètre

Porter dans BND OS les trois mécanismes de lleva, en trois lots livrables séparément.

**Dans le périmètre** : le mode voix de l'assistant (`/assistant`), geste ⌥ Option maintenu et bouton micro maintenu, inchangés.

**Hors périmètre (lot suivant, décidé le 2026-11-13)** :

- la dictée dans les autres champs de BND (commentaires, mails) ;
- le mode mains libres (pression brève, fin de phrase au silence).

Le code du lot 2 ne doit rien faire qui empêche ces deux suites : les modules purs et la capture sont indépendants de l'assistant.

## 3. Faits vérifiés

- `keyterm` est pris en charge par `nova-3` avec `language=multi`, sur l'API par fichier comme en flux. Plafond : 500 tokens par requête, toutes clés confondues.
- `POST /v1/auth/grant` frappe un JWT ; le champ de durée est `ttl_seconds` (un champ inconnu est ignoré sans erreur, durée par défaut 30 s). La clé doit avoir le rôle Member ou plus.
- Le jeton n'a besoin d'être valide qu'à l'ouverture du WebSocket.
- Authentification WebSocket depuis un navigateur : sous-protocole `["bearer", jeton]`. `["token", jeton]` et le jeton en query échouent en silence (code 1006). Mesuré par lleva contre l'API réelle.
- Un terme contenant un chiffre corrompt les nombres dictés autour (« Casa 47 » → « Casa 48 »). Les termes hors-sujet sont inoffensifs jusqu'à 48 termes au moins. Mesuré par lleva.
- Sans `Finalize`, la dernière phrase reste provisoire et nettement moins exacte.

## 4. Lot 1 — glossaire de noms propres

### 4.1 Module pur `packages/domain/src/voice-glossary/`

- `toKeyterms(names: readonly string[]): string[]` — forme envoyée à Deepgram avant la parole :
  - chiffres retirés, espaces normalisés ;
  - termes de 3 à 40 caractères ;
  - dédoublonnage insensible à la casse et aux accents ;
  - plafond `MAX_KEYTERMS = 40`, l'ordre d'entrée est conservé (c'est lui qui survit au plafond).
- `toGlossaryList(names: readonly string[]): string` — forme envoyée à la correction (lot 3) : orthographe exacte, chiffres et casse compris, une entrée par ligne, même plafond.

Aucune dépendance. Couverture 100 %, dont un test qui échoue si le retrait des chiffres est supprimé.

### 4.2 Récolte `apps/web/lib/assistant/voice/glossary-repo.ts`

`loadProperNouns(ctx): Promise<string[]>`, serveur uniquement, Prisma, **toujours** `where: { workspaceId }`, `select` explicite. Ordre :

1. l'utilisateur courant (`firstName lastName` en un seul terme) ;
2. les membres du workspace ;
3. les clients non supprimés et non archivés ;
4. les projets non supprimés ;
5. les contacts non supprimés (`firstName lastName`) ;
6. le nom du workspace.

**Périmètre d'accès** : un membre restreint (`WorkspaceAccess`) ne reçoit que les noms des clients, projets et contacts qu'il a le droit de voir — la récolte passe par `loadUserScope` + `scopedClientWhere` / `scopedProjectWhere`. C'est indispensable dès le lot 2, où les termes sont renvoyés au navigateur avec le jeton.

**Quotas par table** (`take`), pour qu'aucune catégorie n'affame les autres sous le plafond de 40 : 11 membres (utilisateur courant compris), 12 clients, 8 projets, 8 contacts, les plus récemment modifiés d'abord. La fonction ne lève jamais : toute erreur rend une liste vide (la transcription sans glossaire vaut mieux qu'une panne).

**Le glossaire ne doit jamais casser la transcription** : `toKeyterms` borne aussi le total à 800 caractères (marge sous le plafond Deepgram de 500 tokens), et si Deepgram répond 400 à une requête portant des termes, `transcribeAudio` réessaie une fois sans eux.

`toGlossaryList` n'est écrit qu'au lot 3, quand la correction en a besoin.

### 4.3 Branchement

`transcribeAudio(audio, contentType, keyterms)` ajoute un paramètre `keyterm` répété à l'URL Deepgram. La route `/api/assistant/voice/transcribe` appelle `loadProperNouns` puis `toKeyterms`.

### 4.4 Confidentialité

Les noms de membres, clients, projets et contacts partent chez Deepgram dans l'URL de la requête. L'audio les contient déjà, mais c'est une donnée explicite de plus chez le fournisseur : à consigner dans `docs/security.md`. Aucun terme n'est loggé côté BND (§4.7 CLAUDE.md).

## 5. Lot 2 — flux direct

### 5.1 Pourquoi ce transport

Vercel ne peut pas héberger de proxy WebSocket. Le navigateur parle donc à Deepgram directement, avec un jeton éphémère ; la clé maître reste sur le serveur.

### 5.2 Route `POST /api/assistant/voice/token`

1. `getAuthContext()` → 401.
2. `assertCsrfHeader` → 403.
3. Rate limit `assistant_voice_stt` (seau existant, 30/min) → 429.
4. `DEEPGRAM_API_KEY` absente → 503, message générique.
5. `POST https://api.deepgram.com/v1/auth/grant` avec `{ ttl_seconds: 60 }`. Échec → 502, statut seul, jamais le corps de la réponse du fournisseur.
6. Réponse : `{ ok: true, token, keyterms }`, `Cache-Control: no-store`.

Le jeton n'est jamais loggé. En mode `ASSISTANT_E2E_MOCK=1` hors production, la route rend un jeton factice et ne contacte pas Deepgram.

### 5.3 Modules purs `apps/web/lib/assistant/voice/stream/`

| Fichier             | Rôle                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `config.ts`         | modèle, langue, fréquence, sous-protocole `bearer`, `buildListenUrl(keyterms)` — source unique |
| `limits.ts`         | borne dure 60 s, `FINALIZE_GRACE_MS = 700`                                                     |
| `pcm.ts`            | Float32 → Int16 16 kHz mono                                                                    |
| `transcript.ts`     | tampon : segments validés + provisoire courant                                                 |
| `listen-message.ts` | parsing Zod des messages Deepgram (`Results`, `is_final`, `from_finalize`)                     |

Paramètres de connexion : `model=nova-3`, `language=multi`, `encoding=linear16`, `sample_rate=16000`, `channels=1`, `smart_format=true`, `punctuate=true`, `interim_results=true`, plus les `keyterm`.

### 5.4 Capture

`getUserMedia` → `AudioContext` → `AudioWorklet` → trames PCM. Le worklet est servi comme fichier statique depuis notre origine : la CSP actuelle (`script-src 'self'`) suffit, pas de `blob:`. Le stream micro reste caché entre deux prises et son état est vérifié avant réutilisation, comme aujourd'hui.

### 5.5 Hook `use-voice-stream` (remplace `use-voice-recorder`)

États : `idle | connecting | recording | finalizing | denied | unsupported | unavailable`.

- **Démarrage** : jeton, puis micro, puis WebSocket. Un numéro de session, incrémenté par tout arrêt ou annulation, périme un démarrage encore suspendu sur l'une des attentes (pas de micro orphelin).
- **Pendant la prise** : un message provisoire **remplace** le provisoire précédent ; un message définitif s'ajoute aux segments validés.
- **Relâchement** : micro coupé tout de suite, message `Finalize`, attente du définitif jusqu'à `FINALIZE_GRACE_MS`, puis promotion du provisoire restant en validé. Le hook rend le texte complet.
- **Annulation** (Échap, perte de focus fenêtre) : fermeture immédiate, rien n'est rendu.
- **Borne 60 s** : même séquence que le relâchement, texte livré par `onAutoStop`.
- **Erreurs** : refus de permission → `denied` ; micro occupé ou débranché → `unavailable` ; WebSocket fermé avant ouverture (1006) ou jeton refusé → notice « Transcription indisponible — réessayez. ».

### 5.6 Interface

- La capsule affiche le texte en direct pendant la prise (repli sur « J'écoute… relâche pour envoyer » tant qu'aucun mot n'est arrivé).
- Le mode `transcribing` disparaît de `VoiceCapsule` et de `useVoiceMode`.
- `aria-live="polite"` est conservé sur le wrapper ; le texte en direct n'est **pas** dans la région live (une relecture à chaque mot serait inutilisable au lecteur d'écran), seul le changement d'état l'est.
- Story Storybook mise à jour.

### 5.7 CSP

Ajout de `wss://api.deepgram.com` à `connect-src` dans `apps/web/lib/security/csp.ts`, avec le test `buildCsp` correspondant. `Permissions-Policy: microphone=(self)` est déjà en place.

### 5.8 Nettoyage

En fin de lot : suppression de `/api/assistant/voice/transcribe`, de `transcribeAudio` et de `use-voice-recorder`, avec leurs tests. L'audio ne transite plus par notre serveur.

## 6. Lot 3 — correction au relâchement

### 6.1 Ordre des opérations

1. Le hook rend le transcript brut.
2. Confirmation vocale stricte (`voice-confirm`) sur le **brut**. S'il est consommé comme Autoriser/Refuser : fin, aucune correction.
3. Sinon, correction ; puis envoi à l'agent du texte corrigé, ou du brut en cas de repli.

### 6.2 Module pur `packages/domain/src/voice-polish/`

- `shouldPolish(raw)` : faux sous 12 caractères ou au-delà de 6000.
- `acceptPolished(raw, candidate)` : rend `candidate` si sa longueur est entre 55 % et 135 % de l'entrée, sinon `raw`.
  - Le plancher se mesure sur la **prose** : lettres seules, hors chiffres et mots de nombre (`pour`, `cent`, `mille`, `euros`, `virgule`, `millions`…). Sans cela, « 30 pour 100 » → « 30 % » tombe sous le seuil et la correction est refusée en silence.
  - Le plafond se mesure sur le texte entier.

Couverture 100 %, avec les tests dans les deux sens : un vrai résumé est refusé, une mise en forme de nombres est acceptée.

### 6.3 Route `POST /api/assistant/voice/polish`

Auth, CSRF, nouveau seau `assistant_voice_polish` (30/min), corps Zod `{ text: string().max(6000) }`. Appel Haiku via le seam Anthropic existant, température basse, délai 3 s. Glossaire fourni par `toGlossaryList`. Réponse `{ ok: true, polished: string | null }` ; `null` si rien n'a changé ou si le garde-fou a refusé. Toute défaillance rend `polished: null` (le client garde le brut).

### 6.4 Prompt

Constante versionnée `apps/web/lib/assistant/voice/polish-prompt.ts`, reprise de lleva :

- **fait** : retirer hésitations, faux départs et répétitions ; rétablir ponctuation, majuscules, accents ; corriger accords et conjugaisons ; écrire nombres, montants et pourcentages en chiffres selon le contexte ; rétablir l'orthographe exacte des noms du glossaire ;
- **ne fait jamais** : reformuler, résumer, ajouter, changer le registre, corriger le fond, modifier une valeur chiffrée ;
- rend le texte seul ; inchangé s'il est déjà propre.

Corriger un nom propre est posé comme la seule exception à « ne change pas les mots de la personne ».

### 6.5 Interface

État `polishing` dans la capsule : « Je relis… ». Pas de bouton de retour au brut : le texte part à l'agent, il n'est pas édité dans un champ (ce bouton viendra avec la dictée dans les champs).

## 7. Tests

- **Domain** : 100 % sur `voice-glossary` et `voice-polish`.
- **Routes** (intégration) : 401, 403, 429, 503 sans clé, 502 sur panne fournisseur ; aucune réponse ni erreur ne contient la clé, le jeton maître ou le corps de réponse du fournisseur.
- **Hook** (faux WebSocket, faux micro) : provisoire remplacé et non concaténé ; `Finalize` envoyé au relâchement ; promotion du provisoire à l'expiration de la grâce ; relâchement pendant l'attente du jeton puis pendant l'attente du micro ; annulation.
- **`useVoiceMode`** : confirmation consommée → pas d'appel à la correction ; repli sur le brut quand la correction rend `null` ou échoue.
- **E2E** : `page.routeWebSocket` intercepte `wss://api.deepgram.com` et joue un script de messages ; le spec `assistant-voice.spec.ts` est adapté. Aucun chemin de mock dans le code client.

## 8. Sécurité — récapitulatif

| Point         | Traitement                                                                     |
| ------------- | ------------------------------------------------------------------------------ |
| Clé Deepgram  | serveur uniquement ; le navigateur ne reçoit qu'un JWT de 60 s                 |
| Jeton         | jamais loggé, `no-store`, frappé après auth + CSRF + rate limit                |
| CSP           | une seule origine ajoutée, en `connect-src`                                    |
| Multi-tenant  | récolte du glossaire filtrée par `workspaceId`                                 |
| PII           | noms envoyés à Deepgram (documenté) ; rien dans les logs ; audio jamais stocké |
| Actions gated | la confirmation vocale ne passe jamais par un LLM                              |

## 9. Prérequis et documentation

- Clé Deepgram de rôle Member : mise à jour dans Vercel le 2026-11-13. À reporter aussi dans `.env.local` pour le développement.
- Aucune migration, aucune table, aucune nouvelle variable d'environnement, aucune nouvelle dépendance.
- À mettre à jour à la livraison : `CLAUDE.md` (§11), `progress.md`, `docs/security.md` (flux audio direct, CSP, glossaire), `.env.example` (commentaire sur le rôle de la clé).

## 10. Ordre de livraison

| Lot | Contenu                                               | Dépend de |
| --- | ----------------------------------------------------- | --------- |
| 1   | glossaire + branchement sur la route actuelle         | —         |
| 2   | jeton, capture, flux, texte en direct, CSP, nettoyage | 1         |
| 3   | correction au relâchement                             | 1, 2      |

Une PR par lot. Les lots 2 et 3 touchent la CSP et un flux de données vers un tiers : revue de sécurité requise (§5.6 CLAUDE.md).
