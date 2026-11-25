# Mise en production de KanbanX : ce que l'application exige

Adresse publique : `https://kanbanx.y-factor.fr`.

Le proxy inverse, le service et la chaîne de livraison sont tenus par InfraLWS. Cette fiche ne décrit que le
contrat de l'application.

## 1. Exigences

- **Node.js 22 ou plus récent** (`engines` de `package.json`) et **PostgreSQL 18**.
- **Un seul processus.** La limitation de débit et le direct sont en mémoire.
- **Écoute en boucle locale** (`HOST=127.0.0.1` par défaut), derrière un proxy inverse HTTPS qui :
  - transmet l'en-tête `Host` d'origine (contrôle d'origine contre le CSRF, serveur MCP) ;
  - pose `X-Real-IP` (adresse du client, utilisée seulement pour les limites de débit) ;
  - ne met pas en tampon les flux en direct (`/api/boards/:id/events`, Server-Sent Events, connexions longues) ;
  - accepte un corps de requête jusqu'à 11 Mo (import d'un export Trello : 10 Mo au plus).
- L'application pose elle-même ses en-têtes de sécurité, dont une CSP stricte et HSTS : le proxy ne les
  duplique pas.
- **Deux rôles de base** :
  - le **propriétaire** possède les tables ; il sert aux migrations et aux commandes `compte` et `jeton`. Il n'a
    besoin ni d'être superutilisateur ni de `CREATEROLE` ;
  - le **rôle applicatif `kanbanx_app`**, créé d'avance, n'est ni superutilisateur ni `BYPASSRLS` et ne possède
    aucune table : les politiques RLS s'appliquent à lui.

## 2. Variables du service web

| Variable | Exigence |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST`, `PORT` | Adresse et port d'écoute (boucle locale) |
| `TRUST_PROXY` | `1` derrière le proxy inverse. `X-Real-IP` n'est cru que si la connexion vient de la boucle locale. |
| `BASE_URL` | Adresse publique, en `https://` |
| `DATABASE_URL` | Connexion avec le rôle applicatif `kanbanx_app` |
| `SMTP_URL` | `smtps://…:465` (TLS dès la connexion) ou `smtp://…:587` (STARTTLS exigé) |
| `SMTP_FROM` | `Nom <adresse>`, au domaine signé par DKIM |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Facultatives, mais les deux ou aucune : « Continuer avec Google » (§ 5 quater). |

Le serveur **refuse de démarrer** si l'une de ces variables manque, contient une valeur de développement, ou
si son rôle de connexion échappe aux politiques RLS.

Jamais dans l'environnement du service : `DATABASE_ADMIN_URL`, `KANBANX_APP_PASSWORD`, `SEED_DEMO=1`, ni
`?tls=non` dans `SMTP_URL`. Aucun fichier `.env` dans le dossier de l'application : le serveur en chargerait
le contenu.

## 3. Commandes (rôle propriétaire, avec `DATABASE_ADMIN_URL`)

- `npm run db:migrer` applique les migrations manquantes, chacune dans sa transaction, sous un verrou. Sans
  `KANBANX_APP_PASSWORD` (le cas de la production), il ne crée ni ne modifie `kanbanx_app` : il vérifie qu'il
  existe et qu'il est sûr, sinon il échoue avant toute migration.
- `npm run compte -- <courriel> <prénom> [--agent]` crée un compte (personne ou agent). Relancée, la commande ne
  crée pas de doublon.
- `npm run jeton -- <courriel du compte agent>` crée le jeton d'API de l'agent. Il s'affiche une seule fois.

Il n'y a pas d'inscription publique. La première personne est créée par `compte`, puis elle invite les autres
depuis l'application. Un agent n'est jamais propriétaire d'un tableau : la base le refuse.

## 4. Route de santé

`GET /api/sante`, publique, soumise à la limite de débit publique :

- `200 {"ok":true,"version":"…","commit":"…","base":"ok","schema":"a-jour"}` ;
- `503` si la base ne répond pas en 3 secondes, ou si une migration du dossier `migrations/` n'est pas appliquée.

`commit` est lu dans le fichier `.commit-deploye` à la racine du paquet (écrit par la chaîne de livraison) ;
sans ce fichier, il vaut `dev`. La route ne renvoie aucune donnée, aucun compteur, aucun détail d'erreur.

## 5. Branchement de Claude (OAuth 2.1)

Rien à configurer : pas de variable, pas de secret. Le serveur d'autorisation fait partie de l'application et
se déduit de `BASE_URL`. Le proxy transmet tels quels, sans cache :

- `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp` et
  `/.well-known/oauth-authorization-server` (métadonnées, RFC 9728 et RFC 8414) ;
- `/oauth/register`, `/oauth/authorize`, `/oauth/token` ;
- `/mcp`, qui répond `401` avec `WWW-Authenticate: Bearer resource_metadata="…"` sans jeton valable.

Les serveurs de Claude viennent de la plage `160.79.104.0/21` : elle ne doit pas être bloquée. Côté personne,
on ajoute dans Claude un connecteur personnalisé d'adresse `https://kanbanx.y-factor.fr/mcp`, puis on se
connecte et on donne son accord. La page « Applications connectées » de KanbanX permet de retirer un accès.

## 5 bis. Courriels de mentions

Aucune variable nouvelle : les courriels de mentions partent par le même `SMTP_URL` et le même `SMTP_FROM` que
le lien de connexion, avec les mêmes en-têtes. Une mention ajoute une ligne à la file `mention_emails` ; une
boucle du processus web l'envoie (un tour toutes les 30 secondes), au plus un courriel toutes les 10 minutes
par personne. La file est en base : elle survit à un redémarrage. Un échec d'envoi est réessayé (1, 2, 4…
minutes, au plus une heure, abandon après 10 essais) et journalisé sans adresse ni contenu. Les lignes
envoyées ou abandonnées sont purgées au bout de 7 jours. Chaque personne peut couper ces courriels dans
« Mon compte ». Le message contient un lien vers `BASE_URL/compte` pour le faire.

