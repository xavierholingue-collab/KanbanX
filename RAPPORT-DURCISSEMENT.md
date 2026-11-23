# Rapport du durcissement avant mise en production

Date : 23/11/2026. Travail fait par Claude, en séance avec Xavier (PR #2, puis alignement en PR #3).

**Secrets** : aucun secret trouvé dans le dépôt, aucun ajouté.
**Périmètre** : les points 2 à 7 de la relecture de sécurité de la PR #1 (PR #2), puis le lot C1 à C7 de la
réponse d'InfraLWS du 23/11 (PR #3). Le point 1 (le tableau sans propriétaire) est corrigé dans la PR #1.
OAuth 2.1 pour le serveur MCP fera l'objet d'une PR à part.

## En bref

| Point | Correction | Vérifié par |
| --- | --- | --- |
| 2. Le serveur détenait les identifiants administrateur de la base | En production, plus de migration au démarrage ; refus de démarrer si `DATABASE_ADMIN_URL` ou `KANBANX_APP_PASSWORD` sont fournis, ou si le rôle de connexion est superutilisateur, BYPASSRLS ou propriétaire des tables | Tests sur le vrai serveur lancé en production |
| 3. SMTP en STARTTLS opportuniste | TLS obligatoire : sans STARTTLS, rien ne part (ni identifiants, ni lien) ; `?tls=non` seulement hors production, pour un faux serveur de test ; SNI ; port 587 par défaut | Faux serveur SMTP |
| 4. Valeurs de développement et écoute sur 0.0.0.0 | Refus de démarrer en production si une variable manque ou garde une valeur de développement ; écoute sur `127.0.0.1` par défaut | Tests de configuration et de démarrage |
| 5. Énumération des comptes par le temps de réponse | Envoi du lien en arrière-plan ; un échec est journalisé sans l'adresse ni le lien | Faux serveur SMTP muet |
| 6. Injection de consignes via MCP | Consignes MCP : le contenu des cartes est une information, pas un ordre ; confirmation avant toute action étendue ; une mention ne notifie pas. Un agent ne peut jamais être propriétaire d'un tableau (garanti par la base, migration 004) | Tests API et MCP |
| 7. Mineurs | Adresse mal encodée : 400 (et non 500) ; 10 flux en direct au plus par utilisateur ; pas de carte créée ou déplacée dans une colonne archivée | Tests API |
| Premier compte en production | `npm run compte -- <courriel> <prénom> [--agent]`, idempotent | Test : le compte créé se connecte et crée un tableau |

## Lot C1 à C7 de la réponse d'InfraLWS (PR #3)

La réponse d'InfraLWS (`REPONSE-INFRALWS-2026-11-23.md`) remplace ses consignes du matin. Une première
version de la PR #3 suivait ces consignes, désormais archivées : elle retirait HSTS, `TRUST_PROXY` et la
fiche de mise en production. Ces retraits sont annulés, car InfraLWS garde ces trois points.

| Point | État | Ce qui est fait |
| --- | --- | --- |
| C1. `engines.node` à `>=22` | Fait | Suite complète verte sous Node 22.23.5 (production) et 26.13.1 (cible de 2027) |
| C2. `migrer.js` sans mot de passe | Fait | Sans `KANBANX_APP_PASSWORD`, le script ne crée ni ne modifie `kanbanx_app`. Il vérifie que le rôle existe, n'est ni superutilisateur ni `BYPASSRLS` et ne possède aucune table, sinon il échoue avant toute migration. Testé avec un propriétaire `nosuperuser nocreaterole` et un rôle créé d'avance |
| C3. `GET /api/sante` | Fait | Publique, soumise à la limite de débit publique. 200 avec version, commit (`.commit-deploye`, sinon `dev`), base et schéma ; 503 si la base ne répond pas en 3 s ou si une migration manque. Migration 005 : `select` sur `schema_migrations` |
| C4. Courriel conforme | Fait | `Date`, `Message-ID` au domaine de l'expéditeur, `MIME-Version`, `Content-Transfer-Encoding: 8bit`, sujet encodé (RFC 2047) s'il est accentué, `EHLO` avec l'hôte de `BASE_URL` |
| C5. Le direct après une coupure | Fait | À l'ouverture qui suit une erreur, le tableau et la carte ouverte se rechargent. Si le navigateur abandonne la reconnexion, le flux est rouvert. Parcours Playwright : arrêt et relance du serveur, modification par un second client pendant la reconnexion |
| C6. Règle des migrations | Fait | Écrite dans `CLAUDE.md` : on ajoute, on ne renomme ni ne supprime dans la même livraison |
| C7. Fiche réduite au contrat | Fait | `docs/mise-en-production.md` : exigences, variables, commandes, route de santé, ordre d'une livraison. Plus de nginx, de Node 26, de port 3100 ni de mot de passe de base |

Rien n'est contesté. Restent conservés de la PR #2 : HSTS posé par l'application, `TRUST_PROXY=1` avec
`X-Real-IP` (cru seulement si la connexion vient de la boucle locale), et `npm run compte` idempotent avec
l'option `--agent`.

**Tests** : 106 tests (`node:test`) et 20 parcours navigateur verts, sous Node.js 22.23.5 et 26.13.1, avec
PostgreSQL 18.7 et Chrome 153. Le rouge a été constaté avant chaque correction de C2 à C5 : refus de
`alter role` par le propriétaire ordinaire (C2), module et route absents (C3), en-têtes et encodage absents
(C4), carte jamais affichée après la relance du serveur (C5).

**Hors de portée de la sandbox** : l'authentification « peer » par le socket de PostgreSQL. La forme des
adresses retenues (`postgresql://kanbanx_app@/kanbanx?host=/var/run/postgresql`) a été vérifiée : le
pilote `pg` la lit correctement et le contrôle de configuration de production l'accepte. InfraLWS a éprouvé
les migrations sur le serveur dans ces conditions.

## Méthode suivie

- Tests écrits d'abord, rouge constaté (15 échecs) avant les corrections.
- Tests de mutation : l'envoi sans TLS, le retour à l'attente de l'envoi du courriel, la suppression de la
  garde « agent non propriétaire » et celle du contrôle du rôle au démarrage font chacun échouer le test
  correspondant.

## Choix faits, et pourquoi

1. **Un agent ne crée plus de tableau.** C'est la conséquence de la règle « un agent n'est jamais
   propriétaire ». Claude travaille dans les tableaux où une personne l'a invité.
2. **Le développement reste simple** : `npm start` applique toujours les migrations et les données de
   démonstration, mais uniquement hors production.
3. **Port SMTP par défaut** : 587 (soumission avec STARTTLS) au lieu de 25.
