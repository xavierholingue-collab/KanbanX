import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { environnement, connecter, creerUtilisateur } from './aide.js';

let env;
before(async () => { env = await environnement(); });
after(async () => { await env.fermer(); });

const colonne = (page, nom) => page.locator('section.colonne', { has: page.getByRole('heading', { name: nom, exact: true }) });
const titres = (page, nom) => colonne(page, nom).locator('.carte-lien').allTextContents();

async function nouveauTableau(page, nom) {
  await page.getByRole('button', { name: 'Créer un tableau' }).click();
  await page.getByLabel('Nom du tableau').fill(nom);
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'À faire', exact: true }).waitFor();
}

test('créer un tableau : il démarre avec À faire, En cours, Fait', async () => {
  const page = await connecter(env, await creerUtilisateur('Xavier'));
  await nouveauTableau(page, 'Projet Alpha');
  assert.deepEqual(await page.locator('section.colonne h2').allTextContents(), ['À faire', 'En cours', 'Fait']);
  assert.deepEqual(page.erreurs, []);
  await page.context().close();
});

test('ajouter trois cartes d\'affilée au clavier : le champ reste ouvert, Échap annule', async () => {
  const page = await connecter(env, await creerUtilisateur('Eric'));
  await nouveauTableau(page, 'Rafale');
  await page.keyboard.press('n'); // raccourci : nouvelle carte
  const champ = page.getByLabel('Titre de la nouvelle carte dans À faire');
  await champ.waitFor();
  for (const t of ['Première', 'Deuxième', 'Troisième']) {
    await page.keyboard.type(t);
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => document.querySelectorAll('.carte-lien[href]').length === 3);
  assert.deepEqual(await titres(page, 'À faire'), ['Première', 'Deuxième', 'Troisième']);
  assert.ok(await champ.isVisible(), 'le champ reste ouvert');
  assert.equal(await champ.evaluate((el) => el === document.activeElement), true, 'le focus reste dans le champ');
  await page.keyboard.type('Brouillon abandonné');
  await page.keyboard.press('Escape');
  assert.equal(await champ.count(), 0, 'Échap ferme le champ');
  await page.reload(); await page.locator('section.colonne').first().waitFor();
  assert.deepEqual(await titres(page, 'À faire'), ['Première', 'Deuxième', 'Troisième'], 'les cartes sont bien enregistrées');
  assert.deepEqual(page.erreurs, []);
  await page.context().close();
});

async function tableauAvecCartes(page, nom, cartes) {
  await nouveauTableau(page, nom);
  await page.getByRole('button', { name: 'Ajouter une carte' }).first().click();
  for (const t of cartes) { await page.keyboard.type(t); await page.keyboard.press('Enter'); }
  await page.keyboard.press('Escape');
  await page.waitForFunction((n) => document.querySelectorAll('.carte-lien[href]').length === n, cartes.length);
}

test('déplacer une carte à la souris : fantôme pendant le glisser, puis enregistrement', async () => {
  const page = await connecter(env, await creerUtilisateur('Alexis'));
  await tableauAvecCartes(page, 'Glisser', ['A', 'B']);
  const carte = colonne(page, 'À faire').locator('.carte', { hasText: 'A' });
  const cible = colonne(page, 'En cours').locator('.liste-cartes');
  const b1 = await carte.boundingBox();
  const b2 = await cible.boundingBox();
  await page.mouse.move(b1.x + 20, b1.y + 15);
  await page.mouse.down();
  await page.mouse.move(b1.x + 60, b1.y + 40, { steps: 5 });
  await page.mouse.move(b2.x + 40, b2.y + 10, { steps: 10 });
  assert.equal(await page.locator('.carte.fantome').count(), 1, 'un emplacement fantôme est visible');
  assert.equal(await colonne(page, 'En cours').locator('.carte.fantome').count(), 1, 'le fantôme est dans la colonne visée');
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.fantome'));
  assert.deepEqual(await titres(page, 'En cours'), ['A']);
  await page.waitForTimeout(300);
  await page.reload(); await page.locator('section.colonne').first().waitFor();
  assert.deepEqual(await titres(page, 'En cours'), ['A']);
  assert.deepEqual(await titres(page, 'À faire'), ['B']);
  await page.context().close();
});

