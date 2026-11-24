// P2 : commentaires (Markdown nettoyé, mentions), historique d'activité.
import { agir, journal, roleSur, exigerEcriture } from './services.js';
import { introuvable, interdit } from './erreurs.js';
import { rendreMarkdown, prenom } from './markdown.js';
import { membresDuTableau, resoudreMentions, citeClaude } from './mentions.js';
import { mettreEnFile } from './notifications.js';

// « @Claude » est toujours une mention (point 3) : elle est mise en évidence comme celles des membres.
const prenoms = (membres) => new Set(['claude', ...membres.map((m) => prenom(m.name))]);

async function carteVisible(c, cardId) {
  const { rows } = await c.query('select id, board_id, title from cards where id = $1', [cardId]);
  if (!rows[0]) throw introuvable('Carte introuvable');
  return rows[0];
}

const SQL_COMM = `select m.id, m.card_id, m.body, m.mentions, m.created_at, m.edited_at, m.client_name, u.id as uid, u.name, u.kind
  from comments m join users u on u.id = m.author_id`;
// client : application OAuth qui a écrit au nom de l'auteur (« Claude pour Eric »), sinon null.
const versComm = (r, ps) => ({ id: r.id, cardId: r.card_id, body: r.body, html: rendreMarkdown(r.body, ps), mentions: r.mentions,
  createdAt: r.created_at, editedAt: r.edited_at, author: { id: r.uid, name: r.name, kind: r.kind }, client: r.client_name });

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
    const { rows } = await c.query(`insert into comments (board_id, card_id, author_id, body, mentions, client_name, mentions_claude)
      values ($1, $2, $3, $4, $5, $6, $7) returning id`, [k.board_id, cardId, ctx.user.id, body, mentions, ctx.application ?? null, citeClaude(body, ctx)]);
    await mettreEnFile(c, ctx, { boardId: k.board_id, cardId, lieu: 'commentaire', texte: body, destinataires: mentions, membres });
    await journal(c, ctx, k.board_id, cardId, 'commentaire.ajoute', { title: k.title, commentId: rows[0].id, mentions });
    emit(k.board_id, { kind: 'comment', id: rows[0].id, cardId });
    return versComm((await c.query(`${SQL_COMM} where m.id = $1`, [rows[0].id])).rows[0], prenoms(membres));
  });
}

/** Carte en entier, pour un agent : tableau, colonne, champs, responsables, étiquettes et fil de commentaires (sans HTML). */
export async function carteComplete(ctx, cardId) {
  return agir(ctx, async (c) => {
    const k = await carteVisible(c, cardId);
    await roleSur(c, k.board_id);
    const r = (await c.query(`select c.id, c.title, c.description, to_char(c.due_date, 'YYYY-MM-DD') as due_date, c.archived_at,
        b.id as board_id, b.name as board_name, k.id as column_id, k.name as column_name, k.archived_at as column_archived_at
      from cards c join boards b on b.id = c.board_id join columns k on k.id = c.column_id where c.id = $1`, [cardId])).rows[0];
    const responsables = (await c.query(`select u.id, u.name from card_assignees a join users u on u.id = a.user_id
      where a.card_id = $1 order by lower(u.name)`, [cardId])).rows;
    const etiquettes = (await c.query(`select l.id, l.name, l.color from card_labels x join labels l on l.id = x.label_id
      where x.card_id = $1 order by l.created_at`, [cardId])).rows;
    const commentaires = (await c.query(`${SQL_COMM} where m.card_id = $1 and m.deleted_at is null order by m.created_at, m.id`, [cardId])).rows;
    return {
      id: r.id, title: r.title, description: r.description, dueDate: r.due_date, archived: !!r.archived_at,
      board: { id: r.board_id, name: r.board_name }, column: { id: r.column_id, name: r.column_name, archived: !!r.column_archived_at },
      assignees: responsables, labels: etiquettes,
      comments: commentaires.map((m) => ({ id: m.id, body: m.body, createdAt: m.created_at, editedAt: m.edited_at,
        author: { id: m.uid, name: m.name, kind: m.kind }, client: m.client_name })),
    };
  });
}

async function commentaireDeLAuteur(c, ctx, id) {
  const { rows } = await c.query('select id, board_id, card_id, author_id, mentions from comments where id = $1', [id]);
  if (!rows[0]) throw introuvable('Commentaire introuvable');
  exigerEcriture(await roleSur(c, rows[0].board_id));
  if (rows[0].author_id !== ctx.user.id) throw interdit('Seul l\'auteur peut modifier ou supprimer son commentaire.');
  return rows[0];
}

