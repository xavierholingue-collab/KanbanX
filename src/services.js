// Logique métier. Chaque fonction reçoit un contexte { user: {id, name, kind}, via, clientId, application } et s'exécute dans une
// transaction « comme » l'utilisateur : le code vérifie les droits ET la base les applique (RLS).
import { transaction } from './db.js';
import { ErreurHttp, introuvable, interdit, invalide } from './erreurs.js';
import { publier, expulser } from './evenements.js';
import { rendreMarkdown, prenom } from './markdown.js';
import { membresDuTableau, noterMentionsCarte } from './mentions.js';
import { lireLiaison } from './google.js';

const PAS = 1024;

export async function agir(ctx, fn) {
  const evenements = [];
  const r = await transaction(ctx.user.id, (c) => fn(c, (boardId, e) => evenements.push([boardId, { ...e, par: ctx.user.id, client: ctx.clientId ?? null }])));
  for (const [b, e] of evenements) publier(b, e);
  return r;
}

export async function journal(c, ctx, boardId, cardId, action, data = {}) {
  // client_name : application OAuth qui agit au nom de l'acteur (« Claude pour Eric »), sinon vide.
  await c.query('insert into activity (board_id, card_id, actor_id, via, action, data, client_name) values ($1, $2, $3, $4, $5, $6, $7)',
    [boardId, cardId, ctx.user.id, ctx.via ?? 'web', action, data, ctx.application ?? null]);
}

/** Rôle de l'utilisateur sur un tableau ; 404 s'il n'y a pas accès (on ne révèle pas l'existence du tableau). */
export async function roleSur(c, boardId) {
  const { rows } = await c.query('select kx_role($1) as role', [boardId]);
  if (!rows[0].role) throw introuvable('Tableau introuvable');
  return rows[0].role;
}
export const exigerEcriture = (role) => { if (role === 'reader') throw interdit('Lecture seule : vous ne pouvez pas modifier ce tableau.'); };
export const exigerProprietaire = (role) => { if (role !== 'owner') throw interdit('Réservé au propriétaire du tableau.'); };

/** Écriture dans un tableau : membre écrivain, et tableau non archivé. */
export async function roleEcriture(c, boardId) {
  const r = await roleSur(c, boardId);
  exigerEcriture(r);
  const { rows } = await c.query('select archived_at from boards where id = $1', [boardId]);
  if (rows[0]?.archived_at) throw invalide('Ce tableau est archivé : son propriétaire peut le restaurer depuis l\'accueil.');
  return r;
}

export function calculerPosition(positions, index) {
  const n = positions.length;
  const i = Math.max(0, Math.min(index, n));
  if (!n) return PAS;
  if (i === 0) return positions[0] - PAS;
  if (i === n) return positions[n - 1] + PAS;
  return (positions[i - 1] + positions[i]) / 2;
}

async function positionColonne(c, boardId, index, sauf) {
  const { rows } = await c.query('select position from columns where board_id = $1 and archived_at is null and id <> $2 order by position', [boardId, sauf ?? '00000000-0000-4000-8000-000000000000']);
  return calculerPosition(rows.map((r) => r.position), index);
}

async function positionCarte(c, colonneId, index, sauf) {
  const lire = async () => (await c.query('select id, position from cards where column_id = $1 and archived_at is null and id <> $2 order by position', [colonneId, sauf ?? '00000000-0000-4000-8000-000000000000'])).rows;
  let rows = await lire();
  const i = Math.max(0, Math.min(index, rows.length));
  if (i > 0 && i < rows.length && rows[i].position - rows[i - 1].position < 1e-6) {
    // Les positions se sont trop rapprochées : on renumérote la colonne.
    await c.query(`update cards set position = t.n * ${PAS} from (select id, row_number() over (order by position) as n from cards where column_id = $1 and archived_at is null) t where cards.id = t.id`, [colonneId]);
    rows = await lire();
  }
  return calculerPosition(rows.map((r) => r.position), index);
}

