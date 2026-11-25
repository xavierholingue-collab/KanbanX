// « Continuer avec Google » (OpenID Connect), contre un faux Google local : aucun appel au vrai Google.
// Règles (demande de Xavier du 25/11) :
// - réservé aux personnes invitées : Google n'ouvre qu'un compte KanbanX existant, il n'en crée jamais ;
// - une fois connectée, la personne ne voit que les tableaux où elle est invitée ;
// - le compte Google est reconnu par son identifiant (sub), jamais par son adresse ;
// - la première liaison par l'adresse n'a lieu que si Google fait autorité sur elle (Gmail, ou Workspace : hd) ;
//   sinon, la personne se connecte par courriel puis lie son compte Google depuis « Mon compte » ;
// - state lié au navigateur par un cookie, nonce, PKCE S256, client authentifié ; une demande ne sert qu'une fois.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { demarrer } from './serveur.js';
import { admin, fermer, creerUtilisateur, creerTableau } from './aide.js';
import { config } from '../src/config.js';
import { boiteDev } from '../src/courriel.js';
import { reinitialiserLimites } from '../src/securite.js';
import { verifierConfigProduction } from '../src/demarrage.js';
import { analyserJetonId, googleFaitAutorite } from '../src/google.js';

// Identifiants fictifs : ce ne sont pas ceux d'un vrai client Google.
const CLIENT_ID = '123456789012-fictifkanbanxtest.apps.googleusercontent.com';
const SECRET = 'GOCSPX-fictif-pour-les-tests-uniquement';
const DOMAINE = 'ecole.exemple.invalid'; // domaine fictif d'un compte Google Workspace (revendication hd)

// ---------- Faux Google : point de jeton seulement (l'écran de choix du compte est simulé par le test) ----------
const faux = { codes: new Map(), requetes: [], panne: false };
const jwt = (revendications) => [{ alg: 'RS256', kid: 'fictif', typ: 'JWT' }, revendications]
  .map((o) => Buffer.from(JSON.stringify(o)).toString('base64url')).join('.') + '.c2lnbmF0dXJlLWZpY3RpdmU';
const basic = () => `Basic ${Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(SECRET)}`).toString('base64')}`;

let fauxGoogle;
let srv;
before(async () => {
  fauxGoogle = http.createServer(async (req, res) => {
    let corps = '';
    for await (const m of req) corps += m;
    faux.requetes.push({ url: req.url, methode: req.method, headers: req.headers, corps });
    const repondre = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (faux.panne) return repondre(500, { error: 'internal_failure' });
    const p = new URLSearchParams(corps);
    const c = faux.codes.get(p.get('code'));
    faux.codes.delete(p.get('code')); // un code ne sert qu'une fois, comme chez Google
    const pkce = c && createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === c.defi;
    if (req.method !== 'POST' || req.url !== '/token' || req.headers.authorization !== basic()
      || p.get('grant_type') !== 'authorization_code' || !c || !pkce || p.get('redirect_uri') !== c.retour) {
      return repondre(400, { error: 'invalid_grant' });
    }
    repondre(200, { access_token: 'ya29.fictif', expires_in: 3599, token_type: 'Bearer', scope: 'openid email', id_token: jwt(c.revendications) });
  });
  await new Promise((r) => fauxGoogle.listen(0, '127.0.0.1', r));
  config.google = { ...config.google, clientId: CLIENT_ID, clientSecret: SECRET, tokenUrl: `http://127.0.0.1:${fauxGoogle.address().port}/token` };
  srv = await demarrer();
});
after(async () => { await srv.fermer(); fauxGoogle.closeAllConnections(); await new Promise((r) => fauxGoogle.close(r)); await fermer(); });

