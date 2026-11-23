// Mise en phrases de l'historique d'activité, et panneau d'activité du tableau.
import { h, avatar, icone } from './dom.js';
import { get } from './api.js';
import { erreur } from './toasts.js';

const VIA = { api: ' (via l\'API)', mcp: ' (via MCP)', web: '', systeme: '' };
const q = (t) => `« ${t} »`;

export function phrase(a, { surCarte = false } = {}) {
  const d = a.data ?? {};
  const carte = surCarte ? 'cette carte' : `la carte ${q(a.cardTitle ?? d.title ?? '?')}`;
  switch (a.action) {
    case 'tableau.cree': return `a créé le tableau ${q(d.name)}`;
    case 'tableau.importe': return `a importé le tableau ${q(d.name)} depuis Trello (${d.cartes} cartes)`;
    case 'tableau.renomme': return `a renommé le tableau en ${q(d.name)}`;
    case 'colonne.creee': return `a ajouté la colonne ${q(d.name)}`;
    case 'colonne.renommee': return `a renommé la colonne ${q(d.from)} en ${q(d.to)}`;
    case 'colonne.deplacee': return `a déplacé la colonne ${q(d.name)}`;
    case 'colonne.archivee': return `a archivé la colonne ${q(d.name)}`;
    case 'colonne.restauree': return `a restauré la colonne ${q(d.name)}`;
    case 'colonne.limite': return d.wipLimit ? `a fixé la limite de ${q(d.name)} à ${d.wipLimit}` : `a retiré la limite de ${q(d.name)}`;
    case 'carte.creee': return surCarte ? `a créé cette carte dans ${q(d.column)}` : `a ajouté ${carte} à ${q(d.column)}`;
    case 'carte.modifiee': return `a modifié ${carte} (${(d.champs ?? []).join(', ')})`;
    case 'carte.deplacee': return d.from ? `a déplacé ${carte} de ${q(d.from)} vers ${q(d.to)}` : `a réordonné ${carte} dans ${q(d.to)}`;
    case 'carte.archivee': return `a archivé ${carte}`;
    case 'carte.restauree': return `a restauré ${carte}`;
    case 'commentaire.ajoute': return `a commenté ${carte}`;
    case 'commentaire.modifie': return `a modifié un commentaire sur ${carte}`;
    case 'commentaire.supprime': return `a supprimé un commentaire sur ${carte}`;
    case 'commentaire.restaure': return `a restauré un commentaire sur ${carte}`;
    case 'membre.invite': return 'a invité une personne';
    case 'membre.role': return 'a changé le rôle d\'un membre';
    case 'membre.retire': return 'a retiré un membre';
    default: return a.action;
  }
}

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export function quand(iso) {
  const s = (new Date(iso) - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return 'à l\'instant';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const horodatage = (iso) => h('time', { datetime: iso, title: new Date(iso).toLocaleString('fr-FR') }, quand(iso));

export function ligneActivite(a, opts) {
  return h('li.activite', avatar(a.actor),
    h('p', h('strong', a.client ? `${a.client} pour ${a.actor.name}` : a.actor.name), ` ${phrase(a, opts)}${VIA[a.via] ?? ''} · `, horodatage(a.createdAt)));
}

/** Panneau « Activité » du tableau (fenêtre latérale). */
export async function ouvrirActivite(T) {
  const liste = h('ol.liste-activite', { 'aria-label': 'Activité récente' });
  const plus = h('button.btn.btn-secondaire', { type: 'button', hidden: true }, 'Voir plus');
  const d = h('dialog.dialog-lateral', { 'aria-labelledby': 'titre-activite' },
    h('div.dialog-entete', h('h2#titre-activite', icone('activite'), ' Activité du tableau'), h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': 'Fermer', onclick: () => d.close() }, icone('x'))),
    h('div.dialog-corps', liste, plus));
  let avant = null;
  const charger = async () => {
    try {
      const lot = await get(`/api/boards/${T.tableau.id}/activity?limit=50${avant ? `&before=${avant}` : ''}`);
      liste.append(...lot.map((a) => ligneActivite(a)));
      if (lot.length) avant = lot.at(-1).id;
      plus.hidden = lot.length < 50;
      if (!liste.children.length) liste.append(h('li.vide', 'Aucune activité pour l\'instant.'));
    } catch (e) { erreur(e.message); }
  };
  plus.addEventListener('click', charger);
  d.addEventListener('close', () => { d.remove(); document.querySelector('[data-cle="activite"]')?.focus(); });
  document.body.append(d);
  d.showModal();
  await charger();
}
