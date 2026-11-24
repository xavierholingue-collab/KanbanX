// Nuit 2, point 6 : prévenir la personne mentionnée par courriel, regroupé (au plus un toutes les 10 minutes),
// désactivable ; file en base qui survit à un redémarrage ; un échec d'envoi est réessayé plus tard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { demarrer, utilisateurConnecte, agentAvecJeton } from './serveur.js';
import { admin, fermer, commeUtilisateur, creerUtilisateur, creerTableau } from './aide.js';
import { config } from '../src/config.js';
import { boiteMentions } from '../src/courriel.js';
import { traiterFileMentions } from '../src/notifications.js';
import { outil, claudePour } from './mcp-aide.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

async function scene() {
  const xavier = await utilisateurConnecte(srv.base, 'Xavier');
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const b = (await xavier.post('/api/boards', { name: 'Backlog partagé' })).data;
  await xavier.post(`/api/boards/${b.id}/members`, { email: eric.user.email, name: 'Eric', role: 'member' });
  const carte = (await xavier.post(`/api/columns/${b.columns[0].id}/cards`, { title: 'Devis fournisseur' })).data;
  return { xavier, eric, b, carte };
}
const recus = (u) => boiteMentions.filter((m) => m.a === u.email);
const file = async (u) => (await admin.query('select * from mention_emails where user_id = $1 order by id', [u.id])).rows;
/** Simule le temps qui passe : le dernier envoi date de `minutes` minutes. */
const vieillir = (u, minutes) => admin.query(`update mention_emails set sent_at = now() - ($2 || ' minutes')::interval where user_id = $1 and sent_at is not null`, [u.id, String(minutes)]);

test('un commentaire qui mentionne Eric : un courriel avec qui, quel tableau, quelle carte, un extrait court et le lien', async () => {
  const { xavier, eric, b, carte } = await scene();
  const long = `@Eric ${'peux-tu vérifier le montant du devis ? '.repeat(20)}FIN-SECRETE`;
  assert.equal((await xavier.post(`/api/cards/${carte.id}/comments`, { body: long })).status, 200);
  assert.equal(recus(eric.user).length, 0, 'rien ne part pendant la requête');
  await traiterFileMentions();
  const m = recus(eric.user);
  assert.equal(m.length, 1);
  assert.match(m[0].sujet, /mention/i);
  assert.ok(m[0].texte.includes('Xavier'));
  assert.ok(m[0].texte.includes('Backlog partagé'));
  assert.ok(m[0].texte.includes('Devis fournisseur'));
  assert.ok(m[0].texte.includes(`${config.baseUrl}/b/${b.id}/c/${carte.id}`));
  assert.ok(!m[0].texte.includes('FIN-SECRETE'), 'extrait limité');
  const extrait = m[0].texte.match(/« (@Eric[^»]*) »/)[1];
  assert.ok(extrait.length <= 200, `extrait de ${extrait.length} caractères`);
  assert.ok(!m[0].texte.includes(xavier.user.email), 'aucune adresse dans le message');
  // Rien n'est envoyé deux fois.
  await traiterFileMentions();
  assert.equal(recus(eric.user).length, 1);
});

test('regroupé : au plus un courriel toutes les 10 minutes, qui liste les mentions reçues depuis le précédent', async () => {
  const { xavier, eric, carte } = await scene();
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Eric premier' });
  await traiterFileMentions();
  assert.equal(recus(eric.user).length, 1);
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Eric deuxième' });
  await xavier.patch(`/api/cards/${carte.id}`, { description: 'Voir avec @Eric' });
  await traiterFileMentions();
  assert.equal(recus(eric.user).length, 1, 'moins de 10 minutes : on attend');
  await vieillir(eric.user, 9);
  await traiterFileMentions();
  assert.equal(recus(eric.user).length, 1);
  await vieillir(eric.user, 11);
  await traiterFileMentions();
  const m = recus(eric.user);
  assert.equal(m.length, 2);
  assert.match(m[1].sujet, /2 nouvelles mentions/);
  assert.ok(m[1].texte.includes('deuxième'));
  assert.ok(m[1].texte.includes('Voir avec @Eric'));
  assert.ok(!m[1].texte.includes('premier'), 'seulement depuis le précédent');
});

test('titre et description : un courriel par mention nouvelle, pas pour une faute corrigée', async () => {
  const { xavier, eric, b } = await scene();
  const c = (await xavier.post(`/api/columns/${b.columns[0].id}/cards`, { title: 'Relance @Eric' })).data;
  await xavier.patch(`/api/cards/${c.id}`, { title: 'Relancer @Eric' });
  assert.equal((await file(eric.user)).length, 1);
});

test('jamais pour une mention de soi-même, jamais vers un compte agent, jamais pour « @Claude »', async () => {
  const { xavier, b, carte } = await scene();
  const robot = await agentAvecJeton(srv.base, 'Robot');
  await xavier.post(`/api/boards/${b.id}/members`, { email: robot.user.email, name: 'Robot', role: 'member' });
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Xavier note pour moi, @Robot et @Claude' });
  await xavier.patch(`/api/cards/${carte.id}`, { description: '@Xavier @Robot @Claude' });
  // Claude pour Xavier qui cite Xavier : c'est encore Xavier qui se mentionne.
  const pourXavier = await claudePour(srv.base, xavier);
  await outil(srv.base, pourXavier, 'ajouter_commentaire', { carte_id: carte.id, texte: '@Xavier fait.' });
  assert.deepEqual(await file(xavier.user), []);
  assert.deepEqual(await file(robot.user), []);
  assert.equal((await admin.query('select count(*)::int n from mention_emails where board_id = $1', [b.id])).rows[0].n, 0);
});

