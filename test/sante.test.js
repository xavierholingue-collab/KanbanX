// Route de santé : interrogée par le déployeur, la sonde de disponibilité et le contrôle de production.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { demarrer } from './serveur.js';
import { fermer } from './aide.js';
import { etatSante, lireCommit } from '../src/sante.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

test('GET /api/sante : 200, base et schéma à jour, sans authentification ni donnée', async () => {
  const r = await fetch(`${srv.base}/api/sante`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const corps = await r.json();
  assert.deepEqual(Object.keys(corps).sort(), ['base', 'commit', 'ok', 'schema', 'version']);
  assert.equal(corps.ok, true);
  assert.equal(corps.base, 'ok');
  assert.equal(corps.schema, 'a-jour');
  assert.match(corps.version, /^\d+\.\d+\.\d+$/);
});

test('santé : 503 si une migration du dossier n\'est pas appliquée', async () => {
  const e = await etatSante({ attendues: ['001_schema.sql', '999_future.sql'] });
  assert.equal(e.status, 503);
  assert.deepEqual(e.corps, { ok: false, base: 'ok', schema: 'en-retard' });
});

test('santé : 503 si la base ne répond pas, sans détail d\'erreur', async () => {
  const e = await etatSante({ interroger: async () => { throw new Error('connexion refusée : détail interne'); } });
  assert.equal(e.status, 503);
  assert.deepEqual(e.corps, { ok: false, base: 'injoignable' });
});

test('santé : le commit vient de .commit-deploye s\'il existe, sinon « dev »', async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), 'kx-commit-'));
  try {
    assert.equal(await lireCommit(d), 'dev');
    await writeFile(path.join(d, '.commit-deploye'), '0123abcd\n');
    assert.equal(await lireCommit(d), '0123abcd');
    await writeFile(path.join(d, '.commit-deploye'), '<script>alert(1)</script>');
    assert.equal(await lireCommit(d), 'dev');
  } finally {
    await rm(d, { recursive: true, force: true });
  }
});
