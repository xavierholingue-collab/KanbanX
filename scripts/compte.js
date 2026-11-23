// Crée un compte nominatif, par exemple le tout premier propriétaire en production (il n'y a pas d'inscription
// publique : ensuite, chaque propriétaire invite les autres depuis l'application).
// Usage (avec DATABASE_ADMIN_URL) : npm run compte -- <courriel> <prénom> [agent]
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';

const COURRIEL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

export async function creerCompte(client, email, nom, kind = 'human') {
  const adresse = String(email ?? '').trim().toLowerCase();
  const prenom = String(nom ?? '').trim();
  if (!COURRIEL.test(adresse) || adresse.length > 254) throw new Error('Adresse courriel invalide.');
  if (prenom.length < 1 || prenom.length > 40) throw new Error('Le prénom doit faire de 1 à 40 caractères.');
  if (!['human', 'agent'].includes(kind)) throw new Error('Type de compte invalide (human ou agent).');
  const { rows } = await client.query(
    'insert into users (email, name, kind) values ($1, $2, $3) on conflict (email) do nothing returning id, email, name, kind',
    [adresse, prenom, kind]);
  if (!rows[0]) throw new Error(`Ce compte existe déjà : ${adresse}`);
  return rows[0];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [email, nom, type] = process.argv.slice(2);
  if (!email || !nom) {
    console.error('Usage : npm run compte -- <courriel> <prénom> [agent]');
    process.exit(1);
  }
  const c = new pg.Client({ connectionString: config.adminUrl });
  await c.connect();
  try {
    const u = await creerCompte(c, email, nom, type === 'agent' ? 'agent' : 'human');
    console.log(`Compte créé : ${u.name} <${u.email}> (${u.kind === 'agent' ? 'agent' : 'personne'}).`);
    if (u.kind === 'agent') console.log(`Jeton d'API : npm run jeton -- ${u.email}`);
    else console.log('Cette personne peut maintenant se connecter par lien magique et créer ses tableaux.');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}
