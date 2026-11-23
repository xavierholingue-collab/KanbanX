# Rapport : OAuth 2.1 du serveur MCP (brancher Claude depuis claude.ai)

Date : 23/11/2026. Travail fait par Claude, en séance avec Xavier, sur la branche `oauth`.

**Secrets** : aucun secret trouvé dans le dépôt, aucun ajouté.
**Contrat** : réponse d'InfraLWS du 23/11, § 5, vérifiée contre la documentation actuelle de Claude sur les
connecteurs et contre la dernière révision de la spécification d'autorisation MCP (2026-07-28).

## Une ligne par point du § 5

| Point | État | Ce qui est fait |
| --- | --- | --- |
| Découverte | Fait | `401` sur `/mcp` avec `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource", scope="kanbanx"`. Métadonnées RFC 9728 sous les deux chemins demandés, RFC 8414 sous `/.well-known/oauth-authorization-server` |
| Enregistrement dynamique | Fait | Clients publics seulement (`token_endpoint_auth_method: none`). Adresses de retour en liste fermée : les deux de Claude, et la boucle locale `http://localhost` ou `http://127.0.0.1` pour Claude Code. 30 enregistrements par heure et par adresse, 1 000 clients au plus, purge des clients jamais utilisés au bout de 24 heures |
| Autorisation | Fait | PKCE `S256` obligatoire, `plain` refusé, `state` rendu tel quel, `resource` refusé s'il désigne autre chose que `/mcp`. En plus : `iss` dans la réponse (RFC 9207), que la spécification MCP recommande désormais |
| Consentement | Fait | Session KanbanX exigée (lien magique), nom du client et hôte de retour affichés, bouton protégé contre le CSRF, jamais d'accord implicite. La décision part par `fetch`, puis le navigateur est dirigé par script : la directive `form-action` de la CSP n'entre pas en jeu |
| Jetons | Fait | Code à usage unique de 60 secondes, jeton d'accès d'une heure, jeton de rafraîchissement renouvelé à chaque usage ; un rafraîchissement rejoué révoque toute la lignée. Tout est stocké haché (SHA-256) |
| Au nom de qui ? | Fait | Le jeton agit au nom de la personne qui a donné son accord, avec ses droits (RLS). Historique et fil de commentaires affichent « Claude pour Eric » (avec « via MCP »). Le compte agent et son jeton `kbx_…` restent pour Claude Code |
| Révocation | Fait | Page « Applications connectées » (icône robot de l'en-tête). Un accès retiré est refusé à la requête suivante |
| Pas de CIMD | Fait | Le serveur n'annonce pas `client_id_metadata_document_supported` : Claude se rabat sur l'enregistrement dynamique |
| Instructions MCP | Fait | La phrase sur les notifications était déjà corrigée (PR #2). Les instructions disent en plus au nom de qui Claude agit |
| Tests demandés | Fait | Parcours complet avec PKCE ; mauvais vérificateur ; adresse de retour hors liste ; code rejoué ; rafraîchissement rejoué ; ressource différente ; un jeton d'Eric ne lit pas un tableau réservé à Alexis ; jeton révoqué refusé aussitôt |

Rien n'est contesté.

## Tests

- **21 tests serveur** (`test/oauth.test.js`) et **4 parcours navigateur** (`e2e/oauth.test.js`, audit
  d'accessibilité axe compris). Les 19 premiers tests serveur ont été écrits avant le code : 19 échecs constatés.
- **Suite complète** : 127 tests `node:test` et 24 parcours navigateur verts, sous Node.js 22.23.5 et 26.13.1,
  avec PostgreSQL 18.7 et Chrome 153.
- **Mutations** : 14 règles cassées une à une, chacune fait échouer un test. Vérificateur PKCE ignoré, code
  rejouable, code sans expiration, rafraîchissement rejoué sans révocation, audience non vérifiée, révocation
  ignorée, retrait de l'accès d'un autre, compte désactivé accepté, adresse de retour libre, enregistrement
  sans liste fermée, PKCE `plain` accepté, ressource quelconque à l'échange, code créé par un agent.
  La garde « seule une personne consent » côté application survit seule à la mutation, parce que deux autres
  verrous la doublent : un agent n'a jamais de session web, et la base refuse (testé directement).

## Choix faits, et pourquoi

1. **Une seule portée, `kanbanx`** : lire et écrire avec les droits de la personne. Le serveur d'autorisation
   annonce aussi `offline_access`, que Claude ajoute pour obtenir un jeton de rafraîchissement.
2. **Rafraîchissement valable 30 jours**, renouvelé à chaque usage. Un accès inutilisé pendant 30 jours meurt
   et disparaît de la page « Applications connectées ».
3. **Code rejoué : l'accès qu'il avait délivré est révoqué**, comme le recommande OAuth 2.1.
4. **Rafraîchissement présenté par un autre client : la lignée est révoquée** (vol présumé).
5. **Boucle locale : port libre, chemin exact** (RFC 8252), sans paramètres, fragment ni identifiants, en
   forme canonique.
6. **Le nom de l'application vient d'elle-même.** L'écran dit « une application qui se présente sous le nom
   … » ; le nom est nettoyé (caractères de contrôle et d'inversion de sens retirés, 60 caractères au plus).
   La vraie garantie est ailleurs : le code ne peut repartir que vers Claude ou vers la machine de la personne.
7. **Retour après connexion par `localStorage`**, 15 minutes, adresses internes connues seulement : le lien du
   courriel s'ouvre souvent dans un autre onglet. L'onglet resté sur la connexion la constate en reprenant
   la main.
8. **Focus initial sur le titre de l'écran de consentement**, jamais sur « Autoriser » : une touche Entrée ne
   doit pas accorder un accès par mégarde.
9. **Sur téléphone, les boutons de l'en-tête n'affichent que leur icône**, pour faire de la place à celle des
   applications connectées.

## Points d'attention

- **La dernière spécification MCP (2026-07-28) déprécie l'enregistrement dynamique** au profit des documents
  de métadonnées de client. Claude se rabat sur l'enregistrement dynamique quand le serveur n'annonce pas ces
  documents : le choix d'InfraLWS (pas de requête sortante, pas de SSRF) reste tenable. À revoir si Claude
  abandonne ce repli.
- **Rafraîchissement concurrent.** Claude rafraîchit avant l'expiration et aussi sur un `401`. Si les deux
  tombent en même temps, le second compte comme un rejeu et révoque la lignée : il faudra reconnecter. C'est
  le prix de la règle du contrat ; le risque est faible.
- **Pas vérifiable ici** : la connexion réelle depuis claude.ai, qui demande l'adresse publique. Après la mise
  en ligne : ajouter dans Claude un connecteur personnalisé `https://kanbanx.y-factor.fr/mcp`, se connecter,
  vérifier « Claude pour … » dans l'historique, puis retirer l'accès depuis « Applications connectées ».
