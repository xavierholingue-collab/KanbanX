// Nuit 2 : parcours navigateur des écrans nouveaux, avec audit d'accessibilité axe (clair, sombre, téléphone).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { environnement, connecter, creerUtilisateur, admin, auditer } from './aide.js';

let env;
before(async () => { env = await environnement(); });
after(async () => { await env.fermer(); });

/** Tableau « Backlog » de Xavier, avec Eric membre et une carte « Préparer la démo ». */
async function scene() {
  const xavier = await creerUtilisateur('Xavier');
  const eric = await creerUtilisateur('Eric');
  const b = (await admin.query("insert into boards (name, created_by) values ('Backlog', $1) returning *", [xavier.id])).rows[0];
  await admin.query("insert into board_members (board_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')", [b.id, xavier.id, eric.id]);
  const col = (await admin.query("insert into columns (board_id, name, position) values ($1, 'À faire', 1024) returning *", [b.id])).rows[0];
  const carte = (await admin.query("insert into cards (board_id, column_id, title, position, created_by) values ($1, $2, 'Préparer la démo', 1024, $3) returning *",
    [b.id, col.id, xavier.id])).rows[0];
  return { xavier, eric, b, col, carte };
}

test('point 2 : suggestions @ dans la description et le titre ; Eric retrouve ses mentions avec l\'endroit', async () => {
  const { xavier, eric, b, carte } = await scene();
  const px = await connecter(env, xavier);
  await px.goto(`${env.base}/b/${b.id}/c/${carte.id}`);
  const dialog = px.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Ajouter une description plus détaillée…' }).click();
  const desc = dialog.getByRole('combobox', { name: 'Description (Markdown)' });
  await desc.focus();
  await px.keyboard.type('Merci @er');
  await dialog.getByRole('listbox', { name: 'Membres à mentionner' }).getByRole('option', { name: /Eric/ }).waitFor();
  await px.keyboard.press('Enter'); // choisit la suggestion, n'enregistre pas
  await px.keyboard.type('pour le budget.');
  assert.equal(await desc.inputValue(), 'Merci @Eric pour le budget.');
  await px.keyboard.press('Control+Enter');
  await dialog.locator('.markdown .mention', { hasText: '@Eric' }).waitFor();

  // Titre : la suggestion s'ouvre aussi ; Entrée choisit, une seconde Entrée enregistre.
  await dialog.getByRole('button', { name: 'Préparer la démo' }).click();
  const titre = dialog.getByRole('combobox', { name: 'Titre de la carte' });
  await titre.press('End');
  await px.keyboard.type(' avec @E');
  await dialog.getByRole('listbox', { name: 'Membres à mentionner' }).waitFor();
  await px.keyboard.press('Enter');
  assert.equal(await titre.inputValue(), 'Préparer la démo avec @Eric ');
  await px.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Préparer la démo avec @Eric' }).waitFor();

  // Eric : écran « Mes mentions » depuis l'en-tête.
  const pe = await connecter(env, eric);
  await pe.getByRole('link', { name: 'Mes mentions' }).click();
  await pe.getByRole('heading', { name: 'Mes mentions' }).waitFor();
  const items = pe.locator('.mention');
  await items.nth(1).waitFor();
  const textes = await items.evaluateAll((els) => els.map((e) => e.querySelector('p').textContent));
  assert.deepEqual(textes, ['Xavier vous a mentionné dans le titre de Préparer la démo avec @Eric',
    'Xavier vous a mentionné dans la description de Préparer la démo avec @Eric']);
  assert.equal(await items.nth(1).locator('blockquote').textContent(), 'Merci @Eric pour le budget.');
  const v = await auditer(pe, 'mes mentions (clair)');
  await pe.emulateMedia({ colorScheme: 'dark' });
  v.push(...await auditer(pe, 'mes mentions (sombre)'));
  assert.deepEqual(v, []);
  // Le lien ouvre la carte.
  await items.nth(1).getByRole('link').click();
  await pe.getByRole('dialog').getByText('Merci').waitFor();
  assert.deepEqual(pe.erreurs, []);
  assert.deepEqual(px.erreurs, []);
  await px.context().close(); await pe.context().close();
});

test('point 2 : « Mes mentions » sur téléphone, en sombre, et suggestions dans l\'ajout de carte', async () => {
  const { xavier, eric, b } = await scene();
  const px = await connecter(env, xavier, { telephone: true, sombre: true });
  await px.goto(`${env.base}/b/${b.id}`);
  await px.getByRole('button', { name: 'Ajouter une carte' }).first().click();
  await px.keyboard.type('Appeler @Er');
  await px.getByRole('listbox', { name: 'Membres à mentionner' }).waitFor();
  const v = await auditer(px, 'ajout de carte avec suggestions (téléphone, sombre)');
  await px.keyboard.press('Enter');
  await px.keyboard.type('demain');
  await px.keyboard.press('Enter');
  await px.getByRole('link', { name: 'Appeler @Eric demain' }).waitFor();
  const pe = await connecter(env, eric, { telephone: true, sombre: true });
  await pe.goto(`${env.base}/mentions`);
  await pe.locator('.mention', { hasText: 'dans le titre de' }).waitFor();
  v.push(...await auditer(pe, 'mes mentions (téléphone, sombre)'));
  assert.deepEqual(v, []);
  const largeur = await pe.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.equal(largeur, true, 'pas de défilement horizontal');
  await px.context().close(); await pe.context().close();
});

test('point 3 : « @Claude » est proposé dans les suggestions même sans compte Claude membre, et mis en évidence', async () => {
  const { xavier, b, carte } = await scene();
  const px = await connecter(env, xavier);
  await px.goto(`${env.base}/b/${b.id}/c/${carte.id}`);
  const champ = px.getByRole('combobox', { name: 'Nouveau commentaire' });
  await champ.click();
  await px.keyboard.type('@cl');
  await px.getByRole('option', { name: /Claude — le Claude de chaque membre/ }).waitFor();
  const v = await auditer(px, 'suggestion @Claude');
  await px.keyboard.press('Enter');
  await px.keyboard.type('résume la carte');
  await px.keyboard.press('Control+Enter');
  await px.locator('.commentaire .bulle .mention', { hasText: '@Claude' }).waitFor();
  assert.deepEqual(v, []);
  assert.deepEqual(px.erreurs, []);
  await px.context().close();
});
