# Rapport de la nuit 2 : affiner KanbanX pour l'usage à deux

Date : 24/11/2026. Branche `nuit-2`. Consigne : `docs/consignes/NUIT-2.md`.

**Secrets** : aucun secret trouvé dans le dépôt, aucun ajouté. Les clés et jetons Trello des tests sont fictifs.
**Production** : jamais contactée. Tout a été testé en local, avec des données fictives (`exemple.invalid`), la
boîte de courriel de développement, un faux serveur SMTP et un faux serveur Trello.
**Sandbox** : aucun site bloqué. Le dossier `.github/` n'a pas été touché.

## Une ligne par point

| Point | État | Ce qui est fait |
| --- | --- | --- |
| 1. [MCP] Lire une carte en entier | **Fait** | Outil `lire_carte` (`carte_id`) : tableau, colonne, titre, description, échéance, responsables, étiquettes, commentaires (auteur, « Claude pour X », date, texte). Droits de la personne (RLS) ; une carte d'un autre tableau répond « introuvable » |
| 2. [Produit] Mentions partout | **Fait** | `@prénom` compte dans le titre, la description et les commentaires, parmi les membres du tableau seulement. Seules les mentions nouvelles comptent. Écran « Mes mentions » (icône @ de l'en-tête) et `lire_mentions` donnent l'endroit. Suggestions `@` dans le commentaire, le titre (fenêtre de carte et tableau), la description et l'ajout de carte |
| 3. [MCP] « @Claude » au Claude de chaque membre | **Fait** | `lire_mentions` d'une application OAuth y ajoute les « @Claude » des tableaux de la personne (`destinataire : "Claude"`). Fonctionne sans compte nommé Claude ; le compte agent « Claude » membre la reçoit aussi, une seule fois. Un non-membre ne la voit jamais. Instructions MCP mises à jour |
| 4. [MCP] Gérer les colonnes | **Fait** | `creer_colonne` (position facultative), `renommer_colonne`, `deplacer_colonne`, avec les droits de l'interface (un lecteur ne change rien, un non-membre ne voit rien). Les instructions demandent de proposer en commentaire avant de changer la structure |
| 5. [Ergonomie] `/mcp` dans un navigateur | **Fait** | `GET /mcp` qui accepte `text/html` : courte page avec la CSP de l'application. Tout autre `GET` garde le 405 JSON |
| 6. [Produit] Courriel de mention | **Fait** | File en base (`mention_emails`), boucle en mémoire toutes les 30 s, au plus un courriel toutes les 10 minutes par personne. Jamais pour soi-même, vers un agent ni pour « @Claude ». Désactivable dans « Mon compte ». La file survit à un redémarrage. Un échec est réessayé plus tard, sans bloquer la requête |
| 7. [Interface] Archives ; archiver un tableau | **Fait** | Panneau « Archives » sur le tableau : cartes et colonnes archivées, avec « Restaurer ». Le propriétaire archive le tableau (confirmation, annulation possible) et le restaure depuis « Tableaux archivés » sur l'accueil. Un membre non propriétaire ne peut pas archiver (403, et la base refuse). Un tableau archivé ne se modifie plus |
| 8. [Import] Auteurs Trello reliés aux comptes | **Fait** | L'import propose d'associer chaque auteur Trello à une personne qui partage déjà un tableau avec celle qui importe. Le commentaire affiche ce nom avec « importé de Trello », mais reste la propriété de celle qui importe. La base refuse un faux auteur et toute modification après coup |
| 9. [Import] Images de Trello | **Fait** | Images en base (RLS), PNG, JPEG, GIF et WebP reconnus par leur signature, sans SVG, 5 Mo au plus. Diffusion contrôlée (`nosniff`, `inline`, CSP `sandbox`). Téléchargement fermé aux hôtes de Trello, sans adresse interne, avec délai, taille maximale et 200 images au plus. Clé et jeton jamais stockés ni journalisés. Une image non récupérée reste un lien avec un encart « Image restée sur Trello » |

## Tests

- `npm test` est **vert** (code de sortie 0) : **184 tests `node:test` et 33 parcours navigateur**. À la fin de
  la nuit 1, la suite comptait 138 tests et 27 parcours.
- **Nouveaux fichiers de test** :
  - serveur : `test/mcp-carte`, `mentions`, `mentions-claude`, `mcp-colonnes`, `mcp-page`,
    `courriel-mentions`, `archives`, `import-auteurs` et `images` ;
  - navigateur : `e2e/nuit2.test.js`, qui fait passer l'audit axe à chaque écran nouveau, en clair, en sombre et
    sur téléphone ;
  - outils partagés : `test/mcp-aide.js` (dont `claudePour`, qui branche « Claude pour X » par OAuth) et
    `auditer` dans `e2e/aide.js`.
- **Lanceur** : la variable `FICHIERS=…` permet de ne lancer que certains fichiers pendant le développement.
  Sans elle, rien ne change.

### Rouges constatés (tests écrits d'abord)

| Point | Échecs avant le code |
| --- | --- |
| 1 | 4 |
| 2 | 6 |
| 3 | 4 |
| 4 | 5 |
| 5 | 1 |
| 6 | 8, après pose d'un module vide pour voir chaque règle échouer séparément |
| 7 | 3 |
| 8 | 4 |
| 9 | 11, module vide également |

- **Tests déjà verts avant le code** : quelques tests négatifs (par exemple « un non-membre ne voit rien »)
  passaient avant d'écrire le code, faute de fonctionnalité. Ils servent de garde-fous de non-régression.
- **Point 7 : test RLS déjà vert**. Il passait avant tout code : la politique `boards_maj` réserve la mise à
  jour d'un tableau au propriétaire depuis la nuit 1.
- **Erreurs de mes tests, pas du code**, corrigées :
  - point 5 : une expression régulière `on\w+=` attrapait `content=` ;
  - point 6 : j'attendais à tort un 201, et un sujet ASCII encodé.

### Tests de mutation

- **Point 6** : supprimer l'exclusion « vers un agent » fait échouer un test.
- **Point 9** : huit garde-fous ont été cassés un à un, et chacun fait échouer au moins un test :
  - contrôle de l'adresse IP ;
  - clé transmise aux redirections ;
  - limite de taille réelle ;
  - liste d'hôtes ;
  - plafond de 200 images ;
  - CSP `sandbox` ;
  - limite de taille annoncée ;
  - délai.
- **Deux survivants au premier essai** :
  - la limite de taille était masquée par le contrôle à l'enregistrement ;
  - l'expression `/hôte/` reconnaissait aussi « hôte introuvable ».

  J'ai resserré les tests, et les deux mutations sont désormais détectées.

### Tests existants modifiés, et pourquoi

- **`test/mcp.test.js`** : la liste des outils annoncés comprend les 4 nouveaux outils.
- **`test/durcissement.test.js`** : les consignes MCP disaient « une mention ne déclenche aucune notification ».
  Ce n'est plus vrai depuis la décision du 24/11 (point 6). Le test vérifie maintenant que les consignes
  l'annoncent : « la prévient par courriel… ne mentionne quelqu'un que si c'est utile ».

## Migrations (ajouts seulement)

- **`007_mentions`** : table `card_mentions` (RLS) et colonne `comments.mentions_claude` (défaut `false`).
- **`008_courriels_mentions`** :
  - colonne `users.mention_emails` (défaut `true`), modifiable par la personne elle-même seulement ;
  - table `mention_emails` : insertion par l'auteur seulement, aucune lecture par l'application ;
  - trois fonctions pour la boucle d'envoi.
- **`009_import_auteurs`** :
  - colonnes `comments.imported_*` ;
  - politique restrictive à l'insertion ;
  - déclencheur qui fige l'association.
- **`010_images`** : table `images` (RLS, types et taille contrôlés par la base).

L'ancien code tourne sur le nouveau schéma : il ignore les tables nouvelles, et les colonnes nouvelles ont une
valeur par défaut. La politique restrictive et le déclencheur ne visent que les colonnes nouvelles.

## Choix faits (non tranchés par la consigne), et pourquoi

1. **Les mentions de commentaires restent dans `comments.mentions`** (comme dans la nuit 1). La nouvelle table ne
   reçoit que celles du titre et de la description. Ainsi, après un retour arrière puis une nouvelle livraison,
   rien n'est perdu.
2. **Texte affiché pour une mention de titre ou de description** : c'est le texte actuel de la carte, et non
   celui du moment de la mention.
3. **« Nouvelle mention » se juge par champ** : une personne déjà citée dans ce champ avant la modification ne
   compte pas. Si on la retire puis la remet, elle compte de nouveau.
4. **Point 3 : un « @Claude » écrit par un agent ne relance pas les autres Claude.** Cela vaut pour le compte
   agent comme pour « Claude pour X ». C'est l'option sûre : pas de boucle entre agents.
5. **Point 3 : `lire_mentions` d'une application OAuth reçoit les « @Claude »**, quel que soit le nom déclaré par
   l'application. Elle n'agit qu'avec les droits de la personne, donc rien ne fuit hors de ses tableaux.
6. **Point 3 : `destinataire`** dit à qui s'adresse chaque mention : « Claude », ou la personne au nom de qui on
   agit. L'écran « Mes mentions » de la personne ne montre pas les « @Claude ». « Claude » est toujours proposé
   dans les suggestions et mis en évidence dans le texte.
7. **Point 6 : mentions faites pendant la désactivation.** Elles sont abandonnées et ne partent pas après coup
   si la personne réactive les courriels. Un compte désactivé ou retiré du tableau ne reçoit rien non plus.
8. **Point 6 : lien de désinscription.** Le courriel contient une dernière ligne « Ne plus recevoir ces
   courriels : …/compte ». C'est l'usage, et c'est le moyen de « désactiver par la personne ». Hormis cette
   ligne, il ne contient que ce que demande la consigne.
9. **Point 6 : sujet sans nom propre** (« KanbanX : 2 nouvelles mentions »). Aucune donnée saisie par un tiers
   n'entre dans les en-têtes.
10. **Point 6 : réessais** au bout de 1, 2, 4… minutes, au plus une heure, avec abandon après 10 essais. Les
    lignes traitées sont purgées après 7 jours.
11. **Point 6 : courriel qui part même si l'auteur a supprimé son commentaire entre-temps.** L'extrait est copié
    au moment de la mention.
12. **Point 7 : un membre voit les tableaux archivés**, mais seul le propriétaire les restaure. Un tableau
    archivé n'est plus modifiable (code), mais reste lisible par ses cartes.
13. **Point 7 : restaurer une carte ou une colonne** reste permis aux membres écrivains, comme l'archivage.
14. **Point 8 : association limitée aux personnes**, pas aux agents, qui partagent un tableau avec celle qui
    importe. Une association hors de ce cercle refuse tout l'import (400), sans rien créer. L'interface propose
    l'association quand un seul prénom correspond. La date Trello est conservée.
15. **Point 8 : ancien format accepté.** L'API prend aussi l'export brut, comme avant. Le nouveau format est
    `{ trello, correspondances, trelloAuth }`.
16. **Point 9 : hôtes autorisés** : `trello.com`, `api.trello.com` et `trello-attachments.s3.amazonaws.com`.
    La clé et le jeton ne partent que vers l'hôte d'origine, jamais vers celui d'une redirection.
17. **Point 9 : limites par import**, en plus de celles demandées : 100 Mo au total, 90 s pour l'ensemble des
    téléchargements, 4 téléchargements en parallèle. Les téléchargements ont lieu avant la transaction, pour ne
    pas tenir une transaction ouverte pendant le réseau.
18. **Point 9 : Markdown.** Il n'affiche une image que si elle est servie par KanbanX (`/api/images/<uuid>`).

## Défauts trouvés en chemin et corrigés

- **Ordre des commentaires importés** (défaut présent depuis la nuit 1). Ils recevaient tous l'heure de la
  transaction, et leur ordre dans le fil dépendait d'un identifiant aléatoire. Ils gardent désormais leur date
  Trello. Un test du point 8 échouait une fois sur deux à cause de ce défaut.
- **« Mes mentions »** : tout le texte était orange. La classe des éléments de la liste entrait en collision avec
  celle des mentions `@prénom`. Je l'ai vu sur les captures et corrigé.

## Limites connues

- **Un seul processus**, toujours. La boucle de courriels s'ajoute à la limitation de débit et au direct. Avec
  deux processus, un courriel pourrait partir deux fois.
- **Fonctions de la boucle de courriels** : `kx_courriels_*` donnent au rôle applicatif la liste des adresses à
  prévenir. C'est le prix d'une boucle sans session. Elles ne sont appelées que par `src/notifications.js`.
- **Point 9 : l'API Trello réelle n'a pas été jointe** : la consigne interdit tout service tiers réel. Le format
  d'authentification (`Authorization: OAuth oauth_consumer_key=…, oauth_token=…`) et le stockage S3 sont ceux
  que je connais de Trello. Ils sont à confirmer lors d'un premier import réel.
- **Images liées dans une description Trello sans figurer dans les pièces jointes** : elles ne sont pas
  rapatriées. Seules les pièces jointes sont traitées.
- **Point 9 : accès sortant et délai du proxy.** Le serveur doit pouvoir joindre ces trois hôtes en HTTPS, et le
  proxy doit laisser au moins 120 s à l'import. C'est documenté dans `docs/mise-en-production.md` (§ 5 ter), avec
  l'effet sur la taille de la base. Les courriels de mentions sont décrits au § 5 bis ; ils n'ajoutent aucune
  variable.
- **Pas d'essai avec un lecteur d'écran réel.** L'audit axe passe sur chaque écran nouveau, en clair, en sombre
  et sur téléphone.

## Captures des écrans nouveaux

Elles sont dans `docs/captures/`, produites par `node scripts/captures-nuit2.js` avec des données fictives.

| Écran | Ordinateur | Téléphone, sombre | Ordinateur, sombre |
| --- | --- | --- | --- |
| Mes mentions | `nuit2-01-mentions-ordinateur.png` | `nuit2-01-mentions-telephone-sombre.png` | `nuit2-01-mentions-ordinateur-sombre.png` |
| Mon compte (courriels de mentions) | `nuit2-02-compte-ordinateur.png` | `nuit2-02-compte-telephone-sombre.png` | `nuit2-02-compte-ordinateur-sombre.png` |
| Éléments archivés du tableau | `nuit2-03-archives-ordinateur.png` | `nuit2-03-archives-telephone-sombre.png` | `nuit2-03-archives-ordinateur-sombre.png` |
| Page de `/mcp` | `nuit2-04-page-mcp-ordinateur.png` | `nuit2-04-page-mcp-telephone-sombre.png` | `nuit2-04-page-mcp-ordinateur-sombre.png` |

| Écran | Ordinateur | Téléphone |
| --- | --- | --- |
| Suggestions @ dans la description | `nuit2-05-suggestions-description-ordinateur.png` | `nuit2-05-suggestions-description-telephone.png` |
| Archiver le tableau (confirmation) | `nuit2-06-archiver-tableau-ordinateur.png` | `nuit2-06-archiver-tableau-telephone.png` |
| Accueil, « Tableaux archivés » | `nuit2-07-accueil-tableaux-archives-ordinateur.png` | `nuit2-07-accueil-tableaux-archives-telephone.png` |
| Import Trello (auteurs et images) | `nuit2-08-import-trello-ordinateur.png` | `nuit2-08-import-trello-telephone.png` |
| Carte importée (image rapatriée, encart, auteur associé) | `nuit2-09-carte-importee-ordinateur.png` | `nuit2-09-carte-importee-telephone.png` |
