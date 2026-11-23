// P2 : commentaires, mentions, historique d'activité, mises à jour en direct (SSE).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { demarrer, utilisateurConnecte, agentAvecJeton } from './serveur.js';
import { admin, fermer } from './aide.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

async function equipe() {
  const [prop, membre, lecteur, intrus] = await Promise.all(['Xavier', 'Éric', 'Lecteur', 'Intrus'].map((n) => utilisateurConnecte(srv.base, n)));
  const b = (await prop.post('/api/boards', { name: 'Discussions' })).data;
  await prop.post(`/api/boards/${b.id}/members`, { email: membre.user.email, name: 'Éric', role: 'member' });
  await prop.post(`/api/boards/${b.id}/members`, { email: lecteur.user.email, name: 'Lecteur', role: 'reader' });
  const carte = (await prop.post(`/api/columns/${b.columns[0].id}/cards`, { title: 'Sujet' })).data;
  return { prop, membre, lecteur, intrus, b, carte };
}

test('fil de commentaires : Markdown nettoyé, auteur, ordre chronologique', async () => {
  const { prop, membre, carte } = await equipe();
  assert.equal((await prop.post(`/api/cards/${carte.id}/comments`, { body: 'Premier **message**' })).status, 200);
  await membre.post(`/api/cards/${carte.id}/comments`, { body: '<img src=x onerror=alert(1)> [x](javascript:alert(1))' });
  const fil = (await prop.get(`/api/cards/${carte.id}/comments`)).data;
  assert.deepEqual(fil.map((c) => c.author.name), ['Xavier', 'Éric']);
  assert.equal(fil[0].html, '<p>Premier <strong>message</strong></p>');
  assert.doesNotMatch(fil[1].html, /<img|href="javascript/);
  assert.equal(fil[1].body, '<img src=x onerror=alert(1)> [x](javascript:alert(1))');
});

test('mentions @prénom : seuls les membres du tableau sont résolus (accents et casse ignorés)', async () => {
  const { prop, membre, intrus, carte } = await equipe();
  const c = (await prop.post(`/api/cards/${carte.id}/comments`, { body: 'Merci @eric et @Intrus et @Xavier' })).data;
  assert.deepEqual(c.mentions.sort(), [membre.user.id, prop.user.id].sort());
  assert.match(c.html, /<span class="mention">@eric<\/span>/);
  assert.doesNotMatch(c.html, /<span class="mention">@Intrus/);
  assert.ok(!c.mentions.includes(intrus.user.id));
});

test('droits : un intrus ne lit ni n\'écrit (404) ; un lecteur lit mais ne commente pas (403)', async () => {
  const { prop, lecteur, intrus, carte, b } = await equipe();
  await prop.post(`/api/cards/${carte.id}/comments`, { body: 'confidentiel' });
  assert.equal((await intrus.get(`/api/cards/${carte.id}/comments`)).status, 404);
  assert.equal((await intrus.post(`/api/cards/${carte.id}/comments`, { body: 'x' })).status, 404);
  assert.equal((await intrus.get(`/api/cards/${carte.id}/activity`)).status, 404);
  assert.equal((await intrus.get(`/api/boards/${b.id}/activity`)).status, 404);
  assert.equal((await lecteur.get(`/api/cards/${carte.id}/comments`)).status, 200);
  assert.equal((await lecteur.post(`/api/cards/${carte.id}/comments`, { body: 'x' })).status, 403);
});

test('seul l\'auteur modifie ou supprime son commentaire ; la suppression est annulable', async () => {
  const { prop, membre, intrus, carte } = await equipe();
  const c = (await prop.post(`/api/cards/${carte.id}/comments`, { body: 'à moi' })).data;
  assert.equal((await membre.patch(`/api/comments/${c.id}`, { body: 'volé' })).status, 403);
  assert.equal((await membre.delete(`/api/comments/${c.id}`)).status, 403);
  assert.equal((await intrus.patch(`/api/comments/${c.id}`, { body: 'volé' })).status, 404);
  const m = await prop.patch(`/api/comments/${c.id}`, { body: 'corrigé' });
  assert.equal(m.status, 200);
  assert.ok(m.data.editedAt);
  assert.equal((await prop.delete(`/api/comments/${c.id}`)).status, 200);
  assert.equal((await prop.get(`/api/cards/${carte.id}/comments`)).data.length, 0);
  assert.equal((await prop.post(`/api/comments/${c.id}/restore`)).status, 200);
  assert.equal((await prop.get(`/api/cards/${carte.id}/comments`)).data[0].body, 'corrigé');
});

test('historique : qui a fait quoi et quand, par carte et par tableau ; Claude signé « Claude »', async () => {
  const { prop, b, carte } = await equipe();
  const claude = await agentAvecJeton(srv.base, 'Claude');
  await prop.post(`/api/boards/${b.id}/members`, { email: claude.user.email, name: 'Claude', role: 'member' });
  await claude.post(`/api/cards/${carte.id}/move`, { columnId: b.columns[1].id, index: 0 });
  await claude.post(`/api/cards/${carte.id}/comments`, { body: 'C\'est en cours, @Xavier.' });
  const hist = (await prop.get(`/api/cards/${carte.id}/activity`)).data;
  assert.deepEqual(hist.slice(0, 3).map((a) => [a.action, a.actor.name, a.via]),
    [['commentaire.ajoute', 'Claude', 'api'], ['carte.deplacee', 'Claude', 'api'], ['carte.creee', 'Xavier', 'web']]);
  assert.ok(hist.every((a) => a.createdAt));
  const tab = (await prop.get(`/api/boards/${b.id}/activity`)).data;
  assert.ok(tab.length >= 4);
  assert.equal(tab[0].cardTitle, 'Sujet');
});

function ecouter(client, boardId) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${client.base}/api/boards/${boardId}/events`);
    const req = http.get(u, { headers: client.bearer ? { Authorization: `Bearer ${client.bearer}` } : { Cookie: client.cookie } }, (res) => {
      const evenements = [];
      res.setEncoding('utf8');
      let tampon = '';
      res.on('data', (d) => {
        tampon += d;
        for (const bloc of tampon.split('\n\n').slice(0, -1)) { const m = bloc.match(/^data: (.*)$/m); if (m) evenements.push(JSON.parse(m[1])); }
        tampon = tampon.slice(tampon.lastIndexOf('\n\n') + 2);
      });
      resolve({ status: res.statusCode, type: res.headers['content-type'], evenements, fermer: () => req.destroy(), res });
    });
    req.on('error', reject);
  });
}
const attendre = async (cond, ms = 3000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 20)); } return true; };

test('direct (SSE) : les membres connectés reçoivent les changements ; un intrus est refusé', async () => {
  const { prop, membre, lecteur, intrus, b, carte } = await equipe();
  const fluxMembre = await ecouter(membre, b.id);
  const fluxLecteur = await ecouter(lecteur, b.id);
  const fluxIntrus = await ecouter(intrus, b.id);
  assert.equal(fluxMembre.status, 200);
  assert.match(fluxMembre.type, /text\/event-stream/);
  assert.equal(fluxIntrus.status, 404);
  await prop.post(`/api/cards/${carte.id}/comments`, { body: 'en direct' });
  assert.ok(await attendre(() => fluxMembre.evenements.some((e) => e.kind === 'comment')), 'le membre reçoit le commentaire');
  assert.ok(await attendre(() => fluxLecteur.evenements.some((e) => e.kind === 'comment')), 'le lecteur aussi');
  const e = fluxMembre.evenements.find((x) => x.kind === 'comment');
  assert.equal(e.cardId, carte.id);
  assert.ok(!('body' in e), 'l\'événement ne transporte pas le contenu');
  fluxMembre.fermer(); fluxLecteur.fermer(); fluxIntrus.fermer();
});

test('direct (SSE) : un membre retiré est déconnecté du flux', async () => {
  const { prop, membre, b } = await equipe();
  const flux = await ecouter(membre, b.id);
  let ferme = false;
  flux.res.on('end', () => { ferme = true; });
  await prop.delete(`/api/boards/${b.id}/members/${membre.user.id}`);
  assert.ok(await attendre(() => ferme), 'le flux est fermé');
});

test('le nombre de commentaires apparaît sur la carte du tableau', async () => {
  const { prop, b, carte } = await equipe();
  await prop.post(`/api/cards/${carte.id}/comments`, { body: 'un' });
  await prop.post(`/api/cards/${carte.id}/comments`, { body: 'deux' });
  const t = (await prop.get(`/api/boards/${b.id}`)).data;
  assert.equal(t.columns[0].cards[0].commentCount, 2);
});
