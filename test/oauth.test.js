// OAuth 2.1 du serveur MCP : brancher Claude (claude.ai, Claude Code) au nom de la personne qui donne son accord.
// Contrat : réponse d'InfraLWS du 23/11, § 5 ; spécification d'autorisation MCP ; exigences de Claude.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { demarrer, utilisateurConnecte, agentAvecJeton, Client } from './serveur.js';
import { admin, fermer } from './aide.js';
import { config } from '../src/config.js';
import { reinitialiserLimites } from '../src/securite.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

const EMETTEUR = config.baseUrl;
const RESSOURCE = `${config.baseUrl}/mcp`;
const RETOUR_CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

const b64url = (b) => Buffer.from(b).toString('base64url');
function pkce() {
  const verificateur = b64url(randomBytes(32));
  return { verificateur, defi: b64url(createHash('sha256').update(verificateur).digest()) };
}

async function json(methode, chemin, corps, entetes = {}) {
  const r = await fetch(`${srv.base}${chemin}`, { method: methode, redirect: 'manual',
    headers: { ...(corps ? { 'Content-Type': 'application/json' } : {}), ...entetes }, body: corps ? JSON.stringify(corps) : undefined });
  const t = await r.text();
  let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; }
  return { status: r.status, headers: r.headers, data };
}

