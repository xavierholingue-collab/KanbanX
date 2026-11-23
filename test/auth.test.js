import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, Client, utilisateurConnecte, agentAvecJeton } from './serveur.js';
import { creerUtilisateur, admin, fermer } from './aide.js';
import { boiteDev } from '../src/courriel.js';
import { reinitialiserLimites } from '../src/securite.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

test('connexion par lien magique : cookie HttpOnly, Secure, SameSite=Lax, __Host-', async () => {
  const u = await creerUtilisateur('Lien');
  const c = new Client(srv.base);
  boiteDev.length = 0;
  assert.equal((await c.post('/api/auth/demander', { email: u.email })).status, 200);
  const jeton = new URL(boiteDev.at(-1).lien).searchParams.get('token');
  const r = await c.post('/api/auth/verifier', { token: jeton });
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /^__Host-kx=/);
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(sc.includes(attr), attr);
  assert.doesNotMatch(sc, /Domain=/i);
  assert.equal((await c.get('/api/me')).data.user.id, u.id);
});

test('inscription publique impossible : une adresse inconnue ne reçoit aucun lien, et la réponse est identique', async () => {
  const c = new Client(srv.base);
  boiteDev.length = 0;
  const r = await c.post('/api/auth/demander', { email: 'inconnu@exemple.invalid' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
  assert.equal(boiteDev.length, 0);
  const u = await creerUtilisateur('Connu');
  const r2 = await c.post('/api/auth/demander', { email: u.email });
  assert.deepEqual(r2.data, r.data);
});

test('un compte agent ne peut pas se connecter par lien magique', async () => {
  const a = await creerUtilisateur('Robot', 'agent');
  boiteDev.length = 0;
  await new Client(srv.base).post('/api/auth/demander', { email: a.email });
  assert.equal(boiteDev.length, 0);
});

test('le lien magique est à usage unique et expire', async () => {
  const u = await creerUtilisateur('Unique');
  const c = new Client(srv.base);
  boiteDev.length = 0;
  await c.post('/api/auth/demander', { email: u.email });
  const jeton = new URL(boiteDev.at(-1).lien).searchParams.get('token');
  assert.equal((await c.post('/api/auth/verifier', { token: jeton })).status, 200);
  assert.equal((await new Client(srv.base).post('/api/auth/verifier', { token: jeton })).status, 401);
  await c.post('/api/auth/demander', { email: u.email });
  const j2 = new URL(boiteDev.at(-1).lien).searchParams.get('token');
  await admin.query("update magic_links set expires_at = now() - interval '1 minute' where user_id = $1", [u.id]);
  assert.equal((await new Client(srv.base).post('/api/auth/verifier', { token: j2 })).status, 401);
});

test('les jetons ne sont jamais stockés en clair (liens, sessions, API)', async () => {
  const u = await creerUtilisateur('Hache');
  const c = new Client(srv.base);
  boiteDev.length = 0;
  await c.post('/api/auth/demander', { email: u.email });
  const jeton = new URL(boiteDev.at(-1).lien).searchParams.get('token');
  await c.post('/api/auth/verifier', { token: jeton });
  const a = await agentAvecJeton(srv.base);
  const cookie = c.cookie.split('=')[1];
  const tout = JSON.stringify([
    (await admin.query('select * from magic_links')).rows, (await admin.query('select * from sessions')).rows, (await admin.query('select * from api_tokens')).rows,
  ].map((rows) => rows.map((r) => ({ ...r, token_hash: r.token_hash.toString('hex') }))));
  for (const secret of [jeton, cookie, a.bearer]) assert.ok(!tout.includes(secret));
});

test('CSRF : une écriture par cookie sans jeton CSRF est refusée', async () => {
  const c = await utilisateurConnecte(srv.base);
  assert.equal((await c.post('/api/boards', { name: 'X' }, { csrf: false })).status, 403);
  assert.equal((await c.post('/api/boards', { name: 'X' }, { entetes: { 'X-CSRF-Token': 'faux' }, csrf: false })).status, 403);
  assert.equal((await c.post('/api/boards', { name: 'X' })).status, 200);
});

test('CSRF : une origine étrangère est refusée même avec le bon jeton', async () => {
  const c = await utilisateurConnecte(srv.base);
  const r = await c.post('/api/boards', { name: 'X' }, { entetes: { Origin: 'https://pirate.example' } });
  assert.equal(r.status, 403);
});

test('une écriture exige Content-Type: application/json (pas de formulaire inter-sites)', async () => {
  const c = await utilisateurConnecte(srv.base);
  const r = await c.post('/api/boards', 'name=X', { entetes: { 'Content-Type': 'application/x-www-form-urlencoded' }, brut: true });
  assert.equal(r.status, 415);
});

test('sans authentification : 401 ; jeton Bearer invalide : 401', async () => {
  const c = new Client(srv.base);
  assert.equal((await c.get('/api/boards')).status, 401);
  c.bearer = 'kbx_' + 'a'.repeat(43);
  assert.equal((await c.get('/api/boards')).status, 401);
});

test('un jeton d\'API fonctionne sans CSRF ; révoqué, il cesse de fonctionner', async () => {
  const a = await agentAvecJeton(srv.base);
  assert.equal((await a.get('/api/boards')).status, 200);
  assert.equal((await a.post('/api/boards', { name: 'Tableau de Claude' })).status, 200);
  await admin.query('update api_tokens set revoked_at = now() where user_id = $1', [a.user.id]);
  assert.equal((await a.get('/api/boards')).status, 401);
});

test('déconnexion : la session est détruite côté serveur', async () => {
  const c = await utilisateurConnecte(srv.base);
  const cookie = c.cookie;
  assert.equal((await c.post('/api/auth/deconnexion')).status, 200);
  const c2 = new Client(srv.base); c2.cookie = cookie;
  assert.equal((await c2.get('/api/me')).status, 401);
});

test('limitation de débit de la connexion : 429 avec Retry-After', async () => {
  reinitialiserLimites();
  const c = new Client(srv.base);
  let dernier;
  for (let i = 0; i < 7; i++) dernier = await c.post('/api/auth/demander', { email: 'rafale@exemple.invalid' });
  assert.equal(dernier.status, 429);
  assert.ok(Number(dernier.headers.get('retry-after')) > 0);
  reinitialiserLimites();
});

test('en-têtes de sécurité et CSP stricte, sur l\'API comme sur les pages', async () => {
  const c = new Client(srv.base);
  for (const chemin of ['/api/me', '/', '/b/abc']) {
    const r = await c.get(chemin);
    const csp = r.headers.get('content-security-policy');
    assert.ok(csp && /script-src 'self'/.test(csp), chemin);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  }
});

test('injection SQL à la connexion : traitée comme une simple adresse inconnue', async () => {
  const c = new Client(srv.base);
  for (const email of ["x@y.fr' or '1'='1", "a@b.fr'; drop table users; --"]) {
    const r = await c.post('/api/auth/demander', { email });
    assert.ok([200, 400].includes(r.status));
  }
  assert.ok((await admin.query('select count(*)::int n from users')).rows[0].n > 0);
});

test('l\'application ne peut pas servir de fichier hors de public/ (traversée de chemin)', async () => {
  const c = new Client(srv.base);
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2f..%2fetc/passwd', '/css/../../package.json']) {
    const r = await c.get(p);
    assert.doesNotMatch(String(typeof r.data === 'string' ? r.data : JSON.stringify(r.data)), /"name": "kanbanx"|root:/, p);
  }
});
