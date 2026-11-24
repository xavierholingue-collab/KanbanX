# Consigne de la nuit 2 : affiner KanbanX pour l'usage à deux

Branche : **`nuit-2`** (elle contient déjà ce fichier). Ne pousse jamais sur `main`.
Rapport : **`RAPPORT-NUIT-2.md`** à la racine, en français.

Lis d'abord `CLAUDE.md` en entier, puis `docs/cahier-des-charges.md`, puis les trois rapports
(`RAPPORT-NUIT-1.md`, `RAPPORT-DURCISSEMENT.md`, `RAPPORT-OAUTH.md`). Ces règles s'appliquent toutes.

## Ce qui a changé depuis la nuit 1

KanbanX est en ligne et Claude s'y branche par OAuth, au nom de la personne qui a donné son accord
(« Claude pour Xavier » dans l'historique). Xavier et Claude s'en servent à deux pour leur propre backlog,
avant de l'ouvrir à l'équipe. Les cartes ci-dessous viennent de ce tableau ; les décisions ont été prises
par Xavier le 24/11.

## Règles propres à cette nuit

- **N'accède jamais à la production.** Ni `kanbanx.y-factor.fr`, ni aucun serveur réel. Tout se teste en
  local, avec des données fictives et des adresses en `exemple.invalid`.
- **Aucun courriel réel, aucun service tiers réel.** Le courriel passe par la boîte de développement ou un
  faux serveur SMTP de test ; Trello, par un faux serveur de test.
- **Migrations : uniquement des ajouts** (règle de `CLAUDE.md`). La version actuelle du code doit tourner
  sur le nouveau schéma.
- **Qualité avant quantité.** Traite les points **dans l'ordre**. Un point n'est commencé que si le précédent
  est fini, testé et commité. Ce qui reste est noté dans le rapport, sans honte : c'est prévu.
- **Test d'abord pour chaque règle de sécurité ou de droits**, avec le rouge constaté.
- **Un commit par point au moins**, message en français.
- Garde le niveau d'ergonomie exigé (Trello au minimum), le mode sombre, le téléphone et l'accessibilité :
  chaque écran nouveau passe l'audit axe des parcours navigateur.

## Les points, dans l'ordre

### 1. [MCP] Lire une carte en entier

Aujourd'hui, Claude voit le titre d'une carte, son échéance, ses étiquettes et le nombre de commentaires,
mais pas sa description.

**Fini quand** un outil `lire_carte` (paramètre `carte_id`) renvoie la colonne, le titre, la description,
l'échéance, les responsables, les étiquettes et les commentaires (auteur, « Claude pour X » le cas échéant,
date, texte), avec les droits de la personne (RLS). Une carte d'un autre tableau répond « introuvable ».

### 2. [Produit] Mentions partout : titres, descriptions et commentaires

**Décidé** : une mention `@prénom` compte aussi dans le **titre** et la **description** d'une carte, pas
seulement dans un commentaire.

- Résolution identique aux commentaires : seuls les membres du tableau sont résolus.
- À la création et à chaque modification, seules les **nouvelles** mentions comptent (pas de doublon quand
  on corrige une faute dans une description).
- La personne les retrouve dans ses mentions (écran et outil `lire_mentions`), avec l'endroit : titre,
  description ou commentaire.
- Les suggestions `@` de l'éditeur de commentaire s'ouvrent aussi dans le titre et la description.

### 3. [MCP] « @Claude » arrive au Claude de chaque membre

**Décidé** : quand quelqu'un écrit « @Claude » (titre, description ou commentaire) sur un tableau, la mention
apparaît dans `lire_mentions` pour le Claude de **chaque membre** de ce tableau qui l'a branché par OAuth.
La réponse est signée « Claude pour X », on sait donc qui a répondu.

- « @Claude » est reconnu même si aucun compte nommé Claude n'est membre. Si le compte agent « Claude » est
  membre, il la reçoit aussi, comme aujourd'hui.
- Une personne qui n'est pas membre du tableau ne voit jamais la mention (test).
- Mets à jour les instructions du serveur MCP : « une mention @Claude t'est adressée ; réponds en
  commentaire ; avant toute action large, propose d'abord ».

### 4. [MCP] Gérer les colonnes

Claude ne peut pas créer de colonne.

**Fini quand** trois outils existent : `creer_colonne` (tableau, nom, position facultative),
`renommer_colonne` et `deplacer_colonne`, avec les mêmes droits que l'interface (un lecteur ne peut rien
changer : test). Les instructions MCP demandent de proposer en commentaire avant de changer la structure
d'un tableau.