test('désactivable par la personne dans son compte', async () => {
  const { xavier, eric, carte } = await scene();
  assert.equal((await eric.get('/api/me')).data.user.mentionEmails, true);
  const r = await eric.patch('/api/me/preferences', { mentionEmails: false });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await eric.get('/api/me')).data.user.mentionEmails, false);
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Eric silence' });
  await traiterFileMentions();
  assert.equal(recus(eric.user).length, 0);
  // Réactivé : les mentions faites pendant la désactivation ne partent pas après coup.
  await eric.patch('/api/me/preferences', { mentionEmails: true });
  await traiterFileMentions();
  assert.equal(recus(eric.user).length, 0);
  assert.equal((await eric.patch('/api/me/preferences', { mentionEmails: 'oui' })).status, 400);
});

test('RLS : la préférence ne se change que pour soi ; la file n\'est ni lisible ni modifiable par l\'application', async () => {
  const a = await creerUtilisateur('Anna');
  const bb = await creerUtilisateur('Basile');
  const { board, carte } = await creerTableau(a, { member: bb });
  const r = await commeUtilisateur(a.id, (c) => c.query('update users set mention_emails = false where id = $1', [bb.id]));
  assert.equal(r.rowCount, 0);
  await assert.rejects(commeUtilisateur(a.id, (c) => c.query('update users set name = $2 where id = $1', [a.id, 'Pirate'])), /permission denied/);
  assert.equal((await commeUtilisateur(a.id, (c) => c.query('update users set mention_emails = false where id = $1', [a.id]))).rowCount, 1);
  await assert.rejects(commeUtilisateur(a.id, (c) => c.query('select * from mention_emails')), /permission denied/);
  await assert.rejects(commeUtilisateur(a.id, (c) => c.query('update mention_emails set sent_at = now()')), /permission denied/);
  const inserer = (qui, auteur) => commeUtilisateur(qui.id, (c) => c.query(
    "insert into mention_emails (user_id, board_id, card_id, author_id, lieu, extrait) values ($1, $2, $3, $4, 'commentaire', 'x')", [bb.id, board.id, carte.id, auteur.id]));
  await assert.rejects(inserer(a, bb), /row-level security/, 'au nom d\'un autre');
  const etranger = await creerUtilisateur('Etranger');
  await assert.rejects(inserer(etranger, etranger), /row-level security/, 'hors du tableau');
  await inserer(a, a);
});

test('la file survit à un redémarrage du serveur', async () => {
  const { xavier, eric, carte } = await scene();
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Eric avant la relance' });
  await srv.fermer();
  srv = await demarrer();
  await traiterFileMentions();
  assert.equal(recus(eric.user).length, 1);
});

/** Faux serveur SMTP local ; `refuser` : répond 451 au DATA (panne passagère). */
function fauxSmtp({ refuser = false } = {}) {
  const recu = { commandes: [], data: '' };
  const s = net.createServer((sock) => {
    let tampon = ''; let enData = false;
    sock.write('220 faux ESMTP\r\n');
    sock.on('data', (d) => {
      tampon += d;
      let i;
      while ((i = tampon.indexOf('\r\n')) >= 0) {
        const ligne = tampon.slice(0, i); tampon = tampon.slice(i + 2);
        if (enData) { if (ligne === '.') { enData = false; sock.write('250 OK\r\n'); } else recu.data += `${ligne}\n`; continue; }
        recu.commandes.push(ligne);
        if (/^EHLO/.test(ligne)) sock.write('250 faux\r\n');
        else if (/^DATA/.test(ligne)) { if (refuser) sock.write('451 plus tard\r\n'); else { enData = true; sock.write('354 go\r\n'); } }
        else if (/^QUIT/.test(ligne)) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, recu, port: s.address().port })));
}

test('un échec d\'envoi est réessayé plus tard, sans bloquer la requête qui a mentionné', async () => {
  const { xavier, eric, carte } = await scene();
  const panne = await fauxSmtp({ refuser: true });
  const avant = config.smtpUrl;
  config.smtpUrl = `smtp://127.0.0.1:${panne.port}?tls=non`;
  try {
    await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Eric pendant la panne' });
    await traiterFileMentions(); // ne lève pas
    let [ligne] = await file(eric.user);
    assert.equal(ligne.sent_at, null);
    assert.equal(ligne.tentatives, 1);
    assert.ok(new Date(ligne.prochain_essai_at) > new Date(), 'réessai plus tard');
    await traiterFileMentions();
    [ligne] = await file(eric.user);
    assert.equal(ligne.tentatives, 1, 'pas de nouvel essai avant l\'heure');
    panne.s.close();
    const ok = await fauxSmtp();
    config.smtpUrl = `smtp://127.0.0.1:${ok.port}?tls=non`;
    await admin.query('update mention_emails set prochain_essai_at = now() where user_id = $1', [eric.user.id]);
    await traiterFileMentions();
    ok.s.close();
    [ligne] = await file(eric.user);
    assert.ok(ligne.sent_at, 'envoyé au second essai');
    assert.ok(ok.recu.commandes.includes(`RCPT TO:<${eric.user.email}>`));
    // En-têtes conformes, comme le lien de connexion.
    assert.match(ok.recu.data, /^Subject: KanbanX : une nouvelle mention$/m);
    assert.match(ok.recu.data, /^Message-ID: </m);
    assert.match(ok.recu.data, /^Date: /m);
    assert.match(ok.recu.data, /^Content-Type: text\/plain; charset=utf-8$/m);
  } finally { config.smtpUrl = avant; panne.s.close(); }
});
