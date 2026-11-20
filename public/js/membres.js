// Gestion des membres d'un tableau (invitations, rôles).
import { h, avatar } from './dom.js';
import { post, patch, del } from './api.js';
import { toast, erreur } from './toasts.js';

const ROLES = { owner: 'Propriétaire', member: 'Membre', reader: 'Lecteur' };

export function ouvrirMembres(T) {
  const d = h('dialog.dialog-petit', { 'aria-labelledby': 'titre-membres' });
  const proprietaire = T.tableau.role === 'owner';
  const rendreListe = () => h('ul.membres', T.tableau.members.map((m) => h('li', avatar(m),
    h('span.nom', m.name, m.kind === 'agent' ? ' (agent)' : '', m.id === T.moi.id ? ' (vous)' : ''),
    proprietaire && m.id !== T.moi.id
      ? h('select.champ', { 'aria-label': `Rôle de ${m.name}`, onchange: async (e) => {
        try { T.tableau.members = await patch(`/api/boards/${T.tableau.id}/members/${m.id}`, { role: e.target.value }); toast(`${m.name} est maintenant ${ROLES[e.target.value].toLowerCase()}.`); }
        catch (err) { erreur(err.message); e.target.value = m.role; }
      } }, Object.entries(ROLES).map(([v, l]) => h('option', { value: v, selected: m.role === v }, l)))
      : h('span.vide', ROLES[m.role]),
    proprietaire && m.id !== T.moi.id ? h('button.btn.btn-danger', { type: 'button', 'aria-label': `Retirer ${m.name} du tableau`, onclick: async () => {
      if (!window.confirm(`Retirer ${m.name} du tableau ?`)) return;
      try { await del(`/api/boards/${T.tableau.id}/members/${m.id}`); T.tableau.members = T.tableau.members.filter((x) => x.id !== m.id); maj(); toast(`${m.name} a été retiré du tableau.`); }
      catch (err) { erreur(err.message); }
    } }, 'Retirer') : '')));
  let liste = rendreListe();
  const maj = () => { const n = rendreListe(); liste.replaceWith(n); liste = n; };

  const email = h('input.champ#inv-email', { type: 'email', required: true, autocomplete: 'off', placeholder: 'prenom@exemple.fr' });
  const nom = h('input.champ#inv-nom', { type: 'text', required: true, maxlength: 40, placeholder: 'Prénom' });
  const role = h('select.champ#inv-role', Object.entries(ROLES).map(([v, l]) => h('option', { value: v, selected: v === 'member' }, l)));
  const form = proprietaire ? h('form.form-invitation', { onsubmit: async (e) => {
    e.preventDefault();
    if (!email.checkValidity() || !nom.value.trim()) return erreur('Indiquez une adresse courriel valide et un prénom.');
    try {
      T.tableau.members = await post(`/api/boards/${T.tableau.id}/members`, { email: email.value.trim(), name: nom.value.trim(), role: role.value });
      toast(`${nom.value.trim()} est invité. Il peut se connecter avec son adresse.`);
      email.value = ''; nom.value = ''; maj(); email.focus();
    } catch (err) { erreur(err.message); }
  } },
  h('h3', 'Inviter une personne'),
  h('div', h('label.etiquette-champ', { for: 'inv-email' }, 'Adresse courriel'), email),
  h('div', h('label.etiquette-champ', { for: 'inv-nom' }, 'Prénom (sert aux mentions @prénom)'), nom),
  h('div', h('label.etiquette-champ', { for: 'inv-role' }, 'Rôle'), role),
  h('button.btn.btn-primaire', { type: 'submit' }, 'Inviter')) : h('p.aide', 'Seul un propriétaire peut inviter ou changer les rôles.');

  d.append(h('div.dialog-entete', h('h2#titre-membres', 'Membres du tableau'), h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': 'Fermer', onclick: () => d.close() }, '✕')),
    h('div.dialog-corps', liste, form));
  d.addEventListener('close', () => { d.remove(); document.querySelector('[data-cle="membres"]')?.focus(); import('./tableau.js').then((m) => m.rendre()); });
  document.body.append(d);
  d.showModal();
}
