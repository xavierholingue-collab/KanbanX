// P2 : commentaires (Markdown nettoyé, mentions), historique d'activité.
import { agir, journal, roleSur, exigerEcriture } from './services.js';
import { introuvable, interdit } from './erreurs.js';
import { rendreMarkdown, extraireMentions, prenom } from './markdown.js';

async function membresDuTableau(c, boardId) {
  return (await c.query('select u.id, u.name from board_members m join users u on u.id = m.user_id where m.board_id = $1', [boardId])).rows;
}
const prenoms = (membres) => new Set(membres.map((m) => prenom(m.name)));

/** Identifiants des membres du tableau mentionnés (@prénom). Un nom hors du tableau n'est jamais résolu. */
function resoudreMentions(texte, membres) {
  const cites = extraireMentions(texte);
  return membres.filter((m) => cites.has(prenom(m.name))).map((m) => m.id);
}

async function carteVisible(c, cardId) {
  const { rows } = await c.query('select id, board_id, title from cards where id = $1', [cardId]);
  if (!rows[0]) throw introuvable('Carte introuvable');
  return rows[0];
}

const SQL_COMM = `select m.id, m.card_id, m.body, m.mentions, m.created_at, m.edited_at, u.id as uid, u.name, u.kind
  from comments m join users u on u.id = m.author_id`;
const versComm = (r, ps) => ({ id: r.id, cardId: r.card_id, body: r.body, html: rendreMarkdown(r.body, ps), mentions: r.mentions,
  createdAt: r.created_at, editedAt: r.edited_at, author: { id: r.uid, name: r.name, kind: r.kind } });

export async function listerCommentaires(ctx, cardId) {
  return agir(ctx, async (c) => {
    const k = await carteVisible(c, cardId);
    await roleSur(c, k.board_id);
    const ps = prenoms(await membresDuTableau(c, k.board_id));
    const { rows } = await c.query(`${SQL_COMM} where m.card_id = $1 and m.deleted_at is null order by m.created_at, m.id`, [cardId]);
    return rows.map((r) => versComm(r, ps));
  });
}

export async function ajouterCommentaire(ctx, cardId, { body }) {
  return agir(ctx, async (c, emit) => {
    const k = await carteVisible(c, cardId);
    exigerEcriture(await roleSur(c, k.board_id));
    const membres = await membresDuTableau(c, k.board_id);
    const mentions = resoudreMentions(body, membres);
    const { rows } = await c.query('insert into comments (board_id, card_id, author_id, body, mentions) values ($1, $2, $3, $4, $5) returning id',
      [k.board_id, cardId, ctx.user.id, body, mentions]);
    await journal(c, ctx, k.board_id, cardId, 'commentaire.ajoute', { title: k.title, commentId: rows[0].id, mentions });
    emit(k.board_id, { kind: 'comment', id: rows[0].id, cardId });
    return versComm((await c.query(`${SQL_COMM} where m.id = $1`, [rows[0].id])).rows[0], prenoms(membres));
  });
}

async function commentaireDeLAuteur(c, ctx, id) {
  const { rows } = await c.query('select id, board_id, card_id, author_id from comments where id = $1', [id]);
  if (!rows[0]) throw introuvable('Commentaire introuvable');
  exigerEcriture(await roleSur(c, rows[0].board_id));
  if (rows[0].author_id !== ctx.user.id) throw interdit('Seul l\'auteur peut modifier ou supprimer son commentaire.');
  return rows[0];
}

export async function modifierCommentaire(ctx, id, { body }) {
  return agir(ctx, async (c, emit) => {
    const m = await commentaireDeLAuteur(c, ctx, id);
    const membres = await membresDuTableau(c, m.board_id);
    await c.query('update comments set body = $2, mentions = $3, edited_at = now() where id = $1', [id, body, resoudreMentions(body, membres)]);
    await journal(c, ctx, m.board_id, m.card_id, 'commentaire.modifie', { commentId: id });
    emit(m.board_id, { kind: 'comment', id, cardId: m.card_id });
    return versComm((await c.query(`${SQL_COMM} where m.id = $1`, [id])).rows[0], prenoms(membres));
  });
}

export async function supprimerCommentaire(ctx, id, supprimer = true) {
  return agir(ctx, async (c, emit) => {
    const m = await commentaireDeLAuteur(c, ctx, id);
    await c.query('update comments set deleted_at = $2 where id = $1', [id, supprimer ? new Date() : null]);
    await journal(c, ctx, m.board_id, m.card_id, supprimer ? 'commentaire.supprime' : 'commentaire.restaure', { commentId: id });
    emit(m.board_id, { kind: 'comment', id, cardId: m.card_id });
    return { ok: true };
  });
}

const SQL_ACT = `select a.id, a.action, a.data, a.via, a.created_at, a.card_id, u.id as uid, u.name, u.kind, k.title as card_title
  from activity a join users u on u.id = a.actor_id left join cards k on k.id = a.card_id`;
const versAct = (r) => ({ id: Number(r.id), action: r.action, data: r.data, via: r.via, createdAt: r.created_at, cardId: r.card_id,
  cardTitle: r.card_title, actor: { id: r.uid, name: r.name, kind: r.kind } });

export async function activiteCarte(ctx, cardId, limite = 50) {
  return agir(ctx, async (c) => {
    const k = await carteVisible(c, cardId);
    await roleSur(c, k.board_id);
    return (await c.query(`${SQL_ACT} where a.card_id = $1 order by a.id desc limit $2`, [cardId, limite])).rows.map(versAct);
  });
}

export async function activiteTableau(ctx, boardId, limite = 50, avant = null) {
  return agir(ctx, async (c) => {
    await roleSur(c, boardId);
    return (await c.query(`${SQL_ACT} where a.board_id = $1 and ($3::bigint is null or a.id < $3) order by a.id desc limit $2`, [boardId, limite, avant])).rows.map(versAct);
  });
}
