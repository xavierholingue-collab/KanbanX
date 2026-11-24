// Nuit 2, point 7 : éléments archivés d'un tableau (avec « Restaurer »), archivage d'un tableau par son propriétaire.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, utilisateurConnecte } from './serveur.js';
import { fermer, commeUtilisateur, creerUtilisateur, creerTableau } from './aide.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

async function scene(role = 'member') {
  const xavier = await utilisateurConnecte(srv.base, 'Xavier');
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const b = (await xavier.post('/api/boards', { name: 'À ranger' })).data;
  await xavier.post(`/api/boards/${b.id}/members`, { email: eric.user.email, name: 'Eric', role });
  return { xavier, eric, b };
}

test('les cartes et colonnes archivées d\'un tableau se listent à part, et se restaurent', async () => {
  const { xavier, eric, b } = await scene();
  const [aFaire, enCours] = b.columns;
  const c1 = (await xavier.post(`/api/columns/${aFaire.id}/cards`, { title: 'Ancienne idée' })).data;
  await xavier.post(`/api/columns/${aFaire.id}/cards`, { title: 'Toujours là' });
  const c3 = (await xavier.post(`/api/columns/${enCours.id}/cards`, { title: 'Dans la colonne archivée' })).data;
  await xavier.post(`/api/cards/${c1.id}/archive`);
  await xavier.post(`/api/columns/${enCours.id}/archive`);

  const r = await eric.get(`/api/boards/${b.id}/archives`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.cards.map((c) => [c.id, c.title, c.columnName]), [[c1.id, 'Ancienne idée', 'À faire']]);
  assert.deepEqual(r.data.columns.map((k) => [k.id, k.name, k.cardCount]), [[enCours.id, 'En cours', 1]]);
  assert.ok(r.data.cards[0].archivedAt && r.data.columns[0].archivedAt);
  // Le flux principal ne les montre pas.
  const t = (await eric.get(`/api/boards/${b.id}`)).data;
  assert.deepEqual(t.columns.map((k) => k.name), ['À faire', 'Fait']);
  // Restaurer (un membre le peut, comme l'archivage).
  assert.equal((await eric.post(`/api/cards/${c1.id}/restore`)).status, 200);
  assert.equal((await eric.post(`/api/columns/${enCours.id}/restore`)).status, 200);
  const t2 = (await eric.get(`/api/boards/${b.id}`)).data;
  assert.deepEqual(t2.columns.map((k) => k.name), ['À faire', 'En cours', 'Fait']);
  assert.ok(t2.columns[1].cards.some((c) => c.id === c3.id));
  assert.deepEqual((await eric.get(`/api/boards/${b.id}/archives`)).data, { cards: [], columns: [] });
});

test('les archives d\'un tableau dont on n\'est pas membre : introuvable', async () => {
  const { b } = await scene();
  const alexis = await utilisateurConnecte(srv.base, 'Alexis');
  assert.equal((await alexis.get(`/api/boards/${b.id}/archives`)).status, 404);
});

test('le propriétaire archive un tableau entier, le retrouve dans « Tableaux archivés » et le restaure', async () => {
  const { xavier, eric, b } = await scene();
  assert.equal((await xavier.post(`/api/boards/${b.id}/archive`)).status, 200);
  assert.ok(!(await xavier.get('/api/boards')).data.some((t) => t.id === b.id));
  assert.equal((await xavier.get(`/api/boards/${b.id}`)).status, 404);
  const arch = (await xavier.get('/api/boards/archived')).data;
  assert.deepEqual(arch.filter((t) => t.id === b.id).map((t) => [t.name, t.role]), [['À ranger', 'owner']]);
  assert.ok(arch[0].archivedAt);
  // Un membre voit aussi le tableau archivé (sans pouvoir le restaurer).
  assert.ok((await eric.get('/api/boards/archived')).data.some((t) => t.id === b.id));
  assert.equal((await eric.post(`/api/boards/${b.id}/restore`)).status, 403);
  // Un tableau archivé ne se modifie plus.
  const col = b.columns[0].id;
  assert.equal((await eric.post(`/api/columns/${col}/cards`, { title: 'x' })).status, 400);
  assert.equal((await xavier.post(`/api/boards/${b.id}/restore`)).status, 200);
  assert.ok((await xavier.get('/api/boards')).data.some((t) => t.id === b.id));
  assert.ok(!(await xavier.get('/api/boards/archived')).data.some((t) => t.id === b.id));
  const act = (await xavier.get(`/api/boards/${b.id}/activity`)).data;
  assert.deepEqual(act.slice(0, 2).map((a) => a.action), ['tableau.restaure', 'tableau.archive']);
});

test('un membre non propriétaire ne peut pas archiver le tableau ; un lecteur non plus', async () => {
  for (const role of ['member', 'reader']) {
    const { xavier, eric, b } = await scene(role);
    const r = await eric.post(`/api/boards/${b.id}/archive`);
    assert.equal(r.status, 403, role);
    assert.ok((await xavier.get('/api/boards')).data.some((t) => t.id === b.id), role);
  }
  const alexis = await utilisateurConnecte(srv.base, 'Alexis');
  const { b } = await scene();
  assert.equal((await alexis.post(`/api/boards/${b.id}/archive`)).status, 404);
});

test('RLS : la base refuse aussi l\'archivage d\'un tableau par un membre non propriétaire', async () => {
  const proprio = await creerUtilisateur('Proprio');
  const membre = await creerUtilisateur('Membre');
  const { board } = await creerTableau(proprio, { member: membre });
  const r = await commeUtilisateur(membre.id, (c) => c.query('update boards set archived_at = now() where id = $1', [board.id]));
  assert.equal(r.rowCount, 0);
  const ok = await commeUtilisateur(proprio.id, (c) => c.query('update boards set archived_at = now() where id = $1', [board.id]));
  assert.equal(ok.rowCount, 1);
});
