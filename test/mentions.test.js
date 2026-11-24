// Nuit 2, point 2 : les mentions @prénom comptent aussi dans le titre et la description d'une carte.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, utilisateurConnecte, agentAvecJeton } from './serveur.js';
import { admin, fermer, commeUtilisateur, creerUtilisateur, creerTableau } from './aide.js';
import { outil } from './mcp-aide.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

async function scene() {
  const xavier = await utilisateurConnecte(srv.base, 'Xavier');
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const b = (await xavier.post('/api/boards', { name: 'Backlog' })).data;
  await xavier.post(`/api/boards/${b.id}/members`, { email: eric.user.email, name: 'Eric', role: 'member' });
  return { xavier, eric, b, col: b.columns[0].id };
}
const mentions = async (qui) => (await qui.get('/api/mentions')).data;

test('mention dans le titre à la création : la personne la retrouve, avec l\'endroit « titre »', async () => {
  const { xavier, eric, b, col } = await scene();
  const carte = (await xavier.post(`/api/columns/${col}/cards`, { title: 'Relire le devis @Eric' })).data;
  const m = await mentions(eric);
  assert.equal(m.length, 1);
  assert.equal(m[0].where, 'titre');
  assert.equal(m[0].body, 'Relire le devis @Eric');
  assert.equal(m[0].author.name, 'Xavier');
  assert.deepEqual([m[0].card.id, m[0].board.id], [carte.id, b.id]);
  assert.ok(m[0].createdAt);
});

test('mention dans la description ; corriger une faute ne crée pas de doublon ; seules les nouvelles mentions comptent', async () => {
  const { xavier, eric, col } = await scene();
  const carte = (await xavier.post(`/api/columns/${col}/cards`, { title: 'Budget' })).data;
  await xavier.patch(`/api/cards/${carte.id}`, { description: 'Demander à @Eric le chifre' });
  await xavier.patch(`/api/cards/${carte.id}`, { description: 'Demander à @Eric le chiffre' });
  let m = await mentions(eric);
  assert.equal(m.length, 1, JSON.stringify(m));
  assert.equal(m[0].where, 'description');
  assert.equal(m[0].body, 'Demander à @Eric le chiffre', 'le texte affiché est celui d\'aujourd\'hui');
  // Une nouvelle personne citée : elle seule reçoit une mention.
  await xavier.patch(`/api/cards/${carte.id}`, { description: 'Demander à @Eric le chiffre, puis @Xavier valide' });
  assert.equal((await mentions(eric)).length, 1);
  m = await mentions(xavier);
  assert.equal(m.length, 1);
  assert.equal(m[0].where, 'description');
  // Le titre corrigé sans changer les personnes citées : pas de nouvelle mention.
  await xavier.patch(`/api/cards/${carte.id}`, { title: 'Budjet @Eric' });
  await xavier.patch(`/api/cards/${carte.id}`, { title: 'Budget @Eric' });
  m = await mentions(eric);
  assert.deepEqual(m.map((x) => x.where).sort(), ['description', 'titre']);
});

test('les trois endroits sont distingués ; un commentaire garde l\'endroit « commentaire »', async () => {
  const { xavier, eric, col } = await scene();
  const carte = (await xavier.post(`/api/columns/${col}/cards`, { title: '@Eric titre' })).data;
  await xavier.patch(`/api/cards/${carte.id}`, { description: '@Eric description' });
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Eric commentaire' });
  const m = await mentions(eric);
  assert.deepEqual(m.map((x) => [x.where, x.body]), [['commentaire', '@Eric commentaire'], ['description', '@Eric description'], ['titre', '@Eric titre']]);
});

test('seuls les membres du tableau sont résolus ; un ancien membre ne voit plus ses mentions', async () => {
  const { xavier, eric, b, col } = await scene();
  const alexis = await utilisateurConnecte(srv.base, 'Alexis');
  const carte = (await xavier.post(`/api/columns/${col}/cards`, { title: 'Pour @Alexis et @Eric' })).data;
  await xavier.patch(`/api/cards/${carte.id}`, { description: '@Alexis encore' });
  assert.equal((await mentions(alexis)).length, 0);
  assert.equal((await mentions(eric)).length, 1);
  await xavier.delete(`/api/boards/${b.id}/members/${eric.user.id}`);
  assert.equal((await mentions(eric)).length, 0);
});

test('une carte archivée ne remonte plus dans les mentions', async () => {
  const { xavier, eric, col } = await scene();
  const carte = (await xavier.post(`/api/columns/${col}/cards`, { title: 'Ranger @Eric' })).data;
  await xavier.post(`/api/cards/${carte.id}/archive`);
  assert.equal((await mentions(eric)).length, 0);
});

test('lire_mentions (MCP) renvoie l\'endroit de chaque mention', async () => {
  const { xavier, b, col } = await scene();
  const robot = await agentAvecJeton(srv.base, 'Robot');
  await xavier.post(`/api/boards/${b.id}/members`, { email: robot.user.email, name: 'Robot', role: 'member' });
  const carte = (await xavier.post(`/api/columns/${col}/cards`, { title: 'Analyse' })).data;
  await xavier.patch(`/api/cards/${carte.id}`, { description: '@Robot, peux-tu chiffrer ?' });
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Robot merci' });
  const r = await outil(srv.base, robot, 'lire_mentions');
  assert.equal(r.erreur, false, r.texte);
  assert.deepEqual(r.data.mentions.map((m) => [m.endroit, m.texte, m.auteur, m.carte.id]),
    [['commentaire', '@Robot merci', 'Xavier', carte.id], ['description', '@Robot, peux-tu chiffrer ?', 'Xavier', carte.id]]);
});

// ---------- Base : les mentions de cartes sont isolées par tableau (RLS) ----------

test('RLS : une mention de carte n\'est lisible que par les membres du tableau, et écrite seulement par son auteur, membre écrivain', async () => {
  const proprio = await creerUtilisateur('Proprio');
  const lecteur = await creerUtilisateur('Lecteur');
  const etranger = await creerUtilisateur('Etranger');
  const { board, carte } = await creerTableau(proprio, { reader: lecteur });
  await admin.query("insert into card_mentions (board_id, card_id, field, user_id, author_id) values ($1, $2, 'titre', $3, $4)",
    [board.id, carte.id, lecteur.id, proprio.id]);
  const lire = (u) => commeUtilisateur(u.id, async (c) => (await c.query('select * from card_mentions where card_id = $1', [carte.id])).rows.length);
  assert.equal(await lire(proprio), 1);
  assert.equal(await lire(lecteur), 1);
  assert.equal(await lire(etranger), 0);
  const inserer = (u, auteur) => commeUtilisateur(u.id, (c) => c.query(
    "insert into card_mentions (board_id, card_id, field, user_id, author_id) values ($1, $2, 'description', $3, $4)", [board.id, carte.id, proprio.id, auteur.id]));
  await assert.rejects(inserer(lecteur, lecteur), /row-level security/);
  await assert.rejects(inserer(etranger, etranger), /row-level security/);
  await assert.rejects(inserer(proprio, lecteur), /row-level security/, 'au nom d\'un autre');
  await inserer(proprio, proprio);
  // Ni modification ni suppression par le rôle applicatif : une mention est un fait.
  await assert.rejects(commeUtilisateur(proprio.id, (c) => c.query('update card_mentions set user_id = $1', [proprio.id])), /permission denied/);
  await assert.rejects(commeUtilisateur(proprio.id, (c) => c.query('delete from card_mentions')), /permission denied/);
});