// ---------- Préférences de la personne ----------

export async function lirePreferences(ctx) {
  return agir(ctx, async (c) => {
    const { rows } = await c.query('select mention_emails, email from users where id = kx_uid()');
    return { email: rows[0]?.email, mentionEmails: rows[0]?.mention_emails ?? false, google: await lireLiaison(c) };
  });
}

export async function changerPreferences(ctx, { mentionEmails }) {
  return agir(ctx, async (c) => {
    await c.query('update users set mention_emails = $1 where id = kx_uid()', [mentionEmails]);
    const { rows } = await c.query('select mention_emails from users where id = kx_uid()');
    return { mentionEmails: rows[0].mention_emails };
  });
}

// ---------- Tableaux ----------

export async function listerTableaux(ctx) {
  return agir(ctx, async (c) => (await c.query(
    `select b.id, b.name, m.role from boards b join board_members m on m.board_id = b.id and m.user_id = kx_uid()
     where b.archived_at is null order by lower(b.name)`)).rows);
}

export async function creerTableau(ctx, { name }) {
  return agir(ctx, async (c) => {
    const { rows } = await c.query('select kx_creer_tableau($1) as id', [name]);
    const id = rows[0].id;
    for (const [i, n] of ['À faire', 'En cours', 'Fait'].entries()) {
      await c.query('insert into columns (board_id, name, position) values ($1, $2, $3)', [id, n, (i + 1) * PAS]);
    }
    await journal(c, ctx, id, null, 'tableau.cree', { name });
    return lireTableau(c, id);
  });
}

const SQL_CARTES = `select c.id, c.column_id, c.title, c.position, to_char(c.due_date, 'YYYY-MM-DD') as due_date,
    c.description <> '' as has_description,
    coalesce((select array_agg(a.user_id) from card_assignees a where a.card_id = c.id), '{}') as assignees,
    coalesce((select array_agg(l.label_id) from card_labels l where l.card_id = c.id), '{}') as labels,
    (select count(*)::int from comments m where m.card_id = c.id and m.deleted_at is null) as comment_count
  from cards c join columns k on k.id = c.column_id`;

const versCarte = (r) => ({ id: r.id, columnId: r.column_id, title: r.title, position: r.position, dueDate: r.due_date,
  hasDescription: r.has_description, assignees: r.assignees, labels: r.labels, commentCount: r.comment_count });

async function lireTableau(c, id) {
  const role = await roleSur(c, id);
  const b = (await c.query('select id, name from boards where id = $1 and archived_at is null', [id])).rows[0];
  if (!b) throw introuvable('Tableau introuvable');
  const membres = (await c.query(
    `select u.id, u.name, u.kind, m.role from board_members m join users u on u.id = m.user_id where m.board_id = $1
     order by case m.role when 'owner' then 0 when 'member' then 1 else 2 end, lower(u.name)`, [id])).rows;
  const colonnes = (await c.query('select id, name, position, wip_limit from columns where board_id = $1 and archived_at is null order by position', [id])).rows;
  const cartes = (await c.query(`${SQL_CARTES} where c.board_id = $1 and c.archived_at is null and k.archived_at is null order by c.position`, [id])).rows.map(versCarte);
  const etiquettes = (await c.query('select id, name, color from labels where board_id = $1 order by created_at', [id])).rows;
  return {
    id: b.id, name: b.name, role, members: membres, labels: etiquettes,
    columns: colonnes.map((k) => ({ id: k.id, name: k.name, position: k.position, wipLimit: k.wip_limit, cards: cartes.filter((x) => x.columnId === k.id) })),
  };
}

export const obtenirTableau = (ctx, id) => agir(ctx, (c) => lireTableau(c, id));

export async function renommerTableau(ctx, id, { name }) {
  return agir(ctx, async (c, emit) => {
    exigerProprietaire(await roleSur(c, id));
    await c.query('update boards set name = $2 where id = $1', [id, name]);
    await journal(c, ctx, id, null, 'tableau.renomme', { name });
    emit(id, { kind: 'board', id });
    return lireTableau(c, id);
  });
}

