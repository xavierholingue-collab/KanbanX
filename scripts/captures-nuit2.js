// Captures des écrans nouveaux de la nuit 2 (ordinateur, téléphone, sombre) dans docs/captures/.
// Base de développement (docker compose up -d) ; données fictives créées pour l'occasion (adresses en exemple.invalid).
import { chromium, devices } from 'playwright';
import http from 'node:http';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { config } from '../src/config.js';
import { creerServeur } from '../src/serveur.js';
import { boiteDev } from '../src/courriel.js';
import { pool } from '../src/db.js';
import { migrer } from './migrer.js';
import * as S from '../src/services.js';
import * as D from '../src/services-discussions.js';
import { reglages } from '../src/telechargement.js';

config.env = 'test'; // pas de lien ni de courriel dans la console
await migrer(config.adminUrl, config.appPassword);
const DOSSIER = new URL('../docs/captures/', import.meta.url).pathname;
const admin = new pg.Pool({ connectionString: config.adminUrl, max: 2 });
const suffixe = randomUUID().slice(0, 6);
const personne = async (nom, kind = 'human') => (await admin.query('insert into users (email, name, kind) values ($1, $2, $3) returning *',
  [`${nom.toLowerCase()}-capture-${suffixe}@exemple.invalid`, nom, kind])).rows[0];
const xavier = await personne('Xavier');
const eric = await personne('Eric');
const cx = { user: xavier, via: 'web' }; const ce = { user: eric, via: 'web' };

// Données : un tableau partagé, des mentions dans les trois endroits, des éléments archivés, un tableau archivé.
const b = await S.creerTableau(cx, { name: 'Backlog à deux' });
await S.inviter(cx, b.id, { email: eric.email, name: 'Eric', role: 'member' });
const [aFaire, enCours] = b.columns;
const k1 = await S.creerCarte(cx, aFaire.id, { title: 'Relire le devis avec @Eric' });
await S.modifierCarte(cx, k1.id, { description: 'Le montant a changé. @Eric, peux-tu vérifier la ligne « hébergement » ?' });
await D.ajouterCommentaire(cx, k1.id, { body: '@Eric et @Claude : on valide vendredi ?' });
const k2 = await S.creerCarte(cx, aFaire.id, { title: 'Préparer la démo' });
await S.creerCarte(cx, enCours.id, { title: 'Brancher Claude par OAuth' });
const vieille = await S.creerCarte(cx, aFaire.id, { title: 'Ancienne piste : application mobile' });
await S.archiverCarte(cx, vieille.id);
const col = await S.creerColonne(cx, b.id, { name: 'Idées en vrac' });
await S.creerCarte(cx, col.id, { title: 'Thème sombre automatique' });
await S.archiverColonne(cx, col.id);
const ancien = await S.creerTableau(cx, { name: 'Prototype 2025' });
await S.archiverTableau(cx, ancien.id);
void k2;

// Faux serveur Trello pour l'import d'images (uniquement ici).
// Une vraie image PNG de 320 × 160 (bandes bleue et orange), fabriquée ici.
function png(l, h) {
  const bloc = (type, data) => { const t = Buffer.from(type); const n = Buffer.alloc(4); n.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(Buffer.concat([t, data]))); return Buffer.concat([n, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const lignes = [];
  for (let y = 0; y < h; y++) { const r = Buffer.alloc(1 + l * 3); for (let x = 0; x < l; x++) { const bleu = y < h * 0.7; r.set(bleu ? [10, 61, 115] : [194, 81, 0], 1 + x * 3); } lignes.push(r); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(Buffer.concat(lignes))), bloc('IEND', Buffer.alloc(0))]);
}
const PNG = png(320, 160);
const faux = http.createServer((q, r) => { r.writeHead(200); r.end(PNG); });
await new Promise((r) => faux.listen(0, '127.0.0.1', r));
Object.assign(reglages, { protocoles: ['http:'], resoudre: async () => ({ address: '127.0.0.1', family: 4 }), adresseAutorisee: (ip) => ip === '127.0.0.1' });
const pj = (n) => `http://trello.com:${faux.address().port}/1/cards/c1/attachments/a${n}/download/maquette-${n}.png`;
const exportTrello = {
  name: 'Site vitrine (Trello)', members: [{ id: 'm-eric', fullName: 'Eric Hoarau' }, { id: 'm-marie', fullName: 'Marie Exemple' }],
  lists: [{ id: 'L1', name: 'À faire', pos: 1 }], labels: [],
  cards: [{ id: 'c1', name: 'Maquette de l\'accueil', idList: 'L1', pos: 1, desc: 'Deux versions à comparer.',
    attachments: [{ id: 'a1', name: 'maquette-1.png', url: pj(1), isUpload: true, mimeType: 'image/png' },
      { id: 'a2', name: 'maquette-2.png', url: `https://trello.com/1/cards/c1/attachments/a2/download/maquette-2.png`, isUpload: true, mimeType: 'image/png' }] }],
  actions: [{ type: 'commentCard', date: '2026-10-01T09:00:00.000Z', idMemberCreator: 'm-eric', memberCreator: { id: 'm-eric', fullName: 'Eric Hoarau' }, data: { text: 'Je préfère la première.', card: { id: 'c1' } } },
    { type: 'commentCard', date: '2026-10-02T09:00:00.000Z', idMemberCreator: 'm-marie', memberCreator: { id: 'm-marie', fullName: 'Marie Exemple' }, data: { text: 'D\'accord.', card: { id: 'c1' } } }],
};

