// Migrations dans les conditions du serveur : propriétaire ordinaire (ni superutilisateur ni CREATEROLE),
// rôle applicatif créé d'avance par l'hébergement, aucun mot de passe transmis au script.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { admin, fermer } from './aide.js';
import { migrer } from '../scripts/migrer.js';

const crees = { bases: [], roles: [] };
after(async () => {
  for (const b of crees.bases) await admin.query(`drop database if exists ${b} with (force)`).catch(() => {});
  for (const r of crees.roles) await admin.query(`drop role if exists ${r}`).catch(() => {});
  await fermer();
});

/** Une base neuve appartenant à un propriétaire ordinaire ; renvoie son URL et l'URL du rôle applicatif. */
async function baseNeuve() {
  const suffixe = randomBytes(4).toString('hex');
  const proprio = `kx_proprio_${suffixe}`;
  const base = `kx_serveur_${suffixe}`;
  await admin.query(`create role ${proprio} login nosuperuser nocreaterole nocreatedb password 'proprio-de-test'`);
  crees.roles.push(proprio);
  await admin.query(`create database ${base} owner ${proprio}`);
  crees.bases.push(base);
  const urlProprio = new URL(process.env.DATABASE_ADMIN_URL);
  urlProprio.username = proprio; urlProprio.password = 'proprio-de-test'; urlProprio.pathname = `/${base}`;
  const urlApp = new URL(process.env.DATABASE_URL);
  urlApp.pathname = `/${base}`;
  const urlSuper = new URL(process.env.DATABASE_ADMIN_URL);
  urlSuper.pathname = `/${base}`;
  return { base, urlProprio: urlProprio.toString(), urlApp: urlApp.toString(), urlSuper: urlSuper.toString() };
}

async function avec(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test('sans mot de passe, un propriétaire ordinaire applique toutes les migrations sans toucher au rôle applicatif', async () => {
  const { urlProprio, urlApp } = await baseNeuve();
  const appliquees = await migrer(urlProprio, undefined);
  assert.ok(appliquees.length >= 5, `migrations appliquées : ${appliquees.join(', ')}`);
  // Relancer ne refait rien.
  assert.deepEqual(await migrer(urlProprio, undefined), []);
  // Le rôle applicatif reste soumis aux politiques et sans accès aux tables d'authentification.
  await avec(urlApp, async (c) => {
    await assert.rejects(c.query('select * from sessions'));
    await assert.rejects(c.query('create table intrus (x int)'));
    const { rows } = await c.query('select count(*)::int n from schema_migrations');
    assert.equal(rows[0].n, appliquees.length);
  });
});

test('un rôle applicatif propriétaire de tables est refusé avant toute migration', async () => {
  const { urlProprio, urlSuper } = await baseNeuve();
  await avec(urlSuper, (c) => c.query('create table piege (x int); alter table piege owner to kanbanx_app'));
  await assert.rejects(migrer(urlProprio, undefined), /propriétaire de tables/);
  const restantes = await avec(urlSuper, async (c) => (await c.query("select count(*)::int n from pg_tables where tablename in ('users', 'boards')")).rows[0].n);
  assert.equal(restantes, 0);
});
