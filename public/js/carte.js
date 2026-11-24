// Détail d'une carte, dans une fenêtre superposée qui a sa propre adresse (/b/:tableau/c/:carte).
import { h, icone, avatar, htmlNettoye, formaterDate, etatEcheance, annoncer } from './dom.js';
import { get, patch } from './api.js';
import { erreur } from './toasts.js';
import { T, optimiste, trouverCarte, membre, etiquette, archiverCarte, rendre as rendreTableau } from './tableau.js';
import { naviguer } from './app.js';
import { rendreDiscussion } from './discussion.js';
import { avecMentions } from './saisie-mentions.js';

const COULEURS = ['bleu', 'turquoise', 'vert', 'orange', 'rouge', 'violet', 'ardoise', 'brun'];
const M = { id: null, dialog: null, detail: null, editionTitre: null, editionDesc: null, menu: null };
const ecrit = () => T.tableau && T.tableau.role !== 'reader';

export const carteOuverte = () => M.id;

export async function ouvrirCarte(id) {
  if (M.id === id && M.dialog?.open) return;
  M.id = id; M.detail = null; M.editionTitre = null; M.editionDesc = null;
  if (!M.dialog) creerDialog();
  M.dialog.replaceChildren(h('p.chargement', { role: 'status' }, 'Chargement de la carte…'));
  if (!M.dialog.open) M.dialog.showModal();
  try {
    M.detail = await get(`/api/cards/${id}`);
  } catch (e) {
    erreur(e.status === 404 ? 'Cette carte n\'existe pas ou n\'est plus accessible.' : e.message);
    return fermerCarte();
  }
  if (M.id !== id) return;
  if (M.detail.archived) annoncer('Cette carte est archivée.');
  rendreModal(true);
}

export function fermerCarte(silencieux = false) {
  if (!M.dialog) return;
  const id = M.id;
  M.id = null;
  if (M.dialog.open) M.dialog.close();
  if (!silencieux && id) document.querySelector(`[data-cle="carte-${id}"]`)?.focus();
}

/** Après un rechargement du tableau (autre utilisateur), on rafraîchit la carte ouverte sans perdre une saisie. */
export async function rafraichirCarte() {
  if (!M.id || !M.dialog?.open) return;
  try { M.detail = await get(`/api/cards/${M.id}`); } catch { return; }
  if (!M.editionDesc && !M.editionTitre) rendreModal(false);
}

