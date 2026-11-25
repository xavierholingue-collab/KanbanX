# KanbanX

Un kanban d'équipe pensé pour les discussions autour des cartes, où Claude
participe comme un membre à part entière.

- Ce qu'on construit : [docs/cahier-des-charges.md](docs/cahier-des-charges.md)
- Règles pour les agents : [CLAUDE.md](CLAUDE.md)
- Bilan de la première nuit : [RAPPORT-NUIT-1.md](RAPPORT-NUIT-1.md)
- Bilan de la deuxième nuit : [RAPPORT-NUIT-2.md](RAPPORT-NUIT-2.md)
- Durcissement avant mise en production : [RAPPORT-DURCISSEMENT.md](RAPPORT-DURCISSEMENT.md)
- Ce que la production exige (variables, commandes, route de santé, OAuth) : [docs/mise-en-production.md](docs/mise-en-production.md)
- Brancher Claude depuis claude.ai (OAuth 2.1) : [RAPPORT-OAUTH.md](RAPPORT-OAUTH.md)

## Démarrer en local

Prérequis : Node.js 22 ou plus récent, Docker.

```bash
cp .env.exemple .env     # valeurs de développement, fictives
npm install
docker compose up -d     # PostgreSQL 18
npm start                # migrations + données de démonstration, puis http://localhost:3000
```

Au premier démarrage, des comptes fictifs sont créés (`xavier@kanbanx.invalid`,
`eric@…`, `alexis@…`, et le compte agent `claude@…`) avec un tableau d'exemple.
Le jeton d'API de Claude s'affiche une seule fois dans la console.

**Se connecter** : saisir une adresse sur `/connexion`. En développement, le
lien magique s'affiche dans la console du serveur au lieu d'être envoyé.
« Continuer avec Google » apparaît si `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` sont fournis
(client Google « Application Web », retour `BASE_URL/auth/google/retour`) ; il n'ouvre que des
comptes déjà invités.

Le serveur écoute sur `127.0.0.1` (variable `HOST` pour changer). En développement, il applique
les migrations et crée les données de démonstration au démarrage. En production, il ne fait ni l'un
ni l'autre, et refuse de démarrer si sa configuration est dangereuse.

Créer un compte sans passer par une invitation (par exemple le premier propriétaire) :
`npm run compte -- <courriel> <prénom> [--agent]` (sans effet si le compte existe déjà).

## Tests

```bash
npm test
```

Une seule commande : elle lance un PostgreSQL 18 jetable (conteneur Docker en
mémoire), applique les migrations, exécute les tests (`node:test`) puis les
parcours dans un vrai navigateur (Playwright, Chromium). Variables utiles :
`SANS_NAVIGATEUR=1` (sans Playwright), `SEULEMENT=test` ou `SEULEMENT=e2e`,
`FICHIERS=test/a.test.js,e2e/b.test.js` (seulement ces fichiers).
Première installation de Chromium : `npx playwright install --with-deps chromium`.

## API REST et serveur MCP

- Documentation lisible : `/api/docs` ; document OpenAPI 3.1 : `/api/openapi.json`.
- Authentification des agents : `Authorization: Bearer kbx_…`.
  Créer ou remplacer un jeton : `npm run jeton -- claude@kanbanx.invalid`.
- Serveur MCP (transport Streamable HTTP) : `POST /mcp`, même jeton.

Brancher Claude Code en local :

```bash
claude mcp add --transport http kanbanx http://localhost:3000/mcp \
  --header "Authorization: Bearer kbx_…"
```

Outils exposés : `lister_tableaux`, `lire_tableau`, `lire_carte`, `creer_carte`,
`modifier_carte`, `deplacer_carte`, `ajouter_commentaire`, `creer_colonne`,
`renommer_colonne`, `deplacer_colonne`, `lire_commentaires_recents`,
`lire_mentions` (avec « @Claude », adressée au Claude de chaque membre). Chaque action est signée
« Claude » (via MCP) dans l'historique.

## Organisation du code

| Dossier | Contenu |
| --- | --- |
| `src/` | serveur HTTP sans framework, services métier, authentification, MCP |
| `migrations/` | schéma SQL et politiques RLS |
| `public/` | interface (HTML, CSS, JavaScript en modules, sans compilation) ; `css/jetons.css` est l'unique fichier de jetons de design |
| `scripts/` | migrations, données de démonstration, jetons, lanceur de tests |
| `test/` | tests unitaires et d'intégration (API, RLS, sécurité, MCP) |
| `e2e/` | parcours Playwright et audit d'accessibilité (axe-core) |
