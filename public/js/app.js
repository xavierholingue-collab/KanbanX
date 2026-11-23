// KanbanX — point d'entrée : routeur, en-tête, écrans de connexion et d'accueil.
import { h, icone } from './dom.js';
import { get, post, definirCsrf, ErreurApi } from './api.js';
import { erreur, toast } from './toasts.js';
import { ecranTableau, synchroniserCarte, quitterTableau } from './tableau.js';
import { installerRaccourcis } from './raccourcis.js';

export const etat = { moi: undefined, ecran: null }; // moi : undefined = inconnu, null = non connecté

export function naviguer(url, { remplacer = false } = {}) {
  if (url === location.pathname + location.search) return rendre();
  history[remplacer ? 'replaceState' : 'pushState'](null, '', url);
  rendre();
}
window.addEventListener('popstate', () => rendre());
// Liens internes : navigation sans rechargement (les clics avec modificateur ouvrent un nouvel onglet).
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
  e.preventDefault();
  naviguer(a.getAttribute('href'));
});
window.addEventListener('kx:deconnecte', () => { etat.moi = null; naviguer('/connexion', { remplacer: true }); });

function entete() {
  const el = document.getElementById('entete');
  el.replaceChildren(
    h('a.marque', { href: etat.moi ? '/' : '/connexion' }, logo(), 'KanbanX'),
    h('span.espace'),
    etat.moi && h('span.utilisateur', etat.moi.name),
    etat.moi && h('button.btn.btn-icone', { type: 'button', 'aria-label': 'Raccourcis clavier (?)', title: 'Raccourcis clavier (?)', onclick: () => window.dispatchEvent(new CustomEvent('kx:aide')) }, icone('aide')),
    etat.moi && h('button.btn', { type: 'button', onclick: deconnexion }, icone('sortie'), h('span', 'Se déconnecter')),
  );
}
function logo() {
  const img = h('img.marque-logo', { src: '/favicon.svg', alt: '' });
  return img;
}

async function deconnexion() {
  try { await post('/api/auth/deconnexion'); } catch { /* déjà déconnecté */ }
  etat.moi = null;
  naviguer('/connexion');
}

async function chargerMoi() {
  try {
    const r = await get('/api/me');
    etat.moi = r.user; definirCsrf(r.csrf);
  } catch (e) {
    if (!(e instanceof ErreurApi) || e.status !== 401) throw e;
    etat.moi = null;
  }
}

export function contenu() { return document.getElementById('contenu'); }

async function rendre() {
  const chemin = location.pathname;
  const m = chemin.match(/^\/b\/([0-9a-f-]{36})(?:\/c\/([0-9a-f-]{36}))?\/?$/);
  if (chemin === '/connexion/verifier') return verifier();
  if (etat.moi === undefined) await chargerMoi();
  entete();
  if (!etat.moi) {
    quitterTableau();
    if (chemin !== '/connexion') sessionStorage.setItem('kx:apres', chemin);
    if (chemin !== '/connexion') history.replaceState(null, '', '/connexion');
    return connexion();
  }
  if (chemin === '/connexion') { history.replaceState(null, '', '/'); return accueil(); }
  if (m) {
    if (etat.ecran?.type === 'tableau' && etat.ecran.id === m[1]) return synchroniserCarte(m[2] ?? null);
    etat.ecran = { type: 'tableau', id: m[1] };
    return ecranTableau(contenu(), m[1], m[2] ?? null, etat.moi);
  }
  quitterTableau();
  etat.ecran = { type: 'accueil' };
  return accueil();
}

// ---------- Connexion ----------
function connexion() {
  etat.ecran = { type: 'connexion' };
  document.title = 'Connexion — KanbanX';
  const email = h('input.champ#email', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'prenom@exemple.fr' });
  const zoneMessage = h('div', { role: 'status' });
  const bouton = h('button.btn.btn-primaire', { type: 'submit' }, 'Recevoir un lien de connexion');
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!email.value.trim() || !email.checkValidity()) {
      zoneMessage.replaceChildren(h('p.message.message-erreur', 'Saisissez une adresse courriel valide.'));
      email.setAttribute('aria-invalid', 'true');
      return email.focus();
    }
    email.removeAttribute('aria-invalid');
    bouton.disabled = true;
    try {
      await post('/api/auth/demander', { email: email.value.trim() });
      zoneMessage.replaceChildren(h('p.message', 'Si cette adresse a été invitée, un lien de connexion vient de lui être envoyé. Il est valable 15 minutes.'));
    } catch (err) {
      zoneMessage.replaceChildren(h('p.message.message-erreur', err.message));
    } finally { bouton.disabled = false; }
  } },
  h('div', h('label.etiquette-champ', { for: 'email' }, 'Adresse courriel'), email),
  bouton, zoneMessage);
  contenu().replaceChildren(h('div.page', h('section.boite', { 'aria-labelledby': 'titre-connexion' },
    h('h1#titre-connexion', 'Connexion à KanbanX'),
    h('p.aide', 'KanbanX fonctionne sur invitation. Saisissez votre adresse : nous vous envoyons un lien magique, sans mot de passe.'),
    form)));
  email.focus();
}

