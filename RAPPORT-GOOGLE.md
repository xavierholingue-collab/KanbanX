# Rapport — « Continuer avec Google »

Session de jour du 25/11, à la demande de Xavier. Branche `connexion-google`, partie de `main` (07689d4).
Carte KanbanX : « [Connexion] Continuer avec Google » (tableau KanbanX, colonne En cours).

**Aucun secret trouvé ni ajouté.** Les identifiants Google des tests sont fictifs (`123456789012-fictif…`,
`GOCSPX-fictif-pour-les-tests-uniquement`). Aucun appel au vrai Google : tous les tests passent par un faux
Google local.

## Ce que fait la fonction

- Sur l'écran de connexion, un bouton « Continuer avec Google » au-dessus du lien par courriel, séparé par
  « ou ». Le lien par courriel reste toujours possible.
- **Invités seulement** (règle de Xavier) : Google n'ouvre qu'un compte KanbanX qui existe déjà. Pour une adresse
  inconnue, la connexion est refusée et aucun compte n'est créé.
- **Limités à leurs tableaux** (règle de Xavier) : une fois connectée, la personne a exactement les droits de
  ses invitations ; la base l'impose (RLS). Un test le vérifie en passant par Google.
- Le compte Google est reconnu par son identifiant (`sub`), jamais par son adresse, qui peut changer.
- La première liaison par l'adresse n'a lieu que si Google fait autorité sur elle : adresse `@gmail.com`, ou
  compte Google Workspace (revendication `hd`), adresse vérifiée. Sinon, la personne se connecte une fois par
  courriel, puis « Lier mon compte Google » dans « Mon compte ». On peut aussi délier.
- Après la connexion, retour là où la personne allait (tableau, carte, ou accord OAuth d'un connecteur Claude).
- Chaque refus a un message clair. L'adresse de la page ne porte qu'un code de résultat (`?google=inconnu`…),
  retiré aussitôt : jamais d'adresse courriel ni de texte libre.

## Sécurité, état de l'art

Références : OpenID Connect Core 1.0 (§ 3.1) ; RFC 9700 (bonnes pratiques de sécurité OAuth 2.0, janvier
2025) ; RFC 7636 (PKCE) ; RFC 6749 § 2.3.1 ; documentation Google « OpenID Connect » et « Verify the Google ID
token ».

- Flux du code d'autorisation mené par le serveur (client confidentiel), **PKCE S256**, `state` et `nonce`
  aléatoires (256 bits), `prompt=select_account`.
- **`state` lié au navigateur** par un cookie `__Host-kx-google` (HttpOnly, Secure, SameSite=Lax, 10 minutes) :
  un code et un `state` volés ne connectent personne dans un autre navigateur (pas de connexion forcée).
- Demande **à usage unique**, stockée hachée en base, 10 minutes au plus ; au-delà de 10 000 demandes en cours,
  refus (protection contre l'inondation). Limitation de débit au départ et au retour.
- Échange du code avec **`client_secret_basic`**, sans suivi de redirection, 10 secondes et 64 Ko au plus.
- **Jeton d'identité** : émetteur, audience, `azp`, `nonce` (comparaison à temps constant), expiration, date
  d'émission, `sub`, adresse. Sa signature n'est pas vérifiée : il arrive directement du point de jeton de
  Google, en HTTPS et contre le secret du client, ce que permet OpenID Connect Core (§ 3.1.3.7, point 6) et que
  Google indique aussi. Avantage : aucun accès sortant vers les clés publiques de Google.
- **Portées minimales** : `openid email` (pas `profile` : le prénom vient de l'invitation).
- Liaison depuis « Mon compte » : session web et jeton CSRF exigés ; au retour, la session doit être celle de
  la personne qui a commencé, sinon refus.
- Tables réservées au propriétaire, RLS activé sans politique, accès seulement par fonctions `SECURITY DEFINER`.
- Migration `011_google.sql` **purement additive** : l'ancien code tourne sur le nouveau schéma.

## Choix non tranchés par la demande (option la plus simple et la plus sûre)

1. **Pas de création de compte par Google**, même pour une adresse Gmail : c'est la règle « invités seulement ».
2. **Un seul compte Google par compte KanbanX.** Pour en changer : délier, puis lier l'autre.
3. **Correspondance exacte des adresses.** Gmail ignore les points (`prenom.nom` = `prenomnom`), pas KanbanX :
   l'invitation doit utiliser l'adresse telle que Google la donne. Sinon, la personne lie son compte depuis
   « Mon compte » après une connexion par courriel.
4. **Bouton sans le logo « G » de Google.** Je ne reproduis pas le logo d'un tiers. Les règles de marque de
   Google demandent leur logo officiel sur ce bouton : il faudra l'ajouter à partir du fichier fourni par Google
   (kit « Sign in with Google »), à télécharger par Xavier. Le bouton fonctionne sans.
5. **Même durée de session** qu'avec le lien par courriel (30 jours).

## Tests

- `test/google.test.js` : **18 tests**, écrits d'abord et **vus en rouge** (18 échecs sur une ébauche vide), puis
  verts.
- `e2e/google.test.js` : **5 parcours navigateur** (ordinateur clair, téléphone sombre, audit axe WCAG 2.2 AA),
  **vus en rouge** sans les écrans, puis verts. Lancés 6 fois : un passage (avec captures) a rendu le code 1
  sans aucun test en échec, sans trace exploitable ; les 5 autres, et la suite complète, ont rendu 0. À
  surveiller en CI.
- **18 mutations** des garde-fous (cookie de `state`, `nonce`, audience, `azp`, émetteur, expiration, autorité
  de Google, vérification de l'adresse, session de la liaison, HttpOnly, portées, et en SQL : autorité, agents,
  comptes désactivés, usage unique, expiration, vol de liaison, création de compte) : **toutes attrapées**.
- Suite complète (`npm test`) : **202 tests et 38 parcours navigateur, code de sortie 0**.
- Captures : `docs/captures/google-01-connexion-ordinateur.png`, `google-01-connexion-telephone-sombre.png`,
  `google-02-refus-telephone.png`, `google-03-compte-lie-ordinateur.png`.

Note locale : le Chromium de la sandbox (1243) est plus ancien que celui attendu par Playwright 1.65.1 (1255) ;
les parcours ont tourné en pointant Playwright sur le Chromium installé. La CI utilise sa propre installation.

## Ce qui reste à faire hors du code

- **Xavier** : créer le client Google (« Application Web », retour `https://kanbanx.y-factor.fr/auth/google/retour`),
  publier l'appli, et placer l'identifiant et le secret dans l'environnement du serveur selon la procédure
  d'InfraLWS, sans les écrire dans un échange.
- **InfraLWS** : variables `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` ; accès sortant HTTPS vers
  `oauth2.googleapis.com` ; migration `011` puis redémarrage (`docs/mise-en-production.md`, § 5 quater).
- **Premier essai réel** après la mise en ligne : seul un vrai client Google le permet.