function creerDialog() {
  M.dialog = h('dialog.dialog-carte', { 'aria-labelledby': 'titre-carte' });
  M.dialog.addEventListener('close', () => {
    fermerMenu();
    const ouverte = M.id;
    M.id = null;
    if (T.tableau && /\/c\//.test(location.pathname)) naviguer(`/b/${T.tableau.id}`);
    if (ouverte) setTimeout(() => document.querySelector(`[data-cle="carte-${ouverte}"]`)?.focus(), 0);
  });
  // Clic sur le voile : fermer.
  M.dialog.addEventListener('click', (e) => { if (e.target === M.dialog) M.dialog.close(); });
  document.body.append(M.dialog);
}

const versBoard = () => trouverCarte(M.id);

function rendreModal(focusTitre) {
  const d = M.detail;
  if (!d) return;
  const surBoard = versBoard();
  const carte = surBoard?.carte ?? d; // l'état du tableau est la source la plus fraîche (mises à jour optimistes)
  const colonne = surBoard?.col ?? T.tableau.columns.find((c) => c.id === d.columnId);
  document.title = `${carte.title} — ${T.tableau.name} — KanbanX`;

  // Titre (clic pour renommer)
  let titre;
  if (M.editionTitre) {
    const champTitre = h('textarea.champ.titre-editable#titre-carte', { rows: 1, maxlength: 300, 'aria-label': 'Titre de la carte' });
    champTitre.value = M.editionTitre.texte;
    const finir = (garder) => {
      if (!M.editionTitre) return;
      const v = champTitre.value.replace(/\s+/g, ' ').trim();
      M.editionTitre = null;
      if (garder && v && v !== carte.title) majCarte({ title: v }, (c) => { c.title = v; });
      rendreModal(false);
      M.dialog.querySelector('#titre-carte')?.focus();
    };
    champTitre.addEventListener('input', () => { M.editionTitre.texte = champTitre.value; });
    champTitre.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finir(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finir(false); }
    });
    champTitre.addEventListener('blur', () => setTimeout(() => finir(true), 0));
    titre = avecMentions(champTitre, () => T.tableau.members);
  } else {
    titre = h('h2', { class: 'titre-h' }, ecrit()
      ? h('button.titre-editable#titre-carte', { type: 'button', title: 'Cliquer pour renommer', onclick: () => { M.editionTitre = { texte: carte.title }; rendreModal(false); const t = M.dialog.querySelector('#titre-carte'); t?.focus(); t?.select(); } }, carte.title)
      : h('span.titre-editable#titre-carte', carte.title));
  }

  const resp = carte.assignees.map(membre).filter(Boolean);
  const etiqs = carte.labels.map(etiquette).filter(Boolean);
  const ech = etatEcheance(carte.dueDate);

  const proprietes = h('div.proprietes',
    h('div.propriete', h('h4#p-resp', 'Responsables'),
      h('div.rangee', resp.length ? h('span.avatars', resp.map(avatar)) : '', resp.length ? h('span.visuellement-cache', resp.map((m) => m.name).join(', ')) : h('span.vide', 'Aucun'),
        ecrit() ? boutonMenu('Modifier les responsables', icone('plus'), menuResponsables, 'p-resp') : '')),
    h('div.propriete', h('h4#p-etiq', 'Étiquettes'),
      h('div.rangee', ...etiqs.map((l) => h(`span.etiq${l.name ? '' : '.etiq-vide'}`, { dataset: { couleur: l.color } }, l.name || l.color)),
        !etiqs.length ? h('span.vide', 'Aucune') : '',
        ecrit() ? boutonMenu('Modifier les étiquettes', icone('plus'), menuEtiquettes, 'p-etiq') : '')),
    h('div.propriete', h('h4', h('label', { for: 'echeance' }, 'Échéance')),
      h('div.rangee',
        ecrit()
          ? h('input.champ#echeance', { type: 'date', value: carte.dueDate ?? '', onchange: (e) => { const v = e.target.value || null; majCarte({ dueDate: v }, (c) => { c.dueDate = v; }); } })
          : h('span', carte.dueDate ? formaterDate(carte.dueDate) : 'Aucune'),
        carte.dueDate && ech?.texte ? h(`span.indic.echeance.${ech.classe}`, ech.texte) : '',
        ecrit() && carte.dueDate ? h('button.btn.btn-discret', { type: 'button', onclick: () => majCarte({ dueDate: null }, (c) => { c.dueDate = null; }) }, 'Retirer') : '')),
  );

  const description = h('section.detail-section', { 'aria-labelledby': 'h-desc' }, h('h3#h-desc', icone('texte'), 'Description'), zoneDescription(d));
  const discussion = h('section.detail-section#zone-discussion', { 'aria-labelledby': 'h-disc' });
  rendreDiscussion(discussion, M.id, T);

  const actions = ecrit() ? h('div.actions-laterales', { role: 'group', 'aria-label': 'Actions' },
    h('h3', 'Ajouter à la carte'),
    boutonMenu('Responsables', icone('utilisateur'), menuResponsables, null, true),
    boutonMenu('Étiquettes', icone('etiquette'), menuEtiquettes, null, true),
    h('button.btn', { type: 'button', onclick: () => M.dialog.querySelector('#echeance')?.focus() }, icone('calendrier'), 'Échéance'),
    h('h3', 'Actions'),
    d.archived || !surBoard ? h('p.vide', 'Carte archivée.')
      : h('button.btn', { type: 'button', onclick: async () => { const id = M.id; M.dialog.close(); await archiverCarte(id); } }, icone('archive'), 'Archiver'),
  ) : h('div.actions-laterales', h('p.vide', 'Vous avez un accès en lecture seule.'));

  M.dialog.replaceChildren(
    h('div.dialog-entete', icone('texte'), titre,
      h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': 'Fermer la carte', onclick: () => M.dialog.close() }, icone('x'))),
    h('p.sous-titre', 'dans la colonne ', h('strong', colonne?.name ?? '—'), d.archived ? ' · archivée' : ''),
    h('div.dialog-corps', h('div.detail', h('div', h('section.detail-section', proprietes), description, discussion), actions)),
  );
  if (M.editionDesc) M.dialog.querySelector('#description')?.focus();
  else if (focusTitre) M.dialog.querySelector('#titre-carte')?.focus();
}

