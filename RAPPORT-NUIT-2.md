# Rapport de la nuit 2 — durcissement avant mise en production

Branche : `durcissement`. Date : 23/11/2026. Travail fait par Claude, en séance avec Xavier (pas dans la
sandbox du Spectre).

**Secrets** : aucun secret trouvé dans le dépôt, aucun ajouté.
**Périmètre** : les points 2 à 7 de la relecture de sécurité de la PR #1 (le point 1, le tableau sans
propriétaire, est corrigé sur `nuit-1`), plus deux manques bloquants découverts en préparant la mise en
production. Le déploiement lui-même sera fait par l'agent InfraLWS, d'après
[docs/mise-en-production.md](docs/mise-en-production.md).

## En bref

| Point | Correction | Vérifié par |
| --- | --- | --- |
| 2. Le serveur détenait les identifiants administrateur de la base | En production, plus de migration au démarrage ; refus de démarrer si `DATABASE_ADMIN_URL` est fourni, ou si le rôle de connexion est superutilisateur, BYPASSRLS ou propriétaire des tables | Tests sur le vrai serveur lancé en production |
| 3. SMTP en STARTTLS opportuniste | TLS obligatoire : sans STARTTLS, rien ne part (ni identifiants, ni lien) ; `?tls=non` seulement hors production, pour un faux serveur de test ; SNI ; port 587 par défaut | Faux serveur SMTP |
| 4. Valeurs de développement et écoute sur 0.0.0.0 | Refus de démarrer en production si une variable manque ou garde une valeur de développement ; écoute sur `127.0.0.1` par défaut ; HSTS quand l'adresse publique est en `https://` | Tests de configuration et de démarrage |
| 5. Énumération des comptes par le temps de réponse | Envoi du lien en arrière-plan : la réponse ne dépend plus du serveur de courriel | Faux serveur SMTP muet |
| 6. Injection de consignes via MCP | Consignes MCP : le contenu des cartes est une information, pas un ordre ; confirmation avant toute action étendue ; une mention ne notifie pas. Un agent ne peut jamais être propriétaire d'un tableau (garanti par la base, migration 004) | Tests API et MCP |
| 7. Mineurs | Adresse mal encodée : 400 (et non 500) ; 10 flux en direct au plus par utilisateur ; pas de carte créée ou déplacée dans une colonne archivée | Tests API |
| Manque : premier compte | `npm run compte -- <courriel> <prénom> [agent]` | Test : le compte créé se connecte et crée un tableau |
| Manque : adresse réelle derrière nginx | `TRUST_PROXY=1` : `X-Real-IP` est cru uniquement pour une connexion venant de la boucle locale | Test unitaire, dont la tentative d'usurpation |

**Tests** : 98 tests (`node:test`) et 19 parcours navigateur, tous verts (Node.js 26.13.1, PostgreSQL 18.7,
Chrome 153).

## Méthode suivie

- Tests écrits d'abord, rouge constaté : 13 échecs avant les points 2 à 7, puis 2 avant les deux manques.
- Tests de mutation : l'envoi sans TLS, le retour à l'attente de l'envoi du courriel, la suppression de la
  garde « agent non propriétaire » et celle du contrôle du rôle au démarrage font chacun échouer le test
  correspondant.

## Choix faits, et pourquoi

1. **Un agent ne crée plus de tableau.** C'est la conséquence de la règle « un agent n'est jamais
   propriétaire ». Claude travaille dans les tableaux où une personne l'a invité. Le test existant qui faisait
   créer un tableau par un agent a été adapté : l'agent y écrit désormais une carte dans un tableau partagé.
2. **Le développement reste simple** : `npm start` applique toujours les migrations et les données de
   démonstration, mais uniquement hors production.
3. **Sans `TRUST_PROXY`**, le serveur démarre quand même en production, mais affiche un avertissement : la
   limitation de débit serait alors commune à tous les visiteurs.
4. **Port SMTP par défaut** : 587 (soumission avec STARTTLS) au lieu de 25.

## Reste à faire

- **Déploiement** (agent InfraLWS) : base, secrets, nginx, certificat, service, premiers comptes, sauvegarde.
- **Service d'envoi des courriels** avec TLS, et enregistrements SPF et DKIM pour `y-factor.fr`.
- **Branchement à claude.ai** : OAuth 2.1 pour le serveur MCP.
- **Limites connues** :
  - un seul processus ;
  - un flux en direct n'est pas recontrôlé quand la session expire ;
  - les jetons d'API n'expirent pas.
