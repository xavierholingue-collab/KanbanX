# KanbanX — cahier des charges

Version 1 — 20/11/2026

## Objectif

Remplacer Trello pour une petite équipe : Xavier, Eric, Alexis, et Claude, qui
participe comme un membre à part entière. Le cœur de l'outil, ce sont les
**discussions autour des cartes** : chacun, Claude compris, doit pouvoir lire
où en est un sujet, réagir et faire avancer le travail.

## Utilisateurs et droits

- Comptes nominatifs, **sur invitation uniquement** : pas d'inscription publique.
- Rôles par tableau : propriétaire, membre, lecteur.
- **Claude** a un compte de type « agent », avec un jeton d'API personnel.
  Chacune de ses actions apparaît signée « Claude » dans l'historique.
- **Isolement strict** : un utilisateur ne voit que les tableaux auxquels il
  est invité. Il est appliqué dans le code ET dans la base (politiques RLS de
  PostgreSQL), et vérifié par des tests.

## Fonctions de la version 1, par priorité

**P1 — Le socle**

- Tableaux ; colonnes (créer, renommer, réordonner) ; cartes (titre,
  description en Markdown, responsables, échéance, étiquettes de couleur).
- Glisser-déposer des cartes et des colonnes, également au clavier.
- Connexion par lien magique envoyé par courriel. En développement, le lien
  s'affiche dans la console au lieu d'être envoyé.

**P2 — Les discussions**

- Fil de commentaires sur chaque carte, en Markdown nettoyé, avec mentions
  `@prénom`.
- Historique d'activité par carte et par tableau : qui a fait quoi, et quand.
- Mise à jour en direct chez tous les membres connectés (Server-Sent Events).

**P3 — Claude dans la boucle**

- API REST documentée (OpenAPI), protégée par jeton.
- Serveur MCP (transport Streamable HTTP) qui expose : lister les tableaux,
  lire un tableau, créer, modifier et déplacer une carte, commenter, lire les
  commentaires récents et les mentions qui concernent l'utilisateur.
- Le branchement à claude.ai viendra après le déploiement : il exige une
  adresse publique et OAuth. En version 1, le serveur MCP est utilisable en
  local depuis Claude Code.

**P4 — Si le temps le permet**

- Limites d'en-cours (WIP) par colonne, avec alerte visuelle en cas de
  dépassement.
- Import d'un tableau depuis un export JSON de Trello.

**Hors version 1** : pièces jointes, notifications par courriel, application
mobile, déploiement.

## Expérience utilisateur : au moins au niveau de Trello

C'est une exigence de premier rang, au même titre que la sécurité.
L'application doit être **au moins aussi simple et agréable que Trello**. On
s'inspire de ses usages, sans copier son identité visuelle (nom, logo,
couleurs, illustrations).

Critères vérifiables :

- **Ajouter une carte sans friction** : « + Ajouter une carte », on tape le
  titre, Entrée. Le champ reste ouvert pour enchaîner la suivante ; Échap
  annule.
- **Modifier sur place** : un clic sur le titre d'une colonne ou d'une carte
  permet de le renommer, sans page intermédiaire.
- **Le détail d'une carte** s'ouvre dans une fenêtre superposée qui réunit
  description, responsables, échéance, étiquettes et fil de discussion. Elle a
  sa propre adresse, pour partager le lien d'une carte.
- **Glisser-déposer fluide**, avec un emplacement fantôme qui montre où la
  carte va tomber. Même chose au clavier.
- **Réponse immédiate** : chaque action s'affiche aussitôt et se synchronise
  en arrière-plan. En cas d'échec, l'écran revient en arrière avec un message
  clair.
- **Droit à l'erreur** : une suppression ou un archivage peut être annulé
  pendant quelques secondes, grâce à un bandeau « Annuler ».
- **Raccourcis clavier** usuels (n : nouvelle carte, / : recherche,
  Échap : fermer) et une aide qui les liste (?).
- **Recherche et filtres** sur le tableau : par membre, étiquette, échéance.
- **Démarrage guidé** : un tableau neuf propose trois colonnes (À faire,
  En cours, Fait).
- **Sur téléphone** aussi : colonnes qui défilent horizontalement, zones
  tactiles d'au moins 44 px.
- **Accessibilité** : WCAG 2.2, niveau AA (contrastes, focus visible, lecteur
  d'écran).
- **Identité visuelle** sobre et soignée : dominante bleue avec des touches
  d'orange, sans jaune ni magenta comme couleurs principales. Un seul fichier
  de jetons de design (couleurs, espacements, typographie) pour toute
  l'interface. Mode sombre si le temps le permet.

## Choix techniques

- Node.js 26 (LTS), PostgreSQL 18, HTML, CSS et JavaScript sans framework ni
  étape de compilation, comme Biblio.
- Dépendances minimales, chacune justifiée, versions épinglées, `npm audit`
  sans alerte.
- Base locale par `docker compose` (image `postgres:18` ; le volume se déclare
  `pgdata:/var/lib/postgresql`).
- Tests avec `node:test`. Une seule commande, `npm test`, lance tout, sur une
  base de test jetable.
- Parcours de bout en bout dans un vrai navigateur avec Playwright.
- Interface en français, accessible au clavier.

## Sécurité (non négociable)

- Sessions : cookie `HttpOnly`, `Secure`, `SameSite=Lax` ; protection CSRF ;
  jetons d'API stockés uniquement sous forme hachée.
- Toute sortie HTML échappée ; le Markdown est rendu puis nettoyé, jamais de
  HTML brut.
- En-têtes de sécurité, dont une politique CSP stricte, sans script en ligne.
- Limitation de débit sur la connexion et sur l'API.
- Requêtes SQL paramétrées uniquement.
- Aucun secret dans le dépôt : seulement un `.env.exemple`.

## Critères de fin de la nuit 1

- `docker compose up -d` puis `npm start` : l'application tourne en local,
  avec des données de démonstration (comptes fictifs Xavier, Eric, Alexis et
  Claude, un tableau d'exemple).
- `npm test` est vert, y compris les tests d'isolement entre tableaux, de
  droits par rôle et d'injection (XSS, SQL).
- Les parcours clés passent dans un vrai navigateur : créer un tableau,
  ajouter trois cartes d'affilée au clavier, déplacer une carte, commenter
  avec une mention.
- Des captures d'écran des écrans principaux, sur ordinateur et sur
  téléphone, sont rangées dans `docs/captures/` et citées dans le rapport.
- `RAPPORT-NUIT-1.md` décrit ce qui est fait et ce qui ne l'est pas, les choix
  techniques et leurs raisons, les failles ou limites connues, et la
  prochaine étape proposée.