function zoneDescription(d) {
  if (M.editionDesc) {
    const champ = h('textarea.champ#description', { rows: 8, maxlength: 20000, 'aria-describedby': 'aide-md', 'aria-label': 'Description (Markdown)' });
    champ.value = M.editionDesc.texte;
    champ.addEventListener('input', () => { M.editionDesc.texte = champ.value; });
    const finir = (garder) => {
      const v = champ.value;
      M.editionDesc = null;
      if (garder && v !== d.description) {
        M.detail.description = v;
        majCarte({ description: v }, (c) => { c.hasDescription = v.trim() !== ''; }).then(async () => {
          try { M.detail = await get(`/api/cards/${d.id}`); rendreModal(false); } catch { /* déjà signalé */ }
        });
      }
      rendreModal(false);
      M.dialog.querySelector('[data-desc]')?.focus();
    };
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finir(false); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finir(true); }
    });
    return h('div', avecMentions(champ, () => T.tableau.members),
      h('p.aide#aide-md', 'Markdown : **gras**, *italique*, `code`, listes « - », [lien](https://…). @ pour mentionner. Ctrl+Entrée pour enregistrer, Échap pour annuler.'),
      h('div.rangee', h('button.btn.btn-primaire', { type: 'button', onclick: () => finir(true) }, 'Enregistrer'), h('button.btn.btn-discret', { type: 'button', onclick: () => finir(false) }, 'Annuler')));
  }
  const editer = () => { M.editionDesc = { texte: M.detail.description }; rendreModal(false); };
  if (!d.description.trim()) {
    return ecrit() ? h('button.btn.description-vide', { type: 'button', 'data-desc': '', onclick: editer }, 'Ajouter une description plus détaillée…') : h('p.vide', 'Aucune description.');
  }
  const rendu = htmlNettoye(h('div.markdown'), d.descriptionHtml);
  if (!ecrit()) return rendu;
  return h('div', h('div.zone-description', { onclick: (e) => { if (!e.target.closest('a')) editer(); } }, rendu),
    h('button.btn.btn-secondaire', { type: 'button', 'data-desc': '', onclick: editer }, icone('crayon'), 'Modifier la description'));
}

function majCarte(changement, local) {
  const id = M.id;
  return optimiste((t) => { const x = trouverCarte(id); if (x) local(x.carte); },
    async () => { await patch(`/api/cards/${id}`, changement); },
    'Modification non enregistrée :').finally(() => { if (M.id === id && !M.editionDesc && !M.editionTitre) rendreModal(false); });
}

// ---------- Petits menus (responsables, étiquettes) ----------

function fermerMenu() {
  if (!M.menu) return;
  M.menu.el.remove();
  M.menu.bouton.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', M.menu.dehors, true);
  const b = M.menu.bouton;
  M.menu = null;
  if (b.isConnected) b.focus();
}

