# Rapport de la nuit 1 — KanbanX v1

Branche : `nuit-1`. Date : 20/11/2026.

**Secrets** : aucun secret trouvé dans le dépôt, aucun ajouté. Seul `.env.exemple` (valeurs fictives de développement) est versionné ; `.env` est ignoré.
**Sites bloqués** : aucun blocage rencontré (registre npm, Docker Hub, dépôts apt et téléchargement de Chromium ont fonctionné). Aucune tentative vers les domaines interdits.

## En bref

| Critère de fin de la nuit 1 | État |
| --- | --- |
| `docker compose up -d` puis `npm start` : l'application tourne avec les données de démonstration | ✅ vérifié sur une base vidée (`docker compose down -v`) : 4 comptes fictifs (Xavier, Eric, Alexis, Claude), un tableau d'exemple avec cartes, étiquettes et commentaires |
| `npm test` vert, dont isolement, droits par rôle, injections XSS et SQL | ✅ code de sortie 0 : **77 tests** (`node:test`) + **19 parcours navigateur** (Playwright/Chromium) |
| Parcours clés dans un vrai navigateur : créer un tableau, trois cartes d'affilée au clavier, déplacer une carte, commenter avec une mention | ✅ `e2e/p1.test.js` et `e2e/p2.test.js` |
| Captures d'écran ordinateur et téléphone dans `docs/captures/` | ✅ 17 captures (liste plus bas) |
| Rapport | ✅ ce fichier |

Priorités livrées : **P1, P2, P3 et P4**, chacune testée avant de passer à la suivante, et poussée après chaque étape.

## Ce qui est fait

