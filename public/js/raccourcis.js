// Raccourcis clavier usuels et leur aide (?).
import { h } from './dom.js';
import { nouvelleCarte, T } from './tableau.js';

const LISTE = [
  ['n', 'Nouvelle carte (dans la colonne courante)'],
  ['/', 'Rechercher une carte'],
  ['Échap', 'Fermer, annuler'],
  ['?', 'Afficher cette aide'],
  ['Entrée', 'Ouvrir la carte qui a le focus'],
  ['Espace', 'Saisir une carte ou une colonne pour la déplacer'],
  ['← ↑ → ↓', 'Se déplacer entre les cartes, ou déplacer la carte saisie'],
  ['Ctrl + Entrée', 'Enregistrer la description'],
];

function aide() {
  if (document.querySelector('dialog.dialog-aide')) return;
  const d = h('dialog.dialog-petit.dialog-aide', { 'aria-labelledby': 'titre-aide' },
    h('div.dialog-entete', h('h2#titre-aide', 'Raccourcis clavier'), h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': 'Fermer', onclick: () => d.close() }, '✕')),
    h('div.dialog-corps', h('dl.raccourcis', LISTE.flatMap(([k, t]) => [h('dt', h('kbd', k)), h('dd', t)]))));
  const avant = document.activeElement;
  d.addEventListener('close', () => { d.remove(); avant?.focus?.(); });
  document.body.append(d);
  d.showModal();
}

export function installerRaccourcis() {
  window.addEventListener('kx:aide', aide);
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === '?') { e.preventDefault(); return aide(); }
    if (document.querySelector('dialog[open]')) return;
    if (!T.tableau) return;
    if (e.key === 'n' || e.key === 'N') { if (nouvelleCarte()) e.preventDefault(); }
    else if (e.key === '/') { const r = document.getElementById('recherche'); if (r) { e.preventDefault(); r.focus(); r.select(); } }
  });
}
