// Panneau « Éléments archivés » d'un tableau (vue discrète, hors du flux principal) et archivage du tableau entier.
import { h, icone, annoncer } from './dom.js';
import { get, post } from './api.js';
import { erreur, toast } from './toasts.js';
import { horodatage } from './activite.js';
import { recharger } from './tableau.js';
import { naviguer } from './app.js';

export async function ouvrirArchives(T) {
  const ecrit = T.tableau.role !== 'reader';
  const proprietaire = T.tableau.role === 'owner';
  const zone = h('div', { role: 'status' }, h('p.chargement', 'Chargement…'));
  const d = h('dialog.dialog-lateral', { 'aria-labelledby': 'titre-archives' },
    h('div.dialog-entete', h('h2#titre-archives', icone('archive'), ' Éléments archivés'),
      h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': 'Fermer', onclick: () => d.close() }, icone('x'))),
    h('div.dialog-corps', zone, proprietaire ? blocTableau() : ''));
  d.addEventListener('close', () => { d.remove(); document.querySelector('[data-cle="archives"]')?.focus(); });
  document.body.append(d);
  d.showModal();

  function blocTableau() {
    const bloc = h('section.archives-tableau', { 'aria-labelledby': 'h-archiver-tableau' },
      h('h3#h-archiver-tableau', 'Archiver ce tableau'),
      h('p.aide', 'Le tableau quitte l\'accueil de tous ses membres et ne se modifie plus. Vous pourrez le restaurer depuis « Tableaux archivés », sur l\'accueil.'));
    const bouton = h('button.btn.btn-danger', { type: 'button', onclick: confirmer }, icone('archive'), 'Archiver le tableau');
    const actions = h('div.rangee', bouton);
    bloc.append(actions);
    function confirmer() {
      const oui = h('button.btn.btn-danger', { type: 'button', onclick: async () => {
        oui.disabled = true;
        const id = T.tableau.id; const nom = T.tableau.name;
        try {
          await post(`/api/boards/${id}/archive`);
          d.close();
          naviguer('/');
          toast(`Tableau « ${nom} » archivé.`, { annuler: async () => {
            try { await post(`/api/boards/${id}/restore`); naviguer(`/b/${id}`); } catch (e) { erreur(`Restauration impossible : ${e.message}`); }
          } });
        } catch (e) { oui.disabled = false; erreur(`Archivage impossible : ${e.message}`); }
      } }, 'Oui, archiver');
      const non = h('button.btn.btn-discret', { type: 'button', onclick: () => { actions.replaceChildren(bouton); bouton.focus(); } }, 'Annuler');
      actions.replaceChildren(h('span', 'Archiver tout le tableau ?'), oui, non);
      oui.focus();
    }
    return bloc;
  }

  async function charger() {
    let a;
    try { a = await get(`/api/boards/${T.tableau.id}/archives`); } catch (e) { zone.replaceChildren(); return erreur(e.message); }
    const restaurer = (type, x, libelle) => (ecrit ? h('button.btn.btn-secondaire', { type: 'button', 'aria-label': `Restaurer ${libelle}`, onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        await post(`/api/${type}/${x.id}/restore`);
        annoncer(`${libelle[0].toUpperCase()}${libelle.slice(1)} restaurée.`);
        await recharger();
        await charger();
        zone.querySelector('button')?.focus() ?? d.querySelector('.dialog-entete button')?.focus();
      } catch (err) { erreur(`Restauration impossible : ${err.message}`); await charger(); }
    } }, 'Restaurer') : '');
    const pl = (n, m) => `${n} ${m}${n > 1 ? 's' : ''}`;
    zone.replaceChildren(
      h('h3#h-cartes-archivees', 'Cartes'),
      a.cards.length ? h('ul.liste-archives', { 'aria-labelledby': 'h-cartes-archivees' }, a.cards.map((c) => h('li.archive',
        h('div.archive-texte', h('p', h('strong', c.title)), h('p.aide', `colonne « ${c.columnName} » · archivée `, horodatage(c.archivedAt))),
        restaurer('cards', c, `la carte « ${c.title} »`))))
        : h('p.vide', 'Aucune carte archivée.'),
      h('h3#h-colonnes-archivees', 'Colonnes'),
      a.columns.length ? h('ul.liste-archives', { 'aria-labelledby': 'h-colonnes-archivees' }, a.columns.map((k) => h('li.archive',
        h('div.archive-texte', h('p', h('strong', k.name)), h('p.aide', `${pl(k.cardCount, 'carte')} · archivée `, horodatage(k.archivedAt))),
        restaurer('columns', k, `la colonne « ${k.name} »`))))
        : h('p.vide', 'Aucune colonne archivée.'));
  }
  await charger();
}