export async function listerTableauxArchives(ctx) {
  return agir(ctx, async (c) => (await c.query(
    `select b.id, b.name, m.role, b.archived_at as "archivedAt" from boards b join board_members m on m.board_id = b.id and m.user_id = kx_uid()
     where b.archived_at is not null order by b.archived_at desc`)).rows);
}

export async function archiverTableau(ctx, id, archiver = true) {
  return agir(ctx, async (c, emit) => {
    exigerProprietaire(await roleSur(c, id));
    const r = await c.query(`update boards set archived_at = $2 where id = $1 and (archived_at is null) = $3`, [id, archiver ? new Date() : null, archiver]);
    if (r.rowCount) await journal(c, ctx, id, null, archiver ? 'tableau.archive' : 'tableau.restaure', {});
    emit(id, { kind: 'board', id });
    return { ok: true };
  });
}

/** Éléments archivés d'un tableau : cartes archivées (hors colonnes archivées) et colonnes archivées. */
export async function archivesDuTableau(ctx, id) {
  return agir(ctx, async (c) => {
    await roleSur(c, id);
    const cards = (await c.query(`select c.id, c.title, c.archived_at as "archivedAt", k.id as "columnId", k.name as "columnName"
      from cards c join columns k on k.id = c.column_id
      where c.board_id = $1 and c.archived_at is not null and k.archived_at is null order by c.archived_at desc`, [id])).rows;
    const columns = (await c.query(`select k.id, k.name, k.archived_at as "archivedAt",
        (select count(*)::int from cards c where c.column_id = k.id and c.archived_at is null) as "cardCount"
      from columns k where k.board_id = $1 and k.archived_at is not null order by k.archived_at desc`, [id])).rows;
    return { cards, columns };
  });
}

/** Personnes (pas les agents) qui partagent déjà un tableau avec moi, moi compris : la RLS de users n'en montre pas d'autres. */
export async function personnesPourImport(ctx) {
  return agir(ctx, async (c) => (await c.query("select id, name, email from users where kind = 'human' and kx_shares_board(id) order by lower(name), email")).rows);
}

// ---------- Membres ----------

export async function listerMembres(ctx, id) {
  return agir(ctx, async (c) => { await roleSur(c, id); return (await lireTableau(c, id)).members; });
}

export async function inviter(ctx, id, { email, name, role }) {
  return agir(ctx, async (c, emit) => {
    exigerProprietaire(await roleSur(c, id));
    let rows;
    try {
      ({ rows } = await c.query('select kx_inviter($1, $2, $3, $4) as id', [id, email, name, role]));
    } catch (e) {
      if (e.code === '23505' && e.constraint === 'deja_membre') {
        throw new ErreurHttp(409, 'deja_membre', 'Cette personne est déjà membre du tableau. Pour changer son rôle, utilisez la liste des membres.');
      }
      throw e;
    }
    await journal(c, ctx, id, null, 'membre.invite', { userId: rows[0].id, role });
    emit(id, { kind: 'members', id });
    return (await lireTableau(c, id)).members;
  });
}

async function verifierDernierProprietaire(c, boardId, userId) {
  const { rows } = await c.query("select count(*)::int n, bool_or(user_id = $2) as cible from board_members where board_id = $1 and role = 'owner'", [boardId, userId]);
  if (rows[0].cible && rows[0].n <= 1) throw invalide('Un tableau doit toujours avoir au moins un propriétaire.');
}

export async function changerRole(ctx, id, userId, { role }) {
  return agir(ctx, async (c, emit) => {
    exigerProprietaire(await roleSur(c, id));
    if (role !== 'owner') await verifierDernierProprietaire(c, id, userId);
    const r = await c.query('update board_members set role = $3 where board_id = $1 and user_id = $2', [id, userId, role]);
    if (!r.rowCount) throw introuvable('Membre introuvable');
    await journal(c, ctx, id, null, 'membre.role', { userId, role });
    emit(id, { kind: 'members', id });
    return (await lireTableau(c, id)).members;
  });
}

