// Isolement strict et droits par rôle, appliqués PAR LA BASE (politiques RLS), sans passer par le code du serveur.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { admin, app, creerUtilisateur, commeUtilisateur, creerTableau, fermer } from './aide.js';

after(fermer);

async function scenario() {
  const [prop, membre, lecteur, intrus] = await Promise.all(['Prop', 'Membre', 'Lecteur', 'Intrus'].map((n) => creerUtilisateur(n)));
  const t = await creerTableau(prop, { member: membre, reader: lecteur });
  return { prop, membre, lecteur, intrus, ...t };
}

test('le rôle applicatif est soumis aux politiques (ni superutilisateur, ni BYPASSRLS)', async () => {
  const { rows } = await app.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  assert.equal(rows[0].rolsuper, false);
  assert.equal(rows[0].rolbypassrls, false);
});

test('sans utilisateur courant, aucune donnée n\'est visible', async () => {
  await scenario();
  const n = await commeUtilisateur(null, async (c) => (await c.query('select count(*)::int n from boards')).rows[0].n);
  assert.equal(n, 0);
});

test('un intrus ne voit ni le tableau, ni les colonnes, ni les cartes, ni l\'activité', async () => {
  const s = await scenario();
  await admin.query("insert into activity (board_id, actor_id, action) values ($1, $2, 'test')", [s.board.id, s.prop.id]);
  for (const table of ['boards', 'columns', 'cards', 'labels', 'comments', 'activity', 'board_members']) {
    const n = await commeUtilisateur(s.intrus.id, async (c) => (await c.query(`select count(*)::int n from ${table}`)).rows[0].n);
    assert.equal(n, 0, `${table} doit être invisible pour un intrus`);
  }
});

test('un intrus ne peut ni modifier ni supprimer une carte d\'un autre tableau', async () => {
  const s = await scenario();
  const maj = await commeUtilisateur(s.intrus.id, (c) => c.query("update cards set title = 'piraté' where id = $1", [s.carte.id]));
  assert.equal(maj.rowCount, 0);
  const sup = await commeUtilisateur(s.intrus.id, (c) => c.query('delete from cards where id = $1', [s.carte.id]));
  assert.equal(sup.rowCount, 0);
  assert.equal((await admin.query('select title from cards where id = $1', [s.carte.id])).rows[0].title, 'Carte secrète');
});

test('un intrus ne peut pas créer de carte ni de commentaire dans un tableau étranger', async () => {
  const s = await scenario();
  await assert.rejects(commeUtilisateur(s.intrus.id, (c) => c.query(
    "insert into cards (board_id, column_id, title, position, created_by) values ($1, $2, 'x', 1, $3)", [s.board.id, s.col.id, s.intrus.id])));
  await assert.rejects(commeUtilisateur(s.intrus.id, (c) => c.query(
    "insert into comments (board_id, card_id, author_id, body) values ($1, $2, $3, 'x')", [s.board.id, s.carte.id, s.intrus.id])));
});

test('un lecteur voit tout mais ne peut rien écrire', async () => {
  const s = await scenario();
  const n = await commeUtilisateur(s.lecteur.id, async (c) => (await c.query('select count(*)::int n from cards')).rows[0].n);
  assert.ok(n >= 1);
  await assert.rejects(commeUtilisateur(s.lecteur.id, (c) => c.query(
    "insert into cards (board_id, column_id, title, position, created_by) values ($1, $2, 'x', 1, $3)", [s.board.id, s.col.id, s.lecteur.id])));
  const maj = await commeUtilisateur(s.lecteur.id, (c) => c.query("update cards set title = 'x' where id = $1", [s.carte.id]));
  assert.equal(maj.rowCount, 0);
  await assert.rejects(commeUtilisateur(s.lecteur.id, (c) => c.query(
    "insert into comments (board_id, card_id, author_id, body) values ($1, $2, $3, 'x')", [s.board.id, s.carte.id, s.lecteur.id])));
  const col = await commeUtilisateur(s.lecteur.id, (c) => c.query("update columns set name = 'x' where id = $1", [s.col.id]));
  assert.equal(col.rowCount, 0);
});

test('un membre écrit des cartes et des commentaires, mais ne gère pas les membres', async () => {
  const s = await scenario();
  await commeUtilisateur(s.membre.id, (c) => c.query(
    "insert into cards (board_id, column_id, title, position, created_by) values ($1, $2, 'ok', 2048, $3)", [s.board.id, s.col.id, s.membre.id]));
  await commeUtilisateur(s.membre.id, (c) => c.query(
    "insert into comments (board_id, card_id, author_id, body) values ($1, $2, $3, 'bonjour')", [s.board.id, s.carte.id, s.membre.id]));
  const r = await commeUtilisateur(s.membre.id, (c) => c.query("update board_members set role = 'owner' where user_id = $1", [s.membre.id]));
  assert.equal(r.rowCount, 0, 'un membre ne peut pas s\'élever lui-même propriétaire');
  const b = await commeUtilisateur(s.membre.id, (c) => c.query("update boards set name = 'renommé' where id = $1", [s.board.id]));
  assert.equal(b.rowCount, 0);
});

test('on ne peut pas se faire passer pour un autre auteur', async () => {
  const s = await scenario();
  await assert.rejects(commeUtilisateur(s.membre.id, (c) => c.query(
    "insert into comments (board_id, card_id, author_id, body) values ($1, $2, $3, 'faux')", [s.board.id, s.carte.id, s.prop.id])));
  await assert.rejects(commeUtilisateur(s.membre.id, (c) => c.query(
    "insert into activity (board_id, actor_id, action) values ($1, $2, 'faux')", [s.board.id, s.prop.id])));
});