const srv = creerServeur();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://localhost:${srv.address().port}`;
const nav = await chromium.launch();
const ORDI = { viewport: { width: 1440, height: 900 } };
const TEL = devices['Pixel 7'];

async function session(u, opts) {
  const ctx = await nav.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', ...opts });
  const page = await ctx.newPage();
  await page.goto(`${base}/connexion`);
  await page.getByLabel('Adresse courriel').fill(u.email);
  await page.getByRole('button', { name: 'Recevoir un lien de connexion' }).click();
  await page.getByText('un lien de connexion vient de lui être envoyé').waitFor();
  const lien = new URL(boiteDev.findLast((m) => m.a === u.email).lien);
  await page.goto(`${base}/connexion/verifier${lien.search}`);
  await page.getByRole('heading', { name: 'Mes tableaux' }).waitFor();
  return page;
}
const cap = async (page, nom) => { await page.waitForTimeout(250); await page.screenshot({ path: `${DOSSIER}${nom}.png` }); };

for (const [nom, opts] of [['ordinateur', ORDI], ['telephone-sombre', { ...TEL, colorScheme: 'dark' }], ['ordinateur-sombre', { ...ORDI, colorScheme: 'dark' }]]) {
  const pe = await session(eric, opts);
  await pe.goto(`${base}/mentions`);
  await pe.locator('.mention-item').nth(2).waitFor();
  await cap(pe, `nuit2-01-mentions-${nom}`);
  await pe.goto(`${base}/compte`);
  await pe.getByRole('checkbox').waitFor();
  await cap(pe, `nuit2-02-compte-${nom}`);
  await pe.goto(`${base}/b/${b.id}`);
  await pe.getByRole('button', { name: 'Archives' }).click();
  await pe.getByRole('dialog', { name: 'Éléments archivés' }).getByText('Idées en vrac').waitFor();
  await cap(pe, `nuit2-03-archives-${nom}`);
  await pe.context().close();
  const pm = await nav.newPage(opts);
  await pm.goto(`${base}/mcp`);
  await cap(pm, `nuit2-04-page-mcp-${nom}`);
  await pm.close();
}

// Suggestions @ dans la description, archivage du tableau, accueil, import Trello (ordinateur et téléphone).
for (const [nom, opts] of [['ordinateur', ORDI], ['telephone', TEL]]) {
  const px = await session(xavier, opts);
  await px.goto(`${base}/b/${b.id}/c/${k1.id}`);
  const d = px.getByRole('dialog');
  await d.getByRole('button', { name: 'Modifier la description' }).click();
  const desc = d.getByRole('combobox', { name: 'Description (Markdown)' });
  await desc.press('End');
  await px.keyboard.type(' Merci @');
  await d.getByRole('listbox').waitFor();
  await cap(px, `nuit2-05-suggestions-description-${nom}`);
  await px.keyboard.press('Escape'); await px.keyboard.press('Escape'); await px.keyboard.press('Escape');
  await px.goto(`${base}/b/${b.id}`);
  await px.getByRole('button', { name: 'Archives' }).click();
  await px.getByRole('button', { name: 'Archiver le tableau' }).click();
  await cap(px, `nuit2-06-archiver-tableau-${nom}`);
  await px.keyboard.press('Escape');
  await px.goto(`${base}/`);
  await px.getByText(/Tableaux archivés/).click();
  await cap(px, `nuit2-07-accueil-tableaux-archives-${nom}`);
  await px.locator('#fichier-trello').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...exportTrello, name: `${exportTrello.name} ${nom}` })) });
  const imp = px.getByRole('dialog', { name: 'Auteurs des commentaires Trello' });
  await imp.waitFor();
  await imp.getByLabel('Clé d\'API Trello (facultative)').fill('cle-fictive-1234');
  await imp.getByLabel('Jeton Trello (facultatif)').fill('jeton-fictif-5678');
  await cap(px, `nuit2-08-import-trello-${nom}`);
  await imp.getByRole('button', { name: 'Importer le tableau' }).click();
  await px.getByRole('link', { name: 'Maquette de l\'accueil' }).click();
  await px.locator('.markdown img').first().waitFor();
  await px.locator('.commentaire', { hasText: 'Je préfère la première.' }).waitFor();
  await cap(px, `nuit2-09-carte-importee-${nom}`);
  await px.context().close();
}

await nav.close();
faux.close();
srv.closeAllConnections(); srv.close();
await pool.end(); await admin.end();
console.log(`Captures enregistrées dans ${DOSSIER}`);
