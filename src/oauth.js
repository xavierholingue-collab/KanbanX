// Serveur d'autorisation OAuth 2.1 de KanbanX, et métadonnées de sa ressource protégée : le serveur MCP.
// Contrat : réponse d'InfraLWS du 23/11 (§ 5), spécification d'autorisation MCP, exigences des clients Claude.
// - Découverte : RFC 9728 (ressource) et RFC 8414 (serveur d'autorisation).
// - Enregistrement dynamique (RFC 7591) : clients publics seulement, adresses de retour en liste fermée.
//   Pas de documents de métadonnées de client : il faudrait aller chercher une adresse fournie par le client (SSRF).
// - Code d'autorisation avec PKCE S256 obligatoire, paramètre resource (RFC 8707), iss dans la réponse (RFC 9207).
// - Le jeton agit au nom de la personne qui a donné son accord ; il ne vaut que pour /mcp.
import { createHash } from 'node:crypto';
import { pool, transaction } from './db.js';
import { config } from './config.js';
import { hacher, jetonAleatoire } from './securite.js';
import { ErreurHttp, invalide } from './erreurs.js';

export const PORTEE = 'kanbanx';
const PORTEES = new Set([PORTEE, 'offline_access']);
const TTL_CODE = '60 seconds';
const TTL_ACCES_S = 3600;
const TTL_RAFRAICHISSEMENT = '30 days';
// Adresses de retour des applications Claude hébergées (claude.ai, Desktop, mobile). Anthropic prévient que la
// seconde pourra remplacer la première : les deux sont acceptées.
const RETOURS_CLAUDE = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];

export const emetteur = () => config.baseUrl.replace(/\/+$/, '');
export const ressource = () => `${emetteur()}/mcp`;
export const adresseMetadonnees = () => `${emetteur()}/.well-known/oauth-protected-resource`;

// ---------- Découverte ----------

export function metadonneesRessource() {
  return {
    resource: ressource(),
    authorization_servers: [emetteur()],
    scopes_supported: [PORTEE],
    bearer_methods_supported: ['header'],
    resource_name: 'KanbanX',
  };
}