test('le propriétaire gère les membres', async () => {
  const s = await scenario();
  const r = await commeUtilisateur(s.prop.id, (c) => c.query("update board_members set role = 'reader' where board_id = $1 and user_id = $2", [s.board.id, s.membre.id]));
  assert.equal(r.rowCount, 1);
});

test('l\'activité est en ajout seul : ni modification ni suppression', async () => {
  const s = await scenario();
  await commeUtilisateur(s.prop.id, (c) => c.query("insert into activity (board_id, actor_id, action) values ($1, $2, 'a')", [s.board.id, s.prop.id]));
  await assert.rejects(commeUtilisateur(s.prop.id, (c) => c.query("update activity set action = 'b' where board_id = $1", [s.board.id])));
  await assert.rejects(commeUtilisateur(s.prop.id, (c) => c.query('delete from activity where board_id = $1', [s.board.id])));
});

test('les tables d\'authentification sont inaccessibles au rôle applicatif', async () => {
  for (const table of ['sessions', 'magic_links', 'api_tokens']) {
    await assert.rejects(app.query(`select * from ${table}`), /permission denied/);
  }
});

test('un utilisateur ne voit que lui-même et les co-membres de ses tableaux', async () => {
  const s = await scenario();
  const ids = await commeUtilisateur(s.intrus.id, async (c) => (await c.query('select id from users')).rows.map((r) => r.id));
  assert.deepEqual(ids, [s.intrus.id]);
  const ids2 = await commeUtilisateur(s.membre.id, async (c) => (await c.query('select id from users')).rows.map((r) => r.id));
  assert.ok(ids2.includes(s.prop.id) && ids2.includes(s.lecteur.id) && !ids2.includes(s.intrus.id));
});

test('intégrité : une carte ne peut pas pointer une colonne d\'un autre tableau', async () => {
  const s = await scenario();
  const autre = await creerTableau(s.prop);
  await assert.rejects(admin.query(
    "insert into cards (board_id, column_id, title, position, created_by) values ($1, $2, 'x', 1, $3)", [s.board.id, autre.col.id, s.prop.id]));
});

test('intégrité : un responsable doit être membre du tableau', async () => {
  const s = await scenario();
  await assert.rejects(admin.query('insert into card_assignees (card_id, user_id, board_id) values ($1, $2, $3)', [s.carte.id, s.intrus.id, s.board.id]));
});

test('la base garantit au moins un propriétaire : ni rétrogradation, ni retrait, ni réinvitation du dernier', async () => {
  const s = await scenario();
  await assert.rejects(commeUtilisateur(s.prop.id, (c) => c.query(
    "update board_members set role = 'member' where board_id = $1 and user_id = $2", [s.board.id, s.prop.id])));
  await assert.rejects(commeUtilisateur(s.prop.id, (c) => c.query(
    'delete from board_members where board_id = $1 and user_id = $2', [s.board.id, s.prop.id])));
  await assert.rejects(commeUtilisateur(s.prop.id, (c) => c.query(
    'select kx_inviter($1, $2, $3, $4)', [s.board.id, s.prop.email, 'Prop', 'reader'])));
  const { rows } = await admin.query("select count(*)::int n from board_members where board_id = $1 and role = 'owner'", [s.board.id]);
  assert.equal(rows[0].n, 1);
});

test('réinviter un membre existant par la base est refusé et ne change pas son rôle', async () => {
  const s = await scenario();
  await assert.rejects(commeUtilisateur(s.prop.id, (c) => c.query(
    'select kx_inviter($1, $2, $3, $4)', [s.board.id, s.membre.email.toUpperCase(), 'Membre', 'owner'])), { code: '23505' });
  const { rows } = await admin.query('select role from board_members where board_id = $1 and user_id = $2', [s.board.id, s.membre.id]);
  assert.equal(rows[0].role, 'member');
});

test('deux propriétaires qui se rétrogradent en même temps ne laissent pas le tableau sans propriétaire', async () => {
  const s = await scenario();
  const second = await creerUtilisateur('Second');
  await admin.query("insert into board_members (board_id, user_id, role) values ($1, $2, 'owner')", [s.board.id, second.id]);
  const c1 = await app.connect();
  const c2 = await app.connect();
  try {
    for (const [c, u] of [[c1, s.prop], [c2, second]]) {
      await c.query('begin');
      await c.query("select set_config('app.user_id', $1, true)", [u.id]);
    }
    // Chacun rétrograde l'autre ; la première transaction n'est pas encore validée quand la seconde agit.
    await c1.query("update board_members set role = 'member' where board_id = $1 and user_id = $2", [s.board.id, second.id]);
    const p2 = c2.query("update board_members set role = 'member' where board_id = $1 and user_id = $2", [s.board.id, s.prop.id])
      .then(() => 'accepté', (e) => e);
    await new Promise((r) => setTimeout(r, 300));
    await c1.query('commit');
    const r2 = await p2;
    assert.ok(r2 instanceof Error, 'la seconde rétrogradation doit être refusée');
  } finally {
    for (const c of [c1, c2]) {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  }
  const { rows } = await admin.query("select count(*)::int n from board_members where board_id = $1 and role = 'owner'", [s.board.id]);
  assert.equal(rows[0].n, 1);
});