export async function retirerMembre(ctx, id, userId) {
  const r = await agir(ctx, async (c, emit) => {
    const role = await roleSur(c, id);
    if (userId !== ctx.user.id) exigerProprietaire(role);
    await verifierDernierProprietaire(c, id, userId);
    const r = await c.query('delete from board_members where board_id = $1 and user_id = $2', [id, userId]);
    if (!r.rowCount) throw introuvable('Membre introuvable');
    // Le journal est écrit par le propriétaire ; si la personne se retire elle-même, elle n'a plus le droit d'écrire.
    if (userId !== ctx.user.id) await journal(c, ctx, id, null, 'membre.retire', { userId });
    emit(id, { kind: 'members', id, retire: userId });
    return { ok: true };
  });
  expulser(id, userId); // son flux en direct est coupé
  return r;
}

// ---------- Colonnes ----------

async function lireColonne(c, id) {
  const { rows } = await c.query('select id, board_id, name, wip_limit, archived_at from columns where id = $1', [id]);
  if (!rows[0]) throw introuvable('Colonne introuvable');
  return rows[0];
}
const versColonne = (k) => ({ id: k.id, name: k.name, wipLimit: k.wip_limit, position: k.position });

/** Crée une colonne à la fin, ou à l'index donné (0 = première) parmi les colonnes non archivées. */
export async function creerColonne(ctx, boardId, { name, index }) {
  return agir(ctx, async (c, emit) => {
    await roleEcriture(c, boardId);
    let position;
    if (index === undefined || index === null) {
      position = (await c.query('select coalesce(max(position), 0) + $2 as p from columns where board_id = $1', [boardId, PAS])).rows[0].p;
    } else position = await positionColonne(c, boardId, index);
    const k = (await c.query('insert into columns (board_id, name, position) values ($1, $2, $3) returning *', [boardId, name, position])).rows[0];
    await journal(c, ctx, boardId, null, 'colonne.creee', { name });
    emit(boardId, { kind: 'column', id: k.id });
    return versColonne(k);
  });
}

export async function modifierColonne(ctx, id, ch) {
  return agir(ctx, async (c, emit) => {
    const k = await lireColonne(c, id);
    await roleEcriture(c, k.board_id);
    const nom = ch.name ?? k.name;
    const wip = ch.wipLimit === undefined ? k.wip_limit : ch.wipLimit;
    const r = (await c.query('update columns set name = $2, wip_limit = $3 where id = $1 returning *', [id, nom, wip])).rows[0];
    if (nom !== k.name) await journal(c, ctx, k.board_id, null, 'colonne.renommee', { from: k.name, to: nom });
    if (wip !== k.wip_limit) await journal(c, ctx, k.board_id, null, 'colonne.limite', { name: nom, wipLimit: wip });
    emit(k.board_id, { kind: 'column', id });
    return versColonne(r);
  });
}

export async function deplacerColonne(ctx, id, { index }) {
  return agir(ctx, async (c, emit) => {
    const k = await lireColonne(c, id);
    await roleEcriture(c, k.board_id);
    const pos = await positionColonne(c, k.board_id, index, id);
    const r = (await c.query('update columns set position = $2 where id = $1 returning *', [id, pos])).rows[0];
    await journal(c, ctx, k.board_id, null, 'colonne.deplacee', { name: k.name });
    emit(k.board_id, { kind: 'column', id });
    return versColonne(r);
  });
}

export async function archiverColonne(ctx, id, archiver = true) {
  return agir(ctx, async (c, emit) => {
    const k = await lireColonne(c, id);
    await roleEcriture(c, k.board_id);
    await c.query('update columns set archived_at = $2 where id = $1', [id, archiver ? new Date() : null]);
    await journal(c, ctx, k.board_id, null, archiver ? 'colonne.archivee' : 'colonne.restauree', { name: k.name });
    emit(k.board_id, { kind: 'column', id });
    return { ok: true };
  });
}

