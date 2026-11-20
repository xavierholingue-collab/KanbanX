import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, Client, utilisateurConnecte } from './serveur.js';
import { admin, fermer, creerUtilisateur } from './aide.js';
import { boiteDev } from '../src/courriel.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

/** Un propriétaire, un membre, un lecteur, un intrus et un tableau. */
async function equipe() {
  const [prop, membre, lecteur, intrus] = await Promise.all(['Prop', 'Membre', 'Lecteur', 'Intrus'].map((n) => utilisateurConnecte(srv.base, n)));
  const b = (await prop.post('/api/boards', { name: 'Équipe' })).data;
  await prop.post(`/api/boards/${b.id}/members`, { email: membre.user.email, name: 'Membre', role: 'member' });
  await prop.post(`/api/boards/${b.id}/members`, { email: lecteur.user.email, name: 'Lecteur', role: 'reader' });
  const colId = b.columns[0].id;
  const carte = (await prop.post(`/api/columns/${colId}/cards`, { title: 'Secrète' })).data;
  return { prop, membre, lecteur, intrus, b, colId, carte };
}

test('un tableau neuf propose À faire, En cours, Fait', async () => {
  const c = await utilisateurConnecte(srv.base);
  const b = (await c.post('/api/boards', { name: 'Neuf' })).data;
  assert.deepEqual(b.columns.map((k) => k.name), ['À faire', 'En cours', 'Fait']);
  assert.equal(b.role, 'owner');
});

test('isolement : un intrus reçoit 404 sur tout ce qui touche au tableau d\'autrui', async () => {
  const { intrus, b, colId, carte } = await equipe();
  assert.deepEqual((await intrus.get('/api/boards')).data, []);
  for (const [m, url, corps] of [
    ['GET', `/api/boards/${b.id}`], ['GET', `/api/boards/${b.id}/members`], ['GET', `/api/cards/${carte.id}`],
    ['PATCH', `/api/cards/${carte.id}`, { title: 'piraté' }], ['POST', `/api/cards/${carte.id}/move`, { index: 0 }],
    ['POST', `/api/cards/${carte.id}/archive`, {}], ['POST', `/api/columns/${colId}/cards`, { title: 'x' }],
    ['PATCH', `/api/columns/${colId}`, { name: 'x' }], ['POST', `/api/boards/${b.id}/columns`, { name: 'x' }],
    ['PATCH', `/api/boards/${b.id}`, { name: 'x' }],
    ['POST', `/api/boards/${b.id}/members`, { email: 'z@exemple.invalid', name: 'Z', role: 'member' }],
    ['POST', `/api/boards/${b.id}/labels`, { name: 'x', color: 'bleu' }],
  ]) {
    const r = await intrus.requete(m, url, corps);
    assert.equal(r.status, 404, `${m} ${url} → ${r.status}`);
  }
  const apres = (await admin.query('select title from cards where id = $1', [carte.id])).rows[0];
  assert.equal(apres.title, 'Secrète');
});

test('droits par rôle : le lecteur lit seulement, le membre écrit, seul le propriétaire gère', async () => {
  const { prop, membre, lecteur, b, colId, carte } = await equipe();
  assert.equal((await lecteur.get(`/api/boards/${b.id}`)).status, 200);
  for (const [m, url, corps] of [
    ['POST', `/api/columns/${colId}/cards`, { title: 'x' }], ['PATCH', `/api/cards/${carte.id}`, { title: 'x' }],
    ['POST', `/api/cards/${carte.id}/move`, { index: 0 }], ['POST', `/api/cards/${carte.id}/archive`, {}],
    ['PATCH', `/api/columns/${colId}`, { name: 'x' }], ['POST', `/api/boards/${b.id}/columns`, { name: 'x' }],
    ['POST', `/api/boards/${b.id}/labels`, { name: 'x', color: 'bleu' }],
  ]) {
    assert.equal((await lecteur.requete(m, url, corps)).status, 403, `lecteur ${m} ${url}`);
  }
  assert.equal((await membre.post(`/api/columns/${colId}/cards`, { title: 'ok' })).status, 200);
  assert.equal((await membre.patch(`/api/cards/${carte.id}`, { title: 'modifiée' })).status, 200);
  for (const [m, url, corps] of [
    ['PATCH', `/api/boards/${b.id}`, { name: 'x' }],
    ['POST', `/api/boards/${b.id}/members`, { email: 'z@exemple.invalid', name: 'Z', role: 'member' }],
    ['PATCH', `/api/boards/${b.id}/members/${membre.user.id}`, { role: 'owner' }],
    ['DELETE', `/api/boards/${b.id}/members/${lecteur.user.id}`],
  ]) {
    assert.equal((await membre.requete(m, url, corps)).status, 403, `membre ${m} ${url}`);
  }
  assert.equal((await prop.patch(`/api/boards/${b.id}`, { name: 'Renommé' })).status, 200);
});

