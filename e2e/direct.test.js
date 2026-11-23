// Le direct après une coupure : chaque livraison redémarre le service. Les événements émis pendant que le
// navigateur se reconnecte ne sont pas rejoués ; le tableau doit donc se recharger à la reconnexion.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { environnement, connecter, creerUtilisateur } from './aide.js';
import { Client } from '../test/serveur.js';

let env;
before(async () => { env = await environnement(); });
after(async () => { await env.fermer(); });

test('après un redémarrage du serveur, une modification faite pendant la reconnexion apparaît', async () => {
  const xavier = await creerUtilisateur('Xavier');
  const eric = await creerUtilisateur('Eric');
  const api = new Client(env.base);
  await api.connecter(xavier.email);
  const b = (await api.post('/api/boards', { name: 'Livraison' })).data;
  await api.post(`/api/boards/${b.id}/members`, { email: eric.email, name: 'Eric', role: 'member' });

  const page = await connecter(env, xavier);
  await page.goto(`${env.base}/b/${b.id}`);
  await page.getByRole('heading', { name: 'À faire', exact: true }).waitFor();
  // Laisse le flux en direct s'ouvrir.
  await page.waitForTimeout(500);

  await env.relancer();
  // Eric modifie aussitôt, avant que le navigateur de Xavier ait eu le temps de se reconnecter.
  const ericApi = new Client(env.base);
  await ericApi.connecter(eric.email);
  const r = await ericApi.post(`/api/columns/${b.columns[0].id}/cards`, { title: 'Ajoutée pendant la coupure' });
  assert.equal(r.status, 200);

  await page.getByRole('link', { name: 'Ajoutée pendant la coupure' }).waitFor({ timeout: 10_000 });
  assert.deepEqual(page.erreurs.filter((m) => !/EventSource|net::ERR|Failed to load resource/.test(m)), []);
});
