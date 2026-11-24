// Mentions @prénom : résolution parmi les membres du tableau, et enregistrement des seules mentions nouvelles.
import { extraireMentions, prenom } from './markdown.js';

export async function membresDuTableau(c, boardId) {
  return (await c.query('select u.id, u.name, u.kind from board_members m join users u on u.id = m.user_id where m.board_id = $1', [boardId])).rows;
}

/** Identifiants des membres du tableau mentionnés (@prénom). Un nom hors du tableau n'est jamais résolu. */
export function resoudreMentions(texte, membres) {
  if (!texte) return [];
  const cites = extraireMentions(texte);
  return membres.filter((m) => cites.has(prenom(m.name))).map((m) => m.id);
}

/**
 * « @Claude » : adressée au Claude de chaque membre du tableau, même sans compte nommé Claude.
 * Seule une personne qui écrit elle-même la déclenche : un agent (compte agent ou application qui agit
 * au nom de quelqu'un) qui écrit « @Claude » ne relance pas les autres Claude (pas de boucle entre agents).
 */
export const citeClaude = (texte, ctx) => !!texte && !ctx.application && ctx.user.kind === 'human' && extraireMentions(texte).has('claude');

/**
 * Enregistre les mentions nouvelles d'un champ de carte (titre ou description) : les personnes citées dans
 * `apres` qui ne l'étaient pas dans `avant`. Corriger une faute ne crée donc pas de doublon.
 * Renvoie les identifiants des personnes nouvellement mentionnées.
 */
export async function noterMentionsCarte(c, ctx, { boardId, cardId, champ, avant = '', apres, membres }) {
  const deja = new Set(resoudreMentions(avant, membres));
  const nouveaux = resoudreMentions(apres, membres).filter((u) => !deja.has(u));
  for (const u of nouveaux) {
    await c.query('insert into card_mentions (board_id, card_id, field, user_id, author_id, client_name) values ($1, $2, $3, $4, $5, $6)',
      [boardId, cardId, champ, u, ctx.user.id, ctx.application ?? null]);
  }
  if (citeClaude(apres, ctx) && !extraireMentions(avant).has('claude')) {
    await c.query('insert into card_mentions (board_id, card_id, field, user_id, author_id) values ($1, $2, $3, null, $4)', [boardId, cardId, champ, ctx.user.id]);
  }
  return nouveaux;
}