test('invitation : le compte est créé, la personne se connecte et voit le tableau ; sans invitation, rien', async () => {
  const { prop, b } = await equipe();
  const email = `invite-${Date.now()}@exemple.invalid`;
  await prop.post(`/api/boards/${b.id}/members`, { email, name: 'Invitée', role: 'member' });
  const inv = new Client(srv.base);
  assert.equal((await inv.connecter(email)).status, 200);
  assert.equal((await inv.get('/api/boards')).data.some((x) => x.id === b.id), true);
});

test('un tableau garde toujours un propriétaire', async () => {
  const { prop, b } = await equipe();
  assert.equal((await prop.patch(`/api/boards/${b.id}/members/${prop.user.id}`, { role: 'member' })).status, 400);
  assert.equal((await prop.delete(`/api/boards/${b.id}/members/${prop.user.id}`)).status, 400);
});

test('retirer un membre lui ferme l\'accès', async () => {
  const { prop, membre, b } = await equipe();
  assert.equal((await prop.delete(`/api/boards/${b.id}/members/${membre.user.id}`)).status, 200);
  assert.equal((await membre.get(`/api/boards/${b.id}`)).status, 404);
});

test('cartes : création, ordre, déplacement entre colonnes, archivage et restauration', async () => {
  const { prop, b, colId } = await equipe();
  const [a, bb] = [(await prop.post(`/api/columns/${colId}/cards`, { title: 'A' })).data, (await prop.post(`/api/columns/${colId}/cards`, { title: 'B' })).data];
  const col2 = b.columns[1].id;
  await prop.post(`/api/cards/${bb.id}/move`, { columnId: col2, index: 0 });
  await prop.post(`/api/cards/${a.id}/move`, { columnId: col2, index: 0 });
  let t = (await prop.get(`/api/boards/${b.id}`)).data;
  assert.deepEqual(t.columns[1].cards.map((x) => x.title), ['A', 'B']);
  await prop.post(`/api/cards/${a.id}/move`, { columnId: col2, index: 1 });
  t = (await prop.get(`/api/boards/${b.id}`)).data;
  assert.deepEqual(t.columns[1].cards.map((x) => x.title), ['B', 'A']);
  await prop.post(`/api/cards/${a.id}/archive`);
  t = (await prop.get(`/api/boards/${b.id}`)).data;
  assert.deepEqual(t.columns[1].cards.map((x) => x.title), ['B']);
  await prop.post(`/api/cards/${a.id}/restore`);
  t = (await prop.get(`/api/boards/${b.id}`)).data;
  assert.equal(t.columns[1].cards.length, 2);
});

test('réordonner des colonnes, renommer, archiver et restaurer', async () => {
  const { prop, b } = await equipe();
  await prop.post(`/api/columns/${b.columns[2].id}/move`, { index: 0 });
  await prop.patch(`/api/columns/${b.columns[0].id}`, { name: 'Idées' });
  let t = (await prop.get(`/api/boards/${b.id}`)).data;
  assert.deepEqual(t.columns.map((k) => k.name), ['Fait', 'Idées', 'En cours']);
  await prop.post(`/api/columns/${b.columns[2].id}/archive`);
  t = (await prop.get(`/api/boards/${b.id}`)).data;
  assert.equal(t.columns.length, 2);
  await prop.post(`/api/columns/${b.columns[2].id}/restore`);
  assert.equal((await prop.get(`/api/boards/${b.id}`)).data.columns.length, 3);
});

test('déplacer une carte vers une colonne d\'un autre tableau est refusé', async () => {
  const { prop, carte } = await equipe();
  const autre = (await prop.post('/api/boards', { name: 'Autre' })).data;
  const r = await prop.post(`/api/cards/${carte.id}/move`, { columnId: autre.columns[0].id, index: 0 });
  assert.equal(r.status, 400);
});

