// Crée (ou remplace) le jeton d'API personnel d'un compte agent. Le jeton n'est affiché qu'une fois ; seul son hachage est stocké.
import pg from 'pg';
import { config } from '../src/config.js';
import { hacher, jetonAleatoire } from '../src/securite.js';

export async function creerJeton(client, email, nom = 'jeton') {
  const { rows } = await client.query('select id from users where email = $1', [email.toLowerCase()]);
  if (!rows[0]) throw new Error(`Compte inconnu : ${email}`);
  await client.query('update api_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [rows[0].id]);
  const jeton = `kbx_${jetonAleatoire(32)}`;
  await client.query('insert into api_tokens (user_id, name, token_hash) values ($1, $2, $3)', [rows[0].id, nom, hacher(jeton)]);
  return jeton;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const email = process.argv[2];
  if (!email) { console.error('Usage : npm run jeton -- <courriel du compte>'); process.exit(1); }
  const c = new pg.Client({ connectionString: config.adminUrl });
  await c.connect();
  try { console.log(await creerJeton(c, email, 'jeton personnel')); } finally { await c.end(); }
}