### P1 — Le socle
- Tableaux ; colonnes (créer, renommer sur place, réordonner, archiver) ; cartes (titre, description Markdown, responsables, échéance, étiquettes de couleur).
- Glisser-déposer des cartes et des colonnes à la souris, au doigt (appui long, sans bloquer le défilement) et **au clavier** (Espace pour saisir, flèches, Espace pour déposer, Échap pour annuler, annonces pour lecteur d'écran). Emplacement fantôme dans tous les cas, défilement automatique près des bords.
- Connexion par lien magique (15 min, usage unique). En développement, le lien s'affiche dans la console ; en production, envoi SMTP minimal (`SMTP_URL`), testé contre un faux serveur SMTP.
- Comptes **sur invitation uniquement** : le propriétaire invite par courriel depuis la fenêtre « Membres » (rôles propriétaire, membre, lecteur) ; une adresse inconnue ne reçoit rien et la réponse est identique (pas d'énumération).
- Ergonomie exigée : ajout sans friction (le champ reste ouvert, Échap annule) ; renommage sur place ; détail de carte en fenêtre superposée avec **sa propre adresse** `/b/:tableau/c/:carte` ; réponse immédiate (mises à jour optimistes) avec **retour arrière et message clair** en cas d'échec ; bandeau **« Annuler »** après archivage (cartes, colonnes) et suppression (commentaires) ; raccourcis `n`, `/`, `Échap`, `?` (aide) ; recherche et filtres par membre, étiquette, échéance ; tableau neuf avec À faire / En cours / Fait ; téléphone : colonnes à défilement horizontal aimanté, cibles ≥ 44 px (vérifié par test) ; mode sombre.
- Accessibilité : audit **axe-core WCAG 2.2 AA** automatisé sur connexion, accueil, tableau, détail de carte, menus et membres, en clair (ordinateur) et en sombre (téléphone) : aucune violation. Contrastes de tous les couples de jetons vérifiés par calcul. Focus visible vérifié en parcourant l'écran à la touche Tab.
- Identité : dominante bleue, touches d'orange, ni jaune ni magenta (vérifié par test) ; **un seul fichier de jetons** `public/css/jetons.css` (un test garantit qu'aucune couleur n'est écrite en dur ailleurs).

### P2 — Les discussions
- Fil de commentaires par carte, Markdown rendu puis nettoyé, mentions `@prénom` (insensibles à la casse et aux accents) avec **suggestions au clavier** ; seuls les membres du tableau sont résolus.
- Modifier / supprimer son propre commentaire (suppression annulable).
- Historique par carte (affichable dans le fil) et par tableau (panneau « Activité ») : qui, quoi, quand, et par quel canal (web, API, MCP).
- Mise à jour en direct chez tous les membres connectés (Server-Sent Events) ; un membre retiré est déconnecté du flux.

### P3 — Claude dans la boucle
- API REST protégée par jeton (`Authorization: Bearer kbx_…`), documentée en **OpenAPI 3.1** (`/api/openapi.json`, générée depuis la table des routes : un test vérifie que chaque route est documentée) et lisible sur `/api/docs`.
- **Serveur MCP** (Streamable HTTP, `POST /mcp`) avec les outils : `lister_tableaux`, `lire_tableau`, `creer_carte`, `modifier_carte`, `deplacer_carte`, `ajouter_commentaire`, `lire_commentaires_recents`, `lire_mentions`.
- Vérifié avec un vrai client : `claude mcp add --transport http …` puis `claude mcp list` → « ✔ Connected » ; une instance Claude Code a lu ses mentions et répondu par un commentaire, enregistré dans l'historique comme « Claude · mcp ».

### P4 — Si le temps le permet
- Limites d'en-cours (WIP) par colonne : fenêtre de réglage, compteur « 3 / 2 », bordure rouge **et** message texte (pas seulement la couleur).
- Import d'un export JSON de Trello (listes et cartes ouvertes dans l'ordre, descriptions, échéances, étiquettes avec correspondance des couleurs, commentaires), depuis l'accueil.

## Choix techniques et raisons

- **Node.js 26 sans framework**, serveur `node:http` et routeur maison (~150 lignes) : demandé par le cahier des charges, et la table des routes sert aussi à générer l'OpenAPI et à valider les corps de requête.
- **Dépendances** (versions épinglées, `npm audit` : 0 vulnérabilité) :
  - `pg` (seule dépendance de production) : pilote PostgreSQL, requêtes paramétrées.
  - `playwright` (développement) : parcours dans un vrai navigateur, exigé.
  - `axe-core` (développement) : audit WCAG automatisé, référence du domaine ; injecté seulement pendant les tests.
  - Pas de bibliothèque Markdown : rendu maison qui **échappe tout d'abord**, puis ne reconnaît qu'un petit sous-ensemble ; le HTML produit ne contient que des balises générées par le moteur (liste blanche testée). Pas de SDK MCP : JSON-RPC simple, testé et vérifié avec Claude Code.
- **Isolement en double** : chaque service vérifie le rôle (404 pour un non-membre, pour ne pas révéler l'existence d'un tableau ; 403 pour un lecteur qui écrit) **et** PostgreSQL applique des politiques RLS. Le serveur se connecte avec un rôle `kanbanx_app` ni propriétaire, ni superutilisateur, ni BYPASSRLS ; l'utilisateur courant est passé par `set_config('app.user_id', …, true)` dans chaque transaction. Les tests RLS attaquent la base directement, sans passer par le serveur.
- Tables d'authentification (`sessions`, `magic_links`, `api_tokens`) **inaccessibles** au rôle applicatif : seules des fonctions `SECURITY DEFINER` dédiées y touchent. Clés étrangères composites (carte ↔ colonne ↔ tableau, responsable ↔ membre) : impossible de relier deux tableaux, même par erreur de code.
- Sécurité : cookie `__Host-kx` HttpOnly, Secure, SameSite=Lax ; CSRF par jeton lié à la session + contrôle d'origine + `Content-Type: application/json` obligatoire ; jetons (liens, sessions, API) stockés **hachés** (SHA-256) ; CSP stricte sans script ni style en ligne ; limitation de débit sur la connexion et l'API ; messages d'erreur sans détail interne.
- `npm test` démarre un **PostgreSQL 18 jetable** (conteneur en mémoire, supprimé à la fin), crée une base, applique les migrations, puis lance tests et parcours. `SANS_NAVIGATEUR=1` et `SEULEMENT=test|e2e` permettent des exécutions partielles.

### Choix non tranchés par le cahier des charges (option la plus simple et la plus sûre)
1. **Renommer une carte** : comme dans Trello, un clic sur la carte ouvre son détail, où **un clic sur le titre** le rend modifiable ; sur le tableau, un bouton crayon renomme sur place. Pour les colonnes et le tableau, un clic sur le titre suffit.
2. **Supprimer = archiver** pour les cartes et les colonnes (réversible) ; les commentaires sont supprimés logiquement. Aucune suppression définitive en v1.
3. Un compte **agent** ne peut pas se connecter par lien magique (jeton d'API uniquement), et le serveur MCP **n'accepte que le jeton**, jamais le cookie (pas de CSRF possible sur MCP).
4. Le lien magique ouvre une page qui envoie le jeton en POST (un robot de messagerie qui précharge le lien ne le consomme pas) ; le jeton est retiré de la barre d'adresse.
5. Un tableau garde toujours au moins un propriétaire ; un membre peut quitter un tableau.
6. Import Trello : les membres Trello ne sont pas repris (aucune correspondance fiable avec les comptes) ; les commentaires sont publiés au nom de la personne qui importe, avec l'auteur et la date d'origine dans le texte.
7. Échap dans le champ de commentaire non vide retire le focus au lieu de fermer la carte, pour ne pas perdre un brouillon.
8. Jetons d'API créés en ligne de commande (`npm run jeton -- <courriel>`), affichés une seule fois.

## Méthode suivie, en toute transparence
- Règles RLS, discussions (P2), MCP (P3) et import Trello (P4) : tests écrits d'abord, **rouge constaté** (codes de sortie 1, 8 à 9 échecs), puis code.
- Exception : pour l'étape « serveur et authentification », j'ai écrit le code avant les tests. Pour compenser, j'ai fait des **tests de mutation** : désactiver la vérification CSRF, le contrôle d'origine, la limitation de débit, l'attribut HttpOnly, la CSP stricte ou l'échappement Markdown fait chaque fois échouer `npm test` (code 1).
- Les parcours navigateur ont révélé de vrais défauts, corrigés : boucle infinie sur `/api/me` en 401, bouton « Effacer les filtres » invisible pendant la saisie, Ctrl+Entrée qui insérait une mention au lieu de publier, bouton illisible (contraste) dans le menu des étiquettes, cibles tactiles < 44 px.

## Limites et failles connues
- **Un seul processus** : limitation de débit et diffusion SSE sont en mémoire. Pour plusieurs instances : PostgreSQL `LISTEN/NOTIFY` et un stockage partagé des compteurs.
- Un flux SSE déjà ouvert n'est pas recontrôlé si la session expire ou est fermée (seul le retrait du tableau coupe le flux). Les événements ne transportent aucun contenu (type et identifiants seulement), et le rechargement repasse par les contrôles d'accès.
- Derrière un proxy inverse, la limitation par IP verrait une seule adresse (`X-Forwarded-For` volontairement ignoré pour l'instant).
- Pas d'en-tête HSTS ni de HTTPS : à ajouter au déploiement. Le cookie `Secure` fonctionne sur `http://localhost` dans Chromium et Firefox.
- Positions des cartes en nombres à virgule, avec renumérotation automatique quand l'écart devient trop petit ; deux déplacements simultanés au même endroit peuvent donner un ordre arbitraire entre ces deux cartes (sans perte de données).
- Le champ date suit la langue du navigateur (le Chromium sans interface des tests affiche MM/JJ/AAAA).
- Pas d'interface pour gérer les jetons d'API, consulter les éléments archivés, ni archiver un tableau entier.
- Accessibilité vérifiée par outils automatiques et tests clavier ; **pas de test manuel avec un vrai lecteur d'écran**.
- Lors de l'essai réel, Claude a écrit qu'une mention « enverrait une notification » : c'est inexact en v1 (pas de notification, seulement l'outil `lire_mentions`). On pourrait le préciser dans les instructions MCP.
- Dans la sandbox, il a fallu installer Node 26 (paquet `nodejs-26`) et les bibliothèques système de Chromium (`npx playwright install-deps`).

## Captures d'écran (`docs/captures/`)
Ordinateur : `01-connexion-ordinateur.png`, `02-accueil-ordinateur.png`, `03-tableau-ordinateur.png`, `04-carte-discussion-ordinateur.png`, `05-mention-ordinateur.png` (suggestions @), `06-glisser-clavier-ordinateur.png`, `07-activite-ordinateur.png`, `08-recherche-ordinateur.png`, `09-tableau-sombre-ordinateur.png`, `10-raccourcis-sombre-ordinateur.png`.
Téléphone : `01-connexion-telephone.png`, `02-accueil-telephone.png`, `03-tableau-telephone.png`, `04-carte-discussion-telephone.png`, `06-glisser-clavier-telephone.png`, `07-activite-telephone.png`, `08-recherche-telephone.png`.
Régénérer : `node scripts/captures.js` (base de développement démarrée).

## Prochaine étape proposée
1. **Déploiement** : HTTPS + HSTS, proxy inverse (prise en compte maîtrisée de `X-Forwarded-For`), SMTP réel, sauvegardes PostgreSQL.
2. **Branchement à claude.ai** : OAuth 2.1 pour le serveur MCP (exigé pour une adresse publique), puis instructions MCP précisées.
3. Passage multi-processus : `LISTEN/NOTIFY` pour le direct, compteurs de débit partagés, recontrôle périodique des sessions sur les flux SSE.
4. Petites briques d'interface : gestion des jetons d'API, vue des éléments archivés, archivage d'un tableau.
5. Une séance de test avec un lecteur d'écran (NVDA ou VoiceOver) et sur un vrai téléphone.