function boutonMenu(libelle, ic, construire, idLibelle, avecTexte = false) {
  const conteneur = h('div.popover');
  const bouton = h(`button.btn${avecTexte ? '' : '.btn-icone.btn-secondaire'}`, { type: 'button', 'aria-label': avecTexte ? undefined : libelle, 'aria-haspopup': 'true', 'aria-expanded': 'false', title: libelle }, ic, avecTexte ? libelle : '');
  bouton.addEventListener('click', () => {
    const deja = M.menu?.bouton === bouton;
    fermerMenu();
    if (deja) return;
    const el = h('div.menu', { role: 'group', 'aria-label': libelle, onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermerMenu(); } } });
    const dehors = (e) => { if (!conteneur.contains(e.target)) fermerMenu(); };
    M.menu = { el, bouton, dehors, construire };
    construire(el);
    conteneur.append(el);
    bouton.setAttribute('aria-expanded', 'true');
    el.querySelector('button, input')?.focus();
    document.addEventListener('pointerdown', dehors, true);
  });
  conteneur.append(bouton);
  return conteneur;
}

/** Re-rend la carte en gardant le menu ouvert (après une coche). */
function rerendreAvecMenu(construire, indexFocus) {
  const libelle = M.menu?.el.getAttribute('aria-label');
  M.menu && document.removeEventListener('pointerdown', M.menu.dehors, true);
  M.menu = null;
  rendreModal(false);
  const bouton = [...M.dialog.querySelectorAll('.popover > button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === libelle || b.title === libelle);
  bouton?.click();
  const opts = M.menu?.el.querySelectorAll('.option');
  opts?.[Math.min(indexFocus, opts.length - 1)]?.focus();
}

function menuResponsables(el) {
  const carte = versBoard()?.carte;
  if (!carte) return;
  el.append(h('h4', 'Responsables'), h('ul', T.tableau.members.map((m, i) => {
    const coche = carte.assignees.includes(m.id);
    return h('li', h('button.option', { type: 'button', 'aria-pressed': String(coche), onclick: () => {
      const liste = coche ? carte.assignees.filter((x) => x !== m.id) : [...carte.assignees, m.id];
      majCarte({ assignees: liste }, (c) => { c.assignees = liste; });
      rerendreAvecMenu(menuResponsables, i);
    } }, avatar(m), h('span', m.name, m.kind === 'agent' ? ' (agent)' : ''), coche ? h('span.coche', icone('coche')) : ''));
  })));
}

function menuEtiquettes(el) {
  const carte = versBoard()?.carte;
  if (!carte) return;
  el.append(h('h4', 'Étiquettes'));
  el.append(h('ul', T.tableau.labels.map((l, i) => {
    const coche = carte.labels.includes(l.id);
    return h('li', h('button.option', { type: 'button', 'aria-pressed': String(coche), onclick: () => {
      const liste = coche ? carte.labels.filter((x) => x !== l.id) : [...carte.labels, l.id];
      majCarte({ labels: liste }, (c) => { c.labels = liste; });
      rerendreAvecMenu(menuEtiquettes, i);
    } }, h('span.etiq', { dataset: { couleur: l.color } }, l.name || l.color), coche ? h('span.coche', icone('coche')) : ''));
  })));
  // Création d'une étiquette
  let couleur = 'bleu';
  const nom = h('input.champ', { type: 'text', maxlength: 40, placeholder: 'Nom de l\'étiquette', 'aria-label': 'Nom de la nouvelle étiquette' });
  const palette = h('div.palette', { role: 'group', 'aria-label': 'Couleur' }, COULEURS.map((c) => h('button.etiq', { type: 'button', dataset: { couleur: c }, 'aria-pressed': String(c === couleur), 'aria-label': c,
    onclick: (e) => { couleur = c; palette.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, c)));
  el.append(h('form', { class: 'form-invitation', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const { post } = await import('./api.js');
      const l = await post(`/api/boards/${T.tableau.id}/labels`, { name: nom.value.trim(), color: couleur });
      T.tableau.labels.push(l);
      const liste = [...versBoard().carte.labels, l.id];
      await majCarte({ labels: liste }, (c) => { c.labels = liste; });
      rendreTableau();
      rerendreAvecMenu(menuEtiquettes, T.tableau.labels.length - 1);
    } catch (err) { erreur(`Étiquette non créée : ${err.message}`); }
  } }, h('h4', 'Nouvelle étiquette'), nom, palette, h('button.btn.btn-primaire', { type: 'submit' }, 'Créer')));
}
