import { h, annoncer } from './dom.js';

function zone() { return document.getElementById('toasts'); }

/** Message bref ; avec `annuler`, propose le bandeau « Annuler » pendant quelques secondes. */
export function toast(texte, { annuler, erreur = false, duree } = {}) {
  const t = h(`div.toast${erreur ? '.toast-erreur' : ''}`, { role: erreur ? 'alert' : 'status' });
  const fermer = () => { t.remove(); clearTimeout(minuteur); };
  t.append(h('p', texte));
  if (annuler) {
    t.append(h('button.btn', { type: 'button', onclick: () => { fermer(); annuler(); } }, 'Annuler'));
  }
  t.append(h('button.btn.btn-icone', { type: 'button', 'aria-label': 'Fermer le message', onclick: fermer }, '✕'));
  zone().append(t);
  if (!erreur) annoncer(annuler ? `${texte}. Bouton Annuler disponible.` : texte);
  const minuteur = setTimeout(fermer, duree ?? (annuler ? 7000 : erreur ? 8000 : 4000));
  return fermer;
}
export const erreur = (texte) => toast(texte, { erreur: true });
