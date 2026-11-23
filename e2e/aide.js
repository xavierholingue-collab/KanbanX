// Parcours de bout en bout : vrai serveur (en processus) sur la base de test, vrai navigateur Chromium.
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
