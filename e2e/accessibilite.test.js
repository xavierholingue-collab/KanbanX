// Audit WCAG 2.2 AA automatisé (axe-core) des écrans principaux, en clair et en sombre, ordinateur et téléphone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { environnement, connecter, creerUtilisateur } from './aide.js';

const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let env;
before(async () => { env = await environnement(); });
after(async () => { await env.fermer(); });

async function auditer(page, contexte) {
  // Injection par le protocole de débogage : n'est pas soumise à la CSP de la page.
  await page.evaluate(axe);
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }));
  const violations = r.violations.map((v) => `${contexte} — ${v.id} : ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  return violations;
}

async function parcours(page) {
  const v = [];
  v.push(...await auditer(page, 'accueil'));
  await page.getByRole('button', { name: 'Créer un tableau' }).click();
  await page.getByLabel('Nom du tableau').fill('Audit');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'À faire', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ajouter une carte' }).first().click();
  for (const t of ['Une carte', 'Une autre']) { await page.keyboard.type(t); await page.keyboard.press('Enter'); }
  await page.waitForFunction(() => document.querySelectorAll('.carte-lien[href]').length === 2);
  v.push(...await auditer(page, 'tableau avec composeur'));
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Une carte' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Étiquettes', exact: true }).click();
  v.push(...await auditer(page, 'détail de carte + menu étiquettes'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Membres du tableau/ }).click();
  v.push(...await auditer(page, 'membres'));
  return v;
}

for (const [nom, opts] of [['ordinateur, clair', {}], ['téléphone, sombre', { telephone: true, sombre: true }]]) {
  test(`aucune violation WCAG 2.2 AA détectée (${nom})`, async () => {
    const page = await connecter(env, await creerUtilisateur('Audit'), opts);
    if (opts.sombre) await page.emulateMedia({ colorScheme: 'dark' });
    const v = [];
    await page.goto(`${env.base}/`);
    await page.getByRole('heading', { name: 'Mes tableaux' }).waitFor();
    v.push(...await parcours(page));
    const anonyme = await env.navigateur.newPage({ colorScheme: opts.sombre ? 'dark' : 'light' });
    await anonyme.goto(`${env.base}/connexion`);
    await anonyme.getByLabel('Adresse courriel').waitFor();
    v.push(...await auditer(anonyme, 'connexion'));
    await anonyme.close();
    assert.deepEqual(v, []);
    await page.context().close();
  });
}

test('focus visible : chaque élément atteint au clavier a un contour de focus', async () => {
  const page = await connecter(env, await creerUtilisateur('Focus'));
  await page.getByRole('button', { name: 'Créer un tableau' }).click();
  await page.getByLabel('Nom du tableau').fill('Focus');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'À faire', exact: true }).waitFor();
  await page.locator('body').click({ position: { x: 2, y: 400 } });
  const sansContour = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el); const a = getComputedStyle(el, '::after');
      const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || (a.outlineStyle !== 'none' && parseFloat(a.outlineWidth) >= 2);
      return { nom: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.tagName, visible };
    });
    if (r && !r.visible) sansContour.push(r.nom);
  }
  assert.deepEqual(sansContour, []);
  await page.context().close();
});