// ---------- Un navigateur : cookies, jeton CSRF, pas de suivi automatique des redirections ----------
class Navigateur {
  constructor() { this.cookies = new Map(); this.csrf = null; }
  noter(r) {
    for (const sc of r.headers.getSetCookie()) {
      const kv = sc.split(';')[0];
      const i = kv.indexOf('=');
      const [nom, valeur] = [kv.slice(0, i), kv.slice(i + 1)];
      if (!valeur || /Max-Age=0\b/i.test(sc)) this.cookies.delete(nom); else this.cookies.set(nom, valeur);
    }
  }
  async aller(methode, chemin, corps, { entetes = {} } = {}) {
    const h = { ...entetes };
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (corps !== undefined) h['Content-Type'] = 'application/json';
    if (methode !== 'GET' && this.csrf && !('X-CSRF-Token' in h)) h['X-CSRF-Token'] = this.csrf;
    const r = await fetch(srv.base + chemin, { method: methode, headers: h, redirect: 'manual', body: corps === undefined ? undefined : JSON.stringify(corps) });
    this.noter(r);
    const t = await r.text();
    let data; try { data = JSON.parse(t); } catch { data = t; }
    return { status: r.status, data, headers: r.headers, location: r.headers.get('location') };
  }
  async moi() {
    const r = await this.aller('GET', '/api/me');
    if (r.status === 200) this.csrf = r.data.csrf;
    return r;
  }
  /** Connexion par le lien envoyé par courriel, comme aujourd'hui. */
  async parCourriel(email) {
    reinitialiserLimites();
    await this.aller('POST', '/api/auth/demander', { email });
    const jeton = new URL(boiteDev.findLast((m) => m.a === email.toLowerCase()).lien).searchParams.get('token');
    const r = await this.aller('POST', '/api/auth/verifier', { token: jeton });
    assert.equal(r.status, 200);
    this.csrf = r.data.csrf;
  }
}

const maintenant = () => Math.floor(Date.now() / 1000);

/** Commence chez KanbanX ; renvoie l'adresse vers Google et de quoi simuler le choix du compte. */
async function commencer(nav, { liaison = false } = {}) {
  reinitialiserLimites();
  const d = await nav.aller('POST', liaison ? '/api/me/google' : '/api/auth/google', {});
  assert.equal(d.status, 200, JSON.stringify(d.data));
  return { reponse: d, url: new URL(d.data.url) };
}

/** La personne choisit son compte chez Google, qui renvoie le navigateur vers KanbanX avec un code. */
function choisirCompte(depart, revendications) {
  const p = depart.searchParams;
  const code = `4/0fictif-${randomUUID()}`;
  faux.codes.set(code, { defi: p.get('code_challenge'), retour: p.get('redirect_uri'), revendications: {
    iss: 'https://accounts.google.com', aud: CLIENT_ID, azp: CLIENT_ID, iat: maintenant(), exp: maintenant() + 3600,
    nonce: p.get('nonce'), email_verified: true, ...revendications } });
  return new URLSearchParams({ state: p.get('state'), code, scope: 'email openid https://www.googleapis.com/auth/userinfo.email', authuser: '0', prompt: 'consent' });
}

async function parGoogle(nav, revendications, options = {}) {
  const { url } = await commencer(nav, options);
  const qs = choisirCompte(url, revendications);
  return nav.aller('GET', `/auth/google/retour?${qs}`);
}

/** Compte invité sur un domaine Workspace fictif : Google fait autorité sur son adresse (hd). */
async function invite(nom, { domaine = DOMAINE } = {}) {
  const email = `${nom.toLowerCase()}-${randomUUID().slice(0, 8)}@${domaine}`;
  return (await admin.query('insert into users (email, name) values ($1, $2) returning *', [email, nom])).rows[0];
}
const identite = async (sujet) => (await admin.query('select * from identites_google where sujet = $1', [sujet])).rows[0];
const nbUtilisateurs = async () => (await admin.query('select count(*)::int n from users')).rows[0].n;

// ---------- Règles pures ----------

test('Google fait autorité sur Gmail et sur les comptes Workspace (hd), jamais sur une autre adresse', () => {
  assert.equal(googleFaitAutorite({ email: 'kx-fictif@gmail.com', email_verified: true }), true);
  assert.equal(googleFaitAutorite({ email: `eve@${DOMAINE}`, email_verified: true, hd: DOMAINE }), true);
  assert.equal(googleFaitAutorite({ email: `eve@${DOMAINE}`, email_verified: true }), false, 'adresse hors Gmail sans hd');
  assert.equal(googleFaitAutorite({ email: 'kx-fictif@gmail.com', email_verified: false }), false, 'adresse non vérifiée');
  assert.equal(googleFaitAutorite({ email: `eve@${DOMAINE}`, email_verified: 'true', hd: DOMAINE }), false, 'vérification qui n\'est pas un booléen');
  assert.equal(googleFaitAutorite({ email: 'kx-fictif@gmail.com.exemple.invalid', email_verified: true }), false, 'faux suffixe Gmail');
});

