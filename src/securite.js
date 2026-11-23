import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const hacher = (s) => createHash('sha256').update(s).digest();
export const jetonAleatoire = (n = 32) => randomBytes(n).toString('base64url');

export function egalSur(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Aucun script ni style en ligne : tout vient de notre propre origine.
export const EN_TETES = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// Limitation de débit en mémoire (un seul processus). Fenêtre fixe.
const compteurs = new Map();
export function limiter(cle, max, fenetreMs) {
  const t = Date.now();
  let c = compteurs.get(cle);
  if (!c || c.fin <= t) { c = { n: 0, fin: t + fenetreMs }; compteurs.set(cle, c); }
  c.n += 1;
  return { ok: c.n <= max, reessayerDansS: Math.ceil((c.fin - t) / 1000) };
}
export function reinitialiserLimites() { compteurs.clear(); }
setInterval(() => { const t = Date.now(); for (const [k, v] of compteurs) if (v.fin <= t) compteurs.delete(k); }, 60_000).unref();

export function cookieSession(valeur, maxAgeS) {
  // __Host- impose Secure, Path=/ et aucun Domain.
  return `__Host-kx=${valeur}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`;
}
export function lireCookie(req, nom) {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === nom) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * Adresse du client. Derrière un proxy inverse de confiance (TRUST_PROXY=1), la connexion vient de la boucle
 * locale et le proxy transmet la vraie adresse dans X-Real-IP. Une connexion directe depuis Internet ne peut
 * jamais imposer son adresse par cet en-tête.
 */
export function ipClient(req, faireConfianceAuProxy) {
  const directe = req.socket?.remoteAddress ?? '?';
  if (!faireConfianceAuProxy) return directe;
  const locale = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(directe);
  const reelle = String(req.headers?.['x-real-ip'] ?? '').trim();
  return locale && /^[0-9a-fA-F:.]{2,45}$/.test(reelle) ? reelle : directe;
}