export async function modifierCommentaire(ctx, id, { body }) {
  return agir(ctx, async (c, emit) => {
    const m = await commentaireDeLAuteur(c, ctx, id);
    const membres = await membresDuTableau(c, m.board_id);
    const mentions = resoudreMentions(body, membres);
    await c.query('update comments set body = $2, mentions = $3, mentions_claude = $4, edited_at = now() where id = $1',
      [id, body, mentions, citeClaude(body, ctx)]);
    // Seules les personnes nouvellement citées sont prévenues.
    const deja = new Set(m.mentions);
    await mettreEnFile(c, ctx, { boardId: m.board_id, cardId: m.card_id, lieu: 'commentaire', texte: body, destinataires: mentions.filter((u) => !deja.has(u)), membres });
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

const SQL_ACT = `select a.id, a.action, a.data, a.via, a.client_name, a.created_at, a.card_id, u.id as uid, u.name, u.kind, k.title as card_title
  from activity a join users u on u.id = a.actor_id left join cards k on k.id = a.card_id`;
const versAct = (r) => ({ id: Number(r.id), action: r.action, data: r.data, via: r.via, client: r.client_name, createdAt: r.created_at, cardId: r.card_id,
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

const SQL_FIL = `select m.id, m.body, m.mentions, m.created_at, m.card_id, k.title as card_title, b.id as board_id, b.name as board_name,
    m.client_name, u.id as uid, u.name, u.kind
  from comments m join users u on u.id = m.author_id join cards k on k.id = m.card_id join boards b on b.id = m.board_id`;
// where : endroit de la mention (commentaire, titre ou description de la carte).
const versFil = (r) => ({ id: r.id, where: r.lieu ?? 'commentaire', body: r.body, createdAt: r.created_at, author: { id: r.uid, name: r.name, kind: r.kind },
  client: r.client_name, card: { id: r.card_id, title: r.card_title }, board: { id: r.board_id, name: r.board_name } });

/**
 * Mentions de l'utilisateur dans les tableaux auxquels il a accès (RLS), du plus récent au plus ancien :
 * commentaires (comments.mentions), titres et descriptions de cartes (card_mentions, texte d'aujourd'hui).
 * Pour une application qui agit au nom de la personne (« Claude pour Xavier »), s'y ajoutent les « @Claude »
 * de ses tableaux. `for` dit à qui la mention s'adresse : 'claude', ou absent (la personne elle-même).
 */
export async function mentionsDe(ctx, limite = 20) {
  const pourClaude = !!ctx.application;
  return agir(ctx, async (c) => (await c.query(
    `select * from (
       select 'commentaire' as lieu, case when $3 and m.mentions_claude then 'claude' end as pour, m.id, m.body, m.created_at, m.card_id, k.title as card_title, b.id as board_id, b.name as board_name,
         m.client_name, u.id as uid, u.name, u.kind
       from comments m join users u on u.id = m.author_id join cards k on k.id = m.card_id join boards b on b.id = m.board_id
       where (($1 = any(m.mentions)) or ($3 and m.mentions_claude)) and m.deleted_at is null and k.archived_at is null and b.archived_at is null
       union all
       select x.field, case when x.user_id is null then 'claude' end, x.id, case x.field when 'titre' then k.title else k.description end, x.created_at,
         x.card_id, k.title, b.id, b.name, x.client_name, u.id, u.name, u.kind
       from card_mentions x join users u on u.id = x.author_id join cards k on k.id = x.card_id join boards b on b.id = x.board_id
       where (x.user_id = $1 or ($3 and x.user_id is null)) and k.archived_at is null and b.archived_at is null
     ) t order by created_at desc, id limit $2`,
    [ctx.user.id, limite, pourClaude])).rows.map((r) => ({ ...versFil(r), ...(r.pour ? { for: r.pour } : {}) })));
}

/** Commentaires récents (tous les tableaux accessibles, ou un seul). */
export async function commentairesRecents(ctx, { boardId = null, limite = 20 } = {}) {
  return agir(ctx, async (c) => {
    if (boardId) await roleSur(c, boardId);
    return (await c.query(
      `${SQL_FIL} where m.deleted_at is null and k.archived_at is null and b.archived_at is null and ($1::uuid is null or m.board_id = $1)
       order by m.created_at desc limit $2`, [boardId, limite])).rows.map(versFil);
  });
}
