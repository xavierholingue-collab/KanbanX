# Rapport du durcissement avant mise en production

Date : 23/11/2026. Travail fait par Claude, en séance avec Xavier (PR #2, puis alignement en PR #3).

**Secrets** : aucun secret trouvé dans le dépôt, aucun ajouté.
**Périmètre** : les points 2 à 7 de la relecture de sécurité de la PR #1. Le point 1 (le tableau sans
propriétaire) est corrigé dans la PR #1. Le reste de la préparation à l'hébergement fait l'objet de la nuit 2,
qui produira son propre `RAPPORT-NUIT-2.md`.

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

## Alignement sur le contrat d'hébergement (PR #3)

Les exigences d'hébergement de la nuit 2 sont arrivées après la PR #2. Pour ne pas les contredire :

- la fiche de mise en production a été retirée du dépôt, qui est public : il ne décrit pas le serveur ;
- l'en-tête HSTS n'est plus posé par l'application, car le proxy d'hébergement s'en charge ;
- l'option `TRUST_PROXY` (lecture de `X-Real-IP`) est retirée. Elle sera remplacée par l'exigence H2 de la
  nuit 2 ;
- `engines.node` passe à `>=22`, la version de production. La suite complète passe sous Node 22.23.5 ;
- `npm run compte` devient idempotent, avec l'option `--agent` (exigence H11).

**Tests** : 96 tests (`node:test`) et 19 parcours navigateur verts, sous Node.js 22.23.5 et 26.13.1,
avec PostgreSQL 18.7 et Chrome 153.

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
