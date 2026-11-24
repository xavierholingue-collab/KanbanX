// Nuit 2, point 1 : l'outil MCP lire_carte renvoie une carte en entier, avec les droits de la personne (RLS).
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
  const b = (await xavier.post('/api/boards', { name: 'Backlog' })).data;
  const etiq = (await xavier.post(`/api/boards/${b.id}/labels`, { name: 'Urgent', color: 'rouge' })).data;
  const carte = (await xavier.post(`/api/columns/${b.columns[1].id}/cards`, { title: 'Rédiger la note' })).data;
  await xavier.patch(`/api/cards/${carte.id}`, { description: 'Contexte **complet**\n\n- point 1', dueDate: '2026-12-15',
    assignees: [xavier.user.id], labels: [etiq.id] });
  await xavier.post(`/api/cards/${carte.id}/comments`, { body: 'Premier jet ?' });
  return { xavier, b, carte };
}

test('lire_carte est annoncé, en lecture seule, avec le paramètre carte_id', async () => {
  const x = await utilisateurConnecte(srv.base, 'Xavier');
  const claude = await claudePour(srv.base, x);
  const outils = (await mcp(srv.base, claude, 'tools/list')).data.result.tools;
  const lc = outils.find((o) => o.name === 'lire_carte');
  assert.ok(lc, 'outil lire_carte absent');
  assert.equal(lc.annotations.readOnlyHint, true);
  assert.deepEqual(lc.inputSchema.required, ['carte_id']);
});

test('lire_carte : colonne, titre, description, échéance, responsables, étiquettes et commentaires (« Claude pour Xavier »)', async () => {
  const { xavier, b, carte } = await scene();
  const claude = await claudePour(srv.base, xavier);
  assert.equal((await outil(srv.base, claude, 'ajouter_commentaire', { carte_id: carte.id, texte: 'Je propose un plan.' })).erreur, false);

  const r = await outil(srv.base, claude, 'lire_carte', { carte_id: carte.id });
  assert.equal(r.erreur, false, r.texte);
  const d = r.data;
  assert.equal(d.id, carte.id);
  assert.deepEqual(d.tableau, { id: b.id, nom: 'Backlog' });
  assert.deepEqual(d.colonne, { id: b.columns[1].id, nom: 'En cours' });
  assert.equal(d.titre, 'Rédiger la note');
  assert.equal(d.description, 'Contexte **complet**\n\n- point 1');
  assert.equal(d.echeance, '2026-12-15');
  assert.deepEqual(d.responsables, [{ id: xavier.user.id, nom: 'Xavier' }]);
  assert.deepEqual(d.etiquettes.map((e) => [e.nom, e.couleur]), [['Urgent', 'rouge']]);
  assert.equal(d.archivee, false);
  assert.equal(d.commentaires.length, 2);
  const [c1, c2] = d.commentaires;
  assert.equal(c1.auteur, 'Xavier');
  assert.equal(c1.texte, 'Premier jet ?');
  assert.ok(!Number.isNaN(Date.parse(c1.date)));
  assert.equal(c2.auteur, 'Claude pour Xavier');
  assert.equal(c2.texte, 'Je propose un plan.');
  // Le texte lisible contient tout, y compris la description.
  for (const morceau of ['Rédiger la note', 'En cours', 'Contexte **complet**', '2026-12-15', 'Urgent', 'Claude pour Xavier', 'Je propose un plan.']) {
    assert.ok(r.texte.includes(morceau), `texte sans « ${morceau} »`);
  }
});

test('lire_carte : une carte d\'un autre tableau répond « introuvable » (RLS), comme un identifiant inconnu', async () => {
  const { carte } = await scene();
  const alexis = await utilisateurConnecte(srv.base, 'Alexis');
  const pourAlexis = await claudePour(srv.base, alexis);
  const agent = await agentAvecJeton(srv.base, 'Claude');
  for (const qui of [pourAlexis, agent]) {
    const r = await outil(srv.base, qui, 'lire_carte', { carte_id: carte.id });
    assert.equal(r.erreur, true);
    assert.match(r.texte, /introuvable/i);
    assert.doesNotMatch(r.texte, /Rédiger/);
  }
  const inconnue = await outil(srv.base, pourAlexis, 'lire_carte', { carte_id: '00000000-0000-4000-8000-000000000000' });
  assert.match(inconnue.texte, /introuvable/i);
  const invalide = await outil(srv.base, pourAlexis, 'lire_carte', { carte_id: 'pas-un-uuid' });
  assert.equal(invalide.erreur, true);
});

test('lire_carte : un lecteur lit la carte ; les commentaires supprimés n\'apparaissent pas', async () => {
  const { xavier, b, carte } = await scene();
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  await xavier.post(`/api/boards/${b.id}/members`, { email: eric.user.email, name: 'Eric', role: 'reader' });
  const c = (await xavier.post(`/api/cards/${carte.id}/comments`, { body: 'À effacer' })).data;
  await xavier.delete(`/api/comments/${c.id}`);
  const r = await outil(srv.base, await claudePour(srv.base, eric), 'lire_carte', { carte_id: carte.id });
  assert.equal(r.erreur, false, r.texte);
  assert.ok(!r.data.commentaires.some((m) => m.texte === 'À effacer'));
});
