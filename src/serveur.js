import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN_TETES, limiter, egalSur } from './securite.js';
import { authentifier } from './auth.js';
import { ErreurHttp, invalide } from './erreurs.js';
import { valider, estUuid } from './validation.js';
import { routes, FLUX } from './routes.js';
import { routesDiscussions } from './routes-discussions.js';
import { genererOpenApi } from './openapi.js';
import { traiterMcp } from './mcp.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const MAX_CORPS = 1_000_000;

const tableau = [...routes, ...routesDiscussions].map((r) => {
  const noms = [];
  const re = new RegExp(`^${r.chemin.replace(/:(\w+)/g, (_, n) => { noms.push(n); return '([^/]+)'; })}$`);
  return { ...r, re, noms };
});
export const toutesLesRoutes = tableau;

function envoyerJson(res, status, data, entetes = {}) {
  const corps = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...entetes });
  res.end(corps);
}

async function lireCorps(req, max = MAX_CORPS) {
  const vide = !req.headers['transfer-encoding'] && !Number(req.headers['content-length'] ?? 0);
  if (vide) return {};
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json(\s*;|$)/i.test(type)) throw new ErreurHttp(415, 'type_non_supporte', 'Content-Type: application/json requis.');
  const morceaux = [];
  let n = 0;
  for await (const m of req) {
    n += m.length;
    if (n > max) throw new ErreurHttp(413, 'trop_gros', 'Corps de requête trop volumineux.');
    morceaux.push(m);
  }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch { throw invalide('JSON invalide.'); }
}

function memeOrigine(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

// Messages des contraintes posées par la base (migrations 003 et 004).
const CONTRAINTES = {
  un_proprietaire: 'Un tableau doit toujours avoir au moins un propriétaire.',
  agent_non_proprietaire: 'Un agent ne peut pas être propriétaire d\'un tableau.',
};

function erreurVersReponse(e) {
  if (e instanceof ErreurHttp) return e;
  if (e instanceof URIError) return new ErreurHttp(400, 'requete_invalide', 'Adresse mal formée.');
  // Erreurs PostgreSQL connues : jamais de message interne renvoyé au client.
  switch (e.code) {
    case '42501': return new ErreurHttp(403, 'interdit', 'Droits insuffisants.');
    case '23514':
      if (CONTRAINTES[e.constraint]) return new ErreurHttp(400, 'requete_invalide', CONTRAINTES[e.constraint]);
      return new ErreurHttp(400, 'requete_invalide', 'Valeur invalide.');
    case '23503': return new ErreurHttp(400, 'reference_invalide', 'Référence invalide (élément inexistant ou d\'un autre tableau).');
    case '22P02': case '22023': case '22001': case '22007': case '22008': return new ErreurHttp(400, 'requete_invalide', 'Valeur invalide.');
    case '23505': return new ErreurHttp(409, 'conflit', 'Cet élément existe déjà.');
    default: console.error('Erreur interne :', e); return new ErreurHttp(500, 'erreur_interne', 'Erreur interne.');
  }
}

async function api(req, res, url) {
  const ip = req.socket.remoteAddress ?? '?';
  if (url.pathname === '/api/openapi.json') return envoyerJson(res, 200, genererOpenApi(tableau));
  if (url.pathname === '/api/docs') return statique(req, res, new URL('/docs-api.html', 'http://x'));
  const trouve = tableau.find((r) => r.methode === req.method && r.re.test(url.pathname));
  if (!trouve) {
    const autre = tableau.some((r) => r.re.test(url.pathname));
    throw autre ? new ErreurHttp(405, 'methode', 'Méthode non autorisée.') : new ErreurHttp(404, 'introuvable', 'Route inconnue.');
  }
  const params = {};
  const m = url.pathname.match(trouve.re);
  trouve.noms.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
  for (const [n, v] of Object.entries(params)) if (!estUuid(v)) throw invalide(`Identifiant « ${n} » invalide.`);

  let ctx = null;
  if (trouve.auth !== 'public') {
    ctx = await authentifier(req);
    if (!ctx) throw new ErreurHttp(401, 'non_authentifie', 'Authentification requise.');
    ctx.clientId = String(req.headers['x-client-id'] ?? '').slice(0, 64) || null;
    const l = limiter(`api:${ctx.user.id}`, 600, 60_000);
    if (!l.ok) throw new ErreurHttp(429, 'trop_de_requetes', 'Trop de requêtes.', { reessayerDansS: l.reessayerDansS });
    if (trouve.auth === 'session' && !ctx.parCookie) throw new ErreurHttp(403, 'interdit', 'Réservé aux sessions web.');
  } else {
    const l = limiter(`api-pub:${ip}`, 120, 60_000);
    if (!l.ok) throw new ErreurHttp(429, 'trop_de_requetes', 'Trop de requêtes.', { reessayerDansS: l.reessayerDansS });
  }

  const ecriture = req.method !== 'GET' && req.method !== 'HEAD';
  // CSRF : uniquement pour l'authentification par cookie (un jeton Bearer n'est jamais envoyé automatiquement par un navigateur).
  if (ecriture && (!ctx || ctx.parCookie)) {
    if (!memeOrigine(req)) throw new ErreurHttp(403, 'origine', 'Origine refusée.');
    if (ctx && !egalSur(req.headers['x-csrf-token'] ?? '', ctx.csrf)) throw new ErreurHttp(403, 'csrf', 'Jeton CSRF manquant ou invalide.');
  }
  let body = {};
  if (ecriture) {
    const brut = await lireCorps(req, trouve.maxCorps);
    body = trouve.corpsLibre ? brut : valider(trouve.corps, brut);
  }
  const entetes = {};
  const out = await trouve.handler({ ctx, params, body, query: url.searchParams, req, res, ip, entetes });
  if (out === FLUX) return;
  envoyerJson(res, 200, out, entetes);
}

async function statique(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErreurHttp(405, 'methode', 'Méthode non autorisée.');
  let rel = decodeURIComponent(url.pathname);
  let fichier = path.normalize(path.join(PUBLIC, rel));
  const dansPublic = fichier.startsWith(PUBLIC + path.sep);
  let st = dansPublic ? await stat(fichier).catch(() => null) : null;
  if (!st || st.isDirectory()) {
    // Repli SPA pour les adresses d'écran (pas de point dans le dernier segment).
    if (path.extname(rel) && !rel.endsWith('/')) throw new ErreurHttp(404, 'introuvable', 'Fichier introuvable.');
    fichier = path.join(PUBLIC, 'index.html');
    st = await stat(fichier);
  }
  const type = TYPES[path.extname(fichier)];
  if (!type) throw new ErreurHttp(404, 'introuvable', 'Fichier introuvable.');
  const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
  const entetes = { 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, entetes); return res.end(); }
  res.writeHead(200, entetes);
  res.end(req.method === 'HEAD' ? undefined : await readFile(fichier));
}

export function creerServeur() {
  const s = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(EN_TETES)) res.setHeader(k, v);
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/mcp') await traiterMcp(req, res, { limiter, memeOrigine });
      else if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await statique(req, res, url);
    } catch (e) {
      const err = erreurVersReponse(e);
      if (res.headersSent) return res.end();
      const extra = err.status === 429 ? { 'Retry-After': String(err.details?.reessayerDansS ?? 60) } : {};
      envoyerJson(res, err.status, { erreur: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, extra);
    }
  });
  s.requestTimeout = 30_000;
  s.headersTimeout = 15_000;
  return s;
}
