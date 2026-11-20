// P4 : limites d'en-cours (WIP) et import d'un export JSON de Trello.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demarrer, Client, utilisateurConnecte } from './serveur.js';
import { fermer } from './aide.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });
const trello = JSON.parse(readFileSync(new URL('./donnees/trello.json', import.meta.url), 'utf8'));

test('limite d\'en-cours : fixée, retirée, journalisée ; refusée au lecteur', async () => {
  const prop = await utilisateurConnecte(srv.base, 'Prop');
  const lecteur = await utilisateurConnecte(srv.base, 'Lecteur');
  const b = (await prop.post('/api/boards', { name: 'WIP' })).data;
  await prop.post(`/api/boards/${b.id}/members`, { email: lecteur.user.email, name: 'Lecteur', role: 'reader' });
  const col = b.columns[1].id;
  assert.equal((await prop.patch(`/api/columns/${col}`, { wipLimit: 2 })).data.wipLimit, 2);
  assert.equal((await prop.get(`/api/boards/${b.id}`)).data.columns[1].wipLimit, 2);
  assert.equal((await lecteur.patch(`/api/columns/${col}`, { wipLimit: 5 })).status, 403);
  assert.equal((await prop.patch(`/api/columns/${col}`, { wipLimit: null })).data.wipLimit, null);
  const act = (await prop.get(`/api/boards/${b.id}/activity`)).data;
  assert.ok(act.some((a) => a.action === 'colonne.limite'));
});

test('import Trello : listes, cartes ouvertes dans l\'ordre, étiquettes, échéances, commentaires', async () => {
  const c = await utilisateurConnecte(srv.base, 'Importe');
  const r = await c.post('/api/boards/import-trello', trello);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = (await c.get(`/api/boards/${r.data.id}`)).data;
  assert.equal(t.name, 'Export Trello <b>test</b>');
  assert.equal(t.role, 'owner');
  assert.deepEqual(t.columns.map((k) => k.name), ['À faire', 'En cours']);
  assert.deepEqual(t.columns[0].cards.map((k) => k.title), ['Première <script>alert(1)</script>', 'Deuxième']);
  const p = t.columns[0].cards[0];
  assert.equal(p.dueDate, '2026-12-24');
  assert.deepEqual(p.labels.map((id) => t.labels.find((l) => l.id === id)).map((l) => [l.name, l.color]), [['Bug', 'rouge'], ['Idée', 'orange']]);
  assert.deepEqual(t.columns[1].cards[0].labels.map((id) => t.labels.find((l) => l.id === id).color).sort(), ['ardoise', 'turquoise']);
  const detail = (await c.get(`/api/cards/${p.id}`)).data;
  assert.equal(detail.descriptionHtml, '<p>Une <strong>description</strong></p>');
  const comm = (await c.get(`/api/cards/${p.id}/comments`)).data;
  assert.equal(comm.length, 1);
  assert.match(comm[0].body, /Marie Exemple/);
  assert.match(comm[0].body, /Commentaire importé/);
});

test('import Trello : authentification requise, données invalides refusées, tableau privé à l\'importateur', async () => {
  assert.equal((await new Client(srv.base).post('/api/boards/import-trello', trello)).status, 401);
  const c = await utilisateurConnecte(srv.base, 'Importe');
  assert.equal((await c.post('/api/boards/import-trello', { name: 'x' })).status, 400);
  assert.equal((await c.post('/api/boards/import-trello', { name: 'x', lists: 'pas une liste', cards: [] })).status, 400);
  const r = await c.post('/api/boards/import-trello', trello);
  const intrus = await utilisateurConnecte(srv.base, 'Intrus');
  assert.equal((await intrus.get(`/api/boards/${r.data.id}`)).status, 404);
});

test('import Trello : un export volumineux (plus de 1 Mo) est accepté, au-delà de la limite raisonnable il est refusé', async () => {
  const c = await utilisateurConnecte(srv.base, 'Gros');
  const gros = { ...trello, cards: Array.from({ length: 600 }, (_, i) => ({ id: `g${i}`, name: `Carte ${i}`, desc: 'x'.repeat(2000), idList: 'L1', closed: false, pos: i })) };
  const r = await c.post('/api/boards/import-trello', gros);
  assert.equal(r.status, 200);
  assert.equal((await c.get(`/api/boards/${r.data.id}`)).data.columns[0].cards.length, 600);
  const enorme = { ...trello, cards: [{ id: 'z', name: 'z', desc: 'x'.repeat(11_000_000), idList: 'L1', pos: 1 }] };
  assert.equal((await c.post('/api/boards/import-trello', enorme)).status, 413);
});
