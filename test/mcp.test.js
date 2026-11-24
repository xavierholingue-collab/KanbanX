// P3 : serveur MCP (Streamable HTTP, JSON-RPC 2.0) et routes REST associées.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, utilisateurConnecte, agentAvecJeton } from './serveur.js';
import { fermer } from './aide.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

let n = 0;
async function mcp(client, method, params, { entetes = {}, id = ++n } = {}) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', ...entetes };
  if (client?.bearer) h.Authorization = `Bearer ${client.bearer}`;
  if (client?.cookie) h.Cookie = client.cookie;
  const r = await fetch(`${srv.base}/mcp`, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }) });
  const t = await r.text();
  return { status: r.status, headers: r.headers, data: t ? JSON.parse(t) : null };
}
const outil = async (client, name, args = {}) => {
  const r = await mcp(client, 'tools/call', { name, arguments: args });
  const res = r.data.result;
  return { erreur: !!res.isError, texte: res.content[0].text, data: res.structuredContent };
};

async function scene() {
  const xavier = await utilisateurConnecte(srv.base, 'Xavier');
  const claude = await agentAvecJeton(srv.base, 'Claude');
  const b = (await xavier.post('/api/boards', { name: 'Avec Claude' })).data;
  await xavier.post(`/api/boards/${b.id}/members`, { email: claude.user.email, name: 'Claude', role: 'member' });
  const carte = (await xavier.post(`/api/columns/${b.columns[0].id}/cards`, { title: 'Analyse' })).data;
  return { xavier, claude, b, carte };
}

test('sans jeton : 401 avec WWW-Authenticate ; un cookie de session ne suffit pas', async () => {
  const r = await mcp(null, 'initialize', {});
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') ?? '', /Bearer/);
  const humain = await utilisateurConnecte(srv.base, 'Humain');
  assert.equal((await mcp({ cookie: humain.cookie }, 'tools/list', {})).status, 401);
});

test('origine étrangère refusée (protection contre le DNS rebinding)', async () => {
  const { claude } = await scene();
  assert.equal((await mcp(claude, 'tools/list', {}, { entetes: { Origin: 'https://pirate.example' } })).status, 403);
});

test('initialize, notifications et liste des outils', async () => {
  const { claude } = await scene();
  const init = await mcp(claude, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200);
  assert.equal(init.data.result.protocolVersion, '2025-06-18');
  assert.ok(init.data.result.capabilities.tools);
  assert.equal(init.data.result.serverInfo.name, 'kanbanx');
  assert.equal((await mcp(claude, 'notifications/initialized', undefined, { id: null })).status, 202);
  const outils = (await mcp(claude, 'tools/list', {})).data.result.tools.map((t) => t.name).sort();
  assert.deepEqual(outils, ['ajouter_commentaire', 'creer_carte', 'deplacer_carte', 'lire_carte', 'lire_commentaires_recents', 'lire_mentions', 'lire_tableau', 'lister_tableaux', 'modifier_carte']);
  assert.equal((await mcp(claude, 'methode/inconnue', {})).data.error.code, -32601);
  const get = await fetch(`${srv.base}/mcp`, { headers: { Authorization: `Bearer ${claude.bearer}` } });
  assert.equal(get.status, 405);
});

test('outils : lister, lire, créer, modifier, déplacer, commenter — signés Claude via MCP', async () => {
  const { xavier, claude, b, carte } = await scene();
  const liste = await outil(claude, 'lister_tableaux');
  assert.ok(liste.data.tableaux.some((t) => t.id === b.id));
  const lu = await outil(claude, 'lire_tableau', { tableau_id: b.id });
  assert.deepEqual(lu.data.colonnes.map((k) => k.nom), ['À faire', 'En cours', 'Fait']);
  assert.match(lu.texte, /Analyse/);
  const cree = await outil(claude, 'creer_carte', { colonne_id: b.columns[1].id, titre: 'Proposée par Claude', description: 'Avec **Markdown**' });
  assert.equal(cree.erreur, false);
  const mod = await outil(claude, 'modifier_carte', { carte_id: cree.data.id, echeance: '2026-12-01', responsables: [xavier.user.id] });
  assert.equal(mod.erreur, false);
  const dep = await outil(claude, 'deplacer_carte', { carte_id: carte.id, colonne_id: b.columns[2].id });
  assert.equal(dep.erreur, false);
  const com = await outil(claude, 'ajouter_commentaire', { carte_id: carte.id, texte: 'Terminé, @Xavier.' });
  assert.equal(com.erreur, false);
  const hist = (await xavier.get(`/api/cards/${carte.id}/activity`)).data;
  assert.deepEqual(hist.slice(0, 2).map((a) => [a.action, a.actor.name, a.via]), [['commentaire.ajoute', 'Claude', 'mcp'], ['carte.deplacee', 'Claude', 'mcp']]);
  const t = (await xavier.get(`/api/boards/${b.id}`)).data;
  assert.deepEqual(t.columns[2].cards.map((c) => c.title), ['Analyse']);
  assert.equal(t.columns[1].cards[0].dueDate, '2026-12-01');
});

