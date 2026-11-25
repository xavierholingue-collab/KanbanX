// « Continuer avec Google » vu de la personne : bouton sur l'écran de connexion, retour connecté là où elle allait,
// message clair quand l'adresse n'est pas invitée, liaison et déliaison dans « Mon compte ».
// Faux Google local : sa page « choisir un compte » renvoie aussitôt vers KanbanX avec un code. Aucun appel réseau réel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { devices } from 'playwright';
import { environnement, connecter, creerUtilisateur, admin, auditer } from './aide.js';
import { creerTableau } from '../test/aide.js';
import { config } from '../src/config.js';
import { reinitialiserLimites } from '../src/securite.js';

const CLIENT_ID = '123456789012-fictifkanbanxtest.apps.googleusercontent.com';
const DOMAINE = 'ecole.exemple.invalid'; // domaine fictif d'un compte Google Workspace
const choix = { revendications: {} }; // le compte que la personne « choisit » chez le faux Google
const codes = new Map();
// CAPTURES=1 : enregistre les écrans dans docs/captures/ (pour la revue, pas pour le test).
const CAPTURES = process.env.CAPTURES === '1' ? new URL('../docs/captures/', import.meta.url).pathname : null;
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });
const capturer = (page, nom) => (CAPTURES ? page.screenshot({ path: `${CAPTURES}google-${nom}.png` }) : null);

let env;
let faux;
before(async () => {
  faux = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/authorize') {
      const p = u.searchParams;
      const code = `code-${randomUUID()}`;
      codes.set(code, { defi: p.get('code_challenge'), nonce: p.get('nonce') });
      const retour = new URL(p.get('redirect_uri'));
      retour.search = new URLSearchParams({ code, state: p.get('state') }).toString();
      res.writeHead(302, { Location: retour.toString() });
      return res.end();
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      let corps = '';
      for await (const m of req) corps += m;
      const p = new URLSearchParams(corps);
      const c = codes.get(p.get('code'));
      codes.delete(p.get('code'));
      if (!c || createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') !== c.defi) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end('{"error":"invalid_grant"}');
      }
      const t = Math.floor(Date.now() / 1000);
      const r = { iss: 'https://accounts.google.com', aud: CLIENT_ID, azp: CLIENT_ID, iat: t, exp: t + 3600, nonce: c.nonce, email_verified: true, ...choix.revendications };
      const jwt = `${[{ alg: 'RS256', typ: 'JWT' }, r].map((o) => Buffer.from(JSON.stringify(o)).toString('base64url')).join('.')}.c2lnbmF0dXJl`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id_token: jwt, access_token: 'ya29.fictif', token_type: 'Bearer', expires_in: 3599 }));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => faux.listen(0, '127.0.0.1', r));
  const fauxBase = `http://127.0.0.1:${faux.address().port}`;
  env = await environnement();
  config.baseUrl = env.base; // l'adresse de retour donnée à Google doit pointer vers ce serveur de test
  config.google = { clientId: CLIENT_ID, clientSecret: 'GOCSPX-fictif-pour-les-tests-uniquement', authUrl: `${fauxBase}/authorize`, tokenUrl: `${fauxBase}/token` };
});
after(async () => { await env.fermer(); faux.closeAllConnections(); await new Promise((r) => faux.close(r)); });

async function anonyme({ telephone = false, sombre = false } = {}) {
  const ctx = await env.navigateur.newContext({ ...(telephone ? devices['Pixel 7'] : { viewport: { width: 1366, height: 820 } }),
    locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', colorScheme: sombre ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.erreurs = [];
  page.on('pageerror', (e) => page.erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|404)/.test(m.text())) page.erreurs.push(m.text()); });
  return page;
}

async function invite(nom) {
  const email = `${nom.toLowerCase()}-${randomUUID().slice(0, 8)}@${DOMAINE}`;
  return (await admin.query('insert into users (email, name) values ($1, $2) returning *', [email, nom])).rows[0];
}

