import { pool } from './db.js';
import { config } from './config.js';
import { hacher, jetonAleatoire, lireCookie, limiter } from './securite.js';
import { envoyerLien } from './courriel.js';
import { ErreurHttp } from './erreurs.js';

/** Demande de lien magique. Réponse identique que le compte existe ou non (pas d'énumération). */
export async function demanderLien(email, ip) {
  for (const [cle, max] of [[`lien-ip:${ip}`, 30], [`lien-mail:${email.toLowerCase()}`, 5]]) {
    const l = limiter(cle, max, 15 * 60 * 1000);
    if (!l.ok) throw new ErreurHttp(429, 'trop_de_demandes', 'Trop de demandes. Réessayez plus tard.', { reessayerDansS: l.reessayerDansS });
  }
  const jeton = jetonAleatoire();
  const { rows } = await pool.query('select kx_lien_demander($1, $2, $3::interval) as id', [email, hacher(jeton), `${config.lienTtlMs / 1000} seconds`]);
  if (rows[0].id) {
    // Envoi en arrière-plan : la réponse part aussi vite que le compte existe ou non (pas d'énumération par le temps).
    envoyerLien(email.toLowerCase(), `${config.baseUrl}/connexion/verifier?token=${jeton}`)
      .catch((e) => console.error('Envoi du lien de connexion impossible :', e.message));
  }
}

/** Échange un lien magique contre une session. Retourne { cookie, csrf } ou null. */
export async function ouvrirSession(jeton, ip) {
  const l = limiter(`verif-ip:${ip}`, 20, 15 * 60 * 1000);
  if (!l.ok) throw new ErreurHttp(429, 'trop_de_demandes', 'Trop de tentatives. Réessayez plus tard.', { reessayerDansS: l.reessayerDansS });
  const session = jetonAleatoire();
  const csrf = jetonAleatoire(24);
  const { rows } = await pool.query('select kx_lien_consommer($1, $2, $3, $4::interval) as id',
    [hacher(jeton), hacher(session), csrf, `${config.sessionTtlMs / 1000} seconds`]);
  if (!rows[0].id) return null;
  return { session, csrf };
}

export async function fermerSession(req) {
  const s = lireCookie(req, '__Host-kx');
  if (s) await pool.query('select kx_session_fermer($1)', [hacher(s)]);
}

/** Identifie l'appelant : jeton d'API (Authorization: Bearer) ou cookie de session. */
export async function authentifier(req) {
  const h = req.headers.authorization;
  if (h) {
    const m = h.match(/^Bearer\s+(kbx_[A-Za-z0-9_-]{20,})$/);
    if (!m) return null;
    const { rows } = await pool.query('select * from kx_jeton_lire($1)', [hacher(m[1])]);
    if (!rows[0]) return null;
    return { user: { id: rows[0].user_id, name: rows[0].name, kind: rows[0].kind }, via: 'api', parCookie: false };
  }
  const s = lireCookie(req, '__Host-kx');
  if (!s) return null;
  const { rows } = await pool.query('select * from kx_session_lire($1)', [hacher(s)]);
  if (!rows[0]) return null;
  return { user: { id: rows[0].user_id, name: rows[0].name, kind: rows[0].kind }, via: 'web', parCookie: true, csrf: rows[0].csrf_token };
}
