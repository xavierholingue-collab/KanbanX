// « Continuer avec Google » : OpenID Connect, flux du code d'autorisation mené par le serveur (client confidentiel).
// Références : OpenID Connect Core 1.0 (§ 3.1) ; RFC 9700, bonnes pratiques de sécurité OAuth 2.0 (state lié au
// navigateur, PKCE, pas de suivi de redirection) ; RFC 7636 (PKCE S256) ; documentation Google « OpenID Connect » et
// « Verify the Google ID token » (sub comme identifiant ; quand Google fait autorité sur une adresse).
//
// Règles de KanbanX :
// - Google n'ouvre qu'un compte déjà invité ; il n'en crée jamais. Les droits restent ceux des invitations (RLS).
// - Le compte est reconnu par sub. La première liaison par l'adresse n'a lieu que si Google fait autorité sur
//   elle ; sinon, la personne se connecte par courriel et lie son compte Google depuis « Mon compte ».
// - Le jeton d'identité arrive directement de Google, en HTTPS, contre le secret du client : sa signature n'a pas
//   à être vérifiée (OpenID Connect Core § 3.1.3.7, point 6 ; Google le dit aussi). Ses revendications, si.
import { createHash } from 'node:crypto';
import { pool, transaction } from './db.js';
import { config } from './config.js';
import { hacher, jetonAleatoire, egalSur, lireCookie, cookieSession } from './securite.js';
import { authentifier } from './auth.js';
import { ErreurHttp } from './erreurs.js';

const COOKIE = '__Host-kx-google';
const DUREE_S = 600;
const PORTEES = 'openid email'; // le strict nécessaire : l'identité et l'adresse, rien d'autre
const EMETTEURS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const ECART_HORLOGE_S = 300;
const TAILLE_MAX_REPONSE = 64 * 1024;

export const googleActif = () => Boolean(config.google.clientId && config.google.clientSecret);
export const adresseRetour = () => `${config.baseUrl}/auth/google/retour`;
const cookieDemande = (valeur, maxAgeS) => `${COOKIE}=${valeur}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`;

/** Google fait autorité sur l'adresse : compte Gmail, ou compte Google Workspace (revendication hd), adresse vérifiée. */
export function googleFaitAutorite(r) {
  if (r.email_verified !== true || typeof r.email !== 'string') return false;
  return /@gmail\.com$/i.test(r.email) || (typeof r.hd === 'string' && r.hd.length > 0);
}

/** Lit et vérifie le jeton d'identité ; renvoie ses revendications, ou lève une erreur (message sans donnée sensible). */
export function analyserJetonId(jeton, { clientId, nonce, maintenantS = Math.floor(Date.now() / 1000) }) {
  const parties = typeof jeton === 'string' ? jeton.split('.') : [];
  if (parties.length !== 3) throw new Error('jeton d\'identité mal formé');
  let r;
  try { r = JSON.parse(Buffer.from(parties[1], 'base64url').toString('utf8')); } catch { throw new Error('jeton d\'identité illisible'); }
  if (!r || typeof r !== 'object') throw new Error('jeton d\'identité illisible');
  if (!EMETTEURS.has(r.iss)) throw new Error('émetteur inattendu');
  const audiences = Array.isArray(r.aud) ? r.aud : [r.aud];
  if (!audiences.includes(clientId)) throw new Error('audience inattendue');
  // Plusieurs audiences : la partie autorisée doit être nous. Une seule : si azp est là, ce doit être nous aussi.
  if ((audiences.length > 1 || r.azp !== undefined) && r.azp !== clientId) throw new Error('partie autorisée inattendue');
  if (typeof r.nonce !== 'string' || !egalSur(r.nonce, nonce)) throw new Error('nonce inattendu');
  if (!Number.isFinite(r.exp) || r.exp <= maintenantS) throw new Error('jeton expiré');
  if (!Number.isFinite(r.iat) || r.iat > maintenantS + ECART_HORLOGE_S) throw new Error('jeton émis dans le futur');
  if (typeof r.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(r.sub)) throw new Error('sujet invalide');
  if (typeof r.email !== 'string' || r.email.length < 3 || r.email.length > 254 || !r.email.includes('@')) throw new Error('adresse absente');
  return r;
}

/**
 * Prépare le départ vers Google. Connexion : publique. Liaison : pour la personne de la session (ctx).
 * Renvoie l'adresse de Google et le cookie qui lie la demande à ce navigateur.
 */
export async function commencer({ ctx = null } = {}) {
  if (!googleActif()) throw new ErreurHttp(404, 'introuvable', 'Route inconnue.');
  const etat = jetonAleatoire();
  const nonce = jetonAleatoire();
  const verificateur = jetonAleatoire(48); // 64 caractères base64url (RFC 7636 : de 43 à 128)
  const defi = createHash('sha256').update(verificateur).digest('base64url');
  const sql = 'select kx_google_demande_creer($1, $2, $3, $4, $5::interval) as ok';
  const valeurs = [hacher(etat), nonce, verificateur, !!ctx, `${DUREE_S} seconds`];
  const ok = ctx
    ? await transaction(ctx.user.id, async (c) => (await c.query(sql, valeurs)).rows[0].ok)
    : (await pool.query(sql, valeurs)).rows[0].ok;
  if (!ok) throw new ErreurHttp(503, 'indisponible', 'Connexion avec Google momentanément indisponible. Réessayez dans quelques minutes.');
  const url = new URL(config.google.authUrl);
  url.search = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: adresseRetour(), response_type: 'code', scope: PORTEES,
    state: etat, nonce, code_challenge: defi, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return { url: url.toString(), cookie: cookieDemande(etat, DUREE_S) };
}