export function metadonneesServeur() {
  const e = emetteur();
  return {
    issuer: e,
    authorization_endpoint: `${e}/oauth/authorize`,
    token_endpoint: `${e}/oauth/token`,
    registration_endpoint: `${e}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [PORTEE, 'offline_access'],
    authorization_response_iss_parameter_supported: true,
  };
}

// ---------- Adresses de retour ----------

/** Adresse de retour acceptable à l'enregistrement : l'une de Claude, ou une boucle locale (Claude Code). */
function analyserRetour(s) {
  if (typeof s !== 'string' || s.length > 300) return null;
  if (RETOURS_CLAUDE.includes(s)) return { boucleLocale: false };
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.href !== s) return null; // forme canonique exigée : ni majuscules, ni « .. », ni encodage douteux
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname)) return null;
  if (u.username || u.password || u.search || u.hash || s.includes('?') || s.includes('#')) return null;
  return { boucleLocale: true };
}

const sansPort = (s) => { const u = new URL(s); u.port = ''; return u.href; };

/** L'adresse demandée correspond-elle à l'une des adresses enregistrées ? Port libre en boucle locale (RFC 8252). */
function retourAutorise(enregistrees, demandee) {
  if (enregistrees.includes(demandee)) return true;
  if (!analyserRetour(demandee)?.boucleLocale) return false;
  return enregistrees.some((x) => analyserRetour(x)?.boucleLocale && sansPort(x) === sansPort(demandee));
}

// ---------- Enregistrement dynamique (RFC 7591) ----------

const erreurEnr = (status, error, error_description) => ({ status, corps: { error, error_description } });

/** Nom affiché d'un client : texte court, sans caractère de contrôle ni d'inversion de sens d'écriture. */
function nettoyerNom(v) {
  const s = (typeof v === 'string' ? v : '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return s || 'Application sans nom';
}

export async function enregistrerClient(corps) {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return erreurEnr(400, 'invalid_client_metadata', 'Métadonnées attendues en JSON.');
  const retours = corps.redirect_uris;
  if (!Array.isArray(retours) || retours.length < 1 || retours.length > 5 || !retours.every((x) => analyserRetour(x))) {
    return erreurEnr(400, 'invalid_redirect_uri', 'Adresses de retour acceptées : celles de Claude, ou une boucle locale http://localhost ou http://127.0.0.1.');
  }
  const methode = corps.token_endpoint_auth_method ?? 'none';
  if (methode !== 'none') return erreurEnr(400, 'invalid_client_metadata', 'Seuls les clients publics sont acceptés (token_endpoint_auth_method : none).');
  const accords = corps.grant_types ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(accords) || !accords.length || !accords.every((g) => g === 'authorization_code' || g === 'refresh_token') || !accords.includes('authorization_code')) {
    return erreurEnr(400, 'invalid_client_metadata', 'Types d\'accord acceptés : authorization_code et refresh_token.');
  }
  const reponses = corps.response_types ?? ['code'];
  if (!Array.isArray(reponses) || reponses.length !== 1 || reponses[0] !== 'code') {
    return erreurEnr(400, 'invalid_client_metadata', 'Seul le type de réponse « code » est accepté.');
  }
  const id = `kxc_${jetonAleatoire(24)}`;
  const nom = nettoyerNom(corps.client_name);
  const { rows } = await pool.query('select kx_oauth_client_creer($1, $2, $3) as ok', [id, nom, retours]);
  if (!rows[0].ok) return erreurEnr(503, 'temporarily_unavailable', 'Trop de clients enregistrés. Réessayez plus tard.');
  return {
    status: 201,
    corps: { client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: nom, redirect_uris: retours,
      grant_types: accords, response_types: ['code'], token_endpoint_auth_method: 'none' },
  };
}

// ---------- Demande d'autorisation ----------

const CHAMPS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];

function retourAvec(retour, champs) {
  const u = new URL(retour);
  for (const [k, v] of Object.entries(champs)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
  u.searchParams.set('iss', emetteur());
  return u.toString();
}

const memeRessource = (r) => { try { return new URL(r).href === new URL(ressource()).href; } catch { return false; } };

/**
 * Analyse une demande d'autorisation. Trois issues :
 * - { nonRedirigeable } : client inconnu ou adresse de retour non enregistrée, on ne renvoie jamais vers elle ;
 * - { redirection } : erreur à renvoyer au client, avec state et iss ;
 * - { demande } : demande valide, à soumettre à l'accord de la personne.
 */
export async function analyserDemande(qs) {
  const p = new URLSearchParams(qs);
  const unique = (k) => p.getAll(k).length <= 1;
  const clientId = p.get('client_id');
  const retour = p.get('redirect_uri');
  if (!unique('client_id') || !unique('redirect_uri') || !clientId || clientId.length > 100 || !retour) {
    return { nonRedirigeable: 'Demande incomplète : application ou adresse de retour manquante.' };
  }
  const { rows } = await pool.query('select * from kx_oauth_client_lire($1)', [clientId]);
  if (!rows[0]) return { nonRedirigeable: 'Application inconnue. Relancez la connexion depuis Claude.' };
  if (!retourAutorise(rows[0].redirect_uris, retour)) {
    return { nonRedirigeable: 'Adresse de retour non enregistrée pour cette application.' };
  }
  const etat = p.get('state');
  const erreur = (error, error_description) => ({ redirection: retourAvec(retour, { error, error_description, state: etat }) });

  if (!CHAMPS.every(unique)) return erreur('invalid_request', 'Paramètre répété.');
  if (etat !== null && etat.length > 500) return erreur('invalid_request', 'Paramètre state trop long.');
  if (p.get('response_type') !== 'code') return erreur('unsupported_response_type', 'Seul le type de réponse « code » est accepté.');
  if (p.get('code_challenge_method') !== 'S256') return erreur('invalid_request', 'PKCE obligatoire, méthode S256.');
  const defi = p.get('code_challenge') ?? '';
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(defi)) return erreur('invalid_request', 'Défi PKCE (code_challenge) manquant ou invalide.');
  const demandees = (p.get('scope') ?? '').split(' ').filter(Boolean);
  if (demandees.some((s) => !PORTEES.has(s))) return erreur('invalid_scope', 'Portée inconnue.');
  const portee = [PORTEE, ...(demandees.includes('offline_access') ? ['offline_access'] : [])].join(' ');
  const res = p.get('resource');
  if (res !== null && !memeRessource(res)) return erreur('invalid_target', 'Ce serveur ne délivre de jetons que pour son serveur MCP.');

  const boucleLocale = !!analyserRetour(retour)?.boucleLocale;
  return {
    demande: { clientId, nom: rows[0].name, retour, defi, etat, portee, boucleLocale, hote: new URL(retour).hostname },
  };
}

/** Ce que l'écran de consentement affiche. */
export async function decrireDemande(qs) {
  const a = await analyserDemande(qs);
  if (!a.demande) throw invalide(a.nonRedirigeable ?? 'Demande d\'autorisation invalide. Relancez la connexion depuis Claude.');
  return { client: { nom: a.demande.nom }, hote: a.demande.hote, boucleLocale: a.demande.boucleLocale };
}

/** Accord ou refus explicite de la personne connectée (session web, jeton CSRF vérifié en amont). */
export async function deciderDemande(ctx, qs, decision) {
  if (ctx.user.kind !== 'human') throw new ErreurHttp(403, 'interdit', 'Seule une personne peut donner son accord.');
  const a = await analyserDemande(qs);
  if (!a.demande) throw invalide(a.nonRedirigeable ?? 'Demande d\'autorisation invalide. Relancez la connexion depuis Claude.');
  const d = a.demande;
  if (decision !== 'accepter') {
    return { redirection: retourAvec(d.retour, { error: 'access_denied', error_description: 'Accès refusé par la personne.', state: d.etat }) };
  }
  const code = jetonAleatoire(32);
  await transaction(ctx.user.id, (c) => c.query('select kx_oauth_code_creer($1, $2, $3, $4, $5, $6, $7::interval)',
    [hacher(code), d.clientId, d.retour, d.defi, d.portee, ressource(), TTL_CODE]));
  return { redirection: retourAvec(d.retour, { code, state: d.etat }) };
}

// ---------- Point d'accès des jetons ----------

const erreurJeton = (error, error_description, status = 400) => ({ status, corps: { error, error_description } });
const defiDe = (verificateur) => createHash('sha256').update(verificateur).digest('base64url');

function nouveauxJetons() {
  return { acces: `kxa_${jetonAleatoire(32)}`, rafraichissement: `kxr_${jetonAleatoire(32)}` };
}

/** Requête au point d'accès des jetons (corps application/x-www-form-urlencoded déjà lu). */
export async function delivrerJetons(p, { authentificationClient = false } = {}) {
  for (const k of new Set(p.keys())) if (p.getAll(k).length > 1) return erreurJeton('invalid_request', `Paramètre répété : ${k}.`);
  if (authentificationClient || p.has('client_secret')) return erreurJeton('invalid_client', 'Clients publics uniquement : pas de secret.', 401);
  const type = p.get('grant_type');
  const clientId = p.get('client_id');
  const res = p.get('resource');

  if (type === 'authorization_code') {
    const code = p.get('code'); const retour = p.get('redirect_uri'); const verificateur = p.get('code_verifier');
    if (!code || !retour || !clientId || !verificateur) return erreurJeton('invalid_request', 'Paramètres attendus : code, redirect_uri, client_id, code_verifier.');
    if (res !== null && !memeRessource(res)) return erreurJeton('invalid_target', 'Ce serveur ne délivre de jetons que pour son serveur MCP.');
    const j = nouveauxJetons();
    const { rows } = await pool.query('select * from kx_oauth_code_echanger($1, $2, $3, $4, $5, $6, $7::interval, $8::interval)',
      [hacher(code), clientId, retour, defiDe(verificateur), hacher(j.acces), hacher(j.rafraichissement), `${TTL_ACCES_S} seconds`, TTL_RAFRAICHISSEMENT]);
    if (rows[0].statut !== 'ok') return erreurJeton('invalid_grant', 'Code invalide, expiré ou déjà utilisé.');
    return reponseJetons(j, rows[0].scope);
  }

  if (type === 'refresh_token') {
    const rafraichissement = p.get('refresh_token');
    if (!rafraichissement || !clientId) return erreurJeton('invalid_request', 'Paramètres attendus : refresh_token, client_id.');
    if (res !== null && !memeRessource(res)) return erreurJeton('invalid_target', 'Ce serveur ne délivre de jetons que pour son serveur MCP.');
    const j = nouveauxJetons();
    const { rows } = await pool.query('select * from kx_oauth_rafraichir($1, $2, $3, $4, $5::interval, $6::interval)',
      [hacher(rafraichissement), clientId, hacher(j.acces), hacher(j.rafraichissement), `${TTL_ACCES_S} seconds`, TTL_RAFRAICHISSEMENT]);
    if (rows[0].statut !== 'ok') return erreurJeton('invalid_grant', 'Jeton de rafraîchissement invalide, expiré ou révoqué.');
    return reponseJetons(j, rows[0].scope);
  }

  if (!type) return erreurJeton('invalid_request', 'Paramètre grant_type manquant.');
  return erreurJeton('unsupported_grant_type', 'Types acceptés : authorization_code, refresh_token.');
}

function reponseJetons(j, scope) {
  return { status: 200, corps: { access_token: j.acces, token_type: 'Bearer', expires_in: TTL_ACCES_S, refresh_token: j.rafraichissement, scope } };
}

// ---------- Ressource : jeton présenté au serveur MCP ----------

/** Contexte de la personne pour un jeton d'accès OAuth, ou null s'il n'est pas valable pour /mcp. */
export async function lireJetonAcces(jeton) {
  if (!/^kxa_[A-Za-z0-9_-]{40,}$/.test(jeton)) return null;
  const { rows } = await pool.query('select * from kx_oauth_jeton_lire($1, $2)', [hacher(jeton), ressource()]);
  if (!rows[0]) return null;
  return { user: { id: rows[0].user_id, name: rows[0].name, kind: rows[0].kind }, via: 'mcp', application: rows[0].client_name, parCookie: false };
}

// ---------- Applications connectées ----------

export async function listerAcces(ctx) {
  const { rows } = await transaction(ctx.user.id, (c) => c.query('select * from kx_oauth_acces_lister()'));
  return { acces: rows.map((r) => ({ id: r.id, client: r.client_name, hote: new URL(r.redirect_uri).hostname,
    creeLe: r.created_at, utiliseLe: r.last_used_at })) };
}

export async function revoquerAcces(ctx, id) {
  const { rows } = await transaction(ctx.user.id, (c) => c.query('select kx_oauth_acces_revoquer($1) as ok', [id]));
  if (!rows[0].ok) throw new ErreurHttp(404, 'introuvable', 'Accès introuvable.');
  return { ok: true };
}