async function formulaire(chemin, champs) {
  const r = await fetch(`${srv.base}${chemin}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(champs).toString() });
  const t = await r.text();
  return { status: r.status, headers: r.headers, data: t ? JSON.parse(t) : null };
}

async function enregistrer(redirect_uris = [RETOUR_CLAUDE], extra = {}) {
  reinitialiserLimites();
  return json('POST', '/oauth/register', { client_name: 'Claude', redirect_uris, ...extra });
}

function parametres({ client, redirection = RETOUR_CLAUDE, defi, ...extra }) {
  return new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: redirection, code_challenge: defi,
    code_challenge_method: 'S256', state: 'etat-123', scope: 'kanbanx', resource: RESSOURCE, ...extra }).toString();
}

/** La personne connectée (cookie) donne ou refuse son accord ; renvoie l'adresse de retour vers le client. */
async function decider(personne, qs, decision = 'accepter') {
  const r = await personne.post('/api/oauth/accord', { parametres: qs, decision });
  return r;
}

const codeDe = (url) => new URL(url).searchParams.get('code');

async function echanger(code, { client, verificateur, redirection = RETOUR_CLAUDE, ...extra }) {
  reinitialiserLimites();
  return formulaire('/oauth/token', { grant_type: 'authorization_code', code, client_id: client, redirect_uri: redirection,
    code_verifier: verificateur, resource: RESSOURCE, ...extra });
}

async function rafraichir(refresh, client, extra = {}) {
  reinitialiserLimites();
  return formulaire('/oauth/token', { grant_type: 'refresh_token', refresh_token: refresh, client_id: client, resource: RESSOURCE, ...extra });
}

let n = 0;
async function mcp(jeton, method, params = {}) {
  const r = await fetch(`${srv.base}/mcp`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25',
      ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) });
  const t = await r.text();
  return { status: r.status, headers: r.headers, data: t ? JSON.parse(t) : null };
}
const outil = async (jeton, name, args = {}) => (await mcp(jeton, 'tools/call', { name, arguments: args })).data.result;

/** Parcours complet : enregistrement, accord de la personne, échange du code. */
async function brancher(personne, { redirection = RETOUR_CLAUDE } = {}) {
  const client = (await enregistrer([redirection])).data.client_id;
  const { verificateur, defi } = pkce();
  const accord = await decider(personne, parametres({ client, redirection, defi }));
  assert.equal(accord.status, 200, JSON.stringify(accord.data));
  const jetons = await echanger(codeDe(accord.data.redirection), { client, verificateur, redirection });
  assert.equal(jetons.status, 200, JSON.stringify(jetons.data));
  return { client, ...jetons.data };
}

// ---------- Découverte ----------

test('découverte : 401 sur /mcp avec resource_metadata et scope ; métadonnées RFC 9728 et RFC 8414', async () => {
  const r = await mcp(null, 'initialize');
  assert.equal(r.status, 401);
  const www = r.headers.get('www-authenticate');
  assert.match(www, /^Bearer /);
  assert.ok(www.includes(`resource_metadata="${EMETTEUR}/.well-known/oauth-protected-resource"`), www);
  assert.ok(www.includes('scope="kanbanx"'), www);

  for (const chemin of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const m = await json('GET', chemin);
    assert.equal(m.status, 200, chemin);
    assert.equal(m.data.resource, RESSOURCE);
    assert.deepEqual(m.data.authorization_servers, [EMETTEUR]);
    assert.deepEqual(m.data.scopes_supported, ['kanbanx']);
    assert.deepEqual(m.data.bearer_methods_supported, ['header']);
  }

  const as = await json('GET', '/.well-known/oauth-authorization-server');
  assert.equal(as.status, 200);
  assert.equal(as.data.issuer, EMETTEUR);
  assert.equal(as.data.authorization_endpoint, `${EMETTEUR}/oauth/authorize`);
  assert.equal(as.data.token_endpoint, `${EMETTEUR}/oauth/token`);
  assert.equal(as.data.registration_endpoint, `${EMETTEUR}/oauth/register`);
  assert.deepEqual(as.data.response_types_supported, ['code']);
  assert.deepEqual(as.data.grant_types_supported, ['authorization_code', 'refresh_token']);
  assert.deepEqual(as.data.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(as.data.token_endpoint_auth_methods_supported, ['none']);
  assert.deepEqual(as.data.scopes_supported, ['kanbanx', 'offline_access']);
  assert.equal(as.data.authorization_response_iss_parameter_supported, true);
  assert.equal(as.data.client_id_metadata_document_supported, undefined, 'pas de documents de métadonnées de client (SSRF)');
});

// ---------- Enregistrement dynamique ----------

test('enregistrement dynamique : clients publics, adresses de retour en liste fermée', async () => {
  for (const ok of [[RETOUR_CLAUDE], ['https://claude.com/api/mcp/auth_callback'], ['http://localhost:51234/callback'], ['http://127.0.0.1:8123/callback']]) {
    const r = await enregistrer(ok);
    assert.equal(r.status, 201, `${ok} : ${JSON.stringify(r.data)}`);
    assert.match(r.data.client_id, /^kxc_[A-Za-z0-9_-]{20,}$/);
    assert.deepEqual(r.data.redirect_uris, ok);
    assert.equal(r.data.token_endpoint_auth_method, 'none');
    assert.equal(r.data.client_secret, undefined);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  for (const refuse of [['https://evil.example/api/mcp/auth_callback'], ['http://claude.ai/api/mcp/auth_callback'],
    ['https://claude.ai/api/mcp/auth_callback?x=1'], ['https://claude.ai/api/mcp/autre'], ['https://claude.ai.evil.example/api/mcp/auth_callback'],
    ['http://localhost.evil.example:5000/callback'], ['http://user@localhost:5000/callback'], ['http://localhost:5000/callback#f'],
    ['http://192.168.1.10:5000/callback'], [], ['pas une adresse'], [RETOUR_CLAUDE, 'https://evil.example/cb']]) {
    const r = await enregistrer(refuse);
    assert.equal(r.status, 400, `${JSON.stringify(refuse)} aurait dû être refusé`);
    assert.equal(r.data.error, 'invalid_redirect_uri');
  }
  for (const [extra, quoi] of [[{ token_endpoint_auth_method: 'client_secret_basic' }, 'client confidentiel'],
    [{ grant_types: ['authorization_code', 'client_credentials'] }, 'client_credentials'], [{ response_types: ['token'] }, 'flux implicite']]) {
    const r = await enregistrer([RETOUR_CLAUDE], extra);
    assert.equal(r.status, 400, quoi);
    assert.equal(r.data.error, 'invalid_client_metadata', quoi);
  }
  // Le nom affiché est nettoyé : pas de caractères de contrôle, longueur bornée.
  const r = await enregistrer([RETOUR_CLAUDE], { client_name: `Cl\u0000au\nde${'x'.repeat(200)}` });
  assert.equal(r.status, 201);
  assert.ok(!/[\u0000-\u001f]/.test(r.data.client_name));
  assert.ok(r.data.client_name.length <= 60);
});

test('enregistrement : les clients jamais utilisés sont purgés au bout de 24 heures, et leur nombre est plafonné', async () => {
  const vieux = (await enregistrer()).data.client_id;
  await admin.query("update oauth_clients set created_at = now() - interval '25 hours' where id = $1", [vieux]);
  await enregistrer();
  assert.equal((await admin.query('select 1 from oauth_clients where id = $1', [vieux])).rowCount, 0);

  await admin.query(`insert into oauth_clients (id, name, redirect_uris)
    select 'kxc_plafond_' || lpad(g::text, 12, '0'), 'Remplissage', array['${RETOUR_CLAUDE}'] from generate_series(1, 1000) g`);
  try {
    const r = await enregistrer();
    assert.equal(r.status, 503);
    assert.equal(r.data.error, 'temporarily_unavailable');
  } finally {
    await admin.query("delete from oauth_clients where id like 'kxc_plafond_%'");
  }
});

// ---------- Autorisation ----------

test('parcours complet avec PKCE : jeton au nom de la personne, « Claude pour Eric · mcp », rafraîchissement renouvelé', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const b = (await eric.post('/api/boards', { name: 'Chantier Eric' })).data;
  const carte = (await eric.post(`/api/columns/${b.columns[0].id}/cards`, { title: 'Devis' })).data;

  const client = (await enregistrer()).data.client_id;
  const { verificateur, defi } = pkce();
  const qs = parametres({ client, defi });

  // L'adresse d'autorisation affiche l'écran de consentement (application) ; rien n'est accordé sans un clic.
  const page = await fetch(`${srv.base}/oauth/authorize?${qs}`, { redirect: 'manual' });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const demande = await eric.get(`/api/oauth/demande?${qs}`);
  assert.equal(demande.status, 200);
  assert.deepEqual(demande.data, { client: { nom: 'Claude' }, hote: 'claude.ai', boucleLocale: false });
  assert.equal((await admin.query('select count(*)::int n from oauth_codes where client_id = $1', [client])).rows[0].n, 0);

  const accord = await decider(eric, qs);
  assert.equal(accord.status, 200);
  const retour = new URL(accord.data.redirection);
  assert.equal(`${retour.origin}${retour.pathname}`, RETOUR_CLAUDE);
  assert.equal(retour.searchParams.get('state'), 'etat-123');
  assert.equal(retour.searchParams.get('iss'), EMETTEUR);
  assert.match(retour.searchParams.get('code'), /^[A-Za-z0-9_-]{30,}$/);

  const j = await echanger(retour.searchParams.get('code'), { client, verificateur });
  assert.equal(j.status, 200, JSON.stringify(j.data));
  assert.equal(j.headers.get('cache-control'), 'no-store');
  assert.equal(j.data.token_type, 'Bearer');
  assert.equal(j.data.expires_in, 3600);
  assert.match(j.data.access_token, /^kxa_/);
  assert.match(j.data.refresh_token, /^kxr_/);
  assert.equal(j.data.scope, 'kanbanx');
  // Stockés hachés, comme les autres jetons.
  for (const jeton of [j.data.access_token, j.data.refresh_token]) {
    const h = await admin.query('select (token_hash = convert_to($1, \'UTF8\')) as clair, (token_hash = sha256(convert_to($1, \'UTF8\'))) as hache from oauth_jetons where token_hash in (convert_to($1, \'UTF8\'), sha256(convert_to($1, \'UTF8\')))', [jeton]);
    assert.deepEqual(h.rows, [{ clair: false, hache: true }]);
  }

  // MCP au nom d'Eric.
  const init = await mcp(j.data.access_token, 'initialize', { protocolVersion: '2025-11-25' });
  assert.equal(init.status, 200);
  assert.match(init.data.result.instructions, /au nom de « Eric »/);
  const liste = await outil(j.data.access_token, 'lister_tableaux');
  assert.ok(liste.structuredContent.tableaux.some((t) => t.id === b.id));
  const com = await outil(j.data.access_token, 'ajouter_commentaire', { carte_id: carte.id, texte: 'Je relance le fournisseur.' });
  assert.equal(com.isError, false, com.content[0].text);

  // L'historique et le fil disent qui agit, et pour qui.
  const act = (await eric.get(`/api/cards/${carte.id}/activity`)).data;
  const derniere = (act.activite ?? act.items ?? act)[0];
  assert.equal(derniere.actor.name, 'Eric');
  assert.equal(derniere.via, 'mcp');
  assert.equal(derniere.client, 'Claude');
  const fil = (await eric.get(`/api/cards/${carte.id}/comments`)).data;
  const dernierCom = (fil.commentaires ?? fil.items ?? fil).at(-1);
  assert.equal(dernierCom.author.name, 'Eric');
  assert.equal(dernierCom.client, 'Claude');

  // Rafraîchissement : jetons renouvelés à chaque usage.
  const r1 = await rafraichir(j.data.refresh_token, client);
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.notEqual(r1.data.access_token, j.data.access_token);
  assert.notEqual(r1.data.refresh_token, j.data.refresh_token);
  assert.equal((await mcp(r1.data.access_token, 'ping')).status, 200);
});

test('mauvais vérificateur PKCE : refusé, et le code ne sert plus', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const client = (await enregistrer()).data.client_id;
  const { verificateur, defi } = pkce();
  const code = codeDe((await decider(eric, parametres({ client, defi }))).data.redirection);
  const r = await echanger(code, { client, verificateur: pkce().verificateur });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'invalid_grant');
  assert.equal((await echanger(code, { client, verificateur })).data.error, 'invalid_grant');
});

test('PKCE obligatoire en S256 ; type de réponse, portée et ressource vérifiés avant tout accord', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const client = (await enregistrer()).data.client_id;
  const { defi } = pkce();
  for (const [extra, erreur] of [[{ code_challenge_method: 'plain' }, 'invalid_request'], [{ code_challenge: '' }, 'invalid_request'],
    [{ response_type: 'token' }, 'unsupported_response_type'], [{ scope: 'admin' }, 'invalid_scope'],
    [{ resource: 'https://autre.example/mcp' }, 'invalid_target']]) {
    const qs = parametres({ client, defi, ...extra });
    // Le serveur d'autorisation renvoie l'erreur au client, avec state et iss, sans afficher de consentement.
    const r = await fetch(`${srv.base}/oauth/authorize?${qs}`, { redirect: 'manual' });
    assert.equal(r.status, 302, JSON.stringify(extra));
    const loc = new URL(r.headers.get('location'));
    assert.equal(`${loc.origin}${loc.pathname}`, RETOUR_CLAUDE);
    assert.equal(loc.searchParams.get('error'), erreur);
    assert.equal(loc.searchParams.get('state'), 'etat-123');
    assert.equal(loc.searchParams.get('iss'), EMETTEUR);
    // Et l'accord est impossible.
    const a = await decider(eric, qs);
    assert.equal(a.status, 400, JSON.stringify(extra));
    assert.equal(a.data.redirection, undefined);
  }
});

test('adresse de retour hors liste ou client inconnu : jamais de redirection', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const client = (await enregistrer()).data.client_id;
  const { defi } = pkce();
  for (const qs of [parametres({ client, defi, redirect_uri: 'https://evil.example/cb' }),
    parametres({ client, defi, redirect_uri: 'https://claude.com/api/mcp/auth_callback' }), // autorisée en général, pas pour ce client
    parametres({ client: 'kxc_inconnu_inconnu_inconnu', defi })]) {
    const r = await fetch(`${srv.base}/oauth/authorize?${qs}`, { redirect: 'manual' });
    assert.notEqual(r.status, 302);
    assert.equal(r.headers.get('location'), null);
    const d = await eric.get(`/api/oauth/demande?${qs}`);
    assert.equal(d.status, 400);
    assert.equal(d.data.redirection, undefined);
    const a = await decider(eric, qs);
    assert.equal(a.status, 400);
    assert.equal(a.data.redirection, undefined);
  }
});

test('boucle locale (Claude Code) : port quelconque à l\'usage, chemin exact, avertissement à l\'écran', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const client = (await enregistrer(['http://localhost:4321/callback'])).data.client_id;
  const { verificateur, defi } = pkce();
  const qs = parametres({ client, defi, redirect_uri: 'http://localhost:9999/callback' });
  assert.deepEqual((await eric.get(`/api/oauth/demande?${qs}`)).data, { client: { nom: 'Claude' }, hote: 'localhost', boucleLocale: true });
  const a = await decider(eric, qs);
  assert.equal(a.status, 200);
  assert.ok(a.data.redirection.startsWith('http://localhost:9999/callback?'));
  // L'échange exige exactement l'adresse de la demande.
  const code = codeDe(a.data.redirection);
  assert.equal((await echanger(code, { client, verificateur, redirection: 'http://localhost:9999/callback' })).status, 200);
  const autre = parametres({ client, defi, redirect_uri: 'http://localhost:9999/autre' });
  assert.equal((await eric.get(`/api/oauth/demande?${autre}`)).status, 400);
});

test('refus de la personne : retour vers le client avec access_denied', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const client = (await enregistrer()).data.client_id;
  const a = await decider(eric, parametres({ client, defi: pkce().defi }), 'refuser');
  assert.equal(a.status, 200);
  const u = new URL(a.data.redirection);
  assert.equal(u.searchParams.get('error'), 'access_denied');
  assert.equal(u.searchParams.get('state'), 'etat-123');
  assert.equal(u.searchParams.get('iss'), EMETTEUR);
  assert.equal(u.searchParams.get('code'), null);
});

test('le consentement exige une session web et le jeton CSRF : jamais d\'accord implicite', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const client = (await enregistrer()).data.client_id;
  const qs = parametres({ client, defi: pkce().defi });
  const anonyme = new Client(srv.base);
  assert.equal((await decider(anonyme, qs)).status, 401);
  const sansCsrf = await eric.post('/api/oauth/accord', { parametres: qs, decision: 'accepter' }, { csrf: false });
  assert.equal(sansCsrf.status, 403);
  const agent = await agentAvecJeton(srv.base);
  assert.equal((await decider(agent, qs)).status, 403);
  const etranger = await eric.post('/api/oauth/accord', { parametres: qs, decision: 'accepter' }, { entetes: { Origin: 'https://evil.example' } });
  assert.equal(etranger.status, 403);
  assert.equal((await admin.query('select count(*)::int n from oauth_codes where client_id = $1', [client])).rows[0].n, 0);
});

// ---------- Codes et jetons ----------

test('code rejoué : refusé, et les jetons déjà émis par ce code sont révoqués', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const client = (await enregistrer()).data.client_id;
  const { verificateur, defi } = pkce();
  const code = codeDe((await decider(eric, parametres({ client, defi }))).data.redirection);
  const premier = await echanger(code, { client, verificateur });
  assert.equal(premier.status, 200);
  const rejeu = await echanger(code, { client, verificateur });
  assert.equal(rejeu.status, 400);
  assert.equal(rejeu.data.error, 'invalid_grant');
  assert.equal((await mcp(premier.data.access_token, 'ping')).status, 401);
  assert.equal((await rafraichir(premier.data.refresh_token, client)).data.error, 'invalid_grant');
});

test('code valable 60 secondes, lié au client et à l\'adresse de retour', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const client = (await enregistrer()).data.client_id;
  const autre = (await enregistrer()).data.client_id;
  for (const cas of ['expire', 'client', 'retour']) {
    const { verificateur, defi } = pkce();
    const code = codeDe((await decider(eric, parametres({ client, defi }))).data.redirection);
    const ligne = await admin.query('select extract(epoch from expires_at - created_at)::int s from oauth_codes order by created_at desc limit 1');
    assert.equal(ligne.rows[0].s, 60);
    if (cas === 'expire') await admin.query("update oauth_codes set expires_at = now() - interval '1 second'");
    const r = await echanger(code, { client: cas === 'client' ? autre : client, verificateur,
      redirection: cas === 'retour' ? 'https://claude.com/api/mcp/auth_callback' : RETOUR_CLAUDE });
    assert.equal(r.status, 400, cas);
    assert.equal(r.data.error, 'invalid_grant', cas);
  }
});

test('rafraîchissement rejoué : toute la lignée est révoquée', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const j = await brancher(eric);
  const r1 = await rafraichir(j.refresh_token, j.client);
  assert.equal(r1.status, 200);
  const rejeu = await rafraichir(j.refresh_token, j.client);
  assert.equal(rejeu.status, 400);
  assert.equal(rejeu.data.error, 'invalid_grant');
  assert.equal((await mcp(r1.data.access_token, 'ping')).status, 401);
  assert.equal((await rafraichir(r1.data.refresh_token, j.client)).data.error, 'invalid_grant');
  // Un autre client ne peut pas utiliser le jeton de rafraîchissement.
  const k = await brancher(eric);
  const autre = (await enregistrer()).data.client_id;
  assert.equal((await rafraichir(k.refresh_token, autre)).data.error, 'invalid_grant');
});

test('ressource différente refusée ; le jeton ne vaut que pour /mcp', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const client = (await enregistrer()).data.client_id;
  const { verificateur, defi } = pkce();
  const code = codeDe((await decider(eric, parametres({ client, defi }))).data.redirection);
  const r = await echanger(code, { client, verificateur, resource: 'https://autre.example/mcp' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'invalid_target');
  const j = await brancher(eric);
  assert.equal((await rafraichir(j.refresh_token, j.client, { resource: 'https://autre.example/mcp' })).data.error, 'invalid_target');
  // L'API REST refuse les jetons OAuth.
  const api = new Client(srv.base);
  api.bearer = j.access_token;
  assert.equal((await api.get('/api/boards')).status, 401);
  // Un jeton passé dans l'adresse n'est jamais lu.
  const q = await fetch(`${srv.base}/mcp?access_token=${j.access_token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  assert.equal(q.status, 401);
});

test('jeton d\'accès valable une heure ; expiré, il est refusé avec invalid_token', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const j = await brancher(eric);
  const d = await admin.query("select extract(epoch from expires_at - created_at)::int s from oauth_jetons where type = 'acces' order by created_at desc limit 1");
  assert.equal(d.rows[0].s, 3600);
  await admin.query("update oauth_jetons set expires_at = now() - interval '1 second' where type = 'acces' and acces_id = (select acces_id from oauth_jetons order by created_at desc limit 1)");
  const r = await mcp(j.access_token, 'ping');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /error="invalid_token"/);
});

