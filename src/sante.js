// Route de santé (GET /api/sante) : le processus répond, la base répond, toutes les migrations sont appliquées.
// Interrogée par le déployeur, la sonde de disponibilité et le contrôle de production. Aucune donnée, aucun
// compteur, aucun détail d'erreur : seulement des états.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
const DELAI_MS = 3000;

let fixe = null; // version et commit ne changent pas tant que le processus tourne

/** Commit déployé : écrit par la chaîne de livraison dans `.commit-deploye`, sinon « dev ». */
export async function lireCommit(dossier = RACINE) {
  try {
    const c = (await readFile(`${dossier}/.commit-deploye`, 'utf8')).trim();
    return /^[0-9a-f]{7,40}$/.test(c) ? c : 'dev';
  } catch {
    return 'dev';
  }
}

async function infosFixes() {
  if (!fixe) {
    const { version } = JSON.parse(await readFile(`${RACINE}/package.json`, 'utf8'));
    const attendues = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
    fixe = { version, commit: await lireCommit(), attendues };
  }
  return fixe;
}

async function migrationsAppliquees() {
  const { rows } = await pool.query('select nom from schema_migrations');
  return rows.map((r) => r.nom);
}

function avecDelai(promesse) {
  let minuteur;
  const delai = new Promise((_, rejeter) => { minuteur = setTimeout(() => rejeter(new Error('délai dépassé')), DELAI_MS); });
  return Promise.race([promesse, delai]).finally(() => clearTimeout(minuteur));
}

/** État de santé. Les options servent aux tests (migrations attendues, interrogation de la base). */
export async function etatSante({ attendues, interroger = migrationsAppliquees } = {}) {
  const f = await infosFixes();
  let faites;
  try {
    faites = new Set(await avecDelai(interroger()));
  } catch {
    return { status: 503, corps: { ok: false, base: 'injoignable' } };
  }
  if (!(attendues ?? f.attendues).every((m) => faites.has(m))) {
    return { status: 503, corps: { ok: false, base: 'ok', schema: 'en-retard' } };
  }
  return { status: 200, corps: { ok: true, version: f.version, commit: f.commit, base: 'ok', schema: 'a-jour' } };
}