async function verifier() {
  const token = new URLSearchParams(location.search).get('token');
  history.replaceState(null, '', '/connexion/verifier'); // le jeton ne reste ni dans la barre d'adresse ni dans l'historique
  entete();
  contenu().replaceChildren(h('div.page', h('section.boite', h('h1', 'Connexion…'), h('p.aide', { role: 'status' }, 'Vérification du lien en cours.'))));
  try {
    if (!token) throw new Error('Lien incomplet.');
    const r = await post('/api/auth/verifier', { token });
    definirCsrf(r.csrf);
    etat.moi = undefined;
    const apres = sessionStorage.getItem('kx:apres');
    sessionStorage.removeItem('kx:apres');
    naviguer(apres && apres.startsWith('/b/') ? apres : '/', { remplacer: true });
  } catch (e) {
    contenu().replaceChildren(h('div.page', h('section.boite',
      h('h1', 'Lien invalide'), h('p.message.message-erreur', { role: 'alert' }, e.message),
      h('p', h('a.btn.btn-primaire', { href: '/connexion' }, 'Demander un nouveau lien')))));
  }
}

// ---------- Accueil : mes tableaux ----------
const ROLES = { owner: 'Propriétaire', member: 'Membre', reader: 'Lecteur' };

async function accueil() {
  document.title = 'Mes tableaux — KanbanX';
  const liste = h('ul.grille-tableaux', { 'aria-label': 'Mes tableaux' });
  const page = h('div.page', h('h1', 'Mes tableaux'), liste);
  contenu().replaceChildren(page);
  let tableaux = [];
  try { tableaux = await get('/api/boards'); } catch (e) { return erreur(e.message); }
  const tuileNouveau = h('li');
  const ouvrirForm = () => {
    const champ = h('input.champ#nom-tableau', { type: 'text', maxlength: 100, required: true, placeholder: 'Ex. : Projet Alpha', autocomplete: 'off' });
    const fermer = () => { tuileNouveau.replaceChildren(boutonNouveau); boutonNouveau.focus(); };
    const form = h('form.form-tuile', { onsubmit: async (e) => {
      e.preventDefault();
      const nom = champ.value.trim();
      if (!nom) return champ.focus();
      try {
        const b = await post('/api/boards', { name: nom });
        naviguer(`/b/${b.id}`);
      } catch (err) { erreur(`Création impossible : ${err.message}`); }
    }, onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); fermer(); } } },
    h('label.etiquette-champ', { for: 'nom-tableau' }, 'Nom du tableau'), champ,
    h('p.aide', 'Il démarre avec trois colonnes : À faire, En cours, Fait.'),
    h('div.rangee', h('button.btn.btn-primaire', { type: 'submit' }, 'Créer'), h('button.btn.btn-discret', { type: 'button', onclick: fermer }, 'Annuler')));
    tuileNouveau.replaceChildren(form);
    champ.focus();
  };
  const boutonNouveau = h('button.tuile.tuile-nouveau', { type: 'button', onclick: ouvrirForm }, icone('plus'), ' Créer un tableau');
  tuileNouveau.append(boutonNouveau);
  const fichier = h('input.visuellement-cache#fichier-trello', { type: 'file', accept: 'application/json,.json', onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 10_000_000) return erreur('Fichier trop volumineux (10 Mo au plus).');
    let data;
    try { data = JSON.parse(await f.text()); } catch { return erreur('Ce fichier n\'est pas un export JSON de Trello valide.'); }
    try {
      const r = await post('/api/boards/import-trello', data);
      const pl = (n, m) => `${n} ${m}${n > 1 ? 's' : ''}`;
      toast(`Tableau « ${r.name} » importé : ${pl(r.colonnes, 'colonne')}, ${pl(r.cartes, 'carte')}, ${pl(r.commentaires, 'commentaire')}.`);
      naviguer(`/b/${r.id}`);
    } catch (err) { erreur(`Import impossible : ${err.message}`); }
  } });
  page.append(h('div.rangee.import', fichier,
    h('label.btn.btn-secondaire', { for: 'fichier-trello' }, icone('archive'), 'Importer un tableau Trello (JSON)'),
    h('span.aide', 'Listes, cartes, étiquettes, échéances et commentaires sont repris.')));
  liste.replaceChildren(
    ...tableaux.map((t) => h('li', h('a.tuile', { href: `/b/${t.id}` }, h('span', t.name, h('span.tuile-role', ROLES[t.role]))))),
    tuileNouveau,
  );
  if (!tableaux.length) page.insertBefore(h('p.vide', 'Vous n\'avez encore aucun tableau. Créez le premier !'), liste);
}

installerRaccourcis();
rendre().catch((e) => erreur(e.message));
