// Téléchargement d'une image depuis Trello (nuit 2, point 9), avec garde-fous contre la falsification de requêtes
// côté serveur (SSRF) :
// - hôtes de Trello en liste fermée, à chaque redirection ; https seulement ; pas d'identifiants dans l'adresse ;
// - l'adresse IP est contrôlée au moment même de la connexion (pas de « DNS rebinding ») : aucune adresse interne ;
// - délai total, taille maximale (annoncée et réelle), nombre de redirections borné ;
// - la clé et le jeton de la personne ne partent que vers l'hôte d'origine, jamais vers celui d'une redirection.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { TAILLE_MAX } from './images.js';

export const HOTES_TRELLO = ['trello.com', 'api.trello.com', 'trello-attachments.s3.amazonaws.com'];

// Adresses non publiques : boucle locale, réseaux privés, partagés, lien local, documentation, multidiffusion…
const INTERDITES = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) INTERDITES.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) INTERDITES.addSubnet(a, p, 'ipv6');

/** Vrai si l'adresse IP est publique (ni interne, ni réservée). */
export function adressePublique(ip) {
  const v4 = String(ip).match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4) return adressePublique(v4[1]);
  if (net.isIPv4(ip)) return !INTERDITES.check(ip, 'ipv4');
  if (net.isIPv6(ip)) {
    if (/^::ffff:/i.test(ip)) return false; // forme hexadécimale d'une adresse IPv4 : refusée par prudence
    return !INTERDITES.check(ip, 'ipv6');
  }
  return false;
}

/** Réglages. Seuls les tests les modifient (faux serveur Trello local). */
export const reglages = {
  hotes: HOTES_TRELLO,
  protocoles: ['https:'],
  resoudre: async (hote) => lookup(hote, { verbatim: true }),
  adresseAutorisee: adressePublique,
  delaiMs: 10_000, // par image, tout compris
  maxOctets: TAILLE_MAX,
  maxRedirections: 3,
  maxImages: 200, // par import
  maxTotalOctets: 100 * 1024 * 1024, // par import
  delaiTotalMs: 90_000, // par import
};

function verifierAdresse(adresse) {
  let u;
  try { u = new URL(adresse); } catch { throw new Error('adresse invalide'); }
  if (!reglages.protocoles.includes(u.protocol)) throw new Error('protocole refusé');
  if (u.username || u.password) throw new Error('adresse refusée : identifiants dans l\'adresse');
  if (!reglages.hotes.includes(u.hostname.toLowerCase())) throw new Error('hôte refusé (hors de la liste de Trello)');
  return u;
}

function requete(u, entetes, signal) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: `${u.pathname}${u.search}`, method: 'GET',
      headers: { ...entetes, Accept: 'image/png, image/jpeg, image/gif, image/webp', 'User-Agent': 'KanbanX (import Trello)' },
      servername: u.hostname, agent: false, signal,
      // L'adresse contrôlée est celle à laquelle on se connecte.
      lookup: (hote, options, cb) => {
        reglages.resoudre(hote).then(({ address, family }) => {
          if (!reglages.adresseAutorisee(address)) return cb(new Error('adresse interne refusée'));
          if (options?.all) return cb(null, [{ address, family }]);
          return cb(null, address, family);
        }, () => cb(new Error('hôte introuvable')));
      },
    });
    req.on('response', (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); return resolve({ redirection: res.headers.location }); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`réponse ${res.statusCode}`)); }
      const annoncee = Number(res.headers['content-length']);
      if (annoncee > reglages.maxOctets) { res.destroy(); return reject(new Error('image trop volumineuse')); }
      const morceaux = []; let n = 0;
      res.on('data', (m) => {
        n += m.length;
        if (n > reglages.maxOctets) { res.destroy(); req.destroy(); return reject(new Error('image trop volumineuse')); }
        morceaux.push(m);
      });
      res.on('end', () => resolve({ corps: Buffer.concat(morceaux) }));
      res.on('error', reject);
    });
    req.on('error', (e) => reject(e.name === 'AbortError' ? new Error('délai dépassé') : e));
    req.end();
  });
}

/**
 * Télécharge une image ; `entetes` (authentification) ne part que vers l'hôte d'origine.
 * Lève une erreur sans jamais y recopier les en-têtes.
 */
export async function telechargerImage(adresse, { entetes = {} } = {}) {
  let u = verifierAdresse(adresse);
  const origine = u.host;
  const signal = AbortSignal.timeout(reglages.delaiMs);
  for (let n = 0; ; n++) {
    const r = await requete(u, u.host === origine ? entetes : {}, signal);
    if (r.corps) return r.corps;
    if (n >= reglages.maxRedirections || !r.redirection) throw new Error('trop de redirections');
    u = verifierAdresse(new URL(r.redirection, u).toString());
  }
}
