// Outils communs aux tests : connexions administrateur / applicative et fabrication de données fictives.
import pg from 'pg';
import { randomUUID } from 'node:crypto';

export const admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 3 });
export const app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export async function creerUtilisateur(nom = 'Test', kind = 'human') {
  const email = `${nom.toLowerCase()}-${randomUUID().slice(0, 8)}@exemple.invalid`;
  const { rows } = await admin.query('insert into users (email, name, kind) values ($1, $2, $3) returning *', [email, nom, kind]);
  return rows[0];
}

/** Exécute des requêtes avec le rôle applicatif, comme un utilisateur donné (sans passer par le code du serveur). */
export async function commeUtilisateur(userId, fn) {
  const c = await app.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true)", [userId ?? '']);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Fabrique un tableau avec une colonne et une carte, directement via le rôle administrateur. */
export async function creerTableau(proprietaire, membres = {}) {
  const b = (await admin.query('insert into boards (name, created_by) values ($1, $2) returning *', ['Tableau test', proprietaire.id])).rows[0];
  await admin.query("insert into board_members (board_id, user_id, role) values ($1, $2, 'owner')", [b.id, proprietaire.id]);
  for (const [role, u] of Object.entries(membres)) {
    await admin.query('insert into board_members (board_id, user_id, role) values ($1, $2, $3)', [b.id, u.id, role]);
  }
  const col = (await admin.query("insert into columns (board_id, name, position) values ($1, 'À faire', 1024) returning *", [b.id])).rows[0];
  const carte = (await admin.query("insert into cards (board_id, column_id, title, position, created_by) values ($1, $2, 'Carte secrète', 1024, $3) returning *", [b.id, col.id, proprietaire.id])).rows[0];
  return { board: b, col, carte };
}

export async function fermer() {
  await admin.end();
  await app.end();
}