test('déplacer une carte au clavier : Espace, flèches, Espace', async () => {
  const page = await connecter(env, await creerUtilisateur('Clavier'));
  await tableauAvecCartes(page, 'Clavier', ['Un', 'Deux', 'Trois']);
  await page.getByRole('link', { name: 'Un', exact: true }).focus();
  await page.keyboard.press(' ');
  assert.equal(await page.locator('.saisie-clavier').count(), 1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');
  await page.waitForFunction(() => !document.querySelector('.saisie-clavier'));
  assert.deepEqual(await titres(page, 'En cours'), ['Un']);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Un', 'le focus suit la carte');
  // Réordonner dans une colonne, puis annuler avec Échap
  await page.getByRole('link', { name: 'Trois', exact: true }).focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  assert.deepEqual(await titres(page, 'À faire'), ['Trois', 'Deux']);
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.deepEqual(await titres(page, 'À faire'), ['Trois', 'Deux']);
  await page.waitForTimeout(300);
  await page.reload(); await page.locator('section.colonne').first().waitFor();
  assert.deepEqual(await titres(page, 'À faire'), ['Trois', 'Deux']);
  assert.deepEqual(await titres(page, 'En cours'), ['Un']);
  await page.context().close();
});

test('réordonner les colonnes au clavier', async () => {
  const page = await connecter(env, await creerUtilisateur('Colonnes'));
  await nouveauTableau(page, 'Colonnes');
  await page.getByRole('button', { name: 'Déplacer la colonne Fait' }).focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  await page.reload(); await page.locator('section.colonne').first().waitFor();
  assert.deepEqual(await page.locator('section.colonne h2').allTextContents(), ['Fait', 'À faire', 'En cours']);
  await page.context().close();
});

test('modifier sur place : clic sur le titre d\'une colonne ; crayon sur une carte', async () => {
  const page = await connecter(env, await creerUtilisateur('Renomme'));
  await tableauAvecCartes(page, 'Sur place', ['Ancien titre']);
  await page.getByRole('button', { name: 'À faire', exact: true }).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Idées');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Renommer la carte Ancien titre' }).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Nouveau titre');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.reload(); await page.locator('section.colonne').first().waitFor();
  assert.deepEqual(await page.locator('section.colonne h2').allTextContents(), ['Idées', 'En cours', 'Fait']);
  assert.deepEqual(await titres(page, 'Idées'), ['Nouveau titre']);
  await page.context().close();
});

