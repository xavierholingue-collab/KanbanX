// Nuit 2, point 8 : relier les auteurs Trello aux comptes KanbanX, sans jamais écrire au nom d'un autre.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, utilisateurConnecte, agentAvecJeton } from './serveur.js';
import { admin, fermer, commeUtilisateur, creerUtilisateur, creerTableau } from './aide.js';
import { outil, claudePour } from './mcp-aide.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

const exportTrello = () => ({
  id: 'b1', name: 'Chantier Trello',
  members: [{ id: 'm-eric', fullName: 'Eric Hoarau', username: 'erich' }, { id: 'm-marie', fullName: 'Marie Exemple', username: 'marie' }],
  lists: [{ id: 'L1', name: 'À faire', pos: 1 }],
  cards: [{ id: 'c1', name: 'Devis', idList: 'L1', pos: 1 }],
  labels: [],
  actions: [
    { type: 'commentCard', date: '2026-10-01T09:00:00.000Z', idMemberCreator: 'm-eric', memberCreator: { id: 'm-eric', fullName: 'Eric Hoarau' }, data: { text: 'Je relance le fournisseur.', card: { id: 'c1' } } },
    { type: 'commentCard', date: '2026-10-02T09:00:00.000Z', idMemberCreator: 'm-marie', memberCreator: { id: 'm-marie', fullName: 'Marie Exemple' }, data: { text: 'Vu.', card: { id: 'c1' } } },
  ],
});

/** Xavier importe ; Eric partage déjà un tableau avec lui ; Alexis non. */
async function scene() {
  const xavier = await utilisateurConnecte(srv.base, 'Xavier');
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const alexis = await utilisateurConnecte(srv.base, 'Alexis');
  const commun = (await xavier.post('/api/boards', { name: 'Commun' })).data;
  await xavier.post(`/api/boards/${commun.id}/members`, { email: eric.user.email, name: 'Eric', role: 'member' });
  return { xavier, eric, alexis, commun };
}
const commentaires = async (qui, boardId) => {
  const t = (await qui.get(`/api/boards/${boardId}`)).data;
  return (await qui.get(`/api/cards/${t.columns[0].cards[0].id}/comments`)).data;
};

test('candidats à l\'association : seulement les personnes qui partagent déjà un tableau avec celle qui importe', async () => {
  const { xavier, eric, alexis, commun } = await scene();
  const robot = await agentAvecJeton(srv.base, 'Robot');
  await xavier.post(`/api/boards/${commun.id}/members`, { email: robot.user.email, name: 'Robot', role: 'member' });
  const r = await xavier.get('/api/import-trello/personnes');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ids = r.data.map((p) => p.id);
  assert.ok(ids.includes(eric.user.id));
  assert.ok(ids.includes(xavier.user.id), 'soi-même');
  assert.ok(!ids.includes(alexis.user.id), 'jamais la liste de tous les comptes');
  assert.ok(!ids.includes(robot.user.id), 'une personne, pas un agent');
  assert.deepEqual(Object.keys(r.data.find((p) => p.id === eric.user.id)).sort(), ['email', 'id', 'name']);
});