test('le jeton d\'identité est vérifié : émetteur, audience, partie autorisée, nonce, dates, sujet, adresse', () => {
  const base = { iss: 'https://accounts.google.com', aud: CLIENT_ID, azp: CLIENT_ID, iat: maintenant(), exp: maintenant() + 3600,
    nonce: 'nonce-attendu', sub: '1098765432', email: `eve@${DOMAINE}`, email_verified: true, hd: DOMAINE };
  const attendu = { clientId: CLIENT_ID, nonce: 'nonce-attendu' };
  assert.equal(analyserJetonId(jwt(base), attendu).sub, '1098765432');
  assert.equal(analyserJetonId(jwt({ ...base, iss: 'accounts.google.com' }), attendu).sub, '1098765432', 'émetteur sans https, prévu par Google');
  assert.equal(analyserJetonId(jwt({ ...base, aud: [CLIENT_ID] }), attendu).sub, '1098765432', 'audience en liste');
  const refus = {
    'émetteur étranger': { iss: 'https://accounts.google.com.exemple.invalid' },
    'autre audience': { aud: 'autre.apps.googleusercontent.com' },
    'audience multiple sans azp': { aud: [CLIENT_ID, 'autre'], azp: undefined },
    'audience multiple, azp étranger': { aud: [CLIENT_ID, 'autre'], azp: 'autre' },
    'azp étranger': { azp: 'autre.apps.googleusercontent.com' },
    'nonce différent': { nonce: 'nonce-rejoue' },
    'nonce absent': { nonce: undefined },
    'expiré': { exp: maintenant() - 10 },
    'émis dans le futur': { iat: maintenant() + 3600 },
    'sans sujet': { sub: undefined },
    'sujet qui n\'est pas un texte': { sub: 1098765432 },
    'sans adresse': { email: undefined },
  };
  for (const [cas, modif] of Object.entries(refus)) {
    assert.throws(() => analyserJetonId(jwt({ ...base, ...modif }), attendu), Error, cas);
  }
  assert.throws(() => analyserJetonId('pas.un-jeton', attendu));
  assert.throws(() => analyserJetonId('', attendu));
});

test('configuration de production : identifiant et secret Google vont ensemble, au bon format', () => {
  const env = { NODE_ENV: 'production', DATABASE_URL: 'postgres://kanbanx_app:un-vrai-secret@127.0.0.1:5432/kanbanx',
    BASE_URL: 'https://kanbanx.exemple.invalid', SMTP_URL: 'smtps://envoi:secret@smtp.exemple.invalid:465' };
  assert.deepEqual(verifierConfigProduction(env), [], 'sans Google : accepté (la connexion par courriel suffit)');
  assert.deepEqual(verifierConfigProduction({ ...env, GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: SECRET }), []);
  for (const [modif, attendu] of [
    [{ GOOGLE_CLIENT_ID: CLIENT_ID }, /GOOGLE_CLIENT_SECRET/],
    [{ GOOGLE_CLIENT_SECRET: SECRET }, /GOOGLE_CLIENT_ID/],
    [{ GOOGLE_CLIENT_ID: 'mon-client', GOOGLE_CLIENT_SECRET: SECRET }, /GOOGLE_CLIENT_ID/],
  ]) {
    const pb = verifierConfigProduction({ ...env, ...modif });
    assert.ok(pb.some((p) => attendu.test(p)), `${JSON.stringify(Object.keys(modif))} doit être refusé (reçu : ${JSON.stringify(pb)})`);
  }
});

// ---------- Départ vers Google ----------