test('détail d\'une carte : fenêtre superposée avec sa propre adresse, partageable', async () => {
  const page = await connecter(env, await creerUtilisateur('Detail'));
  await tableauAvecCartes(page, 'Détail', ['Carte détaillée']);
  await page.getByRole('link', { name: 'Carte détaillée' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.match(page.url(), /\/b\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}$/);
  const adresse = page.url();
  // Description Markdown
  await dialog.getByRole('button', { name: 'Ajouter une description plus détaillée…' }).click();
  await page.keyboard.type('Du **gras** et <script>alert(1)</script>');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await dialog.locator('.markdown strong', { hasText: 'gras' }).waitFor();
  assert.equal(await dialog.locator('.markdown script').count(), 0);
  // Échéance
  await dialog.getByLabel('Échéance').fill('2026-12-24');
  await dialog.getByLabel('Échéance').dispatchEvent('change');
  // Responsable
  await dialog.getByRole('button', { name: 'Responsables', exact: true }).click();
  await page.getByRole('button', { name: /Detail/ }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/b\/[0-9a-f-]{36}$/);
  // Lien partagé : ouverture directe
  await page.goto(adresse);
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').locator('#titre-carte').textContent(), 'Carte détaillée');
  assert.equal(await page.getByRole('dialog').getByLabel('Échéance').inputValue(), '2026-12-24');
  await page.keyboard.press('Escape');
  await page.waitForURL(/\/b\/[0-9a-f-]{36}$/);
  assert.equal(await page.locator('.carte .avatar').count(), 1);
  assert.deepEqual(page.erreurs, []);
  await page.context().close();
});

test('droit à l\'erreur : archiver une carte puis Annuler', async () => {
  const page = await connecter(env, await creerUtilisateur('Annule'));
  await tableauAvecCartes(page, 'Annulation', ['À garder']);
  await page.getByRole('link', { name: 'À garder' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archiver' }).click();
  await page.getByText('Carte « À garder » archivée.').waitFor();
  assert.equal(await page.locator('.carte-lien').count(), 0);
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('link', { name: 'À garder' }).waitFor();
  await page.waitForTimeout(300);
  await page.reload(); await page.locator('section.colonne').first().waitFor();
  assert.equal(await page.locator('.carte-lien').count(), 1);
  await page.context().close();
});

test('réponse immédiate et retour arrière : en cas d\'échec, l\'écran revient avec un message clair', async () => {
  const page = await connecter(env, await creerUtilisateur('Echec'));
  await tableauAvecCartes(page, 'Échec', ['Stable']);
  await page.route('**/api/cards/*/move', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"erreur":{"code":"x","message":"Serveur indisponible."}}' }));
  await page.getByRole('link', { name: 'Stable' }).focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');
  await page.getByText('Déplacement annulé : Serveur indisponible.').waitFor();
  assert.deepEqual(await titres(page, 'À faire'), ['Stable']);
  await page.context().close();
});

test('recherche et filtres ; raccourcis / et ? ', async () => {
  const page = await connecter(env, await creerUtilisateur('Filtre'));
  await tableauAvecCartes(page, 'Filtres', ['Pomme', 'Poire', 'Cerise']);
  await page.keyboard.press('/');
  await page.keyboard.type('po');
  await page.waitForFunction(() => [...document.querySelectorAll('.carte')].filter((c) => !c.hidden).length === 2);
  assert.match(await page.locator('#compte-filtre').textContent(), /2 cartes sur 3/);
  await page.getByRole('button', { name: 'Effacer les filtres' }).click();
  await page.getByLabel('Filtrer par échéance').selectOption('sans');
  assert.equal(await page.locator('.carte:not([hidden])').count(), 3);
  await page.getByLabel('Filtrer par membre').selectOption({ label: 'Filtre' });
  assert.equal(await page.locator('.carte:not([hidden])').count(), 0);
  await page.locator('body').click({ position: { x: 5, y: 790 } });
  await page.keyboard.press('?');
  await page.getByRole('dialog', { name: 'Raccourcis clavier' }).waitFor();
  await page.keyboard.press('Escape');
  await page.context().close();
});

test('sur téléphone : colonnes qui défilent horizontalement, zones tactiles d\'au moins 44 px', async () => {
  const page = await connecter(env, await creerUtilisateur('Mobile'), { telephone: true });
  await tableauAvecCartes(page, 'Mobile', ['Tactile']);
  const zone = page.locator('.colonnes');
  const { scrollWidth, clientWidth, overflow } = await zone.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflow: getComputedStyle(el).overflowX }));
  assert.ok(scrollWidth > clientWidth && overflow === 'auto', 'défilement horizontal des colonnes');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'pas de défilement horizontal de la page');
  // Le lien d'une carte est étiré sur toute la carte (::after) : sa zone cliquable est la carte entière.
  const petites = await page.evaluate(() => [...document.querySelectorAll('button, a, input, select, textarea')]
    .filter((el) => el.offsetParent && !el.closest('.visuellement-cache') && !el.classList.contains('lien-evitement'))
    .map((el) => ({ t: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30), r: (el.matches('.carte-lien') ? el.closest('.carte') : el).getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && (r.height < 43.5 || r.width < 43.5))
    .map(({ t, r }) => `${t} ${Math.round(r.width)}×${Math.round(r.height)}`));
  assert.deepEqual(petites, [], 'cibles tactiles trop petites');
  await page.context().close();
});

test('un lecteur ne voit aucune commande d\'écriture', async () => {
  const [prop, lecteur] = [await creerUtilisateur('Prop'), await creerUtilisateur('Lecteur')];
  const p = await connecter(env, prop);
  await tableauAvecCartes(p, 'Lecture', ['Visible']);
  const id = p.url().split('/b/')[1];
  await p.getByRole('button', { name: /Membres du tableau/ }).click();
  await p.getByLabel('Adresse courriel').fill(lecteur.email);
  await p.getByLabel(/Prénom/).fill('Lecteur');
  await p.getByLabel('Rôle').selectOption('reader');
  await p.getByRole('button', { name: 'Inviter' }).click();
  await p.getByText('est invité').waitFor();
  const l = await connecter(env, lecteur);
  await l.goto(`${env.base}/b/${id}`);
  await l.getByText('Lecture seule').waitFor();
  assert.equal(await l.getByRole('button', { name: 'Ajouter une carte' }).count(), 0);
  assert.equal(await l.getByRole('button', { name: 'Ajouter une colonne' }).count(), 0);
  await p.context().close(); await l.context().close();
});
