// Petits outils DOM. Le texte est toujours inséré par textContent : aucune chaîne n'est interprétée comme du HTML.

/** h('button.btn.btn-primaire', { type: 'button', onclick }, 'Texte', enfant…) */
export function h(sel, props = {}, ...enfants) {
  const m = sel.match(/^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  const classes = [];
  for (const [, type, nom] of m[2].matchAll(/([.#])([\w-]+)/g)) { if (type === '#') el.id = nom; else classes.push(nom); }
  if (classes.length) el.className = classes.join(' ');
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { enfants.unshift(props); props = {}; }
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k in el && !k.startsWith('aria') && k !== 'role' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  ajouter(el, enfants);
  return el;
}
function ajouter(el, enfants) {
  for (const e of enfants.flat(Infinity)) {
    if (e === null || e === undefined || e === false) continue;
    el.append(e instanceof Node ? e : document.createTextNode(String(e)));
  }
}

const SVG = 'http://www.w3.org/2000/svg';
const ICONES = {
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  crayon: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  utilisateur: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  calendrier: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  etiquette: 'M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01',
  commentaire: 'M4 5h16v11H9l-5 4V5z',
  texte: 'M4 6h16M4 12h16M4 18h10',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  recherche: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  aide: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  membres: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7M18 14a6 6 0 0 1 4 7',
  coche: 'M5 12l5 5 9-11',
  activite: 'M3 12h4l3-8 4 16 3-8h4',
  sortie: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  fleche: 'M5 12h14M13 6l6 6-6 6',
  menu: 'M5 12h.01M12 12h.01M19 12h.01',
  robot: 'M5 9h14v10H5zM12 5v4M9 13h.01M15 13h.01M9 16h6',
};
export function icone(nom) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', ICONES[nom] ?? '');
  s.append(p);
  return s;
}

/** Annonce pour les lecteurs d'écran (région aria-live). */
export function annoncer(texte, urgent = false) {
  const zone = document.getElementById(urgent ? 'annonces-urgentes' : 'annonces');
  if (!zone) return;
  zone.textContent = '';
  setTimeout(() => { zone.textContent = texte; }, 30);
}

export const initiales = (nom) => String(nom).trim().split(/\s+/).map((m) => m[0]).join('').slice(0, 2).toUpperCase();

export function avatar(m) {
  return h(`span.avatar${m.kind === 'agent' ? '.avatar-agent' : ''}`, { title: m.name, 'aria-hidden': 'true' }, initiales(m.name));
}

/** Insère un HTML produit et nettoyé par le serveur (Markdown). Seul usage d'innerHTML de l'application. */
export function htmlNettoye(el, html) {
  el.innerHTML = html;
  return el;
}

export function formaterDate(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(a, m - 1, j).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(a !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
export function etatEcheance(iso) {
  if (!iso) return null;
  const [a, m, j] = iso.split('-').map(Number);
  const d = new Date(a, m - 1, j);
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const jours = Math.round((d - auj) / 86400000);
  if (jours < 0) return { classe: 'depassee', texte: 'en retard' };
  if (jours <= 2) return { classe: 'proche', texte: jours === 0 ? 'aujourd\'hui' : 'bientôt' };
  return { classe: '', texte: '' };
}