test('un jeton d\'Eric ne lit pas un tableau réservé à Alexis', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const alexis = await utilisateurConnecte(srv.base, 'Alexis');
  const prive = (await alexis.post('/api/boards', { name: 'Réservé à Alexis' })).data;
  const j = await brancher(eric);
  const liste = await outil(j.access_token, 'lister_tableaux');
  assert.ok(!liste.structuredContent.tableaux.some((t) => t.id === prive.id));
  const lu = await outil(j.access_token, 'lire_tableau', { tableau_id: prive.id });
  assert.equal(lu.isError, true);
  assert.match(lu.content[0].text, /introuvable/i);
  const ecrit = await outil(j.access_token, 'creer_carte', { colonne_id: prive.columns[0].id, titre: 'Intrusion' });
  assert.equal(ecrit.isError, true);
  assert.equal((await admin.query("select count(*)::int n from cards where title = 'Intrusion'")).rows[0].n, 0);
});

test('Applications connectées : la personne voit et retire ses accès ; un jeton révoqué est refusé aussitôt', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const xavier = await utilisateurConnecte(srv.base, 'Xavier');
  const j = await brancher(eric);
  const liste = await eric.get('/api/oauth/acces');
  assert.equal(liste.status, 200);
  assert.equal(liste.data.acces.length, 1);
  const acces = liste.data.acces[0];
  assert.equal(acces.client, 'Claude');
  assert.equal(acces.hote, 'claude.ai');
  assert.ok(acces.creeLe && 'utiliseLe' in acces);
  assert.equal((await xavier.get('/api/oauth/acces')).data.acces.length, 0);
  // Xavier ne peut pas retirer l'accès d'Eric.
  assert.equal((await xavier.delete(`/api/oauth/acces/${acces.id}`)).status, 404);
  assert.equal((await mcp(j.access_token, 'ping')).status, 200);

  assert.equal((await eric.delete(`/api/oauth/acces/${acces.id}`)).status, 200);
  assert.equal((await mcp(j.access_token, 'ping')).status, 401);
  assert.equal((await rafraichir(j.refresh_token, j.client)).data.error, 'invalid_grant');
  assert.equal((await eric.get('/api/oauth/acces')).data.acces.length, 0);
});

test('compte désactivé : ses jetons OAuth sont refusés', async () => {
  const eric = await utilisateurConnecte(srv.base, 'Eric');
  const j = await brancher(eric);
  await admin.query('update users set disabled_at = now() where id = $1', [eric.user.id]);
  assert.equal((await mcp(j.access_token, 'ping')).status, 401);
  assert.equal((await rafraichir(j.refresh_token, j.client)).data.error, 'invalid_grant');
});

test('jeton : requête mal formée, type d\'accord inconnu, corps JSON refusé', async () => {
  const sans = await formulaire('/oauth/token', { grant_type: 'authorization_code' });
  assert.equal(sans.status, 400);
  assert.equal(sans.data.error, 'invalid_request');
  assert.equal((await formulaire('/oauth/token', { grant_type: 'client_credentials', client_id: 'x' })).data.error, 'unsupported_grant_type');
  const enJson = await json('POST', '/oauth/token', { grant_type: 'refresh_token', refresh_token: 'kxr_x', client_id: 'x' });
  assert.equal(enJson.status, 400);
  assert.equal(enJson.data.error, 'invalid_request');
  assert.equal((await rafraichir('kxr_inexistant_inexistant_inexistant', 'kxc_inconnu')).data.error, 'invalid_grant');
});
