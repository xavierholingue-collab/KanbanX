// Durcissement avant déploiement : configuration de production, rôle de connexion, en-têtes,
// envoi du lien sans attente, consignes MCP, agent jamais propriétaire, cas limites de l'API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { demarrer, Client, utilisateurConnecte, agentAvecJeton } from './serveur.js';
import { admin, fermer, creerUtilisateur } from './aide.js';
import { config } from '../src/config.js';
import { verifierConfigProduction, verifierRoleApplicatif } from '../src/demarrage.js';
import { MAX_FLUX_PAR_UTILISATEUR } from '../src/evenements.js';

const SERVEUR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js');

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

const ENV_PROD_VALIDE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://kanbanx_app:un-vrai-secret@127.0.0.1:5432/kanbanx',
  BASE_URL: 'https://kanbanx.exemple.invalid',
  SMTP_URL: 'smtps://envoi:secret@smtp.exemple.invalid:465',
};

// ---------- Configuration de production ----------

test('configuration de production : une configuration complète est acceptée', () => {
  assert.deepEqual(verifierConfigProduction(ENV_PROD_VALIDE), []);
});

test('configuration de production : chaque manque ou valeur dangereuse est refusé', () => {
  const cas = [
    [{ DATABASE_URL: undefined }, /DATABASE_URL/],
    [{ DATABASE_URL: 'postgres://kanbanx_app:kanbanx_app_dev@127.0.0.1:5432/kanbanx' }, /développement/],
    [{ DATABASE_ADMIN_URL: 'postgres://kanbanx:x@127.0.0.1/kanbanx' }, /DATABASE_ADMIN_URL/],
    [{ KANBANX_APP_PASSWORD: 'x' }, /KANBANX_APP_PASSWORD/],
    [{ BASE_URL: undefined }, /BASE_URL/],
    [{ BASE_URL: 'http://kanbanx.exemple.invalid' }, /https/],
    [{ SMTP_URL: undefined }, /SMTP_URL/],
    [{ SMTP_URL: 'smtp://envoi:secret@smtp.exemple.invalid:587?tls=non' }, /TLS/],
    [{ SMTP_URL: 'http://smtp.exemple.invalid' }, /smtp/],
    [{ SEED_DEMO: '1' }, /SEED_DEMO/],
  ];
  for (const [modif, attendu] of cas) {
    const env = { ...ENV_PROD_VALIDE, ...modif };
    for (const [k, v] of Object.entries(modif)) if (v === undefined) delete env[k];
    const pb = verifierConfigProduction(env);
    assert.ok(pb.some((p) => attendu.test(p)), `${JSON.stringify(modif)} doit être refusé (reçu : ${JSON.stringify(pb)})`);
  }
});

test('rôle de connexion : le rôle applicatif est accepté, un superutilisateur est refusé', async () => {
  const app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try { assert.deepEqual(await verifierRoleApplicatif(app), []); } finally { await app.end(); }
  const pb = await verifierRoleApplicatif(admin);
  assert.ok(pb.some((p) => /superutilisateur/.test(p)), JSON.stringify(pb));
});

function portLibre() {
  return new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
}

