// Nuit 2, point 3 : « @Claude » arrive au Claude de chaque membre du tableau qui l'a branché par OAuth.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, utilisateurConnecte, agentAvecJeton } from './serveur.js';
import { fermer } from './aide.js';
import { mcp, outil, claudePour } from './mcp-aide.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

async function scene() {
  const xavier = await utilisateurConnecte(srv.base, 'Xavier');
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const b = (await xavier.post('/api/boards', { name: 'Backlog à deux' })).data;
  await xavier.post(`/api/boards/${b.id}/members`, { email: eric.user.email, name: 'Eric', role: 'member' });
  const carte = (await xavier.post(`/api/columns/${b.columns[0].id}/cards`, { title: 'Plan' })).data;
  return { xavier, eric, b, carte, pourXavier: await claudePour(srv.base, xavier), pourEric: await claudePour(srv.base, eric) };
}
const mentionsMcp = async (qui) => {
  const r = await outil(srv.base, qui, 'lire_mentions');
  assert.equal(r.erreur, false, r.texte);
  return r.data.mentions;
};

test('« @Claude » dans un commentaire arrive au Claude de chaque membre, même sans compte nommé Claude', async () => {
  const { xavier, carte, pourXavier, pourEric } = await scene();
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Claude peux-tu résumer ?' });
  for (const qui of [pourXavier, pourEric]) {
    const m = await mentionsMcp(qui);
    assert.equal(m.length, 1, JSON.stringify(m));
    assert.deepEqual([m[0].endroit, m[0].texte, m[0].auteur, m[0].destinataire, m[0].carte.id], ['commentaire', '@Claude peux-tu résumer ?', 'Xavier', 'Claude', carte.id]);
  }
  // La réponse est signée : on sait quel Claude a répondu.
  assert.equal((await outil(srv.base, pourEric, 'ajouter_commentaire', { carte_id: carte.id, texte: 'Résumé : trois étapes.' })).erreur, false);
  const lu = await outil(srv.base, pourXavier, 'lire_carte', { carte_id: carte.id });
  assert.equal(lu.data.commentaires.at(-1).auteur, 'Claude pour Eric');
});

test('« @Claude » dans le titre et la description aussi, une seule fois par nouvelle mention', async () => {
  const { xavier, b, pourEric } = await scene();
  const c = (await xavier.post(`/api/columns/${b.columns[0].id}/cards`, { title: 'Relecture @Claude' })).data;
  await xavier.patch(`/api/cards/${c.id}`, { description: '@Claude, propose un plan' });
  await xavier.patch(`/api/cards/${c.id}`, { description: '@Claude, propose un plan détaillé' });
  const m = await mentionsMcp(pourEric);
  assert.deepEqual(m.map((x) => [x.endroit, x.texte, x.destinataire]),
    [['description', '@Claude, propose un plan détaillé', 'Claude'], ['titre', 'Relecture @Claude', 'Claude']]);
});

test('une personne qui n\'est pas membre du tableau ne voit jamais la mention, ni son Claude ; un ancien membre non plus', async () => {
  const { xavier, eric, b, carte, pourEric } = await scene();
  const alexis = await utilisateurConnecte(srv.base, 'Alexis');
  const pourAlexis = await claudePour(srv.base, alexis);
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Claude secret du tableau' });
  await xavier.patch(`/api/cards/${carte.id}`, { description: '@Claude description secrète' });
  assert.deepEqual(await mentionsMcp(pourAlexis), []);
  assert.deepEqual((await alexis.get('/api/mentions')).data, []);
  await xavier.delete(`/api/boards/${b.id}/members/${eric.user.id}`);
  assert.deepEqual(await mentionsMcp(pourEric), []);
});

test('« @Claude » n\'encombre pas les mentions de la personne elle-même (écran)', async () => {
  const { xavier, eric, carte } = await scene();
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Claude et @Eric, à vous' });
  const web = (await eric.get('/api/mentions')).data;
  assert.equal(web.length, 1);
  assert.equal(web[0].body, '@Claude et @Eric, à vous');
  assert.deepEqual((await xavier.get('/api/mentions')).data, []);
});

test('le compte agent « Claude » membre la reçoit aussi, comme avant ; une seule fois', async () => {
  const { xavier, b, carte, pourEric } = await scene();
  const agent = await agentAvecJeton(srv.base, 'Claude');
  await xavier.post(`/api/boards/${b.id}/members`, { email: agent.user.email, name: 'Claude', role: 'member' });
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: '@Claude un avis ?' });
  const m = await mentionsMcp(agent);
  assert.equal(m.length, 1);
  assert.equal(m[0].texte, '@Claude un avis ?');
  assert.equal((await mentionsMcp(pourEric)).length, 1, 'une seule fois pour Claude pour Eric');
});

test('un « @Claude » écrit par un Claude ne relance pas les autres Claude (pas de boucle entre agents)', async () => {
  const { carte, pourXavier, pourEric } = await scene();
  await outil(srv.base, pourEric, 'ajouter_commentaire', { carte_id: carte.id, texte: '@Claude pour Xavier : à toi.' });
  await outil(srv.base, pourEric, 'modifier_carte', { carte_id: carte.id, description: '@Claude reprendre' });
  assert.deepEqual(await mentionsMcp(pourXavier), []);
});

test('instructions du serveur MCP : une mention @Claude t\'est adressée ; réponds en commentaire ; propose d\'abord', async () => {
  const { pourXavier } = await scene();
  const init = await mcp(srv.base, pourXavier, 'initialize', { protocolVersion: '2025-11-25' });
  const ins = init.data.result.instructions;
  assert.match(ins, /mention « ?@Claude »? t'est adressée/);
  assert.match(ins, /réponds en commentaire/);
  assert.match(ins, /avant toute action large, propose d'abord/i);
});
