// Nuit 2, point 9 : rapatrier les images de Trello. Stockage en base (RLS), diffusion contrôlée, téléchargement
// fermé (hôtes de Trello seulement, pas d'adresse interne, délai, taille, 200 images au plus). Faux serveur Trello local.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { demarrer, utilisateurConnecte } from './serveur.js';
import { admin, fermer, commeUtilisateur, creerUtilisateur, creerTableau } from './aide.js';
import { typeImage } from '../src/images.js';
import { reglages, telechargerImage } from '../src/telechargement.js';
import { rendreMarkdown } from '../src/markdown.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

const CLE = 'cle-api-trello-fictive-0123456789';
const JETON = 'jeton-trello-fictif-ATTA0123456789abcdef';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('IHDR-donnees-png-fictives')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-fictif')]);
const GIF = Buffer.from('GIF89a-donnees-gif');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 fictif')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');

// ---------- Faux serveur Trello ----------
// Routes : /1/cards/:carte/attachments/:pj/download/:fichier ; comportement choisi par le nom du fichier.
let faux; let requetes = [];
function lancerFaux() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      requetes.push({ url: req.url, auth: req.headers.authorization ?? null, hote: req.headers.host });
      const f = req.url.split('/').pop();
      const corps = { 'photo.png': PNG, 'photo.jpg': JPEG, 'anim.gif': GIF, 'img.webp': WEBP, 'dessin.svg': SVG, 'faux.png': SVG }[f];
      if (f === 'lent.png') return; // ne répond jamais
      if (f === 'enorme.png') { res.writeHead(200); res.write(PNG); const bloc = Buffer.alloc(1024 * 1024); let n = 0; const t = setInterval(() => { if (n++ > 6 || res.destroyed) { clearInterval(t); return res.end(); } res.write(bloc); }, 5); return; }
      if (f === 'annonce-enorme.png') { res.writeHead(200, { 'Content-Length': String(6 * 1024 * 1024) }); return res.end(PNG); }
      if (f === 'vers-ailleurs.png') { res.writeHead(302, { Location: `http://pirate.exemple.invalid:${s.address().port}/1/cards/c1/attachments/a1/download/photo.png` }); return res.end(); }
      if (f === 'vers-interne.png') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }); return res.end(); }
      if (f === 'vers-s3.png') { res.writeHead(302, { Location: `http://trello-attachments.s3.amazonaws.com:${s.address().port}/s3/photo.png` }); return res.end(); }
      if (f === 'boucle.png') { res.writeHead(302, { Location: req.url }); return res.end(); }
      if (!corps) { res.writeHead(404); return res.end(); }
      // Le vrai Trello exige la clé et le jeton de la personne (sauf sur le stockage S3, déjà signé).
      if (!req.url.startsWith('/s3/') && req.headers.authorization !== `OAuth oauth_consumer_key="${CLE}", oauth_token="${JETON}"`) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/png' }); // le type annoncé n'est jamais cru
      res.end(corps);
    });
    s.listen(0, '127.0.0.1', () => r(s));
  });
}
const sauvegarde = { ...reglages };
before(async () => {
  faux = await lancerFaux();
  // Uniquement dans les tests : les hôtes de Trello résolvent vers le faux serveur, en http, sur la boucle locale.
  Object.assign(reglages, { protocoles: ['http:'], resoudre: async () => ({ address: '127.0.0.1', family: 4 }), adresseAutorisee: (ip) => ip === '127.0.0.1', delaiMs: 500 });
});
after(() => { Object.assign(reglages, sauvegarde); faux.close(); });
const url = (fichier, i = 0) => `http://trello.com:${faux.address().port}/1/cards/c1/attachments/a${i}/download/${fichier}`;

