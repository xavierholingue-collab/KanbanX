import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on('error', (e) => console.error('Erreur du pool PostgreSQL :', e.message));

/** Transaction exécutée « comme » un utilisateur : les politiques RLS s'appliquent à ses requêtes. */
export async function transaction(userId, fn) {
  const c = await pool.connect();
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
