// Une seule commande : base PostgreSQL jetable, migrations, tests unitaires/intégration, puis parcours navigateur.
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import pg from 'pg';
import { migrer } from './migrer.js';

const MDP_ADMIN = 'test_admin_jetable';
const MDP_APP = 'test_app_jetable';
let conteneur = null;

function nettoyer() {
  if (conteneur) {
    spawnSync('docker', ['rm', '-f', conteneur], { stdio: 'ignore' });
    conteneur = null;
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { nettoyer(); process.exit(130); });

async function attendre(url) {
  for (let i = 0; i < 60; i++) {
    const c = new pg.Client({ connectionString: url });
    try { await c.connect(); await c.query('select 1'); await c.end(); return; }
    catch { await c.end().catch(() => {}); await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error('La base de test ne répond pas.');
}

async function main() {
  let hote = '127.0.0.1';
  let port;
  if (process.env.TEST_ADMIN_URL) {
    // Option : une base de test déjà disponible (CI). On y crée tout de même une base jetable.
    var adminServeur = process.env.TEST_ADMIN_URL;
  } else {
    const r = spawnSync('docker', ['run', '-d', '--rm', '-e', `POSTGRES_PASSWORD=${MDP_ADMIN}`, '--tmpfs', '/var/lib/postgresql',
      '-p', '127.0.0.1::5432', 'postgres:18'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Impossible de lancer postgres:18 : ${r.stderr}`);
    conteneur = r.stdout.trim();
    const p = spawnSync('docker', ['port', conteneur, '5432/tcp'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
    port = p.split(':').pop();
    adminServeur = `postgres://postgres:${MDP_ADMIN}@${hote}:${port}/postgres`;
  }
  await attendre(adminServeur);
  const nomBase = `kanbanx_test_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminServeur });
  await admin.connect();
  await admin.query(`create database ${nomBase}`);
  await admin.end();

  const u = new URL(adminServeur);
  const adminUrl = new URL(adminServeur); adminUrl.pathname = `/${nomBase}`;
  const appUrl = new URL(adminUrl); appUrl.username = 'kanbanx_app'; appUrl.password = MDP_APP;
  await migrer(adminUrl.toString(), MDP_APP);

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_ADMIN_URL: adminUrl.toString(),
    DATABASE_URL: appUrl.toString(),
    KANBANX_APP_PASSWORD: MDP_APP,
    BASE_URL: 'http://localhost:0',
  };
  const lister = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.test.js')).map((f) => `${d}/${f}`) : []);
  const lots = [['test', lister('test')], ['e2e', lister('e2e')]];
  let code = 0;
  for (const [nom, fichiers] of lots) {
    if (!fichiers.length) continue;
    if (process.env.SEULEMENT && process.env.SEULEMENT !== nom) continue;
    if (nom === 'e2e' && process.env.SANS_NAVIGATEUR) { console.log('\n(parcours navigateur ignorés : SANS_NAVIGATEUR)'); continue; }
    console.log(`\n=== ${nom} ===`);
    const status = await new Promise((res) => {
      const p = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=120000', ...fichiers], { env, stdio: 'inherit' });
      p.on('exit', (c) => res(c ?? 1));
    });
    if (status !== 0) code = status;
  }
  return code;
}

let code = 1;
try { code = await main(); } catch (e) { console.error(e.message); } finally { nettoyer(); }
process.exit(code);
