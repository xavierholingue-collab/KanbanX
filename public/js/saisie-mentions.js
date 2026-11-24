// Suggestions de mentions @prénom pour n'importe quel champ de saisie (commentaire, titre, description).
// Modèle d'accessibilité : combobox ARIA 1.2 (le champ garde le focus, l'option active est désignée par
// aria-activedescendant). Les touches de la liste passent avant celles du champ (écoute en capture).
import { h, avatar } from './dom.js';

let compteur = 0;
// « @Claude » est toujours proposé : la mention va au Claude de chaque membre qui l'a branché.
const avecClaude = (l) => (l.some((m) => norm(m.name.split(/\s+/)[0]) === 'claude') ? l : [...l, { id: 'claude', name: 'Claude', kind: 'agent', claude: true }]);
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Branche les suggestions sur `champ` (input ou textarea) ; `membres()` renvoie les membres du tableau.
 * Renvoie l'élément à insérer dans la page (le champ, dans un conteneur positionné, et la liste).
 */
export function avecMentions(champ, membres) {
  const id = `suggestions-${++compteur}`;
  const liste = h('ul.suggestions', { id, role: 'listbox', 'aria-label': 'Membres à mentionner', hidden: true });
  champ.setAttribute('role', 'combobox');
  champ.setAttribute('aria-autocomplete', 'list');
  champ.setAttribute('aria-expanded', 'false');
  champ.setAttribute('aria-controls', id);
  let choix = []; let actif = 0;
  const fermer = () => { liste.hidden = true; champ.setAttribute('aria-expanded', 'false'); champ.removeAttribute('aria-activedescendant'); choix = []; };
  const requete = () => {
    const avant = champ.value.slice(0, champ.selectionStart);
    const m = avant.match(/(?:^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_-]*)$/u);
    return m ? m[1] : null;
  };
  const afficher = () => {
    const r = requete();
    if (r === null) return fermer();
    choix = avecClaude(membres()).filter((m) => norm(m.name).startsWith(norm(r))).slice(0, 6);
    if (!choix.length) return fermer();
    actif = Math.min(actif, choix.length - 1);
    liste.replaceChildren(...choix.map((m, i) => h('li.option', { role: 'option', id: `${id}-${i}`, 'aria-selected': String(i === actif),
      onpointerdown: (e) => { e.preventDefault(); inserer(m); } }, avatar(m), m.name, m.claude ? h('span.aide', ' — le Claude de chaque membre') : m.kind === 'agent' ? ' (agent)' : '')));
    liste.hidden = false;
    champ.setAttribute('aria-expanded', 'true');
    champ.setAttribute('aria-activedescendant', `${id}-${actif}`);
  };
  const inserer = (m) => {
    const pos = champ.selectionStart;
    const avant = champ.value.slice(0, pos).replace(/@([\p{L}\p{N}_-]*)$/u, `@${m.name.split(/\s+/)[0]} `);
    champ.value = avant + champ.value.slice(pos);
    champ.setSelectionRange(avant.length, avant.length);
    fermer();
    champ.focus();
    champ.dispatchEvent(new Event('input', { bubbles: true })); // le propriétaire du champ garde son état à jour
  };
  champ.addEventListener('input', () => { actif = 0; afficher(); });
  champ.addEventListener('click', afficher);
  champ.addEventListener('blur', () => setTimeout(fermer, 100));
  champ.addEventListener('keydown', (e) => {
    if (liste.hidden || !choix.length) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { fermer(); return; } // publier : laissé au champ
    const prendre = () => { e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); };
    if (e.key === 'ArrowDown') { prendre(); actif = (actif + 1) % choix.length; afficher(); }
    else if (e.key === 'ArrowUp') { prendre(); actif = (actif - 1 + choix.length) % choix.length; afficher(); }
    else if ((e.key === 'Enter' && !e.isComposing) || e.key === 'Tab') { prendre(); inserer(choix[actif]); }
    else if (e.key === 'Escape') { prendre(); fermer(); }
  }, { capture: true });
  return h('div.popover.popover-mentions', champ, liste);
}