// ---------- Cartes ----------

async function lireCarteBrute(c, id) {
  const { rows } = await c.query('select id, board_id, column_id, title, description, archived_at, created_by, to_char(due_date, \'YYYY-MM-DD\') as due_date from cards where id = $1', [id]);
  if (!rows[0]) throw introuvable('Carte introuvable');
  return rows[0];
}

export async function creerCarte(ctx, colonneId, { title }) {
  return agir(ctx, async (c, emit) => {
    const k = await lireColonne(c, colonneId);
    await roleEcriture(c, k.board_id);
    if (k.archived_at) throw invalide('Cette colonne est archivée : restaurez-la avant d\'y ajouter une carte.');
    const { rows: p } = await c.query('select coalesce(max(position), 0) + $2 as p from cards where column_id = $1', [colonneId, PAS]);
    const { rows } = await c.query('insert into cards (board_id, column_id, title, position, created_by) values ($1, $2, $3, $4, $5) returning id',
      [k.board_id, colonneId, title, p[0].p, ctx.user.id]);
    await noterMentionsCarte(c, ctx, { boardId: k.board_id, cardId: rows[0].id, champ: 'titre', apres: title, membres: await membresDuTableau(c, k.board_id) });
    await journal(c, ctx, k.board_id, rows[0].id, 'carte.creee', { title, column: k.name });
    emit(k.board_id, { kind: 'card', id: rows[0].id });
    return versCarte((await c.query(`${SQL_CARTES} where c.id = $1`, [rows[0].id])).rows[0]);
  });
}

async function prenomsMembres(c, boardId) {
  const { rows } = await c.query('select u.name from board_members m join users u on u.id = m.user_id where m.board_id = $1', [boardId]);
  return new Set(['claude', ...rows.map((r) => prenom(r.name))]); // « @Claude » est toujours une mention
}

export async function obtenirCarte(ctx, id) {
  return agir(ctx, async (c) => {
    const b = await lireCarteBrute(c, id);
    await roleSur(c, b.board_id);
    const carte = versCarte((await c.query(`${SQL_CARTES} where c.id = $1`, [id])).rows[0]);
    return { ...carte, boardId: b.board_id, description: b.description,
      descriptionHtml: rendreMarkdown(b.description, await prenomsMembres(c, b.board_id)), archived: !!b.archived_at, createdBy: b.created_by };
  });
}

export async function modifierCarte(ctx, id, ch) {
  return agir(ctx, async (c, emit) => {
    const b = await lireCarteBrute(c, id);
    await roleEcriture(c, b.board_id);
    const champs = [];
    if (ch.title !== undefined && ch.title !== b.title) { await c.query('update cards set title = $2, updated_at = now() where id = $1', [id, ch.title]); champs.push('titre'); }
    if (ch.description !== undefined && ch.description !== b.description) { await c.query('update cards set description = $2, updated_at = now() where id = $1', [id, ch.description]); champs.push('description'); }
    if (ch.dueDate !== undefined && ch.dueDate !== b.due_date) { await c.query('update cards set due_date = $2, updated_at = now() where id = $1', [id, ch.dueDate]); champs.push('échéance'); }
    if (ch.assignees) {
      await c.query('delete from card_assignees where card_id = $1', [id]);
      for (const u of ch.assignees) await c.query('insert into card_assignees (card_id, user_id, board_id) values ($1, $2, $3)', [id, u, b.board_id]);
      champs.push('responsables');
    }
    if (ch.labels) {
      await c.query('delete from card_labels where card_id = $1', [id]);
      for (const l of ch.labels) await c.query('insert into card_labels (card_id, label_id, board_id) values ($1, $2, $3)', [id, l, b.board_id]);
      champs.push('étiquettes');
    }
    if (champs.includes('titre') || champs.includes('description')) {
      const membres = await membresDuTableau(c, b.board_id);
      const commun = { boardId: b.board_id, cardId: id, membres };
      if (champs.includes('titre')) await noterMentionsCarte(c, ctx, { ...commun, champ: 'titre', avant: b.title, apres: ch.title });
      if (champs.includes('description')) await noterMentionsCarte(c, ctx, { ...commun, champ: 'description', avant: b.description, apres: ch.description });
    }
    if (champs.length) {
      await c.query('update cards set updated_at = now() where id = $1', [id]);
      await journal(c, ctx, b.board_id, id, 'carte.modifiee', { title: ch.title ?? b.title, champs });
      emit(b.board_id, { kind: 'card', id });
    }
    return versCarte((await c.query(`${SQL_CARTES} where c.id = $1`, [id])).rows[0]);
  });
}

