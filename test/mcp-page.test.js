// Nuit 2, point 5 : /mcp ouverte dans un navigateur affiche une courte page ; les clients MCP ne voient rien changer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, agentAvecJeton } from './serveur.js';
import { fermer } from './aide.js';
import { EN_TETES } from '../src/securite.js';

let srv;
before(async () => { srv = await demarrer(); });
after(async () => { await srv.fermer(); await fermer(); });

const NAVIGATEUR = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

test('GET /mcp depuis un navigateur : courte page HTML, avec la CSP de l\'application', async () => {
  const r = await fetch(`${srv.base}/mcp`, { headers: { Accept: NAVIGATEUR } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html; charset=utf-8/);
  assert.equal(r.headers.get('content-security-policy'), EN_TETES['Content-Security-Policy']);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const page = await r.text();
  assert.ok(page.includes('Ceci est l\'adresse du serveur MCP de KanbanX.'), page);
  assert.ok(page.includes('Collez-la dans Claude : Paramètres › Connecteurs › Ajouter un connecteur personnalisé.'));
  assert.doesNotMatch(page, /<script|\sstyle=|\son[a-z]+=/i, 'ni script ni style en ligne');
  assert.equal((await fetch(`${srv.base}/mcp`, { headers: { Accept: 'text/html' } })).status, 200);
});

test('tout autre GET garde la réponse actuelle : 405 en JSON', async () => {
  const claude = await agentAvecJeton(srv.base);
  const cas = [
    {},
    { Accept: '*/*' },
    { Accept: 'application/json' },
    { Accept: 'text/event-stream' },
    { Accept: 'application/json, text/event-stream' },
    { Accept: 'text/event-stream', Authorization: `Bearer ${claude.bearer}` },
    { Accept: 'application/json, text/event-stream', Authorization: `Bearer ${claude.bearer}`, 'MCP-Protocol-Version': '2025-11-25' },
  ];
  for (const entetes of cas) {
    const r = await fetch(`${srv.base}/mcp`, { headers: entetes });
    const cle = JSON.stringify(entetes);
    assert.equal(r.status, 405, cle);
    assert.equal(r.headers.get('allow'), 'POST', cle);
    assert.match(r.headers.get('content-type'), /^application\/json/, cle);
    const corps = await r.json();
    assert.equal(corps.jsonrpc, '2.0', cle);
  }
});

test('la page n\'est servie qu\'en GET : un POST de navigateur reste traité comme du JSON-RPC', async () => {
  const r = await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { Accept: NAVIGATEUR, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('content-type'), /^application\/json/);
});
