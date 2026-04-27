# PRD — NexusHub

> **Version :** 0.1 (Draft pour revue)
> **Date :** 13 avril 2026
> **Auteur :** Angelo L.
> **Statut :** Draft — à valider par le client / l'équipe de développement
> **Type de document :** Cahier des charges fonctionnel (user-focused)

---

## 1. Vision produit

- **Problème** — Les agences travaillent avec une multiplicité d'outils (messagerie, Slack, Trello, CRM, Drive…) où l'information se disperse, génère de la friction et une charge mentale importante pour les équipes de production.
- **Promesse** — NexusHub offre un espace de travail unique organisé autour de la structure **Client › Projet › Tâche**, qui agrège la gestion de projet, les communications et la connaissance client dans un seul contexte navigable.
- **Pour qui** — Agences de **5 à 20 collaborateurs**, qui jonglent entre plusieurs clients actifs simultanément.

## 2. Objectifs produit

1. **Diviser par deux le temps passé à chercher de l'information** liée à un client (mail, brief, avancement projet, contact).
2. **Supprimer la gestion manuelle de l'avancement** des tâches Kanban grâce à la progression automatique par checklist.
3. **Offrir une lecture immédiate** de l'état de l'activité (projets en cours, tâches bloquées, échéances du jour) à l'ouverture de l'app.
4. **Donner à chaque client un dossier complet et structuré** (fiche, contacts, RACI, historique de communications) accessible en un clic.
5. **Rendre l'app utilisable par un collaborateur non-formé** en moins de 10 minutes après invitation.

## 3. Périmètre

### Dans le périmètre V1

- Authentification (login) et onboarding par invitation
- Dashboard Overview avec filtre client global
- Gestion de projets : vue Kanban et vue Calendrier
- Détail de carte avec checklist et progression automatique
- Wizard de création de projet (4 étapes)
- Hub Communications : onglets Mails, Slack
- Gestion des clients : fiches, contacts, matrice RACI
- Templates e-mail avec variables dynamiques
- Templates Kanban (éditeur de colonnes)
- Gestion des membres de l'équipe (Admin / Membre)
- Paramètres généraux utilisateur
- Intégrations Slack et Microsoft Exchange
- Interface bilingue **FR / EN**
- Support **desktop uniquement**
- Notifications Slack bidirectionnelles + push desktop

### Reporté en V1.5 (hors V1)

- Aide à la rédaction IA dans les communications
- Intégration des notes IA (Fireflies / Otter)
- Conversion directe d'un e-mail en tâche (bouton → Tâche)
- Vue "Par personne" des tâches
- Rôle **Observateur** (destiné à terme aux clients externes)
- Notifications par e-mail
- Support mobile / tablette

## 4. Parcours utilisateurs clés

### Parcours 1 — Première connexion après invitation

1. Un Admin envoie une invitation par e-mail à une nouvelle recrue.
2. La personne reçoit un mail "Vous êtes invité à rejoindre l'espace NexusHub de {nom de l'agence}".
3. Elle clique sur le lien, arrive sur une page de création de compte (nom, prénom, mot de passe). Son email est pré-rempli.
4. Elle accepte les conditions et valide.
5. Elle est automatiquement connectée et atterrit sur l'**Overview**.
6. Un message d'accueil contextuel lui indique les 3 actions à essayer en premier : choisir un client, ouvrir un projet, consulter ses tâches.

### Parcours 2 — Journée type d'un membre

1. L'utilisateur ouvre NexusHub le matin → **Overview** (vue tous clients).
2. Il voit ses métriques : 2 cartes bloquées, 5 échéances aujourd'hui, 14 mails non lus.
3. Il clique sur "Acme Brands" dans la sidebar → l'interface bascule en **mode client Acme**.
4. Il va dans **Projets** → voit le Kanban de "Campagne Été 2025".
5. Il clique sur une carte, coche les derniers items de sa checklist → la carte se déplace automatiquement vers la colonne suivante.
6. Il bascule dans **Communications** (toujours en contexte Acme) → ne voit que les mails et Slack Acme.
7. Il répond à un mail en appliquant un template et quitte l'app.

### Parcours 3 — Créer un nouveau projet