function exportAvec(fichiers) {
  return {
    name: 'Avec images', lists: [{ id: 'L1', name: 'À faire', pos: 1 }], labels: [], actions: [],
    cards: [{ id: 'c1', name: 'Maquettes', idList: 'L1', pos: 1, desc: `Voir ![capture](${url(fichiers[0])})`,
      attachments: fichiers.map((f, i) => ({ id: `a${i}`, name: f, url: url(f, i), isUpload: true, mimeType: f.endsWith('svg') ? 'image/svg+xml' : 'image/png' })) }],
  };
}
async function importer(qui, fichiers, auth = { cle: CLE, jeton: JETON }) {
  requetes = [];
  const r = await qui.post('/api/boards/import-trello', { trello: exportAvec(fichiers), ...(auth ? { trelloAuth: auth } : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = (await qui.get(`/api/boards/${r.data.id}`)).data;
  const carte = (await qui.get(`/api/cards/${t.columns[0].cards[0].id}`)).data;
  return { r, t, carte, ids: [...carte.description.matchAll(/\/api\/images\/([0-9a-f-]{36})/g)].map((m) => m[1]) };
}

// ---------- Reconnaissance par la signature ----------

test('images reconnues par leur signature, jamais par l\'extension : PNG, JPEG, GIF, WebP ; pas de SVG', () => {
  assert.equal(typeImage(PNG), 'image/png');
  assert.equal(typeImage(JPEG), 'image/jpeg');
  assert.equal(typeImage(GIF), 'image/gif');
  assert.equal(typeImage(WEBP), 'image/webp');
  for (const x of [SVG, Buffer.from('<html><script>alert(1)</script>'), Buffer.from('RIFF\0\0\0\0WAVE'), Buffer.alloc(0), Buffer.from([0x89, 0x50])]) assert.equal(typeImage(x), null);
});

// ---------- Import ----------

test('import avec clé et jeton : les images sont rapatriées en base, la description pointe vers KanbanX', async () => {
  const x = await utilisateurConnecte(srv.base, 'Xavier');
  const { carte, ids, r } = await importer(x, ['photo.png', 'photo.jpg', 'anim.gif', 'img.webp']);
  assert.equal(ids.length, 4, carte.description);
  assert.ok(!carte.description.includes(`${faux.address().port}/1/cards`), 'plus de lien vers Trello pour une image rapatriée');
  assert.match(carte.descriptionHtml, /<img src="\/api\/images\/[0-9a-f-]{36}" alt="capture" loading="lazy">/);
  assert.ok(requetes.every((q) => q.auth === `OAuth oauth_consumer_key="${CLE}", oauth_token="${JETON}"`));
  assert.equal(r.data.images, 4);
  const types = (await admin.query('select mime, taille from images where id = any($1::uuid[]) order by created_at', [ids])).rows;
  assert.deepEqual(types.map((t) => t.mime).sort(), ['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
});

test('diffusion : contrôle d\'accès, Content-Type fixé par le serveur, nosniff, inline, CSP sandbox', async () => {
  const x = await utilisateurConnecte(srv.base, 'Xavier');
  const { ids } = await importer(x, ['photo.png']);
  const lire = (qui) => fetch(`${srv.base}/api/images/${ids[0]}`, { headers: qui ? { Cookie: qui.cookie } : {} });
  const r = await lire(x);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-disposition'), 'inline');
  assert.match(r.headers.get('content-security-policy'), /^sandbox(;|$)/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
  const intrus = await utilisateurConnecte(srv.base, 'Intrus');
  assert.equal((await lire(intrus)).status, 404);
  assert.equal((await lire(null)).status, 401);
  assert.equal((await fetch(`${srv.base}/api/images/pas-un-uuid`, { headers: { Cookie: x.cookie } })).status, 400);
});

test('la clé et le jeton Trello ne sont jamais stockés ni journalisés', async () => {
  const x = await utilisateurConnecte(srv.base, 'Xavier');
  const journaux = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => { journaux.push(a.map(String).join(' ')); };
  let res;
  try { res = await importer(x, ['photo.png', 'dessin.svg', 'lent.png', 'vers-ailleurs.png']); } finally { Object.assign(console, orig); }
  assert.ok(!journaux.some((l) => l.includes(CLE) || l.includes(JETON)), journaux.join('\n'));
  const { rows } = await admin.query(`select count(*)::int n from (
      select description as t from cards where board_id = $1 union all select title from cards where board_id = $1
      union all select body from comments where board_id = $1 union all select data::text from activity where board_id = $1
      union all select encode(contenu, 'escape') from images where board_id = $1) x where t like '%' || $2 || '%' or t like '%' || $3 || '%'`,
  [res.r.data.id, CLE, JETON]);
  assert.equal(rows[0].n, 0);
});

test('SVG, faux PNG, hôte hors liste, adresse interne, boucle de redirections, lenteur, taille : l\'image reste un lien avec un encart clair', async () => {
  const x = await utilisateurConnecte(srv.base, 'Xavier');
  const fichiers = ['dessin.svg', 'faux.png', 'vers-ailleurs.png', 'vers-interne.png', 'boucle.png', 'lent.png', 'enorme.png', 'annonce-enorme.png'];
  const debut = Date.now();
  const { carte, ids } = await importer(x, fichiers);
  assert.ok(Date.now() - debut < 8000, 'délais respectés');
  assert.deepEqual(ids, []);
  for (const [i, f] of fichiers.entries()) {
    assert.ok(carte.description.includes(url(f, i)), `${f} reste un lien`);
  }
  assert.equal((carte.description.match(/Image restée sur Trello/g) ?? []).length, fichiers.length);
  assert.ok(!requetes.some((q) => /pirate|169\.254/.test(q.hote ?? '')), 'jamais contacté');
});

test('redirection vers le stockage de Trello : suivie, sans transmettre la clé ni le jeton', async () => {
  const x = await utilisateurConnecte(srv.base, 'Xavier');
  const { ids } = await importer(x, ['vers-s3.png']);
  assert.equal(ids.length, 1);
  const s3 = requetes.find((q) => q.url.startsWith('/s3/'));
  assert.ok(s3);
  assert.equal(s3.auth, null);
});

test('sans clé ni jeton : aucune requête vers Trello, les images restent des liens', async () => {
  const x = await utilisateurConnecte(srv.base, 'Xavier');
  const { carte, ids } = await importer(x, ['photo.png'], null);
  assert.deepEqual(ids, []);
  assert.equal(requetes.length, 0);
  assert.match(carte.description, /Image restée sur Trello/);
});

test('200 images au plus par import', async () => {
  const x = await utilisateurConnecte(srv.base, 'Xavier');
  const fichiers = Array.from({ length: 205 }, () => 'photo.png');
  const { ids, carte } = await importer(x, fichiers);
  assert.equal(requetes.length, 200);
  assert.equal(ids.length, 200);
  assert.equal((carte.description.match(/Image restée sur Trello/g) ?? []).length, 5);
});

// ---------- Téléchargement : garde-fous du réseau, sans le faux serveur ----------

test('pas d\'accès aux adresses internes : refusé avant toute connexion', async () => {
  const avant = { ...reglages };
  let connexions = 0;
  const piege = http.createServer((q, r) => { connexions++; r.end(PNG); });
  await new Promise((r) => piege.listen(0, '127.0.0.1', r));
  try {
    reglages.adresseAutorisee = sauvegarde.adresseAutorisee; // la vraie règle
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1']) {
      reglages.resoudre = async () => ({ address: ip, family: ip.includes(':') ? 6 : 4 });
      await assert.rejects(telechargerImage(`http://trello.com:${piege.address().port}/x.png`, {}), /adresse interne/, ip);
    }
    reglages.resoudre = sauvegarde.resoudre;
    reglages.protocoles = sauvegarde.protocoles;
    await assert.rejects(telechargerImage('http://trello.com/x.png', {}), /protocole/);
    await assert.rejects(telechargerImage('https://exemple.invalid/x.png', {}), /hôte refusé/);
    await assert.rejects(telechargerImage('https://trello.com.pirate.invalid/x.png', {}), /hôte refusé/);
    await assert.rejects(telechargerImage('https://127.0.0.1/x.png', {}), /hôte refusé/);
    await assert.rejects(telechargerImage('https://user:mdp@trello.com/x.png', {}), /adresse/);
  } finally { Object.assign(reglages, avant); piege.close(); }
  assert.equal(connexions, 0);
});

test('taille : une réponse plus grosse que 5 Mo est coupée pendant le téléchargement, annoncée ou non', async () => {
  for (const f of ['enorme.png', 'annonce-enorme.png']) {
    await assert.rejects(telechargerImage(url(f), { entetes: {} }), /trop volumineuse/, f);
  }
  await assert.rejects(telechargerImage(url('lent.png'), {}), /délai/);
  await assert.rejects(telechargerImage(url('boucle.png'), {}), /redirections/);
  const ok = await telechargerImage(url('photo.png'), { entetes: { Authorization: `OAuth oauth_consumer_key="${CLE}", oauth_token="${JETON}"` } });
  assert.deepEqual(ok, PNG);
});

// ---------- Base et rendu ----------

test('RLS : une image n\'est lisible que par les membres de son tableau, ajoutée seulement par un membre écrivain', async () => {
  const p = await creerUtilisateur('Proprio');
  const l = await creerUtilisateur('Lecteur');
  const e = await creerUtilisateur('Etranger');
  const { board } = await creerTableau(p, { reader: l });
  const ajouter = (u) => commeUtilisateur(u.id, (c) => c.query("insert into images (board_id, mime, taille, contenu, created_by) values ($1, 'image/png', $2, $3, $4)",
    [board.id, PNG.length, PNG, u.id]));
  await ajouter(p);
  await assert.rejects(ajouter(l), /row-level security/);
  await assert.rejects(ajouter(e), /row-level security/);
  const voir = (u) => commeUtilisateur(u.id, async (c) => (await c.query('select id from images where board_id = $1', [board.id])).rows.length);
  assert.equal(await voir(l), 1);
  assert.equal(await voir(e), 0);
  await assert.rejects(commeUtilisateur(p.id, (c) => c.query("insert into images (board_id, mime, taille, contenu, created_by) values ($1, 'image/svg+xml', 3, '\\x3c73', $2)", [board.id, p.id])), /check/);
  await assert.rejects(commeUtilisateur(p.id, (c) => c.query("insert into images (board_id, mime, taille, contenu, created_by) values ($1, 'image/png', $2, $3, $4)",
    [board.id, 6 * 1024 * 1024, PNG, p.id])), /check/);
});

test('Markdown : seule une image servie par KanbanX devient une balise <img>', () => {
  const id = '0b5d7a4e-1f2a-4c3b-9d8e-7f6a5b4c3d2e';
  assert.equal(rendreMarkdown(`![Ma "capture"](/api/images/${id})`), `<p><img src="/api/images/${id}" alt="Ma &quot;capture&quot;" loading="lazy"></p>`);
  for (const t of ['![x](https://pirate.invalid/a.png)', '![x](/api/images/../../etc)', '![x](javascript:alert(1))', `![x](/api/images/${id}" onerror="alert(1))`]) {
    assert.doesNotMatch(rendreMarkdown(t), /<img/, t);
  }
});