## 5 ter. Images rapatriées de Trello

À l'import d'un export Trello, la personne peut saisir sa clé et son jeton d'API Trello : les images jointes aux
cartes sont alors téléchargées et stockées **dans la base** (table `images`, colonne `bytea`), pas sur le disque.
La clé et le jeton ne servent qu'à cette requête : ils ne sont ni stockés ni journalisés.

- **Accès sortant nouveau** : le serveur doit pouvoir joindre en HTTPS (443) `trello.com`, `api.trello.com` et
  `trello-attachments.s3.amazonaws.com`, et seulement ces hôtes (liste fermée dans le code, redirections
  comprises ; aucune adresse interne n'est jamais contactée). Sans cet accès, les images restent des liens.
- **Taille de la base** : 5 Mo au plus par image, 200 images et 100 Mo au plus par import. Un import d'un
  tableau riche en captures peut donc ajouter jusqu'à 100 Mo ; en pratique, une capture d'écran pèse de 100 à
  500 Ko, soit 20 à 100 Mo pour 200 images. Les images sont supprimées avec leur tableau (et jamais avant).
  La sauvegarde de la base grossit d'autant : à surveiller avec `select pg_size_pretty(sum(taille)) from images;`.
- **Durée de l'import** : 10 secondes au plus par image et 90 secondes au plus pour l'ensemble des
  téléchargements, faits avant l'écriture en base. Le proxy inverse doit laisser à `POST /api/boards/import-trello`
  au moins 120 secondes de délai de réponse.
- **Diffusion** : `GET /api/images/:id`, avec contrôle d'accès, type fixé par le serveur (PNG, JPEG, GIF, WebP
  reconnus par leur signature, jamais de SVG), `nosniff`, `Content-Disposition: inline` et CSP `sandbox`.

## 5 quater. « Continuer avec Google »

Facultatif : sans `GOOGLE_CLIENT_ID` ni `GOOGLE_CLIENT_SECRET`, le bouton n'apparaît pas et seul le lien par
courriel est proposé. Le serveur refuse de démarrer si une seule des deux variables est fournie, ou si
l'identifiant n'a pas la forme `…apps.googleusercontent.com`.

- **Client Google** : type « Application Web », créé par le propriétaire du projet Google Cloud, adresse de
  retour autorisée `BASE_URL/auth/google/retour` (seule adresse, aucune origine JavaScript). Audience
  « Externe », publiée (« In production ») : les portées demandées (`openid email`) sont non sensibles, Google
  ne demande pas de vérification. Le secret n'est montré qu'à la création : il va directement dans
  l'environnement du service, jamais dans le dépôt ni dans un échange écrit.
- **Accès sortant nouveau** : le serveur doit joindre en HTTPS (443) `oauth2.googleapis.com` (échange du code,
  10 secondes au plus, sans suivi de redirection). Le navigateur, lui, va sur `accounts.google.com` : rien à
  ouvrir côté serveur pour cela. Pas d'accès aux clés publiques de Google : le jeton d'identité arrive
  directement du point de jeton de Google, en HTTPS et contre le secret du client, ce qui dispense de vérifier
  sa signature (OpenID Connect Core, § 3.1.3.7) ; ses revendications sont vérifiées.
- **Proxy inverse** : `GET /auth/google/retour` passe tel quel, sans cache (comme le reste de l'application).
- **Règles** : Google n'ouvre qu'un compte déjà invité, jamais n'en crée, et la personne n'a que les droits de
  ses invitations. Le compte est reconnu par l'identifiant Google (`sub`) ; la première liaison par l'adresse
  n'a lieu que si Google fait autorité sur elle (Gmail, ou compte Workspace), sinon on lie son compte Google
  depuis « Mon compte » après une connexion par courriel.
- **Base** : migration `011_google.sql` (tables `identites_google` et `google_demandes`, réservées au
  propriétaire). Les demandes en cours expirent au bout de 10 minutes et sont purgées à la demande suivante.
- **Suivi** : un client Google inutilisé pendant 6 mois est supprimé par Google, qui prévient l'adresse de
  contact du projet.

## 6. Ordre d'une livraison

1. Sauvegarde de la base.
2. Migrations : `npm run db:migrer`.
3. Redémarrage du service web. Les navigateurs ouverts se reconnectent seuls et rechargent le tableau.
4. Santé : `GET /api/sante` répond `200` avec le commit livré.

Les migrations ne font qu'ajouter (règle dans `CLAUDE.md`) : la version précédente du code tourne sur le
nouveau schéma. Le retour arrière consiste donc à relancer le code précédent, sans restaurer la base.

## 7. Limites connues de cette version

- **Un seul processus**, pour les raisons données plus haut.
- **Flux en direct.** Un flux déjà ouvert n'est pas recontrôlé quand la session expire. Il est coupé quand le
  membre est retiré du tableau.
- **Jetons d'API** (compte agent, `kbx_…`). Ils n'expirent pas : la révocation se fait en en recréant un avec
  `npm run jeton`. Les jetons OAuth, eux, durent une heure et se renouvellent par rafraîchissement.
- **Rafraîchissement concurrent.** Si un client présente deux fois le même jeton de rafraîchissement, toute la
  lignée est révoquée, comme le veut le contrat : la personne doit alors reconnecter l'application.
