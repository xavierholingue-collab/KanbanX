// Appels à l'API : jeton CSRF, identifiant de client (pour ignorer l'écho de ses propres événements), erreurs lisibles.
export const clientId = crypto.randomUUID();
let csrf = null;
export const definirCsrf = (v) => { csrf = v; };

export class ErreurApi extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

export async function api(methode, chemin, corps) {
  const entetes = { 'X-Client-Id': clientId };
  if (corps !== undefined) entetes['Content-Type'] = 'application/json';
  if (methode !== 'GET' && csrf) entetes['X-CSRF-Token'] = csrf;
  let r;
  try {
    r = await fetch(chemin, { method: methode, headers: entetes, body: corps === undefined ? undefined : JSON.stringify(corps), credentials: 'same-origin' });
  } catch {
    throw new ErreurApi(0, 'Connexion au serveur impossible. Vérifiez votre réseau.');
  }
  let data = null;
  try { data = await r.json(); } catch { /* corps vide */ }
  if (!r.ok) {
    const message = data?.erreur?.message ?? `Erreur ${r.status}`;
    if (r.status === 401 && !chemin.startsWith('/api/auth/') && chemin !== '/api/me') window.dispatchEvent(new CustomEvent('kx:deconnecte'));
    throw new ErreurApi(r.status, message, data?.erreur?.code);
  }
  return data;
}
export const get = (c) => api('GET', c);
export const post = (c, b = {}) => api('POST', c, b);
export const patch = (c, b) => api('PATCH', c, b);
export const del = (c) => api('DELETE', c);