1. Depuis n'importe quelle page, l'utilisateur clique **"+ Nouveau projet"** dans la topbar.
2. Un wizard en 4 étapes s'ouvre.
3. **Étape 1** : il renseigne nom, client, description, dates.
4. **Étape 2** : il choisit un type de projet (ou en crée un personnalisé avec icône).
5. **Étape 3** : il sélectionne un template Kanban parmi les modèles existants.
6. **Étape 4** : il assigne les membres et consulte le récapitulatif.
7. Il valide → le projet est créé et l'utilisateur est redirigé sur le Kanban du nouveau projet.

### Parcours 4 — Une tâche devient bloquée automatiquement

1. Une carte dans la colonne "Créa" a une échéance au 8 avril.
2. Le 9 avril, sans que personne n'ait agi, le système déplace automatiquement la carte dans la colonne **Bloqué**.
3. Le compteur "Cartes bloquées" de l'Overview passe à 3 (rouge).
4. Un item apparaît dans l'activité récente avec le badge violet "Auto".
5. L'utilisateur ouvre la carte, met à jour la date d'échéance (ex : 12 avril).
6. Le système sort automatiquement la carte de "Bloqué" et la replace dans sa colonne d'origine.

### Parcours 5 — Passage en "mode client X"

1. L'utilisateur clique sur "TechGroup SA" dans la sidebar.
2. La chip client s'affiche dans la barre de contexte, toutes les vues se recomposent :
   - Overview : les métriques se recalculent sur TechGroup uniquement.
   - Projets : seuls les projets TechGroup sont listés.
   - Communications : seuls les mails/Slack de TechGroup s'affichent.
3. Un clic sur la croix de la chip (ou sur "Tous les clients" dans la sidebar) restaure la vue globale.

## 6. Carte des écrans

```
[Login] ──► [Overview]
            │
            ├─► [Projets] ──► [Kanban] ─► [Modal Détail Carte]
            │                └► [Calendrier]
            │                └► [Modal Nouveau projet]
            │
            ├─► [Communications] ─► Onglets : Mails / Slack / Notes
            │
            └─► Menu utilisateur
                 ├─► [Gestion des clients]     ──► [Fiche client + RACI]
                 ├─► [Templates e-mail]
                 ├─► [Templates Kanban]
                 ├─► [Équipe & invitations]
                 ├─► [Paramètres]
                 └─► [Intégrations]

[Invitation reçue par email] ──► [Création de compte] ──► [Overview]
```

Tous les écrans principaux sont construits sur le même cadre : **sidebar permanente + topbar + context bar client + zone de contenu**.

## 7. Description des écrans

### Écran : Login

- **Objectif** — Permettre à un membre existant de se connecter à son espace.
- **Qui y accède** — Tout utilisateur non authentifié.
- **Contenu affiché** :
  - Logo NexusHub
  - Champ Email
  - Champ Mot de passe
  - Lien "Mot de passe oublié ?"
  - Bouton "Se connecter"
  - Mention "Pas encore de compte ? NexusHub fonctionne sur invitation."
- **Actions disponibles** :
  - Se connecter → Overview
  - Demander un nouveau mot de passe → écran de récupération
- **États possibles** :
  - Défaut
  - Erreur identifiants (message rouge sous les champs)
  - Chargement pendant la vérification
- **Règles spécifiques** — Aucune création de compte libre possible. L'inscription se fait **exclusivement** via un lien d'invitation.

### Écran : Création de compte par invitation

- **Objectif** — Finaliser l'inscription d'une personne invitée par un Admin.
- **Qui y accède** — Une personne ayant reçu un e-mail d'invitation et cliqué sur le lien.
- **Accès depuis** — Lien unique dans l'e-mail d'invitation (valide un temps limité `[HYPOTHÈSE À VALIDER : durée de validité à préciser]`).
- **Contenu affiché** :
  - Message de bienvenue "Vous avez été invité à rejoindre {nom de l'espace} par {nom de l'Admin}"
  - Email pré-rempli (non modifiable)
  - Champs : Prénom, Nom, Mot de passe, Confirmation mot de passe
  - Case à cocher "J'accepte les conditions d'utilisation"
  - Bouton "Créer mon compte"