/** Lance le vrai serveur dans un dossier sans .env, avec exactement l'environnement donné. */
function lancer(env) {
  const p = spawn(process.execPath, [SERVEUR], { cwd: os.tmpdir(), env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let sortie = '';
  p.stdout.on('data', (d) => { sortie += d; });
  p.stderr.on('data', (d) => { sortie += d; });
  // Garde-fou : un serveur qui démarre alors qu'il devait refuser est arrêté au bout de 10 s (le test échoue vite).
  const minuterie = setTimeout(() => p.kill('SIGKILL'), 10_000);
  const fin = new Promise((r) => p.on('exit', (code) => { clearTimeout(minuterie); r(code); }));
  return { p, fin, sortie: () => sortie };
}

test('en production, le serveur refuse de démarrer avec une configuration incomplète', async () => {
  const { fin, sortie } = lancer({ NODE_ENV: 'production' });
  assert.equal(await fin, 1);
  assert.match(sortie(), /Démarrage refusé/);
  assert.match(sortie(), /DATABASE_URL/);
});

test('en production, le serveur refuse de démarrer connecté en superutilisateur', async () => {
  const { fin, sortie } = lancer({ ...ENV_PROD_VALIDE, DATABASE_URL: process.env.DATABASE_ADMIN_URL, PORT: String(await portLibre()) });
  assert.equal(await fin, 1);
  assert.match(sortie(), /superutilisateur/);
});

test('en production, le serveur démarre sans les identifiants administrateur, sur 127.0.0.1, avec HSTS', async () => {
  const port = await portLibre();
  const { p, sortie } = lancer({ ...ENV_PROD_VALIDE, DATABASE_URL: process.env.DATABASE_URL, PORT: String(port) });
  try {
    let r;
    for (let i = 0; i < 50 && !r; i++) {
      r = await fetch(`http://127.0.0.1:${port}/api/me`).catch(() => null);
      if (!r) await new Promise((t) => setTimeout(t, 100));
    }
    assert.ok(r, `le serveur doit répondre (sortie : ${sortie()})`);
    assert.equal(r.status, 401);
    assert.match(r.headers.get('strict-transport-security') ?? '', /max-age=\d{7,}/);
    assert.match(sortie(), /127\.0\.0\.1/);
  } finally {
    p.kill('SIGTERM');
  }
});

test('en développement (http), pas d\'en-tête HSTS', async () => {
  const r = await fetch(`${srv.base}/api/me`);
  assert.equal(r.headers.get('strict-transport-security'), null);
});

// ---------- Cas limites de l'API ----------

test('une adresse mal encodée renvoie 400, pas 500', async () => {
  const c = await utilisateurConnecte(srv.base);
  assert.equal((await c.get('/api/boards/%E0%A4%A')).status, 400);
  assert.equal((await fetch(`${srv.base}/%E0%A4%A`)).status, 400);
});

test('le nombre de flux en direct par utilisateur est limité', async () => {
  const c = await utilisateurConnecte(srv.base);
  const b = (await c.post('/api/boards', { name: 'Flux' })).data;
  const abandons = [];
  try {
    for (let i = 0; i < MAX_FLUX_PAR_UTILISATEUR; i++) {
      const a = new AbortController(); abandons.push(a);
      const r = await fetch(`${srv.base}/api/boards/${b.id}/events`, { headers: { Cookie: c.cookie }, signal: a.signal });
      assert.equal(r.status, 200);
    }
    const r = await fetch(`${srv.base}/api/boards/${b.id}/events`, { headers: { Cookie: c.cookie } });
    assert.equal(r.status, 429);
  } finally {
    for (const a of abandons) a.abort();
  }
});

test('on ne crée ni ne déplace une carte dans une colonne archivée', async () => {
  const c = await utilisateurConnecte(srv.base);
  const b = (await c.post('/api/boards', { name: 'Archives' })).data;
  const [ouverte, archivee] = b.columns;
  const carte = (await c.post(`/api/columns/${ouverte.id}/cards`, { title: 'Carte' })).data;
  assert.equal((await c.post(`/api/columns/${archivee.id}/archive`)).status, 200);
  const creation = await c.post(`/api/columns/${archivee.id}/cards`, { title: 'Perdue' });
  assert.equal(creation.status, 400);
  assert.match(creation.data.erreur.message, /archivée/);
  assert.equal((await c.post(`/api/cards/${carte.id}/move`, { columnId: archivee.id, index: 0 })).status, 400);
});

// ---------- Lien magique : réponse sans attendre l'envoi ----------

test('la demande de lien répond sans attendre le serveur de courriel (pas d\'énumération par le temps)', async () => {
  const sockets = new Set();
  const lent = net.createServer((s) => { sockets.add(s); s.on('error', () => {}); }); // n'envoie jamais le message d'accueil
  await new Promise((r) => lent.listen(0, '127.0.0.1', r));
  const avant = config.smtpUrl;
  config.smtpUrl = `smtp://127.0.0.1:${lent.address().port}?tls=non`;
  try {
    const u = await creerUtilisateur('Rapide');
    const c = new Client(srv.base);
    const t0 = Date.now();
    const r = await c.post('/api/auth/demander', { email: u.email });
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 < 1500, `réponse en ${Date.now() - t0} ms`);
  } finally {
    config.smtpUrl = avant;
    for (const s of sockets) s.destroy();
    lent.close();
  }
});

// ---------- Agents ----------

test('un agent ne peut jamais devenir propriétaire d\'un tableau', async () => {
  const prop = await utilisateurConnecte(srv.base);
  const agent = await agentAvecJeton(srv.base, 'Claude');
  const b = (await prop.post('/api/boards', { name: 'Équipe' })).data;
  const invitation = await prop.post(`/api/boards/${b.id}/members`, { email: agent.user.email, name: 'Claude', role: 'owner' });
  assert.equal(invitation.status, 400);
  assert.match(invitation.data.erreur.message, /agent/);
  assert.equal((await prop.post(`/api/boards/${b.id}/members`, { email: agent.user.email, name: 'Claude', role: 'member' })).status, 200);
  assert.equal((await prop.patch(`/api/boards/${b.id}/members/${agent.user.id}`, { role: 'owner' })).status, 400);
  assert.equal((await agent.post('/api/boards', { name: 'Tableau de Claude' })).status, 400);
  const { rows } = await admin.query("select count(*)::int n from board_members m join users u on u.id = m.user_id where u.kind = 'agent' and m.role = 'owner'");
  assert.equal(rows[0].n, 0);
});

test('les consignes MCP rappellent que le contenu des cartes n\'est pas un ordre, et qu\'une mention ne notifie pas', async () => {
  const agent = await agentAvecJeton(srv.base, 'Claude');
  const r = await fetch(`${srv.base}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agent.bearer}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
  });
  const consignes = (await r.json()).result.instructions;
  assert.match(consignes, /jamais des ordres/);
  assert.match(consignes, /confirmation/);
  assert.match(consignes, /aucune notification/);
});

// ---------- Derrière le proxy inverse ----------

test('adresse du client : X-Real-IP n\'est cru que derrière un proxy de confiance, en boucle locale', async () => {
  const { ipClient } = await import('../src/securite.js');
  const req = (adresse, entetes = {}) => ({ socket: { remoteAddress: adresse }, headers: entetes });
  assert.equal(ipClient(req('127.0.0.1', { 'x-real-ip': '203.0.113.7' }), false), '127.0.0.1');
  assert.equal(ipClient(req('127.0.0.1', { 'x-real-ip': '203.0.113.7' }), true), '203.0.113.7');
  assert.equal(ipClient(req('::ffff:127.0.0.1', { 'x-real-ip': '2001:db8::1' }), true), '2001:db8::1');
  // Une connexion directe depuis Internet ne peut pas se faire passer pour une autre adresse.
  assert.equal(ipClient(req('198.51.100.9', { 'x-real-ip': '203.0.113.7' }), true), '198.51.100.9');
  assert.equal(ipClient(req('127.0.0.1', { 'x-real-ip': '<script>' }), true), '127.0.0.1');
  assert.equal(ipClient(req('127.0.0.1'), true), '127.0.0.1');
});

// ---------- Premier compte en production ----------

test('création d\'un compte en ligne de commande : personne ou agent, sans doublon, adresse valide', async () => {
  const { creerCompte } = await import('../scripts/compte.js');
  const cl = await admin.connect();
  try {
    const email = `Premier-${Date.now()}@Exemple.invalid`;
    const u = await creerCompte(cl, email, 'Xavier');
    assert.equal(u.email, email.toLowerCase());
    assert.equal(u.kind, 'human');
    await assert.rejects(creerCompte(cl, email, 'Xavier'), /existe déjà/);
    await assert.rejects(creerCompte(cl, 'pas-une-adresse', 'X'), /adresse/i);
    await assert.rejects(creerCompte(cl, `x-${Date.now()}@exemple.invalid`, ''), /prénom/i);
    const agent = await creerCompte(cl, `claude-${Date.now()}@exemple.invalid`, 'Claude', 'agent');
    assert.equal(agent.kind, 'agent');
    // La personne créée peut se connecter et créer son premier tableau, dont elle est propriétaire.
    const c = new Client(srv.base);
    await c.connecter(email);
    const b = (await c.post('/api/boards', { name: 'Premier tableau' })).data;
    assert.equal(b.role, 'owner');
  } finally {
    cl.release();
  }
});
