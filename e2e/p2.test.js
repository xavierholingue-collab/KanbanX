import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { environnement, connecter, creerUtilisateur } from './aide.js';

let env;
before(async () => { env = await environnement(); });
after(async () => { await env.fermer(); });

test('commenter avec une mention : suggestion au clavier, rendu Markdown, mise à jour en direct chez l\'autre membre', async () => {
  const xavier = await creerUtilisateur('Xavier');
  const eric = await creerUtilisateur('Eric');
  const px = await connecter(env, xavier);
  await px.getByRole('button', { name: 'Créer un tableau' }).click();
  await px.getByLabel('Nom du tableau').fill('Discussions');
  await px.keyboard.press('Enter');
  await px.getByRole('heading', { name: 'À faire', exact: true }).waitFor();
  await px.getByRole('button', { name: 'Ajouter une carte' }).first().click();
  await px.keyboard.type('Sujet chaud');
  await px.keyboard.press('Enter');
  await px.keyboard.press('Escape');
  await px.getByRole('button', { name: /Membres du tableau/ }).click();
  await px.getByLabel('Adresse courriel').fill(eric.email);
  await px.getByLabel(/Prénom/).fill('Eric');
  await px.getByRole('button', { name: 'Inviter' }).click();
  await px.getByText('est invité').waitFor();
  await px.keyboard.press('Escape');
  const adresseTableau = px.url();

  // Eric ouvre le même tableau
  const pe = await connecter(env, eric);
  await pe.goto(adresseTableau);
  await pe.getByRole('link', { name: 'Sujet chaud' }).waitFor();

  // Xavier commente avec une mention choisie dans les suggestions
  await px.getByRole('link', { name: 'Sujet chaud' }).click();
  const champ = px.getByRole('combobox', { name: 'Nouveau commentaire' });
  await champ.click();
  await px.keyboard.type('Bonjour @er');
  await px.getByRole('listbox', { name: 'Membres à mentionner' }).waitFor();
  await px.keyboard.press('Enter');
  await px.keyboard.type('peux-tu **relire** ?');
  assert.equal(await champ.inputValue(), 'Bonjour @Eric peux-tu **relire** ?');
  await px.getByRole('button', { name: 'Commenter' }).click();
  const bulle = px.locator('.commentaire .bulle').last();
  await bulle.locator('.mention', { hasText: '@Eric' }).waitFor();
  assert.equal(await bulle.locator('strong').textContent(), 'relire');
  assert.equal(await champ.inputValue(), '', 'le champ est vidé');

  // En direct chez Eric : le compteur de commentaires apparaît sans recharger
  await pe.locator('.carte', { hasText: 'Sujet chaud' }).locator('.indic', { hasText: '1' }).waitFor({ timeout: 5000 });
  // Eric ouvre la carte, voit le commentaire et l'historique
  await pe.getByRole('link', { name: 'Sujet chaud' }).click();
  await pe.locator('.commentaire', { hasText: 'Bonjour' }).waitFor();
  await pe.getByRole('button', { name: 'Afficher l\'historique' }).click();
  await pe.getByText(/a créé cette carte/).waitFor();
  // Eric répond ; Xavier le voit en direct dans la fenêtre ouverte
  await pe.getByRole('combobox', { name: 'Nouveau commentaire' }).fill('Avec plaisir @Xavier');
  await pe.keyboard.press('Control+Enter');
  await px.locator('.commentaire', { hasText: 'Avec plaisir' }).waitFor({ timeout: 5000 });
  // Panneau d'activité du tableau
  await pe.keyboard.press('Escape');
  await pe.getByRole('button', { name: 'Activité' }).click();
  await pe.getByRole('dialog', { name: /Activité du tableau/ }).getByText(/Xavier a commenté la carte « Sujet chaud »/).waitFor();
  assert.deepEqual(px.erreurs, []);
  assert.deepEqual(pe.erreurs, []);
  await px.context().close(); await pe.context().close();
});

test('déplacer une carte chez l\'un met à jour l\'écran de l\'autre en direct', async () => {
  const a = await creerUtilisateur('Alpha');
  const b = await creerUtilisateur('Beta');
  const pa = await connecter(env, a);
  await pa.getByRole('button', { name: 'Créer un tableau' }).click();
  await pa.getByLabel('Nom du tableau').fill('Direct');
  await pa.keyboard.press('Enter');
  await pa.getByRole('heading', { name: 'À faire', exact: true }).waitFor();
  await pa.getByRole('button', { name: 'Ajouter une carte' }).first().click();
  await pa.keyboard.type('Voyageuse'); await pa.keyboard.press('Enter'); await pa.keyboard.press('Escape');
  await pa.getByRole('button', { name: /Membres du tableau/ }).click();
  await pa.getByLabel('Adresse courriel').fill(b.email);
  await pa.getByLabel(/Prénom/).fill('Beta');
  await pa.getByRole('button', { name: 'Inviter' }).click();
  await pa.getByText('est invité').waitFor();
  await pa.keyboard.press('Escape');
  const pb = await connecter(env, b);
  await pb.goto(pa.url());
  await pb.getByRole('link', { name: 'Voyageuse' }).waitFor();
  await pa.waitForTimeout(300);
  await pa.getByRole('link', { name: 'Voyageuse' }).focus();
  await pa.keyboard.press(' '); await pa.keyboard.press('ArrowRight'); await pa.keyboard.press(' ');
  await pb.locator('section.colonne', { has: pb.getByRole('heading', { name: 'En cours', exact: true }) }).getByRole('link', { name: 'Voyageuse' }).waitFor({ timeout: 5000 });
  await pa.context().close(); await pb.context().close();
});