- **États possibles** :
  - Lien valide → formulaire affiché
  - Lien expiré → message d'erreur avec option "Demander une nouvelle invitation"
  - Lien déjà utilisé → redirection vers login
- **Règles spécifiques** — Le rôle (Admin ou Membre) a été choisi par l'Admin au moment de l'invitation, l'utilisateur ne le voit pas lors de son inscription.

### Écran : Overview (tableau de bord)

- **Objectif** — Donner une lecture immédiate de l'état de l'activité, globale ou filtrée par client.
- **Qui y accède** — Tous les utilisateurs authentifiés.
- **Accès depuis** — Sidebar › Overview (page d'accueil par défaut après login).
- **Contenu affiché** :
  - **Bandeau de salutation** contextuel ("Bonjour Angelo — vue d'ensemble (tous clients)")
  - **6 métriques** en cards :
    1. Projets actifs (+ nombre de clients)
    2. Tâches ouvertes assignées à l'utilisateur
    3. Messages Slack non lus (+ nombre de canaux)
    4. Mails non lus (+ nombre de clients)
    5. Cartes bloquées (affichage rouge)
    6. Échéances aujourd'hui
  - **Panneau "Tâches urgentes"** — liste des tâches prioritaires avec indicateur coloré (rouge = bloqué, orange = aujourd'hui), nom et badge client coloré
  - **Panneau "Avancement projets"** — barres de progression par projet avec % (bleu = en cours, vert = proche fin, orange = retard)
  - **Panneau "Activité récente"** — feed chronologique des actions équipe + système, actions automatiques distinguées par un badge violet "Auto"
- **Actions disponibles** :
  - Cliquer une tâche urgente → ouvre le modal de la carte
  - "Voir →" sur l'avancement projets → section Projets
  - Changer de contexte client via la sidebar
- **États possibles** :
  - Mode tous clients
  - Mode client unique (toutes les données se recalculent)
  - État vide : "Aucun projet actif pour ce client"
- **Règles spécifiques** — La métrique "Cartes bloquées" est **toujours** affichée en rouge si > 0, sinon en neutre.

### Écran : Projets — Vue Kanban

- **Objectif** — Piloter l'avancement opérationnel des tâches d'un projet.
- **Qui y accède** — Tous les utilisateurs.
- **Accès depuis** — Sidebar › Projets.
- **Contenu affiché** :
  - **Sélecteur de projets** en haut sous forme de chips cliquables + chip "+ Nouveau"
  - **Toggle de vue** : Kanban / Calendrier
  - **Board Kanban** horizontal et scrollable, composé de colonnes configurables
  - Chaque colonne contient son nom, un compteur de cartes, un menu "⋯" et ses cartes
  - **Colonne "Bloqué"** — bordure rouge, badge "Auto", non configurable, toujours présente
  - **Indicateur de règle** sous chaque colonne : "→ {colonne suivante} si checklist complète"
  - **Bouton "+ Ajouter"** en bas de chaque colonne pour créer rapidement une carte
  - **Bouton "+ Colonne"** à droite du board pour ajouter une colonne à la volée
- **Cartes affichées** — titre, tag de catégorie coloré, date d'échéance, mini barre de progression si checklist
- **Actions disponibles** :
  - Clic sur une carte → ouvre le modal de détail
  - Menu "⋯" sur une colonne → Renommer, Déplacer à gauche, Déplacer à droite, Supprimer
  - "+ Ajouter" → saisie rapide d'un titre de carte
  - "+ Colonne" → ajoute une colonne à droite (avant Bloqué)
- **États possibles** :
  - Projet chargé normalement
  - Aucun projet sélectionné → message d'accueil + CTA "Créer un projet"
  - Board vide → colonnes visibles mais message "Aucune carte pour le moment"
- **Règles spécifiques** :
  - La colonne **Bloqué** ne peut pas être renommée, déplacée ni supprimée
  - Les cartes arrivent automatiquement dans Bloqué en cas de dépassement d'échéance
  - Elles en sortent automatiquement dès que l'échéance est repoussée dans le futur

### Écran : Projets — Vue Calendrier

- **Objectif** — Visualiser les échéances des tâches sur une grille mensuelle.
- **Qui y accède** — Tous les utilisateurs.
- **Accès depuis** — Projets › Toggle "Calendrier".
- **Contenu affiché** :
  - Grille mensuelle (Lun-Dim)
  - Tâches positionnées sur leur date d'échéance
  - Jour courant mis en évidence
  - Navigation mois précédent / mois suivant `[HYPOTHÈSE À VALIDER : contrôles de navigation]`
- **Actions disponibles** :
  - Clic sur une tâche → ouvre le modal de détail
  - Navigation entre mois
- **États possibles** : normal, mois vide (affichage de la grille sans badges)

### Modal : Détail de carte

- **Objectif** — Consulter et modifier tous les attributs d'une tâche, faire avancer la checklist.
- **Accès depuis** — Clic sur une carte (Kanban, Calendrier, Tâches urgentes de l'Overview).
- **Contenu affiché** :
  - **Titre éditable en ligne** en haut du modal
  - Tag de catégorie, colonne actuelle, indication "→ {colonne suivante} (auto si checklist complète)"
  - **Assignation** : avatars des membres + bouton "+" pour en ajouter
  - **Échéance** : champ date
  - **Description** : champ texte multiligne
  - **Checklist libre** :
    - Chaque item cochable / supprimable individuellement
    - Barre de progression + compteur temps réel ("2 / 3")
    - Champ d'ajout d'item (saisie + Entrée)
    - Bandeau vert "Checklist complète ✓" quand tout est coché
  - **Commentaires** avec avatar de l'utilisateur connecté
  - Bouton de fermeture "✕"
- **Actions disponibles** :
  - Modifier titre, description, échéance, assignation
  - Ajouter, cocher, décocher, supprimer des items de checklist
  - Ajouter un commentaire
  - Fermer le modal
- **États possibles** :
  - Édition en cours (auto-sauvegarde)
  - Checklist incomplète
  - Checklist complète → bandeau vert, puis déplacement automatique
  - Carte en colonne Bloqué → bandeau d'alerte en tête du modal `[HYPOTHÈSE À VALIDER]`
- **Règles spécifiques** :
  - Dès que **tous** les items sont cochés, un compte à rebours de **1,8 seconde** lance le déplacement automatique de la carte vers la colonne suivante
  - Si l'utilisateur décoche un item avant la fin du délai, le déplacement est **annulé** et le bandeau disparaît
  - Si la carte est déjà dans la **dernière colonne** (ex: "Done"), elle reste en Done et devient candidate à un archivage automatique après **30 jours** `[HYPOTHÈSE À VALIDER : règle d'archivage à confirmer]`

### Modal : Nouveau projet (wizard 4 étapes)

- **Objectif** — Créer un projet avec toutes ses informations initiales.
- **Accès depuis** — Bouton "+ Nouveau projet" (topbar) ou chip "+ Nouveau" dans le sélecteur de projets.
- **Structure** — Stepper visible en en-tête avec les 4 étapes, footer avec boutons Retour / Suivant (ou Créer à l'étape 4).

#### Étape 1 — Informations générales

- Champ **Nom du projet** (requis)
- Sélecteur **Client associé** (requis, parmi les clients existants)
- Champ **Description** (optionnel)
- **Date de début** et **Date de fin estimée**
- Validation : impossible de passer à l'étape 2 sans Nom + Client.

#### Étape 2 — Type de projet

- Grille de cards : **Campagne**, **Ongoing**, **Lancement**, **Spot TV**, **Social Media**
- Card dédiée **"+ Créer un type"** (pointillés)
- **Formulaire de type personnalisé** : nom, icône (sélecteur d'émojis proposés), description courte, + prévisualisation temps réel
- La sélection d'un type est obligatoire pour passer à l'étape 3.

#### Étape 3 — Template Kanban

- Sélection parmi : **Campagne créa** (recommandé), **Production vidéo**, **Social Media**, **Standard**, **Vide**
- Chaque template affiche ses colonnes initiales sous forme de pills + la colonne Bloqué
- L'utilisateur peut aussi sélectionner "Vide" pour démarrer sans structure pré-définie.

#### Étape 4 — Équipe & récapitulatif

- Liste des membres de l'agence avec choix du rôle sur ce projet (membre / `[HYPOTHÈSE À VALIDER : rôles projet à confirmer]`)
- Bouton "+ Ajouter un membre"
- **Récapitulatif** : Nom, Client, Type, Template, Nombre de membres
- Bouton final "Créer le projet →" → création et redirection vers le Kanban du nouveau projet.

- **États possibles** : étapes successives, erreur de validation (champs manquants), chargement lors de la création finale.

### Écran : Communications

- **Objectif** — Centraliser les échanges client (mails, Slack, notes) filtrés par contexte.
- **Qui y accède** — Tous les utilisateurs.
- **Accès depuis** — Sidebar › Communications.
- **Contenu affiché** :
  - **Panneau liste (gauche)** — Onglets **Mails**, **Slack**, **Notes** avec compteurs non lus
    - Chaque item : avatar expéditeur, nom, heure, preview, badge client coloré (en vue tous clients), compteur non lu
  - **Panneau lecture (droite)** — Sujet, expéditeur, client, heure, corps du message
  - **Zone d'action** :
    - Boutons "Répondre" et "→ Tâche" (ce dernier : **V1.5**)
    - **Sélecteur de template e-mail**
    - **Pills de destinataires** supprimables, possibilité d'ajouter des CC
    - **Badge IA "Aide rédaction"** (V1.5, désactivé en V1)
  - **Zone de composition** — textarea + bouton "Envoyer"
- **Actions disponibles** :
  - Changer d'onglet (Mails / Slack / Notes)
  - Sélectionner un message dans la liste
  - Répondre, appliquer un template, ajouter des CC
  - Envoyer une réponse
  - (V1.5) Convertir un e-mail en tâche
- **États possibles** :
  - Mode tous clients / mode client unique (filtrage automatique)
  - Liste vide : "Aucun message non lu pour ce client"
  - Message sélectionné / aucun message sélectionné (état par défaut)
- **Règles spécifiques** — Les messages Slack circulent dans les **deux sens** : un message reçu sur un canal intégré apparaît ici, et une réponse saisie ici est publiée sur le canal Slack d'origine.

### Écran : Gestion des clients

- **Objectif** — Créer et maintenir les fiches client avec contacts et matrice RACI.
- **Qui y accède** — Tous les utilisateurs.
- **Accès depuis** — Menu utilisateur › Gestion des clients.
- **Contenu affiché** :
  - Liste des clients (card par client : initiales coloriées, nom, canaux Slack associés, nombre de contacts, bouton "Modifier")
  - Bouton "+ Nouveau client"
  - **Panneau Fiche client** (affichage du client sélectionné) :
    - Identifiant visuel : initiales, couleur, canaux Slack
    - Table des contacts : Prénom, Nom, Rôle entreprise, RACI (badge coloré), Email
    - Bouton "+ Contact"
- **Actions disponibles** :
  - Créer un nouveau client
  - Modifier une fiche client (nom, couleur, canaux)
  - Ajouter, modifier, supprimer un contact
  - Attribuer un rôle RACI à un contact
- **Règles RACI** :
  - **R — Responsable** (badge bleu) : en charge opérationnelle de la livraison
  - **A — Approbateur** (badge ambre) : décide et valide
  - **C — Consulté** (badge vert) : sollicité pour avis
  - **I — Informé** (badge gris) : tenu au courant sans action
- **États possibles** : liste vide (aucun client), fiche en cours de création, édition en cours.

### Écran : Templates e-mail

- **Objectif** — Créer et maintenir des modèles de réponse réutilisables.
- **Qui y accède** — Tous les utilisateurs.
- **Accès depuis** — Menu utilisateur › Templates e-mail.
- **Contenu affiché** :
  - Liste de gauche : templates existants (nom, nombre de variables, compteur d'utilisation)
  - Panneau d'édition : variables disponibles cliquables, objet, corps du mail
  - Boutons "Prévisualiser" / "Sauvegarder" / "+ Nouveau"
- **Variables dynamiques disponibles** — `{contact_name}`, `{client_name}`, `{project_name}`, `{sender_name}`, `{date}`
- **Actions disponibles** :
  - Créer, dupliquer, supprimer un template
  - Éditer objet et corps
  - Insérer une variable (clic)
  - Basculer en mode prévisualisation (les variables sont remplacées par des exemples concrets)
- **États possibles** : édition, prévisualisation, non sauvegardé (indicateur).

### Écran : Templates Kanban

- **Objectif** — Définir des structures de colonnes réutilisables pour la création de projets.
- **Qui y accède** — Tous les utilisateurs.
- **Accès depuis** — Menu utilisateur › Templates Kanban.
- **Contenu affiché** :
  - Sélecteur de template (liste déroulante)
  - Boutons "+ Nouveau template", "Dupliquer", "Supprimer", "Sauvegarder"
  - **Vue colonne interactive** reproduisant le rendu futur du board : colonnes éditables, cartes exemple grisées, étiquette de flux "→ {colonne suivante}"
  - Colonne "Bloqué" fixe en fin de board (non-éditable, compacte, rouge)
  - Bouton "+ Colonne" pour ajouter une colonne
- **Actions disponibles** :
  - Renommer une colonne en ligne
  - Menu "⋯" : Renommer, Déplacer gauche/droite, Supprimer
  - Ajouter une colonne
  - Dupliquer / renommer / supprimer un template entier
- **Règles spécifiques** :
  - La colonne **Bloqué est gérée automatiquement par le système** et ne peut être ni modifiée ni supprimée
  - **La modification d'un template n'impacte PAS les projets déjà créés** à partir de ce template. Le template n'est consommé qu'au moment de la création.

### Écran : Équipe & invitations

- **Objectif** — Gérer les membres du workspace et envoyer des invitations.
- **Qui y accède** — **Admin uniquement**. Les Membres ne voient pas cette entrée dans le menu utilisateur.
- **Accès depuis** — Menu utilisateur › Équipe & invitations.
- **Contenu affiché** :
  - Titre "Membres (X)"
  - Liste des membres : avatar, nom, rôle (Admin / Membre), bouton "Retirer" (sauf pour l'Admin courant)
  - **Bloc d'invitation** en pointillés : champ e-mail, sélecteur de rôle, bouton "Inviter"
  - Bouton "+ Inviter"
- **Actions disponibles** :
  - Inviter un nouveau membre par email (avec choix du rôle)
  - Retirer un membre
  - `[HYPOTHÈSE À VALIDER : modification du rôle d'un membre existant]`
- **Règles spécifiques** :
  - **Seul un Admin** peut inviter ou retirer des membres
  - L'invitation envoie un e-mail contenant un lien unique vers l'écran de création de compte
  - Un Admin ne peut pas se retirer lui-même s'il est le seul Admin restant `[HYPOTHÈSE À VALIDER]`

### Écran : Paramètres

- **Objectif** — Préférences utilisateur individuelles.
- **Qui y accède** — Tous les utilisateurs (leurs propres préférences).
- **Accès depuis** — Menu utilisateur › Paramètres.
- **Contenu affiché** :
  - **Langue d'interface** — FR / EN
  - **Fuseau horaire**
  - **Notifications** :
    - Notifications push desktop (on/off, granularité par type d'événement `[HYPOTHÈSE À VALIDER]`)
    - Notifications Slack (on/off)
  - `[HYPOTHÈSE À VALIDER : profil utilisateur, changement de mot de passe]`
- **Actions disponibles** — modifier chaque préférence, sauvegarde automatique ou explicite `[À VALIDER]`.

### Écran : Intégrations

- **Objectif** — Connecter NexusHub aux outils externes de l'équipe.
- **Qui y accède** — Admin `[HYPOTHÈSE À VALIDER : Admin uniquement ou aussi Membre pour sa propre connexion ?]`.
- **Accès depuis** — Menu utilisateur › Intégrations.
- **Contenu affiché** — Liste des intégrations disponibles :
  - **Slack** — connecter les canaux à associer aux clients (synchronisation bidirectionnelle des messages)
  - **Microsoft Exchange** — synchroniser la boîte mail, association automatique des e-mails au client correspondant
  - **Notes IA (Fireflies / Otter)** — V1.5, affiché en V1 mais désactivé ou absent
- Statut affiché par intégration : "Actif" / "Non connecté" + bouton "Connecter" ou "Gérer"
- **Actions disponibles** : connecter, déconnecter, gérer les canaux Slack associés.

## 8. Fonctionnalités transverses détaillées

### Fonctionnalité : Filtre client global

- **Description** — Mécanisme central de NexusHub. Sélectionner un client depuis la sidebar reconfigure **toutes** les vues (Overview, Projets, Communications, Tâches) comme si l'utilisateur travaillait dans un espace dédié à ce client.
- **Déclenchement** — Clic sur un client dans la sidebar, ou clic sur un badge client depuis n'importe quelle vue.
- **Affichage** — Une chip colorée dans la barre de contexte indique en permanence le client actif, avec une croix de réinitialisation.
- **Désactivation** — Clic sur "Tous les clients" (sidebar) ou sur la croix de la chip.
- **Critères d'acceptation** :
  - [ ] Toutes les métriques de l'Overview se recalculent sur le client actif
  - [ ] La liste des projets affiche uniquement les projets du client
  - [ ] Les communications sont filtrées
  - [ ] Les tâches urgentes sont filtrées
  - [ ] La chip reste visible tant que le filtre est actif, même en changeant de section

### Fonctionnalité : Progression automatique des cartes

- **Description** — Dès que la checklist d'une carte est entièrement cochée, la carte est déplacée automatiquement vers la colonne suivante après un délai de 1,8 seconde.
- **Utilisateur concerné** — Tous.
- **Règles métier** :
  - L'utilisateur ajoute librement des items de checklist, sans configuration préalable
  - La barre de progression et le compteur se mettent à jour en temps réel
  - Le bandeau vert "Checklist complète ✓" s'affiche à 100%
  - Le déplacement vers la colonne suivante a lieu après 1,8 seconde
  - Si un item est **décoché** pendant ce délai, le déplacement est **annulé**
  - Si la carte est déjà dans la **dernière colonne** (ex: Done), elle y reste. Elle est candidate à un **archivage automatique 30 jours** plus tard `[HYPOTHÈSE À VALIDER]`
  - Le déplacement apparaît dans l'activité récente avec le badge violet "Auto"
- **Critères d'acceptation** :
  - [ ] La barre mini sur la carte (vue Kanban) reflète la progression
  - [ ] Le déplacement est annulable par décochage avant la fin du délai
  - [ ] Le mouvement est visible à tous les utilisateurs (sans recharger la page)
  - [ ] L'action est tracée dans l'activité avec badge Auto

### Fonctionnalité : Colonne "Bloqué" automatique

- **Description** — Colonne système, présente sur tous les boards, alimentée automatiquement par les cartes en retard.
- **Règles métier** :
  - Une carte est déplacée dans Bloqué si sa date d'échéance est dépassée et qu'elle n'est pas dans la dernière colonne
  - Si l'utilisateur **repousse l'échéance** d'une carte dans Bloqué, la carte **sort automatiquement** de Bloqué et retourne dans sa colonne précédente
  - La colonne Bloqué est visible sur le board (bordure rouge, badge "Auto") et n'est ni déplaçable ni supprimable
  - Elle alimente la métrique "Cartes bloquées" de l'Overview (affichage rouge dès que > 0)
- **Critères d'acceptation** :
  - [ ] Aucune configuration manuelle possible
  - [ ] Présente sur 100% des projets / templates
  - [ ] Les entrées et sorties automatiques génèrent un événement "Auto" dans l'activité

### Fonctionnalité : Notifications

- **Canaux V1** :
  - **Push desktop** (système d'exploitation)
  - **Slack** bidirectionnel (les messages reçus sur Slack apparaissent dans NexusHub, les réponses envoyées depuis NexusHub sont publiées sur Slack)
- **Canaux V1.5** :
  - Email
- **Événements notifiables** `[HYPOTHÈSE À VALIDER : liste précise à confirmer]` :
  - Nouvelle carte assignée
  - Commentaire sur une carte où l'utilisateur est assigné
  - Carte passée en "Bloqué"
  - Nouveau mail client
  - Mention Slack sur un canal client intégré
- **Paramétrage** — Chaque utilisateur peut activer/désactiver les notifications depuis l'écran Paramètres.

## 9. Règles transverses

### Rôles et permissions (V1)

| Capacité                                 | Admin |    Membre     |
| ---------------------------------------- | :---: | :-----------: |
| Accès à tous les projets et clients      |   ✓   |       ✓       |
| Créer / modifier / supprimer des projets |   ✓   |       ✓       |
| Créer / modifier des clients et contacts |   ✓   |       ✓       |
| Gérer les templates (e-mail & Kanban)    |   ✓   |       ✓       |
| Paramétrer ses propres notifications     |   ✓   |       ✓       |
| **Inviter / retirer des membres**        |   ✓   |       ✗       |
| **Gérer les intégrations**               |   ✓   | `[À VALIDER]` |

Le rôle **Observateur** est reporté en V1.5 (destiné aux contacts clients externes).

### Langues

- Interface disponible en **français** et en **anglais** dès la V1.
- Changement de langue via les Paramètres utilisateur.
- Le contenu saisi par l'utilisateur (noms de projets, cartes, templates, commentaires) n'est **pas** traduit automatiquement.

### Gestion des erreurs côté utilisateur

- Erreurs de connexion : message clair sous les champs de login
- Erreurs de formulaire : validation inline (champs requis manquants, formats invalides)
- Erreurs système : toast en haut à droite avec un libellé lisible par un non-technicien

### Accessibilité

- `[HYPOTHÈSE À VALIDER : niveau d'accessibilité ciblé — WCAG AA ?]`

### Device

- **Desktop uniquement** en V1 (pas de responsive mobile / tablette).
- Support navigateurs modernes `[HYPOTHÈSE À VALIDER : liste précise des navigateurs supportés]`.

## 10. Hypothèses à valider

Ces points ont été ajoutés par défaut ou restent ambigus. Ils nécessitent une décision produit avant développement :

1. **Durée de validité du lien d'invitation** par e-mail (24h ? 7 jours ?)
2. **Archivage automatique** des cartes en colonne finale après 30 jours — règle confirmée ?
3. **Navigation du calendrier** — contrôles mois précédent/suivant, sélecteur de mois, "revenir à aujourd'hui"
4. **Bandeau d'alerte** dans le modal d'une carte passée en Bloqué
5. **Rôles projet** (étape 4 du wizard Nouveau projet) — liste des rôles possibles ?
6. **Modification du rôle** d'un membre existant (Admin ↔ Membre)
7. **Protection dernier Admin** : interdiction de retirer le dernier Admin du workspace
8. **Gestion des intégrations** par un Membre (pour connecter son propre compte Exchange ?) ou Admin uniquement ?
9. **Profil utilisateur** : champs modifiables (avatar, nom, mot de passe)
10. **Mode de sauvegarde** des paramètres : automatique ou explicite
11. **Types d'événements** notifiables et granularité par utilisateur
12. **Niveau d'accessibilité** ciblé (WCAG AA ou autre)
13. **Navigateurs supportés** en V1
14. **Suppression d'un client** qui a encore des projets actifs — que se passe-t-il ?
15. **Suppression d'un projet** — corbeille / restauration possible ?

## 11. Questions ouvertes

- **Gestion des pièces jointes dans les mails** — envoi/réception dans le hub Communications ?
- **Historique d'un contact** — l'ouverture d'un contact dans la fiche client donne-t-elle accès à l'historique des échanges avec lui ?
- **Recherche globale** — y a-t-il une barre de recherche pour retrouver une carte, un mail, un contact ?
- **Gestion des archives** — où retrouve-t-on les projets archivés / terminés ?
- **Paramétrage au niveau espace** (vs. utilisateur) — fuseau horaire par défaut de l'agence, langue par défaut, charte visuelle ?
- **Multi-espace / multi-agence** — un même utilisateur peut-il appartenir à plusieurs workspaces NexusHub ?
- **Export de données** — possibilité d'exporter une fiche client / un projet (PDF, CSV) ?
- **Historique et audit** — qui a fait quoi, quand (au-delà de l'activité récente visible à 24-48h) ?

---

_PRD NexusHub · v0.1 · 13 avril 2026 · Draft pour revue_
