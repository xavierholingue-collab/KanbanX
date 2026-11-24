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
  return nouveaux;
}
