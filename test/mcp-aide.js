// Outils communs aux tests MCP : appel JSON-RPC, appel d'outil, et branchement de « Claude pour X » par OAuth.
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../src/config.js';
import { reinitialiserLimites } from '../src/securite.js';

const RETOUR = 'https://claude.ai/api/mcp/auth_callback';
let n = 0;

/** Appel JSON-RPC sur /mcp. `qui` : { bearer } (jeton kbx_… ou kxa_…), ou null. */
export async function mcp(base, qui, method, params = {}, { entetes = {} } = {}) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', ...entetes };
  if (qui?.bearer) h.Authorization = `Bearer ${qui.bearer}`;
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) });
  const t = await r.text();
  return { status: r.status, headers: r.headers, data: t ? JSON.parse(t) : null };
}

/** Appelle un outil ; renvoie { erreur, texte, data }. */
export async function outil(base, qui, name, args = {}) {
  const r = await mcp(base, qui, 'tools/call', { name, arguments: args });
  if (r.data.error) return { erreur: true, texte: r.data.error.message, data: null };
  const res = r.data.result;
  return { erreur: !!res.isError, texte: res.content[0].text, data: res.structuredContent };
}

/** Branche Claude au nom d'une personne connectée (enregistrement, accord, échange du code). Renvoie { bearer, client }. */
export async function claudePour(base, personne) {
  reinitialiserLimites();
  const enr = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [RETOUR] }) });
  const client = (await enr.json()).client_id;
  const verificateur = randomBytes(32).toString('base64url');
  const defi = createHash('sha256').update(verificateur).digest('base64url');
  const qs = new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: RETOUR, code_challenge: defi,
    code_challenge_method: 'S256', state: 'e', scope: 'kanbanx', resource: `${config.baseUrl}/mcp` }).toString();
  const accord = await personne.post('/api/oauth/accord', { parametres: qs, decision: 'accepter' });
  if (accord.status !== 200) throw new Error(`accord refusé : ${JSON.stringify(accord.data)}`);
  const code = new URL(accord.data.redirection).searchParams.get('code');
  reinitialiserLimites();
  const j = await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client, redirect_uri: RETOUR,
      code_verifier: verificateur, resource: `${config.baseUrl}/mcp` }).toString() });
  const jetons = await j.json();
  if (!jetons.access_token) throw new Error(`échange refusé : ${JSON.stringify(jetons)}`);
  return { bearer: jetons.access_token, client, user: personne.user };
}