test('« Continuer avec Google » : la personne invitée arrive sur ses seuls tableaux (ordinateur clair, téléphone sombre)', async () => {
  const proprio = await creerUtilisateur('Proprio');
  const eve = await invite('Eve');
  await creerTableau(proprio, { member: eve });
  await creerTableau(proprio); // un tableau où Eve n'est pas invitée
  const v = [];
  for (const [nom, opts] of [['ordinateur', {}], ['telephone-sombre', { telephone: true, sombre: true }]]) {
    reinitialiserLimites();
    choix.revendications = { sub: 'sub-eve-e2e', email: eve.email, hd: DOMAINE };
    const page = await anonyme(opts);
    await page.goto(`${env.base}/connexion`);
    const bouton = page.getByRole('button', { name: 'Continuer avec Google' });
    await bouton.waitFor();
    // Les deux moyens sont proposés, Google d'abord, séparés par « ou ».
    await page.getByLabel('Adresse courriel').waitFor();
    assert.ok(await page.getByText('ou', { exact: true }).isVisible());
    v.push(...await auditer(page, `connexion avec Google (${nom})`));
    await capturer(page, `01-connexion-${nom}`);
    await bouton.click();
    await page.getByRole('heading', { name: 'Mes tableaux' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.locator('.grille-tableaux .tuile:not(.tuile-nouveau)').count(), 1, 'seul le tableau où elle est invitée');
    assert.deepEqual(page.erreurs, []);
    await page.context().close();
  }
  assert.deepEqual(v, []);
});

test('« Continuer avec Google » ramène là où la personne allait', async () => {
  const proprio = await creerUtilisateur('Proprio');
  const lea = await invite('Lea');
  const { board } = await creerTableau(proprio, { member: lea });
  reinitialiserLimites();
  choix.revendications = { sub: 'sub-lea-e2e', email: lea.email, hd: DOMAINE };
  const page = await anonyme();
  await page.goto(`${env.base}/b/${board.id}`);
  await page.getByRole('button', { name: 'Continuer avec Google' }).click();
  await page.waitForURL(`${env.base}/b/${board.id}`);
  await page.getByRole('heading', { name: 'Tableau test' }).waitFor();
  assert.deepEqual(page.erreurs, []);
  await page.context().close();
});

test('adresse Google non invitée : message clair et accessible, rien dans l\'adresse de la page', async () => {
  reinitialiserLimites();
  choix.revendications = { sub: 'sub-inconnu-e2e', email: `inconnu-${randomUUID().slice(0, 8)}@${DOMAINE}`, hd: DOMAINE };
  const page = await anonyme({ telephone: true });
  await page.goto(`${env.base}/connexion`);
  await page.getByRole('button', { name: 'Continuer avec Google' }).click();
  const alerte = page.getByRole('alert');
  await alerte.waitFor();
  assert.match(await alerte.textContent(), /n'a pas accès à KanbanX : aucune invitation n'a été faite à son adresse/);
  assert.equal(new URL(page.url()).search, '', 'le code de résultat ne reste pas dans l\'adresse');
  assert.deepEqual(await auditer(page, 'connexion refusée (téléphone)'), []);
  await capturer(page, '02-refus-telephone');
  // Le lien par courriel reste proposé juste en dessous.
  await page.getByRole('button', { name: 'Recevoir un lien de connexion' }).waitFor();
  assert.deepEqual(page.erreurs, []);
  await page.context().close();
});

test('« Mon compte » : lier son compte Google, puis le délier (le lien par courriel reste possible)', async () => {
  const tom = await creerUtilisateur('Tom'); // adresse sur laquelle Google ne fait pas autorité
  const v = [];
  const page = await connecter(env, tom);
  await page.locator('a[href="/compte"]').click();
  await page.getByRole('heading', { name: 'Connexion avec Google' }).waitFor();
  v.push(...await auditer(page, 'mon compte, non lié'));
  reinitialiserLimites();
  choix.revendications = { sub: 'sub-tom-e2e', email: tom.email };
  await page.getByRole('button', { name: 'Lier mon compte Google' }).click();
  await page.getByText('Votre compte Google est lié').waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, '/compte');
  await page.getByText(`Lié au compte Google ${tom.email}`).waitFor();
  v.push(...await auditer(page, 'mon compte, lié'));
  await capturer(page, '03-compte-lie-ordinateur');
  // Avec Google, Tom entre désormais directement, depuis un autre navigateur.
  const ailleurs = await anonyme();
  await ailleurs.goto(`${env.base}/connexion`);
  await ailleurs.getByRole('button', { name: 'Continuer avec Google' }).click();
  await ailleurs.getByRole('heading', { name: 'Mes tableaux' }).waitFor();
  await ailleurs.context().close();
  // Délier.
  await page.getByRole('button', { name: 'Délier mon compte Google' }).click();
  await page.getByText('Compte Google délié').waitFor();
  const lier = page.getByRole('button', { name: 'Lier mon compte Google' });
  await lier.waitFor();
  assert.ok(await lier.evaluate((b) => b === document.activeElement), 'le focus revient sur « Lier mon compte Google »');
  assert.deepEqual(page.erreurs, []);
  assert.deepEqual(v, []);
  await page.context().close();
});

test('sans identifiants Google, l\'écran de connexion reste celui d\'avant', async () => {
  const sauve = config.google;
  config.google = { ...sauve, clientId: '', clientSecret: '' };
  try {
    const page = await anonyme();
    await page.goto(`${env.base}/connexion`);
    await page.getByRole('button', { name: 'Recevoir un lien de connexion' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Continuer avec Google' }).count(), 0);
    assert.ok(await page.getByText('nous vous envoyons un lien magique').isVisible());
    await page.context().close();
  } finally { config.google = sauve; }
});