export async function deplacerCarte(ctx, id, { columnId, index }) {
  return agir(ctx, async (c, emit) => {
    const b = await lireCarteBrute(c, id);
    await roleEcriture(c, b.board_id);
    const cible = await lireColonne(c, columnId ?? b.column_id);
    if (cible.board_id !== b.board_id) throw invalide('Colonne d\'un autre tableau.');
    if (cible.archived_at) throw invalide('Cette colonne est archivée : restaurez-la avant d\'y déplacer une carte.');
    const pos = await positionCarte(c, cible.id, index, id);
    await c.query('update cards set column_id = $2, position = $3, updated_at = now() where id = $1', [id, cible.id, pos]);
    const ancienne = b.column_id !== cible.id ? (await lireColonne(c, b.column_id)).name : null;
    await journal(c, ctx, b.board_id, id, 'carte.deplacee', { title: b.title, from: ancienne, to: cible.name });
    emit(b.board_id, { kind: 'card', id });
    return versCarte((await c.query(`${SQL_CARTES} where c.id = $1`, [id])).rows[0]);
  });
}

export async function archiverCarte(ctx, id, archiver = true) {
  return agir(ctx, async (c, emit) => {
    const b = await lireCarteBrute(c, id);
    await roleEcriture(c, b.board_id);
    await c.query('update cards set archived_at = $2 where id = $1', [id, archiver ? new Date() : null]);
    await journal(c, ctx, b.board_id, id, archiver ? 'carte.archivee' : 'carte.restauree', { title: b.title });
    emit(b.board_id, { kind: 'card', id });
    return { ok: true };
  });
}

// ---------- Étiquettes ----------

export async function creerEtiquette(ctx, boardId, { name, color }) {
  return agir(ctx, async (c, emit) => {
    await roleEcriture(c, boardId);
    const l = (await c.query('insert into labels (board_id, name, color) values ($1, $2, $3) returning id, name, color', [boardId, name ?? '', color])).rows[0];
    emit(boardId, { kind: 'board', id: boardId });
    return l;
  });
}

async function lireEtiquette(c, id) {
  const { rows } = await c.query('select id, board_id, name, color from labels where id = $1', [id]);
  if (!rows[0]) throw introuvable('Étiquette introuvable');
  return rows[0];
}

export async function modifierEtiquette(ctx, id, ch) {
  return agir(ctx, async (c, emit) => {
    const l = await lireEtiquette(c, id);
    await roleEcriture(c, l.board_id);
    const r = (await c.query('update labels set name = $2, color = $3 where id = $1 returning id, name, color', [id, ch.name ?? l.name, ch.color ?? l.color])).rows[0];
    emit(l.board_id, { kind: 'board', id: l.board_id });
    return r;
  });
}

export async function supprimerEtiquette(ctx, id) {
  return agir(ctx, async (c, emit) => {
    const l = await lireEtiquette(c, id);
    await roleEcriture(c, l.board_id);
    await c.query('delete from labels where id = $1', [id]);
    emit(l.board_id, { kind: 'board', id: l.board_id });
    return { ok: true };
  });
}
