// Parcours de bout en bout : vrai serveur (en processus) sur la base de test, vrai navigateur Chromium.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, devices } from 'playwright';
import { creerServeur } from '../src/serveur.js';
import { boiteDev } from '../src/courriel.js';
import { reinitialiserLimites } from '../src/securite.js';
import { admin, app, creerUtilisateur } from '../test/aide.js';

export async function environnement() {
  let srv = creerServeur();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const base = `http://localhost:${port}`;
  const navigateur = await chromium.launch();
  const arreter = async () => { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); };
  return {
    base, navigateur,
    /** Simule une livraison : le serveur s'arrête (flux en direct coupés) puis redémarre sur le même port. */
    async relancer() { await arreter(); srv = creerServeur(); await new Promise((r) => srv.listen(port, '127.0.0.1', r)); },
    async fermer() { await navigateur.close(); await arreter(); await admin.end(); await app.end(); },
  };
}

/** Ouvre un contexte (ordinateur ou téléphone) et connecte l'utilisateur par le vrai parcours du lien magique. */
export async function connecter(env, utilisateur, { telephone = false, sombre = false } = {}) {
  const ctx = await env.navigateur.newContext({ ...(telephone ? devices['Pixel 7'] : { viewport: { width: 1366, height: 820 } }), locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', colorScheme: sombre ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|404)/.test(m.text())) erreurs.push(m.text()); });
  page.erreurs = erreurs;
  reinitialiserLimites();
  await page.goto(`${env.base}/connexion`);
  await page.getByLabel('Adresse courriel').fill(utilisateur.email);
  await page.getByRole('button', { name: 'Recevoir un lien de connexion' }).click();
  await page.getByText('un lien de connexion vient de lui être envoyé').waitFor();
  const lien = new URL(boiteDev.findLast((m) => m.a === utilisateur.email).lien);
  await page.goto(`${env.base}/connexion/verifier${lien.search}`);
  await page.getByRole('heading', { name: 'Mes tableaux' }).waitFor();
  return page;
}

export { creerUtilisateur, admin };

/** Audit WCAG 2.2 AA (axe-core) de la page telle qu'elle est ; renvoie la liste des violations, vide si tout va bien. */
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
export async function auditer(page, contexte) {
  await page.evaluate(AXE); // injection par le protocole de débogage : n'est pas soumise à la CSP de la page
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }));
  return r.violations.map((v) => `${contexte} — ${v.id} : ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
}