/** Lit une réponse HTTP sans dépasser une taille maximale. */
async function lireBorne(reponse, max) {
  const morceaux = [];
  let n = 0;
  for await (const m of reponse.body ?? []) {
    n += m.length;
    if (n > max) throw new Error('réponse de Google trop volumineuse');
    morceaux.push(m);
  }
  return Buffer.concat(morceaux).toString('utf8');
}

/** Échange le code contre les jetons, avec le vérificateur PKCE et l'authentification du client (RFC 6749, § 2.3.1). */
async function echangerCode(code, verificateur) {
  const g = config.google;
  const identifiants = Buffer.from(`${encodeURIComponent(g.clientId)}:${encodeURIComponent(g.clientSecret)}`).toString('base64');
  const r = await fetch(g.tokenUrl, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Basic ${identifiants}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: adresseRetour(), code_verifier: verificateur }).toString(),
  });
  const texte = await lireBorne(r, TAILLE_MAX_REPONSE);
  if (!r.ok) throw new Error(`échange du code refusé par Google (HTTP ${r.status})`);
  let data;
  try { data = JSON.parse(texte); } catch { throw new Error('réponse de Google illisible'); }
  if (typeof data?.id_token !== 'string') throw new Error('jeton d\'identité absent');
  return data.id_token;
}

/**
 * Retour de Google (GET /auth/google/retour). Renvoie { location, cookies } : toujours une redirection vers un écran
 * de KanbanX, avec au plus un code de résultat dans l'adresse (jamais d'adresse courriel ni de donnée personnelle).
 */
export async function terminer(req, url) {
  const cookies = [cookieDemande('', 0)]; // le cookie de demande ne sert qu'une fois
  const fin = (chemin, resultat) => ({ location: resultat ? `${chemin}?google=${resultat}` : chemin, cookies });
  const p = url.searchParams;
  const etat = p.get('state') ?? '';
  const etatNavigateur = lireCookie(req, COOKIE);
  // Sans le cookie de ce navigateur, ou avec celui d'une autre demande : retour forgé ou ouvert ailleurs. La demande
  // n'est pas consommée, pour que le navigateur légitime puisse encore terminer.
  if (!etat || etat.length > 200 || !etatNavigateur || !egalSur(etat, etatNavigateur)) return fin('/connexion', 'expire');
  const { rows } = await pool.query('select * from kx_google_demande_consommer($1)', [hacher(etat)]);
  const d = rows[0];
  if (!d) return fin('/connexion', 'expire');
  const ecran = d.liaison ? '/compte' : '/connexion';
  if (p.has('error')) return fin(ecran, p.get('error') === 'access_denied' ? 'annule' : 'echec');
  const code = p.get('code') ?? '';
  if (!code || code.length > 2048) return fin(ecran, 'echec');

  let r;
  try {
    r = analyserJetonId(await echangerCode(code, d.verificateur), { clientId: config.google.clientId, nonce: d.nonce });
  } catch (e) {
    console.error('Connexion avec Google refusée :', e.name === 'TimeoutError' ? 'Google ne répond pas' : e.message);
    return fin(ecran, 'echec');
  }

  if (d.liaison) {
    // La session doit être celle de la personne qui a commencé la liaison.
    const ctx = await authentifier(req);
    if (!ctx?.parCookie || ctx.user.id !== d.user_id) return fin('/compte', 'expire');
    const statut = await transaction(ctx.user.id, async (c) => (await c.query('select kx_google_lier($1, $2) as s', [r.sub, r.email])).rows[0].s);
    return fin('/compte', statut);
  }
  const session = jetonAleatoire();
  const csrf = jetonAleatoire(24);
  let statut;
  try {
    ({ rows: [{ s: statut }] } = await pool.query('select kx_google_connexion($1, $2, $3, $4, $5, $6::interval) as s',
      [r.sub, r.email, googleFaitAutorite(r), hacher(session), csrf, `${config.sessionTtlMs / 1000} seconds`]));
  } catch (e) {
    if (e.code !== '23505') throw e;
    statut = 'echec'; // deux premières connexions simultanées du même compte : la seconde recommence
  }
  if (statut !== 'ok') return fin('/connexion', statut);
  cookies.push(cookieSession(session, config.sessionTtlMs / 1000));
  return fin('/connexion/suite');
}

/** Compte Google lié à la personne (adresse affichée), ou null. */
export async function lireLiaison(c) {
  const { rows } = await c.query('select kx_google_lire() as email');
  return rows[0].email ?? null;
}

export async function delier(ctx) {
  await transaction(ctx.user.id, (c) => c.query('select kx_google_delier()'));
  return { ok: true };
}
