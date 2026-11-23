// Applique les migrations SQL avec le rôle administrateur, et prépare le rôle applicatif.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const dossier = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrer(adminUrl, motDePasseApp) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock(727001)');
    // Le rôle applicatif n'est ni propriétaire, ni superutilisateur, ni BYPASSRLS : les politiques RLS s'appliquent à lui.
    const { rowCount } = await client.query("select 1 from pg_roles where rolname = 'kanbanx_app'");
    const mdp = client.escapeLiteral(motDePasseApp);
    if (!rowCount) {
      await client.query(`create role kanbanx_app login nosuperuser nobypassrls nocreatedb nocreaterole password ${mdp}`);
    } else {
      await client.query(`alter role kanbanx_app password ${mdp}`);
    }
    await client.query('create table if not exists schema_migrations (nom text primary key, appliquee_le timestamptz not null default now())');
    const faites = new Set((await client.query('select nom from schema_migrations')).rows.map((r) => r.nom));
    const fichiers = (await readdir(dossier)).filter((f) => f.endsWith('.sql')).sort();
    const appliquees = [];
    for (const f of fichiers) {
      if (faites.has(f)) continue;
      const sql = await readFile(path.join(dossier, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (nom) values ($1)', [f]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Migration ${f} en échec : ${e.message}`);
      }
      appliquees.push(f);
    }
    return appliquees;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile('.env'); } catch { /* pas de .env : variables d'environnement seules */ }
  const faites = await migrer(process.env.DATABASE_ADMIN_URL, process.env.KANBANX_APP_PASSWORD);
  console.log(faites.length ? `Migrations appliquées : ${faites.join(', ')}` : 'Base à jour.');
}
