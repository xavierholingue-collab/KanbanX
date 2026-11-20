# Règles pour les agents qui travaillent sur KanbanX

Lis ce fichier en entier avant toute action, puis `docs/cahier-des-charges.md`.

## Méthode

- Avance par priorité (P1, puis P2, puis P3, puis P4). Termine et teste une
  priorité avant de passer à la suivante.
- La qualité prime sur la quantité : un P1 impeccable, au niveau d'ergonomie
  exigé par le cahier des charges, vaut mieux que P1 à P3 bâclés.
- Pour chaque règle de sécurité ou de droits, écris d'abord le test, vérifie
  qu'il échoue (voir le rouge), puis écris le code qui le fait passer.
- Un résultat de test se lit à son code de sortie, pas au texte affiché.
- Si un choix n'est pas tranché par le cahier des charges, prends l'option la
  plus simple et la plus sûre, et note-la dans le rapport.

## Règles strictes

- Travaille sur la branche indiquée dans ta consigne. Ne pousse jamais sur
  `main`.
- Fais des commits petits, avec des messages clairs en français.
- Données fictives uniquement. N'utilise aucune adresse électronique réelle.
- Ne tente jamais de joindre lisia.y-factor.fr, biblio.xavier-holingue.eu ni
  195.110.35.206.
- Si la sandbox bloque un site dont tu as besoin, ne contourne pas le blocage :
  note-le dans le rapport.
- Ne mets aucun secret dans le dépôt. Si tu en trouves un, ne l'utilise pas et
  signale-le en tête du rapport.
- Ne crée ni ne modifie de fichier dans `.github/`.

## Fin de travail

- `npm test` doit être vert. Un test qui échoue pour une raison que tu ne sais
  pas corriger est signalé dans le rapport, jamais supprimé ni désactivé en
  silence.
- Écris `RAPPORT-NUIT-<n>.md` à la racine, en français.
- Pousse ta branche, puis arrête-toi. Ne commence pas d'autre chantier.