### 5. [Ergonomie] /mcp ouverte dans un navigateur

Ouverte dans un onglet, l'adresse `/mcp` affiche une erreur JSON.

**Fini quand** une requête `GET /mcp` qui accepte `text/html` reçoit une courte page, avec la CSP de
l'application : « Ceci est l'adresse du serveur MCP de KanbanX. Collez-la dans Claude : Paramètres ›
Connecteurs › Ajouter un connecteur personnalisé. » Tout autre `GET` garde la réponse actuelle (405 JSON) :
les clients MCP ne doivent rien voir changer (test).

### 6. [Produit] Prévenir la personne mentionnée par courriel

**Décidé** : un courriel par mention, **regroupé** : au plus un courriel toutes les 10 minutes par personne,
qui liste les mentions reçues depuis le précédent. **Désactivable** par la personne dans son compte.

- Jamais pour une mention de soi-même, jamais vers un compte agent, jamais pour « @Claude ».
- Contenu : qui, sur quel tableau, quelle carte, un extrait court (200 caractères au plus) et le lien. Rien
  d'autre. En-têtes conformes, comme le lien de connexion (`src/courriel.js`).
- Un seul processus : une file en base et une boucle en mémoire suffisent ; la file survit à un
  redémarrage (test). Un échec d'envoi est réessayé plus tard, sans bloquer la requête qui a mentionné.
- Variables de production inchangées (le SMTP existe déjà) ; si tu en ajoutes une, documente-la dans
  `docs/mise-en-production.md`.

### 7. [Interface] Éléments archivés ; archiver un tableau

**Fini quand** un tableau montre ses cartes et colonnes archivées (une vue discrète, pas dans le flux
principal) avec « Restaurer » ; le propriétaire peut archiver un tableau entier et le restaurer depuis
l'accueil (« Tableaux archivés »). Un membre non propriétaire ne peut pas archiver le tableau (test).

### 8. [Import] Relier les auteurs Trello aux comptes KanbanX

Les commentaires importés sont signés par la personne qui importe, avec « Eric Hoarau sur Trello » en tête.

**Fini quand** l'import propose d'associer chaque membre Trello de l'export à une personne **qui partage déjà
un tableau** avec celle qui importe (jamais la liste de tous les comptes). Le commentaire affiche alors le nom
de la personne associée, avec la mention « importé de Trello ». Il **reste la propriété** de la personne qui
importe : personne ne peut écrire au nom d'un autre (test).

### 9. [Import] Rapatrier les images de Trello

**Décidé** : rapatrier les images dans KanbanX, au lieu de liens vers trello.com qui ne s'affichent pas sans
compte Trello.

C'est le point le plus lourd et le plus sensible : fais-le seulement si les huit premiers sont finis.

- **Stockage** : table en base (pas de fichiers sur le disque du serveur), protégée par RLS comme le tableau.
  Images seulement : PNG, JPEG, GIF, WebP, reconnues par leur signature et non par leur extension. **Pas de
  SVG.** 5 Mo au plus par image.
- **Diffusion** : par l'API, avec contrôle d'accès, `Content-Type` fixé par le serveur,
  `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` et une CSP `sandbox`.
- **Téléchargement depuis Trello** : Trello exige la clé et le jeton d'API de la personne. Ils sont saisis
  au moment de l'import, servent pendant cette seule requête, et ne sont **jamais** stockés ni journalisés.
  Le serveur ne contacte que les hôtes de Trello en liste fermée (redirections comprises), avec un délai,
  une taille maximale et 200 images au plus par import. Pas d'accès aux adresses internes (test). Les tests
  passent par un faux serveur Trello local.
- Une image non récupérée reste un lien, avec un encart clair « image restée sur Trello ».
- Documente dans `docs/mise-en-production.md` l'effet sur la taille de la base.

Si ce point n'est pas fini, laisse le code inachevé hors de la branche (ou derrière un test marqué
« à faire » documenté) et décris dans le rapport ce qui reste. Ne livre jamais un téléchargement à moitié
protégé.

## Fin de nuit

- `npm test` vert. Un test qui échoue pour une raison que tu ne sais pas corriger est signalé, jamais
  supprimé ni désactivé en silence.
- `RAPPORT-NUIT-2.md` : une ligne par point (fait, partiel, pas fait, avec la raison), les choix faits, les
  rouges constatés, les limites connues, des captures des écrans nouveaux (ordinateur, téléphone, sombre).
- Pousse la branche `nuit-2`, puis arrête-toi. N'ouvre pas de PR, ne commence pas d'autre chantier.
