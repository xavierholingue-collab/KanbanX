import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { environnement, connecter, creerUtilisateur } from './aide.js';

let env;
before(async () => { env = await environnement(); });
after(async () => { await env.fermer(); });

test('limite d\'en-cours : alerte visuelle et textuelle en cas de dépassement', async () => {
  const page = await connecter(env, await creerUtilisateur('Wip'));
  await page.getByRole('button', { name: 'Créer un tableau' }).click();
  await page.getByLabel('Nom du tableau').fill('WIP');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'À faire', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Actions de la colonne À faire' }).click();
  await page.getByRole('button', { name: 'Limite d\'en-cours (WIP)…' }).click();
  await page.getByLabel('Nombre maximal de cartes dans la colonne').fill('2');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Ajouter une carte' }).first().click();
  for (const t of ['a', 'b']) { await page.keyboard.type(t); await page.keyboard.press('Enter'); }
  const col = page.locator('section.colonne').first();
  assert.equal(await col.evaluate((el) => el.classList.contains('depassement')), false);
  await page.keyboard.type('c'); await page.keyboard.press('Enter');
  await col.locator('.alerte-wip').waitFor();
  assert.match(await col.locator('.alerte-wip').textContent(), /3 cartes pour 2 maximum/);
  assert.equal(await col.locator('.colonne-compte').textContent(), '3 / 2');
  await page.context().close();
});

test('import d\'un export Trello depuis l\'accueil', async () => {
  const page = await connecter(env, await creerUtilisateur('Trello'));
  await page.locator('#fichier-trello').setInputFiles(fileURLToPath(new URL('../test/donnees/trello.json', import.meta.url)));
  await page.getByRole('heading', { name: 'À faire', exact: true }).waitFor();
  await page.locator('#toasts').getByText(/importé : 2 colonnes, 3 cartes, 1 commentaire\./).waitFor();
  assert.deepEqual(await page.locator('section.colonne h2').allTextContents(), ['À faire', 'En cours']);
  assert.equal(await page.locator('.carte-lien').first().textContent(), 'Première <script>alert(1)</script>');
  await page.context().close();
});
