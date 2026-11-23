// Branchement de Claude par OAuth, vu de la personne : consentement, retour après connexion, Applications connectées.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { environnement, connecter, creerUtilisateur } from './aide.js';
import { boiteDev } from '../src/courriel.js';
import { reinitialiserLimites } from '../src/securite.js';
import { config } from '../src/config.js';

const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const RETOUR = 'https://claude.ai/api/mcp/auth_callback';
let env;
before(async () => { env = await environnement(); });
after(async () => { await env.fermer(); });

async function auditer(page, contexte) {
  await page.evaluate(axe);
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }));
  return r.violations.map((v) => `${contexte} — ${v.id} : ${v.help} ${v.nodes.slice(0, 2).map((x) => x.target.join(' ')).join(' | ')}`);
}

async function demandeAutorisation() {
  reinitialiserLimites();
  const r = await fetch(`${env.base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [RETOUR] }) });
  const client = (await r.json()).client_id;
  const verificateur = randomBytes(32).toString('base64url');
  const defi = createHash('sha256').update(verificateur).digest('base64url');
  const qs = new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: RETOUR, code_challenge: defi,
    code_challenge_method: 'S256', state: 'etat-e2e', scope: 'kanbanx', resource: `${config.baseUrl}/mcp` });
  return { client, verificateur, url: `${env.base}/oauth/authorize?${qs}` };
}

/** Intercepte le retour vers claude.ai : on ne quitte jamais la machine de test. */
async function capturerRetour(page) {
  let adresse = null;
  await page.context().route('https://claude.ai/**', (route) => { adresse = route.request().url(); route.fulfill({ status: 200, body: 'retour' }); });
  return () => adresse;
}

test('consentement : nom du client, hôte de retour, ce que Claude pourra faire ; « Autoriser » renvoie le code', async () => {
  const eric = await creerUtilisateur('Eric');
  const page = await connecter(env, eric);
  const retour = await capturerRetour(page);
  const d = await demandeAutorisation();
  await page.goto(d.url);
  await page.getByRole('heading', { name: 'Autoriser « Claude » à accéder à KanbanX ?' }).waitFor();
  const texte = await page.locator('main').innerText();
  assert.match(texte, /claude\.ai/);
  assert.match(texte, /en votre nom/);
  assert.match(texte, /Claude pour Eric/);
  assert.deepEqual(await auditer(page, 'consentement'), []);
  await page.getByRole('button', { name: 'Autoriser' }).click();
  await page.waitForURL(/^https:\/\/claude\.ai\/api\/mcp\/auth_callback\?/);
  const u = new URL(retour());
  assert.ok(u.searchParams.get('code'));
  assert.equal(u.searchParams.get('state'), 'etat-e2e');
  assert.deepEqual(page.erreurs, []);
});

test('« Refuser » renvoie access_denied, sans code', async () => {
  const eric = await creerUtilisateur('Eric');
  const page = await connecter(env, eric);
  const retour = await capturerRetour(page);
  await page.goto((await demandeAutorisation()).url);
  await page.getByRole('button', { name: 'Refuser' }).click();
  await page.waitForURL(/^https:\/\/claude\.ai\//);
  const u = new URL(retour());
  assert.equal(u.searchParams.get('error'), 'access_denied');
  assert.equal(u.searchParams.get('code'), null);
});

test('sans session : connexion par lien magique, puis retour au consentement, même si le lien s\'ouvre dans un autre onglet', async () => {
  const eric = await creerUtilisateur('Eric');
  const ctx = await env.navigateur.newContext({ viewport: { width: 1366, height: 820 }, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const d = await demandeAutorisation();
  await page.goto(d.url);
  await page.getByRole('heading', { name: 'Connexion à KanbanX' }).waitFor();
  assert.match(await page.locator('main').innerText(), /Connectez-vous pour autoriser « Claude »/);
  reinitialiserLimites();
  await page.getByLabel('Adresse courriel').fill(eric.email);
  await page.getByRole('button', { name: 'Recevoir un lien de connexion' }).click();
  await page.getByText('un lien de connexion vient de lui être envoyé').waitFor();
  const lien = new URL(boiteDev.findLast((m) => m.a === eric.email).lien);
  // Le lien du courriel s'ouvre dans un nouvel onglet.
  const onglet = await ctx.newPage();
  await onglet.goto(`${env.base}/connexion/verifier${lien.search}`);
  await onglet.getByRole('heading', { name: 'Autoriser « Claude » à accéder à KanbanX ?' }).waitFor();
  await ctx.close();
});

test('Applications connectées : la liste montre l\'accès, « Retirer l\'accès » le coupe aussitôt', async () => {
  const eric = await creerUtilisateur('Eric');
  const page = await connecter(env, eric);
  const retour = await capturerRetour(page);
  const d = await demandeAutorisation();
  await page.goto(d.url);
  await page.getByRole('button', { name: 'Autoriser' }).click();
  await page.waitForURL(/^https:\/\/claude\.ai\//);
  reinitialiserLimites();
  const jetons = await (await fetch(`${env.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: new URL(retour()).searchParams.get('code'), client_id: d.client,
      redirect_uri: RETOUR, code_verifier: d.verificateur, resource: `${config.baseUrl}/mcp` }) })).json();
  const ping = () => fetch(`${env.base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jetons.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) }).then((r) => r.status);
  assert.equal(await ping(), 200);

  await page.goto(`${env.base}/`);
  await page.getByRole('link', { name: 'Applications connectées' }).click();
  await page.getByRole('heading', { name: 'Applications connectées' }).waitFor();
  const ligne = page.getByRole('listitem').filter({ hasText: 'Claude' });
  await ligne.waitFor();
  assert.match(await ligne.innerText(), /claude\.ai/);
  assert.deepEqual(await auditer(page, 'applications connectées'), []);
  await ligne.getByRole('button', { name: 'Retirer l\'accès de « Claude »' }).click();
  await page.getByRole('button', { name: 'Confirmer le retrait' }).click();
  await page.getByText('Aucune application n\'a accès à votre compte.').waitFor();
  assert.equal(await ping(), 401);
  assert.deepEqual(page.erreurs, []);
});
