// Client de test : serveur réel sur un port libre, avec gestion du cookie de session et du jeton CSRF.
import { creerServeur } from '../src/serveur.js';
import { boiteDev } from '../src/courriel.js';
import { reinitialiserLimites } from '../src/securite.js';
import { creerJeton } from '../scripts/jeton.js';
import { admin, creerUtilisateur } from './aide.js';

export async function demarrer() {
  reinitialiserLimites();
  const s = creerServeur();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  return { base, fermer: () => { s.closeAllConnections(); return new Promise((r) => s.close(r)); } };
}

export class Client {
  constructor(base) { this.base = base; this.cookie = null; this.csrf = null; this.bearer = null; }

  async requete(methode, chemin, corps, { entetes = {}, brut = false, csrf = true } = {}) {
    const h = { ...entetes };
    if (corps !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
    if (this.bearer) h.Authorization = `Bearer ${this.bearer}`;
    else if (this.cookie) { h.Cookie = this.cookie; if (csrf && this.csrf && methode !== 'GET') h['X-CSRF-Token'] = this.csrf; }
    const r = await fetch(this.base + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : (brut ? corps : JSON.stringify(corps)) });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.startsWith('__Host-kx=;') || /Max-Age=0/.test(sc) ? null : sc.split(';')[0];
    const texte = await r.text();
    let data; try { data = JSON.parse(texte); } catch { data = texte; }
    return { status: r.status, data, headers: r.headers };
  }
  get(c, o) { return this.requete('GET', c, undefined, o); }
  post(c, b = {}, o) { return this.requete('POST', c, b, o); }
  patch(c, b, o) { return this.requete('PATCH', c, b, o); }
  delete(c, o) { return this.requete('DELETE', c, undefined, o); }

  /** Connexion complète par lien magique, comme un humain. */
  async connecter(email) {
    reinitialiserLimites();
    boiteDev.length = 0;
    await this.post('/api/auth/demander', { email });
    const m = boiteDev.at(-1);
    const jeton = new URL(m.lien).searchParams.get('token');
    const r = await this.post('/api/auth/verifier', { token: jeton });
    this.csrf = r.data.csrf;
    return r;
  }
}

/** Crée un utilisateur et le connecte (cookie). */
export async function utilisateurConnecte(base, nom = 'Test') {
  const u = await creerUtilisateur(nom);
  const c = new Client(base);
  await c.connecter(u.email);
  c.user = u;
  return c;
}

/** Crée un compte agent avec jeton d'API. */
export async function agentAvecJeton(base, nom = 'Claude') {
  const u = await creerUtilisateur(nom, 'agent');
  const cl = await admin.connect();
  let jeton;
  try { jeton = await creerJeton(cl, u.email); } finally { cl.release(); }
  const c = new Client(base);
  c.bearer = jeton; c.user = u;
  return c;
}
