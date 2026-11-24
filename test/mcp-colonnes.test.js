// Nuit 2, point 4 : outils MCP creer_colonne, renommer_colonne, deplacer_colonne, avec les droits de l'interface.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, utilisateurConnecte } from './serveur.js';
import { fermer } from './aide.js';
import { mcp, outil, claudePour } from './mcp-aide.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

async function scene(role = 'member') {
  const xavier = await utilisateurConnecte(srv.base, 'Xavier');
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const b = (await xavier.post('/api/boards', { name: 'Structure' })).data;
  await xavier.post(`/api/boards/${b.id}/members`, { email: eric.user.email, name: 'Eric', role });
  return { xavier, eric, b, pourEric: await claudePour(srv.base, eric) };
}
const noms = async (qui, b) => (await qui.get(`/api/boards/${b.id}`)).data.columns.map((k) => k.name);

test('les trois outils sont annoncés, et ne sont pas en lecture seule', async () => {
  const { pourEric } = await scene();
  const outils = (await mcp(srv.base, pourEric, 'tools/list')).data.result.tools;
  for (const n of ['creer_colonne', 'renommer_colonne', 'deplacer_colonne']) {
    const o = outils.find((x) => x.name === n);
    assert.ok(o, n);
    assert.equal(o.annotations.readOnlyHint, false, n);
  }
  assert.deepEqual(outils.find((x) => x.name === 'creer_colonne').inputSchema.required.sort(), ['nom', 'tableau_id']);
});

test('créer (à la fin ou à une position), renommer, déplacer : signé « Claude pour Eric »', async () => {
  const { xavier, b, pourEric } = await scene();
  const fin = await outil(srv.base, pourEric, 'creer_colonne', { tableau_id: b.id, nom: 'Bloqué' });
  assert.equal(fin.erreur, false, fin.texte);
  assert.deepEqual(await noms(xavier, b), ['À faire', 'En cours', 'Fait', 'Bloqué']);
  const tete = await outil(srv.base, pourEric, 'creer_colonne', { tableau_id: b.id, nom: 'Idées', position: 0 });
  assert.equal(tete.erreur, false, tete.texte);
  assert.deepEqual(await noms(xavier, b), ['Idées', 'À faire', 'En cours', 'Fait', 'Bloqué']);
  const ren = await outil(srv.base, pourEric, 'renommer_colonne', { colonne_id: fin.data.id, nom: 'En attente' });
  assert.equal(ren.erreur, false, ren.texte);
  const dep = await outil(srv.base, pourEric, 'deplacer_colonne', { colonne_id: fin.data.id, position: 2 });
  assert.equal(dep.erreur, false, dep.texte);
  assert.deepEqual(await noms(xavier, b), ['Idées', 'À faire', 'En attente', 'En cours', 'Fait']);
  const act = (await xavier.get(`/api/boards/${b.id}/activity`)).data;
  assert.deepEqual(act.slice(0, 3).map((a) => [a.action, a.actor.name, a.client, a.via]),
    [['colonne.deplacee', 'Eric', 'Claude', 'mcp'], ['colonne.renommee', 'Eric', 'Claude', 'mcp'], ['colonne.creee', 'Eric', 'Claude', 'mcp']]);
});

test('un lecteur ne peut rien changer à la structure, même par son Claude', async () => {
  const { xavier, b, pourEric } = await scene('reader');
  const col = b.columns[0].id;
  for (const [n, a] of [['creer_colonne', { tableau_id: b.id, nom: 'X' }], ['renommer_colonne', { colonne_id: col, nom: 'X' }],
    ['deplacer_colonne', { colonne_id: col, position: 2 }]]) {
    const r = await outil(srv.base, pourEric, n, a);
    assert.equal(r.erreur, true, n);
    assert.match(r.texte, /lecture seule/i, n);
  }
  assert.deepEqual(await noms(xavier, b), ['À faire', 'En cours', 'Fait']);
});

test('un tableau dont on n\'est pas membre : « introuvable »', async () => {
  const { b } = await scene();
  const alexis = await utilisateurConnecte(srv.base, 'Alexis');
  const pourAlexis = await claudePour(srv.base, alexis);
  for (const [n, a] of [['creer_colonne', { tableau_id: b.id, nom: 'X' }], ['renommer_colonne', { colonne_id: b.columns[0].id, nom: 'X' }],
    ['deplacer_colonne', { colonne_id: b.columns[0].id, position: 0 }]]) {
    const r = await outil(srv.base, pourAlexis, n, a);
    assert.equal(r.erreur, true, n);
    assert.match(r.texte, /introuvable/i, n);
  }
});

test('instructions MCP : proposer en commentaire avant de changer la structure d\'un tableau', async () => {
  const { pourEric } = await scene();
  const ins = (await mcp(srv.base, pourEric, 'initialize', { protocolVersion: '2025-11-25' })).data.result.instructions;
  assert.match(ins, /avant de changer la structure d'un tableau \(colonnes\), propose-le en commentaire/i);
});