test('sans identifiants Google, rien n\'est proposé ni ouvert', async () => {
  const sauve = config.google;
  config.google = { ...sauve, clientId: '', clientSecret: '' };
  try {
    const nav = new Navigateur();
    assert.deepEqual((await nav.aller('GET', '/api/auth/methodes')).data, { google: false });
    assert.equal((await nav.aller('POST', '/api/auth/google', {})).status, 404);
    assert.equal((await nav.aller('GET', '/auth/google/retour?state=x&code=y')).status, 404);
  } finally { config.google = sauve; }
  assert.deepEqual((await new Navigateur().aller('GET', '/api/auth/methodes')).data, { google: true });
});

test('le départ vers Google suit OpenID Connect : code, PKCE S256, state et nonce, portées minimales', async () => {
  const nav = new Navigateur();
  const { reponse, url } = await commencer(nav);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const p = url.searchParams;
  assert.equal(p.get('client_id'), CLIENT_ID);
  assert.equal(p.get('redirect_uri'), `${config.baseUrl}/auth/google/retour`);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('scope'), 'openid email', 'ni profil ni autre donnée : seulement l\'identité et l\'adresse');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.match(p.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(p.get('state'), /^[A-Za-z0-9_-]{43,}$/);
  assert.match(p.get('nonce'), /^[A-Za-z0-9_-]{43,}$/);
  assert.notEqual(p.get('state'), p.get('nonce'));
  assert.ok(!url.search.includes(SECRET), 'le secret ne quitte jamais le serveur');
  assert.equal(reponse.headers.get('cache-control'), 'no-store');
  // Le state est lié à ce navigateur par un cookie réservé à notre origine.
  const sc = reponse.headers.getSetCookie().find((c) => c.startsWith('__Host-kx-google='));
  assert.ok(sc, 'cookie de liaison posé');
  assert.equal(sc.split(';')[0], `__Host-kx-google=${p.get('state')}`);
  for (const attr of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600']) assert.ok(sc.includes(attr), `${attr} dans ${sc}`);
  // Seule la page KanbanX elle-même peut commencer (pas de départ forcé depuis un autre site).
  reinitialiserLimites();
  const ailleurs = await nav.aller('POST', '/api/auth/google', {}, { entetes: { Origin: 'https://site-hostile.exemple.invalid' } });
  assert.equal(ailleurs.status, 403);
});

// ---------- Retour de Google : connexion ----------

test('une personne invitée entre avec Google et ne voit que les tableaux où elle est invitée', async () => {
  const proprio = await creerUtilisateur('Proprio');
  const eve = await invite('Eve');
  const { board: invite1 } = await creerTableau(proprio, { member: eve });
  const { board: autre } = await creerTableau(proprio);
  const nav = new Navigateur();
  const r = await parGoogle(nav, { sub: 'sub-eve-1', email: eve.email, hd: DOMAINE });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/connexion/suite');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.ok(nav.cookies.get('__Host-kx'), 'session ouverte');
  assert.ok(!nav.cookies.has('__Host-kx-google'), 'cookie de liaison effacé');
  const moi = await nav.moi();
  assert.equal(moi.status, 200);
  assert.equal(moi.data.user.id, eve.id);
  assert.equal(moi.data.user.google, eve.email);
  const tableaux = (await nav.aller('GET', '/api/boards')).data.map((b) => b.id);
  assert.deepEqual(tableaux, [invite1.id], 'seulement le tableau où elle est invitée');
  assert.equal((await nav.aller('GET', `/api/boards/${autre.id}`)).status, 404);
  assert.equal((await identite('sub-eve-1')).user_id, eve.id, 'compte Google lié par son identifiant');
});

test('une adresse Gmail invitée entre aussi ; ensuite le compte est reconnu par son identifiant, même si l\'adresse change', async () => {
  // Adresse fictive au hasard : aucun courriel n'est envoyé, aucun réseau n'est contacté.
  const gmail = `kx-test-${randomUUID()}@gmail.com`;
  const alexis = (await admin.query("insert into users (email, name) values ($1, 'Alexis') returning *", [gmail])).rows[0];
  const r = await parGoogle(new Navigateur(), { sub: 'sub-alexis', email: gmail });
  assert.equal(r.location, '/connexion/suite');
  // L'adresse du compte Google a changé (hors Gmail, sans hd) : l'identifiant suffit.
  const nav = new Navigateur();
  const r2 = await parGoogle(nav, { sub: 'sub-alexis', email: `alexis-${randomUUID().slice(0, 8)}@perso.exemple.invalid` });
  assert.equal(r2.location, '/connexion/suite');
  assert.equal((await nav.moi()).data.user.id, alexis.id);
});

test('une adresse jamais invitée est refusée, et aucun compte n\'est créé', async () => {
  const avant = await nbUtilisateurs();
  const nav = new Navigateur();
  const r = await parGoogle(nav, { sub: 'sub-inconnu', email: `inconnu-${randomUUID().slice(0, 8)}@${DOMAINE}`, hd: DOMAINE });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/connexion?google=inconnu');
  assert.ok(!nav.cookies.has('__Host-kx'), 'pas de session');
  assert.equal(await nbUtilisateurs(), avant, 'aucun compte créé');
  assert.equal(await identite('sub-inconnu'), undefined);
});

test('si Google ne fait pas autorité sur l\'adresse, pas de liaison par l\'adresse, même pour une personne invitée', async () => {
  const zoe = await invite('Zoe'); // domaine Workspace fictif, mais le jeton n'a pas de hd
  for (const [sujet, revendications] of [
    ['sub-zoe-sans-hd', { email: zoe.email }],
    ['sub-zoe-non-verifiee', { email: zoe.email, hd: DOMAINE, email_verified: false }],
  ]) {
    const nav = new Navigateur();
    const r = await parGoogle(nav, { sub: sujet, ...revendications });
    assert.equal(r.location, '/connexion?google=non_autoritaire', sujet);
    assert.ok(!nav.cookies.has('__Host-kx'));
    assert.equal(await identite(sujet), undefined);
  }
});

test('un compte agent ou désactivé n\'entre pas avec Google', async () => {
  const agent = await invite('Robot');
  await admin.query("update users set kind = 'agent' where id = $1", [agent.id]);
  assert.equal((await parGoogle(new Navigateur(), { sub: 'sub-robot', email: agent.email, hd: DOMAINE })).location, '/connexion?google=inconnu');
  const ines = await invite('Ines');
  assert.equal((await parGoogle(new Navigateur(), { sub: 'sub-ines', email: ines.email, hd: DOMAINE })).location, '/connexion/suite');
  await admin.query('update users set disabled_at = now() where id = $1', [ines.id]);
  const nav = new Navigateur();
  assert.equal((await parGoogle(nav, { sub: 'sub-ines', email: ines.email, hd: DOMAINE })).location, '/connexion?google=inconnu');
  assert.ok(!nav.cookies.has('__Host-kx'));
});

test('le retour exige le navigateur qui a commencé : un code et un state volés ne connectent personne', async () => {
  const lea = await invite('Lea');
  const victime = new Navigateur();
  const { url } = await commencer(victime);
  const qs = choisirCompte(url, { sub: 'sub-lea', email: lea.email, hd: DOMAINE });
  // Un autre navigateur, sans le cookie, présente le même retour.
  const intrus = new Navigateur();
  const r = await intrus.aller('GET', `/auth/google/retour?${qs}`);
  assert.equal(r.location, '/connexion?google=expire');
  assert.ok(!intrus.cookies.has('__Host-kx'));
  // Avec un cookie, mais d'une autre demande.
  const intrus2 = new Navigateur();
  await commencer(intrus2);
  const r2 = await intrus2.aller('GET', `/auth/google/retour?${qs}`);
  assert.equal(r2.location, '/connexion?google=expire');
  assert.ok(!intrus2.cookies.has('__Host-kx'));
  // Le navigateur légitime, lui, termine normalement.
  const ok = await victime.aller('GET', `/auth/google/retour?${qs}`);
  assert.equal(ok.location, '/connexion/suite');
});

test('une demande ne sert qu\'une fois et expire au bout de 10 minutes', async () => {
  const max = await invite('Max');
  const nav = new Navigateur();
  const { url } = await commencer(nav);
  const qs = choisirCompte(url, { sub: 'sub-max', email: max.email, hd: DOMAINE });
  const etat = url.searchParams.get('state');
  assert.equal((await nav.aller('GET', `/auth/google/retour?${qs}`)).location, '/connexion/suite');
  // Rejeu : même cookie remis, même adresse de retour.
  const rejoueur = new Navigateur();
  rejoueur.cookies.set('__Host-kx-google', etat);
  assert.equal((await rejoueur.aller('GET', `/auth/google/retour?${qs}`)).location, '/connexion?google=expire');
  assert.ok(!rejoueur.cookies.has('__Host-kx'));
  // Expiration.
  const nav2 = new Navigateur();
  const d2 = await commencer(nav2);
  const qs2 = choisirCompte(d2.url, { sub: 'sub-max', email: max.email, hd: DOMAINE });
  await admin.query("update google_demandes set expires_at = now() - interval '1 second'");
  assert.equal((await nav2.aller('GET', `/auth/google/retour?${qs2}`)).location, '/connexion?google=expire');
  assert.ok(!nav2.cookies.has('__Host-kx'));
});

test('un jeton d\'identité non conforme ne connecte personne', async () => {
  const noa = await invite('Noa');
  for (const [cas, modif] of Object.entries({
    'autre audience': { aud: 'autre.apps.googleusercontent.com' },
    'nonce d\'une autre demande': { nonce: 'nonce-d-une-autre-demande' },
    'émetteur étranger': { iss: 'https://faux-google.exemple.invalid' },
    'expiré': { exp: maintenant() - 60 },
  })) {
    const nav = new Navigateur();
    const r = await parGoogle(nav, { sub: 'sub-noa', email: noa.email, hd: DOMAINE, ...modif });
    assert.equal(r.location, '/connexion?google=echec', cas);
    assert.ok(!nav.cookies.has('__Host-kx'), cas);
  }
  assert.equal(await identite('sub-noa'), undefined);
});

test('le code est échangé avec le vérificateur PKCE et le client authentifié, sans suivre de redirection', async () => {
  const ugo = await invite('Ugo');
  faux.requetes.length = 0;
  assert.equal((await parGoogle(new Navigateur(), { sub: 'sub-ugo', email: ugo.email, hd: DOMAINE })).location, '/connexion/suite');
  const q = faux.requetes.at(-1);
  assert.equal(q.headers.authorization, basic(), 'client_secret_basic (RFC 6749, § 2.3.1)');
  assert.match(q.headers['content-type'], /^application\/x-www-form-urlencoded/);
  const p = new URLSearchParams(q.corps);
  assert.match(p.get('code_verifier'), /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(p.get('client_secret'), null, 'le secret ne part pas dans le corps');
  // Vérificateur faux (rejeté par le faux Google) : échec propre.
  const nav = new Navigateur();
  const { url } = await commencer(nav);
  const qs = choisirCompte(url, { sub: 'sub-ugo', email: ugo.email, hd: DOMAINE });
  faux.codes.get(qs.get('code')).defi = 'defi-qui-ne-correspond-pas-au-verificateur-xx';
  assert.equal((await nav.aller('GET', `/auth/google/retour?${qs}`)).location, '/connexion?google=echec');
});

test('refus chez Google, panne ou retour incomplet : retour propre vers la connexion, sans session', async () => {
  const nav = new Navigateur();
  const { url } = await commencer(nav);
  const r = await nav.aller('GET', `/auth/google/retour?${new URLSearchParams({ state: url.searchParams.get('state'), error: 'access_denied' })}`);
  assert.equal(r.location, '/connexion?google=annule');
  const nav2 = new Navigateur();
  const d2 = await commencer(nav2);
  assert.equal((await nav2.aller('GET', `/auth/google/retour?${new URLSearchParams({ state: d2.url.searchParams.get('state') })}`)).location,
    '/connexion?google=echec', 'sans code');
  const kim = await invite('Kim');
  faux.panne = true;
  try {
    const nav3 = new Navigateur();
    assert.equal((await parGoogle(nav3, { sub: 'sub-kim', email: kim.email, hd: DOMAINE })).location, '/connexion?google=echec');
    assert.ok(!nav3.cookies.has('__Host-kx'));
  } finally { faux.panne = false; }
  assert.equal((await new Navigateur().aller('POST', '/auth/google/retour', {})).status, 405);
});

// ---------- Liaison depuis « Mon compte » ----------

test('liaison depuis « Mon compte » : session et CSRF exigés ; ensuite Google suffit, et on peut délier', async () => {
  const tom = await creerUtilisateur('Tom'); // adresse sur laquelle Google ne fait pas autorité
  const sujet = `sub-tom-${randomUUID().slice(0, 6)}`;
  assert.equal((await parGoogle(new Navigateur(), { sub: sujet, email: tom.email })).location, '/connexion?google=non_autoritaire');

  const anonyme = new Navigateur();
  assert.equal((await anonyme.aller('POST', '/api/me/google', {})).status, 401);
  const nav = new Navigateur();
  await nav.parCourriel(tom.email);
  const sansCsrf = await nav.aller('POST', '/api/me/google', {}, { entetes: { 'X-CSRF-Token': 'faux' } });
  assert.equal(sansCsrf.status, 403);

  const r = await parGoogle(nav, { sub: sujet, email: tom.email }, { liaison: true });
  assert.equal(r.location, '/compte?google=lie');
  assert.equal((await identite(sujet)).user_id, tom.id);
  assert.equal((await nav.moi()).data.user.google, tom.email);

  const ailleurs = new Navigateur();
  assert.equal((await parGoogle(ailleurs, { sub: sujet, email: tom.email })).location, '/connexion/suite');
  assert.equal((await ailleurs.moi()).data.user.id, tom.id);

  const d = await nav.aller('DELETE', '/api/me/google');
  assert.equal(d.status, 200);
  assert.equal((await nav.moi()).data.user.google, null);
  assert.equal((await parGoogle(new Navigateur(), { sub: sujet, email: tom.email })).location, '/connexion?google=non_autoritaire');
});

test('liaison : un compte Google déjà lié à quelqu\'un d\'autre est refusé, et la session doit rester la même', async () => {
  const ana = await creerUtilisateur('Ana');
  const ben = await creerUtilisateur('Ben');
  const navAna = new Navigateur(); await navAna.parCourriel(ana.email);
  const navBen = new Navigateur(); await navBen.parCourriel(ben.email);
  const sujetAna = `sub-ana-${randomUUID().slice(0, 6)}`;
  assert.equal((await parGoogle(navAna, { sub: sujetAna, email: ana.email }, { liaison: true })).location, '/compte?google=lie');
  // Ben ne peut pas lier le compte Google d'Ana.
  assert.equal((await parGoogle(navBen, { sub: sujetAna, email: ana.email }, { liaison: true })).location, '/compte?google=deja_lie');
  assert.equal((await identite(sujetAna)).user_id, ana.id);
  // Ben lie le sien, puis tente d'en lier un second.
  const sujetBen = `sub-ben-${randomUUID().slice(0, 6)}`;
  assert.equal((await parGoogle(navBen, { sub: sujetBen, email: ben.email }, { liaison: true })).location, '/compte?google=lie');
  assert.equal((await parGoogle(navBen, { sub: `${sujetBen}-bis`, email: ben.email }, { liaison: true })).location, '/compte?google=autre_compte');
  // Liaison commencée par Ana, terminée dans un navigateur où la session est devenue celle de Ben.
  const { url } = await commencer(navAna, { liaison: true });
  const piege = `sub-piege-${randomUUID().slice(0, 6)}`;
  const qs = choisirCompte(url, { sub: piege, email: ana.email });
  navAna.cookies.set('__Host-kx', navBen.cookies.get('__Host-kx'));
  assert.equal((await navAna.aller('GET', `/auth/google/retour?${qs}`)).location, '/compte?google=expire');
  assert.equal(await identite(piege), undefined);
  assert.equal((await admin.query('select count(*)::int n from identites_google where user_id = any($1)', [[ana.id, ben.id]])).rows[0].n, 2);
});

test('le rôle applicatif n\'a aucun accès direct aux tables de Google', async () => {
  const { app } = await import('./aide.js');
  await assert.rejects(app.query('select * from identites_google'), /permission/);
  await assert.rejects(app.query('select * from google_demandes'), /permission/);
});
