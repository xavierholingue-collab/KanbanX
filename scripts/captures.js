// Captures d'écran des écrans principaux (ordinateur et téléphone) dans docs/captures/.
// Utilise la base de développement (données de démonstration) : docker compose up -d && npm start au moins une fois avant.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { creerServeur } from '../src/serveur.js';
import { boiteDev } from '../src/courriel.js';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';

config.env = 'test'; // pas de lien dans la console
const DOSSIER = new URL('../docs/captures/', import.meta.url).pathname;
mkdirSync(DOSSIER, { recursive: true });
const srv = creerServeur();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://localhost:${srv.address().port}`;
const nav = await chromium.launch();

async function session(email, opts) {
  const ctx = await nav.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', ...opts });
  const page = await ctx.newPage();
  await page.goto(`${base}/connexion`);
  await page.getByLabel('Adresse courriel').fill(email);
  await page.getByRole('button', { name: 'Recevoir un lien de connexion' }).click();
  await page.getByText('un lien de connexion vient de lui être envoyé').waitFor();
  const lien = new URL(boiteDev.findLast((m) => m.a === email).lien);
  await page.goto(`${base}/connexion/verifier${lien.search}`);
  await page.getByRole('heading', { name: 'Mes tableaux' }).waitFor();
  return page;
}
const cap = (page, nom) => page.screenshot({ path: `${DOSSIER}${nom}.png` });

for (const [suffixe, opts] of [['ordinateur', { viewport: { width: 1440, height: 900 } }], ['telephone', devices['Pixel 7']]]) {
  const anonyme = await nav.newPage(opts.viewport ? { viewport: opts.viewport } : { ...devices['Pixel 7'] });
  await anonyme.goto(`${base}/connexion`);
  await anonyme.getByLabel('Adresse courriel').waitFor();
  await cap(anonyme, `01-connexion-${suffixe}`);
  await anonyme.close();

  const page = await session('xavier@kanbanx.invalid', opts);
  await cap(page, `02-accueil-${suffixe}`);
  await page.getByRole('link', { name: /Lancement de KanbanX/ }).click();
  await page.getByRole('heading', { name: 'À faire', exact: true }).waitFor();
  await page.waitForTimeout(300);
  await cap(page, `03-tableau-${suffixe}`);
  await page.getByRole('link', { name: 'Brancher Claude au serveur MCP' }).click();
  await page.locator('.commentaire').first().waitFor();
  await page.waitForTimeout(300);
  await cap(page, `04-carte-discussion-${suffixe}`);
  if (suffixe === 'ordinateur') {
    await page.getByRole('combobox', { name: 'Nouveau commentaire' }).click();
    await page.keyboard.type('Merci @a');
    await page.getByRole('listbox').waitFor();
    await cap(page, '05-mention-ordinateur');
    await page.keyboard.press('Escape'); // ferme les suggestions
    await page.keyboard.press('Escape'); // quitte le champ (le brouillon est conservé)
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/b\/[0-9a-f-]+$/);
  // Glisser au clavier : la carte saisie et son emplacement
  await page.getByRole('link', { name: 'Choisir la palette de couleurs' }).focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowRight');
  await cap(page, `06-glisser-clavier-${suffixe}`);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Activité' }).click();
  await page.getByRole('dialog').locator('.activite').first().waitFor();
  await cap(page, `07-activite-${suffixe}`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await page.keyboard.type('claude');
  await cap(page, `08-recherche-${suffixe}`);
  await page.context().close();
}
// Mode sombre et raccourcis
const sombre = await session('eric@kanbanx.invalid', { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
await sombre.getByRole('link', { name: /Lancement de KanbanX/ }).click();
await sombre.getByRole('heading', { name: 'À faire', exact: true }).waitFor();
await sombre.waitForTimeout(300);
await cap(sombre, '09-tableau-sombre-ordinateur');
await sombre.locator('body').click({ position: { x: 1300, y: 800 } });
await sombre.keyboard.press('?');
await sombre.getByRole('dialog', { name: 'Raccourcis clavier' }).waitFor();
await cap(sombre, '10-raccourcis-sombre-ordinateur');
await sombre.context().close();

await nav.close();
srv.closeAllConnections(); srv.close(); await pool.end();
console.log(`Captures enregistrées dans ${DOSSIER}`);
