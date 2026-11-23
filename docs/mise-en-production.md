# Mise en production de KanbanX

Fiche destinée à l'agent qui administre le VPS (projet InfraLWS). Elle décrit ce que l'application exige ;
les choix d'outillage du serveur (Docker ou systemd, emplacement des fichiers) restent ceux du VPS.

- **Adresse publique** : `https://kanbanx.y-factor.fr`
- **Pile** : Node.js 26 (LTS), PostgreSQL 18, un proxy inverse HTTPS devant (nginx).
- **Principe de sécurité** : le serveur web ne détient **jamais** les identifiants administrateur de la base. Les
  migrations sont une étape séparée. Le serveur **refuse de démarrer** si sa configuration de production est
  incomplète, contient une valeur de développement, ou s'il est connecté avec un rôle qui échappe aux
  politiques RLS (superutilisateur, BYPASSRLS, propriétaire des tables).

## 1. Base de données (une seule fois)

Dans le cluster PostgreSQL 18 existant, en superutilisateur `postgres` :

```sql
create role kanbanx_proprio login createrole password '<secret-1>';
create database kanbanx owner kanbanx_proprio;
```

- `kanbanx_proprio` possède les tables et applique les migrations. Il crée lui-même le rôle applicatif
  `kanbanx_app` (ni superutilisateur, ni BYPASSRLS) lors de la première migration.
- Connexions en local uniquement (`127.0.0.1`), comme pour Biblio.
- Ajouter la base `kanbanx` à la sauvegarde chiffrée quotidienne du VPS.

## 2. Deux fichiers de secrets, jamais dans le dépôt

**Migrations** (lisible par root uniquement), utilisé seulement pendant un déploiement :

```bash
DATABASE_ADMIN_URL=postgres://kanbanx_proprio:<secret-1>@127.0.0.1:5432/kanbanx
KANBANX_APP_PASSWORD=<secret-2>
```

**Service web** (`0600`, propriétaire root, lu par le service) :

```bash
NODE_ENV=production
HOST=127.0.0.1
PORT=3100                      # libre sur le VPS ; à adapter
TRUST_PROXY=1                  # nginx pose X-Real-IP : limitation de débit par vraie adresse
BASE_URL=https://kanbanx.y-factor.fr
DATABASE_URL=postgres://kanbanx_app:<secret-2>@127.0.0.1:5432/kanbanx
SMTP_URL=smtps://<utilisateur>:<secret-3>@<hôte>:465   # ou smtp://…:587 avec STARTTLS (exigé)
SMTP_FROM=KanbanX <kanbanx@y-factor.fr>
```

À ne **jamais** mettre dans l'environnement du service : `DATABASE_ADMIN_URL`, `KANBANX_APP_PASSWORD`,
`SEED_DEMO=1`, ni un `?tls=non` dans `SMTP_URL`. Aucun fichier `.env` dans le dossier de l'application :
le serveur en chargerait le contenu.

Pour l'envoi des courriels, il faut un service SMTP avec TLS, et des enregistrements SPF et DKIM pour
`y-factor.fr` afin que les liens de connexion ne finissent pas en indésirables.

## 3. Proxy inverse nginx

```nginx
server {
  listen 80;
  server_name kanbanx.y-factor.fr;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name kanbanx.y-factor.fr;
  # Certificat Let's Encrypt (certbot), comme les autres sites du VPS.

  client_max_body_size 11m;    # import d'un export Trello : 10 Mo au plus

  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;             # indispensable : contrôle d'origine (CSRF, MCP)
    proxy_set_header X-Real-IP $remote_addr;
  }

  # Flux en direct (Server-Sent Events) : pas de mise en tampon, connexions longues.
  location ~ ^/api/boards/[^/]+/events$ {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```

L'application pose elle-même ses en-têtes de sécurité, dont HSTS et une CSP stricte : nginx ne doit pas les
dupliquer.

## 4. Déployer une version

1. Récupérer le code de `main` (version étiquetée), puis `npm ci --omit=dev` avec Node.js 26.
2. Sauvegarder la base, puis appliquer les migrations avec le fichier de secrets des migrations :
   `npm run db:migrer`. Les migrations ne vont que vers l'avant ; la sauvegarde est le retour arrière.
3. (Re)démarrer le service web : `node src/server.js`, sous un utilisateur système dédié sans droit de
   connexion. Si systemd est utilisé : `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`,
   `PrivateTmp=true`, `Restart=on-failure`.
4. Vérifier :
   - `curl -sI https://kanbanx.y-factor.fr/api/me` → `401`, avec un en-tête `Strict-Transport-Security` ;
   - le journal du service affiche « KanbanX écoute sur 127.0.0.1:3100 » et aucun « Démarrage refusé ».

## 5. Premiers comptes (une seule fois)

Il n'y a pas d'inscription publique. Avec le fichier de secrets des migrations :

```bash
npm run compte -- <courriel de Xavier> Xavier
npm run compte -- claude@y-factor.fr Claude agent
npm run jeton -- claude@y-factor.fr
```

- Xavier se connecte par lien magique, crée ses tableaux, puis invite Eric et Alexis depuis l'application.
- Le jeton de Claude s'affiche une seule fois. Il se transmet à Xavier par un canal sûr, jamais dans une
  conversation ni dans un fichier du dépôt. Claude est invité dans un tableau avec le rôle « membre » : un
  agent ne peut pas être propriétaire, la base le refuse.
- Serveur MCP : `https://kanbanx.y-factor.fr/mcp`, avec l'en-tête `Authorization: Bearer kbx_…`.
  Utilisable depuis Claude Code. Le branchement à claude.ai demandera OAuth (étape suivante, non faite).

## 6. Limites connues de cette version

- **Un seul processus.** La limitation de débit et le direct sont en mémoire : pas de répartition sur
  plusieurs instances.
- **Flux en direct.** Un flux déjà ouvert n'est pas recontrôlé quand la session expire. Il est coupé quand
  le membre est retiré du tableau.
- **Jetons d'API.** Ils n'expirent pas : la révocation se fait en en recréant un avec `npm run jeton`.
