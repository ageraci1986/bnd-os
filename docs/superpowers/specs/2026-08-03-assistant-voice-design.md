# Assistant — Mode voix (V1.5) — Design

> Spec validée par brainstorm (superpowers:brainstorming) le 2026-08-03.
> Contexte : itération voix de l'Assistant NexusHub, différée de la V1 (décision « Texte d'abord » du 2026-07-27). Le socle est prêt : état d'orbe `listening`, micro grisé placeholder, boucle agent SSE + gate + widgets en prod.
> Référence d'inspiration : projet Alfred d'Angelo (`/Users/angelogeraci/Documents/Application/Alfred/alfred/voice/`) — Deepgram nova-3 REST sur push-to-talk, ElevenLabs flash streaming PCM, machine à états idle→listening→thinking→speaking avec interruption.

## Décisions produit (Q&A Angelo, 2026-08-02/03)

| Sujet               | Décision                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Déclenchement       | **Push-to-talk** : maintenir **⌥ Option** (gauche ou droite, par défaut, quand le champ texte n'a pas le focus) OU maintien du bouton micro à la souris. Échap pendant l'écoute = annuler. |
| Sortie vocale       | **Symétrique** : question vocale → réponse parlée + texte ; question tapée → texte silencieux.                                                                                             |
| Confirmations gated | **Confirmation vocale acceptée**, avec garde-fous stricts (voir §4).                                                                                                                       |
| Portée              | **Page /assistant uniquement.** Pas d'orbe globale.                                                                                                                                        |
| Architecture        | **« Alfred web »** : REST + streaming via proxy serveur. Pas de WebSocket temps réel, pas de Web Speech API.                                                                               |
| Providers           | **Deepgram `nova-3`** (STT, langue `multi`, smart_format) + **ElevenLabs `eleven_flash_v2_5`** (TTS streaming).                                                                            |

## 1. Expérience utilisateur

Machine à états côté client : `idle → listening → transcribing → (boucle agent existante) → speaking → idle`.

- **Écoute** : Option maintenue (ou micro maintenu) → orbe `listening`, capsule « J'écoute… relâche pour envoyer » avec indication « ✕ Échap pour annuler ». Le placeholder du champ devient « 🎙 Maintiens Option (ou le micro) pour parler… ».
- **Relâche** : l'audio part en transcription (capsule « Transcription… » atténuée). Le transcript est inséré comme **message utilisateur ordinaire** dans le chat — la boucle agent (outils, widgets, gate, audit) est **inchangée**.
- **Réponse** : si le tour a été initié à la voix, les réponses textuelles de l'assistant sont lues **phrase par phrase** pendant que le texte streame (orbe `responding` + capsule « Je parle… » avec onde + bouton **■ Stop**). Rappuyer sur Option **interrompt** la lecture ET la génération en cours (même mécanique que le stop existant), puis relance l'écoute.
- **Ce qui est lu** : uniquement le texte de l'assistant. Jamais le contenu des widgets (listes de mails, boards, briefing KPI) — pas de tunnel audio de 2 minutes.
- **Permission micro** : demandée au premier usage (`getUserMedia`). Refus → capsule d'aide expliquant comment réactiver dans le navigateur ; le micro reste grisé. Tant que la permission n'est pas accordée, Option ne déclenche rien.
- **Énoncé vide** : transcript vide ou blanc → notice discrète « Je n'ai rien entendu », aucun message envoyé, retour à `idle`.
- **Bilingue** : tous les libellés (capsule, hints, erreurs) via next-intl FR/EN. `nova-3` en `multi` transcrit FR et EN sans configuration par utilisateur.
- **Accessibilité** : la capsule est `aria-live=polite` ; le bouton micro a un label explicite ; le PTT clavier ne détourne jamais la saisie (Option seule, champ non focalisé) ; tout reste faisable à la souris.

## 2. STT — transcription

- **Client** : capture `MediaRecorder` (webm/opus), bornée à **60 s max** par énoncé (arrêt automatique + envoi au-delà). Pas de VAD, pas de streaming : le PTT donne les bornes exactes (choix identique à Alfred — un appel REST est aussi rapide qu'un socket dans ce cas).
- **Serveur** : `POST /api/assistant/voice/transcribe` (body binaire audio) → Deepgram `nova-3`, `language: multi`, `smart_format: true` → `{ transcript: string }`.
- **Seam provider** : l'appel Deepgram est isolé derrière une fonction unique (pattern `stt.py` d'Alfred / provider seam existant) — mockable en test et en E2E.
- **Sécurité** : `requireUser` obligatoire ; rate limit Upstash **30 requêtes/min/user** ; taille de body plafonnée (~2 Mo, cohérent avec 60 s d'opus) ; l'audio n'est **jamais stocké ni loggé** (ni chez NexusHub, ni en persistance Deepgram — pas d'option de rétention activée) ; clé `DEEPGRAM_API_KEY` côté serveur uniquement, jamais dans une réponse ou une erreur.

## 3. TTS — synthèse

- **Découpage** : un **chunker de phrases** pur TypeScript (inspiré de `chunker.py` d'Alfred) découpe les deltas SSE en phrases prêtes à vocaliser. Placé dans un package pur (domain/agent), couvert à 100 %.
- **Client** : pour chaque phrase, `POST /api/assistant/voice/speak` → lecture en **file d'attente séquentielle** via Web Audio ; `AbortController` pour annuler la file au Stop / interruption / nouveau tour.
- **Serveur** : proxifie le stream **ElevenLabs `eleven_flash_v2_5`** (latence première phrase ~300 ms). Voix par défaut : `ELEVENLABS_VOICE_ID` (env). Un sélecteur de voix dans Settings est explicitement **hors scope**.
- **Sécurité** : `requireUser` + rate limit Upstash **60 requêtes/min/user** (plusieurs phrases par réponse) + longueur de texte plafonnée à **1 000 caractères** par requête ; clé `ELEVENLABS_API_KEY` serveur uniquement.

## 4. Confirmation vocale des actions gated

Quand un widget Autoriser/Refuser est en attente **et** que le tour était vocal :

1. L'assistant **lit à voix haute le récapitulatif** de confirmation (le même texte que celui affiché par le widget — `describeForConfirm`).
2. La prochaine phrase PTT est comparée à des motifs **stricts, exacts et déterministes** (après normalisation casse/ponctuation) :
   - Autoriser : « oui », « autorise », « valide », « envoie », « confirme », « go » (+ équivalents EN : yes / confirm / send / approve)
   - Refuser : « non », « refuse », « annule », « stop » (+ EN : no / cancel / deny)
3. Correspondance exacte → **clic simulé** sur le bouton correspondant : même chemin de code, même ConfirmStore, même audit. Aucun chemin parallèle.
4. Tout autre énoncé (« euh oui enfin attends… ») → réponse vocale « Dis clairement oui ou non, ou clique sur le bouton », widget toujours cliquable. **Aucune interprétation LLM** de la décision — pattern matching uniquement : pas de faux positif possible sur une action irréversible.

## 5. Sécurité & conformité (rappel des règles CLAUDE.md §4)

- Secrets : `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` — env serveur, listés dans `.env.example` sans valeur, **demandés à Angelo à l'implémentation** (jamais inventés). Aucun `NEXT_PUBLIC_*`.
- Transcripts = contenu utilisateur ordinaire : stockés comme les messages tapés, jamais en log applicatif (PII).
- Routes voice : Zod sur les entrées, `requireUser`, rate limit Upstash, pas de token/clé dans les erreurs.
- CSP : lecture audio via Web Audio à partir de réponses fetch même origine — aucune source externe côté client.

## 6. Coûts estimés

Usage soutenu (~50 échanges vocaux/jour) : Deepgram ~0,004 $/min → **~1 $/mois** ; ElevenLabs Flash ~0,07 $/1000 caractères → **~5-10 $/mois**. Négligeable ; pas de quota applicatif au-delà des rate limits.

## 7. Tests

- **Unit 100 %** : chunker de phrases (package pur) ; machine à états PTT (hook React testé — transitions, Échap, interruption, permission refusée, transcript vide).
- **Intégration** : routes `transcribe` et `speak` avec providers mockés (auth, rate limit, plafonds, erreurs provider mappées en messages génériques).
- **Confirmation vocale** : table de vérité des motifs (oui/non/ambigus, FR/EN, casse/ponctuation).
- **E2E** (env-gated, mécanique `ASSISTANT_E2E_MOCK` existante) : parcours PTT complet avec STT/TTS scriptés.
- **Storybook** : états capsule (écoute, transcription, parole) + orbe `listening`.

## 8. Hors scope V1.5 (explicite)

Mains libres / VAD, wake word, voix hors page /assistant, lecture vocale des notifications/briefings/widgets, sélecteur de voix dans Settings, choix de langue STT par utilisateur, transcription live affichée pendant l'énoncé (nécessiterait le streaming WebSocket écarté).