test('import avec association : le commentaire affiche la personne associée, « importé de Trello », et reste à celle qui importe', async () => {
  const { xavier, eric } = await scene();
  const r = await xavier.post('/api/boards/import-trello', { trello: exportTrello(), correspondances: { 'm-eric': eric.user.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const [c1, c2] = await commentaires(xavier, r.data.id);
  assert.equal(c1.body, 'Je relance le fournisseur.');
  assert.deepEqual(c1.imported, { from: 'trello', name: 'Eric' });
  assert.equal(c1.author.id, xavier.user.id, 'propriété de la personne qui importe');
  assert.equal(new Date(c1.createdAt).toISOString(), '2026-10-01T09:00:00.000Z', 'date d\'origine');
  // Sans association : comme avant, l'auteur Trello en tête du texte.
  assert.match(c2.body, /^\*Marie Exemple sur Trello/);
  assert.equal(c2.imported ?? null, null);
  // MCP : on sait qui a écrit, et d'où cela vient.
  const lu = await outil(srv.base, await claudePour(srv.base, xavier), 'lire_carte', { carte_id: c1.cardId });
  assert.equal(lu.data.commentaires[0].auteur, 'Eric (importé de Trello par Xavier)');
});

test('l\'ancien format (export brut) reste accepté', async () => {
  const { xavier } = await scene();
  const r = await xavier.post('/api/boards/import-trello', exportTrello());
  assert.equal(r.status, 200);
  const [c1] = await commentaires(xavier, r.data.id);
  assert.match(c1.body, /^\*Eric Hoarau sur Trello/);
});

test('association refusée vers une personne qui ne partage aucun tableau, un agent ou un identifiant invalide : rien n\'est importé', async () => {
  const { xavier, alexis, commun } = await scene();
  const robot = await agentAvecJeton(srv.base, 'Robot');
  await xavier.post(`/api/boards/${commun.id}/members`, { email: robot.user.email, name: 'Robot', role: 'member' });
  const avant = (await xavier.get('/api/boards')).data.length;
  for (const cible of [alexis.user.id, robot.user.id, 'pas-un-uuid', '00000000-0000-4000-8000-000000000000']) {
    const r = await xavier.post('/api/boards/import-trello', { trello: exportTrello(), correspondances: { 'm-eric': cible } });
    assert.equal(r.status, 400, `${cible} : ${JSON.stringify(r.data)}`);
  }
  assert.equal((await xavier.get('/api/boards')).data.length, avant);
});

test('personne ne peut écrire au nom d\'un autre : la personne associée ne modifie ni ne supprime le commentaire importé', async () => {
  const { xavier, eric } = await scene();
  const r = await xavier.post('/api/boards/import-trello', { trello: exportTrello(), correspondances: { 'm-eric': eric.user.id } });
  await xavier.post(`/api/boards/${r.data.id}/members`, { email: eric.user.email, name: 'Eric', role: 'member' });
  const [c1] = await commentaires(eric, r.data.id);
  assert.equal((await eric.patch(`/api/comments/${c1.id}`, { body: 'réécrit' })).status, 403);
  assert.equal((await eric.delete(`/api/comments/${c1.id}`)).status, 403);
  assert.equal((await xavier.patch(`/api/comments/${c1.id}`, { body: 'Corrigé par Xavier' })).status, 200);
  const [apres] = await commentaires(eric, r.data.id);
  assert.equal(apres.author.id, xavier.user.id);
  assert.deepEqual(apres.imported, { from: 'trello', name: 'Eric' });
});

test('RLS : la base refuse un commentaire « importé » attribué à une personne hors de ses tableaux, ou sous un faux nom', async () => {
  const x = await creerUtilisateur('Xavier');
  const e = await creerUtilisateur('Eric');
  const inconnu = await creerUtilisateur('Inconnu');
  const { carte, board } = await creerTableau(x, { member: e });
  const inserer = (auteurImporte, nom) => commeUtilisateur(x.id, (c) => c.query(
    `insert into comments (board_id, card_id, author_id, body, imported_from, imported_author_id, imported_author_name)
     values ($1, $2, $3, 'x', 'trello', $4, $5)`, [board.id, carte.id, x.id, auteurImporte, nom]));
  await assert.rejects(inserer(inconnu.id, 'Inconnu'), /row-level security/);
  await assert.rejects(inserer(e.id, 'Quelqu\'un d\'autre'), /row-level security/);
  await inserer(e.id, 'Eric');
  const { rows } = await admin.query("select id from comments where card_id = $1 and imported_author_id = $2", [carte.id, e.id]);
  await assert.rejects(commeUtilisateur(x.id, (c) => c.query('update comments set imported_author_id = $2, imported_author_name = $3 where id = $1',
    [rows[0].id, inconnu.id, 'Inconnu'])), /ne se modifie pas/);
});