test('mentions et commentaires récents qui concernent Claude', async () => {
  const { xavier, claude, carte } = await scene();
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Claude peux-tu analyser ?' });
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: 'Note sans mention' });
  const m = await outil(claude, 'lire_mentions');
  assert.equal(m.data.mentions.length >= 1, true);
  assert.equal(m.data.mentions[0].texte, '@Claude peux-tu analyser ?');
  assert.equal(m.data.mentions[0].carte.titre, 'Analyse');
  assert.equal(m.data.mentions[0].auteur, 'Xavier');
  const r = await outil(claude, 'lire_commentaires_recents', { limite: 10 });
  assert.ok(r.data.commentaires.some((c) => c.texte === 'Note sans mention'));
  // REST équivalent
  const rest = await claude.get('/api/mentions');
  assert.equal(rest.status, 200);
  assert.equal(rest.data[0].body, '@Claude peux-tu analyser ?');
});

test('isolement via MCP : rien d\'un tableau où Claude n\'est pas invité', async () => {
  const { claude } = await scene();
  const autre = await utilisateurConnecte(srv.base, 'Autre');
  const b2 = (await autre.post('/api/boards', { name: 'Secret' })).data;
  const c2 = (await autre.post(`/api/columns/${b2.columns[0].id}/cards`, { title: 'Confidentiel' })).data;
  await autre.post(`/api/cards/${c2.id}/comments`, { body: '@Claude secret' });
  assert.ok(!(await outil(claude, 'lister_tableaux')).data.tableaux.some((t) => t.id === b2.id));
  for (const [nom, args] of [['lire_tableau', { tableau_id: b2.id }], ['creer_carte', { colonne_id: b2.columns[0].id, titre: 'x' }],
    ['modifier_carte', { carte_id: c2.id, titre: 'x' }], ['deplacer_carte', { carte_id: c2.id, colonne_id: b2.columns[1].id }],
    ['ajouter_commentaire', { carte_id: c2.id, texte: 'x' }]]) {
    const r = await outil(claude, nom, args);
    assert.equal(r.erreur, true, nom);
    assert.match(r.texte, /introuvable/i, nom);
  }
  assert.ok(!(await outil(claude, 'lire_mentions')).data.mentions.some((m) => m.texte === '@Claude secret'));
});

test('un agent lecteur ne peut rien écrire via MCP', async () => {
  const { xavier, b, carte } = await scene();
  const lecteur = await agentAvecJeton(srv.base, 'Robot');
  await xavier.post(`/api/boards/${b.id}/members`, { email: lecteur.user.email, name: 'Robot', role: 'reader' });
  assert.equal((await outil(lecteur, 'lire_tableau', { tableau_id: b.id })).erreur, false);
  const r = await outil(lecteur, 'ajouter_commentaire', { carte_id: carte.id, texte: 'x' });
  assert.equal(r.erreur, true);
  assert.match(r.texte, /lecture seule/i);
});

test('arguments invalides : erreur claire, pas d\'exception', async () => {
  const { claude } = await scene();
  const r = await outil(claude, 'creer_carte', { colonne_id: "x' or 1=1 --", titre: 'x' });
  assert.equal(r.erreur, true);
  const r2 = await mcp(claude, 'tools/call', { name: 'outil_inconnu', arguments: {} });
  assert.ok(r2.data.error || r2.data.result.isError);
  const brut = await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${claude.bearer}`, 'Content-Type': 'application/json' }, body: '{pas du json' });
  assert.equal((await brut.json()).error.code, -32700);
});

test('API REST : documentation OpenAPI servie et lisible', async () => {
  const r = await fetch(`${srv.base}/api/openapi.json`);
  const doc = await r.json();
  assert.ok(doc.paths['/api/mentions']);
  assert.ok(doc.paths['/api/comments/recent']);
  const page = await fetch(`${srv.base}/api/docs`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
});