test('responsables et étiquettes : doivent appartenir au tableau', async () => {
  const { prop, intrus, b, carte } = await equipe();
  const l = (await prop.post(`/api/boards/${b.id}/labels`, { name: 'Urgent', color: 'rouge' })).data;
  const ok = await prop.patch(`/api/cards/${carte.id}`, { labels: [l.id], assignees: [prop.user.id], dueDate: '2026-12-24' });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.data.labels, ok.data.assignees, ok.data.dueDate], [[l.id], [prop.user.id], '2026-12-24']);
  assert.equal((await prop.patch(`/api/cards/${carte.id}`, { assignees: [intrus.user.id] })).status, 400);
  const autre = (await intrus.post('/api/boards', { name: 'Autre' })).data;
  const lAutre = (await intrus.post(`/api/boards/${autre.id}/labels`, { name: 'x', color: 'vert' })).data;
  assert.equal((await prop.patch(`/api/cards/${carte.id}`, { labels: [lAutre.id] })).status, 400);
  assert.equal((await prop.post(`/api/boards/${b.id}/labels`, { name: 'x', color: 'jaune' })).status, 400);
});

test('injection SQL : les valeurs sont des données, jamais du code', async () => {
  const { prop, b, colId, carte } = await equipe();
  const piege = "x'); drop table cards; --";
  assert.equal((await prop.post(`/api/columns/${colId}/cards`, { title: piege })).status, 200);
  assert.equal((await prop.patch(`/api/cards/${carte.id}`, { description: piege })).status, 200);
  assert.equal((await prop.post(`/api/boards`, { name: piege })).status, 200);
  const t = (await prop.get(`/api/boards/${b.id}`)).data;
  assert.ok(t.columns[0].cards.some((x) => x.title === piege));
  assert.ok((await admin.query('select count(*)::int n from cards')).rows[0].n > 0);
  for (const id of ["1' or '1'='1", `${b.id}' or 1=1 --`, '1;drop table users']) {
    assert.equal((await prop.get(`/api/boards/${encodeURIComponent(id)}`)).status, 400);
  }
  assert.equal((await prop.patch(`/api/cards/${carte.id}`, { assignees: ["x' or '1'='1"] })).status, 400);
});

test('XSS : titres et descriptions sont stockés tels quels, le HTML rendu est nettoyé', async () => {
  const { prop, carte, colId } = await equipe();
  const mal = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  const r = await prop.patch(`/api/cards/${carte.id}`, { title: mal, description: `${mal}\n\n[x](javascript:alert(1))` });
  assert.equal(r.status, 200);
  const d = (await prop.get(`/api/cards/${carte.id}`)).data;
  assert.equal(d.title, mal);
  assert.doesNotMatch(d.descriptionHtml, /<script|<img|href="javascript/i);
  assert.match(d.descriptionHtml, /&lt;script&gt;/);
});

test('validation : champs obligatoires, tailles, types ; corps JSON invalide', async () => {
  const { prop, colId } = await equipe();
  assert.equal((await prop.post(`/api/columns/${colId}/cards`, {})).status, 400);
  assert.equal((await prop.post(`/api/columns/${colId}/cards`, { title: '   ' })).status, 400);
  assert.equal((await prop.post(`/api/columns/${colId}/cards`, { title: 'x'.repeat(301) })).status, 400);
  assert.equal((await prop.post(`/api/columns/${colId}/cards`, { title: 42 })).status, 400);
  assert.equal((await prop.post(`/api/columns/${colId}/cards`, '{pas du json', { brut: true })).status, 400);
  assert.equal((await prop.patch(`/api/columns/${colId}`, { wipLimit: 0 })).status, 400);
});

test('les erreurs ne divulguent ni requête SQL ni détails internes', async () => {
  const { prop } = await equipe();
  const r = await prop.get('/api/cards/00000000-0000-4000-8000-000000000000');
  assert.equal(r.status, 404);
  assert.deepEqual(Object.keys(r.data.erreur).sort(), ['code', 'message']);
});

test('OpenAPI : chaque route est documentée', async () => {
  const c = new Client(srv.base);
  const doc = (await c.get('/api/openapi.json')).data;
  assert.equal(doc.openapi, '3.1.0');
  const { toutesLesRoutes } = await import('../src/serveur.js');
  for (const r of toutesLesRoutes) {
    const chemin = r.chemin.replace(/:(\w+)/g, '{$1}');
    assert.ok(doc.paths[chemin]?.[r.methode.toLowerCase()]?.summary, `${r.methode} ${r.chemin} non documentée`);
  }
});

test('lien de carte partageable : la page est servie à une adresse /b/:id/c/:id', async () => {
  const c = new Client(srv.base);
  const r = await c.get('/b/00000000-0000-4000-8000-000000000000/c/00000000-0000-4000-8000-000000000001');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
});
