// Écran d'un tableau : colonnes, cartes, ajout sans friction, édition sur place, filtres, glisser-déposer.
// Chaque action s'affiche aussitôt (mise à jour optimiste) ; en cas d'échec, l'écran revient en arrière avec un message.
import { h, icone, annoncer, avatar, formaterDate, etatEcheance } from './dom.js';
import { get, post, patch, clientId } from './api.js';
import { toast, erreur } from './toasts.js';
import { activerGlisser, glisserAuClavier } from './dnd.js';
import { ouvrirCarte, fermerCarte, carteOuverte, rafraichirCarte } from './carte.js';
import { ouvrirMembres } from './membres.js';
import { ouvrirActivite } from './activite.js';
import { naviguer } from './app.js';

export const T = {
  tableau: null, moi: null, racine: null,
  ui: { composeur: null, ajoutColonne: null, edition: null },
  filtres: { texte: '', membre: '', etiquette: '', echeance: '' },
  source: null, enAttente: false, occupe: 0,
};
const ecrit = () => T.tableau && T.tableau.role !== 'reader';
const tmpId = () => `tmp-${crypto.randomUUID()}`;
const estTmp = (id) => String(id).startsWith('tmp-');

export function quitterTableau() {
  T.source?.close(); T.source = null;
  fermerCarte(true);
  T.tableau = null;
}

export async function ecranTableau(racine, id, carteId, moi) {
  quitterTableau();
  T.racine = racine; T.moi = moi;
  T.ui = { composeur: null, ajoutColonne: null, edition: null };
  T.filtres = { texte: '', membre: '', etiquette: '', echeance: '' };
  racine.replaceChildren(h('p.chargement', { role: 'status' }, 'Chargement du tableau…'));
  try {
    T.tableau = await get(`/api/boards/${id}`);
  } catch (e) {
    racine.replaceChildren(h('div.page', h('h1', 'Tableau introuvable'), h('p', e.status === 404 ? 'Ce tableau n\'existe pas ou vous n\'y êtes pas invité.' : e.message), h('a.btn.btn-primaire', { href: '/' }, 'Retour à mes tableaux')));
    return;
  }
  construire();
  brancherDirect();
  if (carteId) synchroniserCarte(carteId);
}

export function synchroniserCarte(carteId) {
  if (!T.tableau) return;
  if (carteId) ouvrirCarte(carteId);
  else fermerCarte();
  document.title = `${T.tableau.name} — KanbanX`;
}

/** Recharge le tableau depuis le serveur (après un événement en direct, ou pour se resynchroniser). */
export async function recharger() {
  if (!T.tableau) return;
  if (T.occupe > 0) { T.enAttente = true; return; }
  try {
    const t = await get(`/api/boards/${T.tableau.id}`);
    if (T.occupe > 0) { T.enAttente = true; return; }
    T.tableau = t;
    rendre();
    rafraichirCarte();
  } catch (e) {
    if (e.status === 404) { erreur('Vous n\'avez plus accès à ce tableau.'); naviguer('/'); }
  }
}

function brancherDirect() {
  if (!window.EventSource) return;
  const s = new EventSource(`/api/boards/${T.tableau.id}/events`);
  T.source = s;
  let minuteur = null;
  s.addEventListener('maj', (e) => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.client === clientId) return; // nos propres actions sont déjà affichées
    if (d.retire === T.moi.id) { s.close(); erreur('Vous avez été retiré de ce tableau.'); return naviguer('/'); }
    clearTimeout(minuteur);
    minuteur = setTimeout(recharger, 150);
    window.dispatchEvent(new CustomEvent('kx:evenement', { detail: d }));
  });
  s.addEventListener('error', () => { /* le navigateur se reconnecte seul */ });
}

/** Exécute une modification optimiste : `modifier` change l'état local, `appel` l'envoie au serveur. */
export async function optimiste(modifier, appel, echec) {
  const avant = structuredClone(T.tableau);
  T.occupe++;
  modifier(T.tableau);
  rendre();
  try {
    return await appel();
  } catch (e) {
    T.tableau = avant;
    rendre();
    erreur(`${echec} ${e.message}`);
    annoncer(`${echec} ${e.message}`, true);
    return undefined;
  } finally {
    T.occupe--;
    if (!T.occupe && T.enAttente) { T.enAttente = false; recharger(); }
  }
}

export const trouverCarte = (id) => {
  for (const k of T.tableau.columns) { const i = k.cards.findIndex((c) => c.id === id); if (i >= 0) return { col: k, carte: k.cards[i], index: i }; }
  return null;
};
export const membre = (id) => T.tableau.members.find((m) => m.id === id);
export const etiquette = (id) => T.tableau.labels.find((l) => l.id === id);

// ---------- Construction de l'écran ----------

let zoneColonnes = null;
let zoneBarre = null;

function construire() {
  zoneBarre = h('div.barre-tableau');
  zoneColonnes = h('div.colonnes', { role: 'region', 'aria-label': 'Colonnes du tableau' });
  T.racine.replaceChildren(h('div.ecran-tableau', zoneBarre, zoneColonnes,
    h('p.visuellement-cache#aide-carte', 'Entrée pour ouvrir. Espace pour saisir la carte, puis flèches pour la déplacer, Espace pour la déposer, Échap pour annuler.'),
    h('p.visuellement-cache#aide-colonne', 'Espace pour saisir la colonne, puis flèches gauche et droite pour la déplacer, Espace pour la déposer.')));
  activerGlisser(zoneColonnes, { surCarte: deposerCarte, surColonne: deposerColonne, peut: ecrit, debut: () => { T.occupe++; }, fin: () => { T.occupe--; if (!T.occupe && T.enAttente) { T.enAttente = false; recharger(); } } });
  document.title = `${T.tableau.name} — KanbanX`;
  rendre();
}

export function rendre() {
  if (!T.tableau || !zoneColonnes) return;
  // Préserver le focus et les défilements à travers le re-rendu.
  const actif = document.activeElement;
  const cleFocus = actif?.closest?.('[data-cle]')?.dataset.cle;
  const defilH = zoneColonnes.scrollLeft;
  const defilV = Object.fromEntries([...zoneColonnes.querySelectorAll('.colonne')].map((c) => [c.dataset.colId, c.querySelector('.liste-cartes')?.scrollTop ?? 0]));

  rendreBarre();
  const colonnes = T.tableau.columns.map(rendreColonne);
  zoneColonnes.replaceChildren(...colonnes, ecrit() ? rendreAjoutColonne() : '');
  zoneColonnes.scrollLeft = defilH;
  for (const c of zoneColonnes.querySelectorAll('.colonne')) { const l = c.querySelector('.liste-cartes'); if (l && defilV[c.dataset.colId]) l.scrollTop = defilV[c.dataset.colId]; }
  appliquerFiltres();

  const champActif = zoneColonnes.querySelector('[data-autofocus]');
  if (champActif) {
    champActif.focus();
    if (champActif.setSelectionRange) champActif.setSelectionRange(champActif.value.length, champActif.value.length);
  } else if (cleFocus && !document.querySelector('dialog[open]')) {
    const el = document.querySelector(`[data-cle="${CSS.escape(cleFocus)}"]`);
    if (el) (el.matches('a,button,input,textarea,select,[tabindex]') ? el : el.querySelector('a,button'))?.focus({ preventScroll: false });
  }
}

const ROLES = { owner: 'Propriétaire', member: 'Membre', reader: 'Lecture seule' };

function rendreBarre() {
  const t = T.tableau;
  const proprietaire = t.role === 'owner';
  let titre;
  if (T.ui.edition?.type === 'tableau') {
    titre = champEdition(T.ui.edition, (v) => renommerTableau(v), 'Nom du tableau', 100);
  } else {
    titre = h('h1', proprietaire
      ? h('button.colonne-titre.titre-tableau', { type: 'button', 'data-cle': 'titre-tableau', title: 'Cliquer pour renommer', onclick: () => { T.ui.edition = { type: 'tableau', texte: t.name }; rendre(); } }, t.name)
      : h('span.titre-tableau', t.name));
  }
  const f = T.filtres;
  const optionsMembres = t.members.map((m) => h('option', { value: m.id, selected: f.membre === m.id }, m.name));
  const optionsEtiq = t.labels.map((l) => h('option', { value: l.id, selected: f.etiquette === l.id }, l.name || `(${l.color})`));
  const recherche = h('input.champ#recherche', { type: 'search', placeholder: 'Rechercher une carte', value: f.texte, 'aria-label': 'Rechercher une carte (raccourci /)', 'data-cle': 'recherche',
    oninput: (e) => { f.texte = e.target.value; appliquerFiltres(); },
    onkeydown: (e) => { if (e.key === 'Escape' && f.texte) { e.stopPropagation(); f.texte = ''; e.target.value = ''; appliquerFiltres(); } } });
  const filtreActif = f.texte || f.membre || f.etiquette || f.echeance;
  zoneBarre.replaceChildren(
    titre,
    t.role === 'reader' ? h('span.badge', ROLES.reader) : '',
    h('button.btn.btn-secondaire', { type: 'button', 'data-cle': 'membres', onclick: () => ouvrirMembres(T) },
      h('span.avatars', t.members.slice(0, 4).map(avatar)), h('span', 'Membres'), h('span.visuellement-cache', ` du tableau (${t.members.length})`)),
    h('button.btn.btn-secondaire', { type: 'button', 'data-cle': 'activite', onclick: () => ouvrirActivite(T) }, icone('activite'), 'Activité'),
    h('div.filtres', { role: 'search', 'aria-label': 'Filtrer les cartes' },
      h('div.recherche', icone('recherche'), recherche),
      h('select.champ', { 'aria-label': 'Filtrer par membre', 'data-cle': 'f-membre', onchange: (e) => { f.membre = e.target.value; appliquerFiltres(); rendreBarre(); } },
        h('option', { value: '' }, 'Tous les membres'), h('option', { value: 'aucun', selected: f.membre === 'aucun' }, 'Sans responsable'), optionsMembres),
      h('select.champ', { 'aria-label': 'Filtrer par étiquette', 'data-cle': 'f-etiq', onchange: (e) => { f.etiquette = e.target.value; appliquerFiltres(); rendreBarre(); } },
        h('option', { value: '' }, 'Toutes les étiquettes'), optionsEtiq),
      h('select.champ', { 'aria-label': 'Filtrer par échéance', 'data-cle': 'f-ech', onchange: (e) => { f.echeance = e.target.value; appliquerFiltres(); rendreBarre(); } },
        ...[['', 'Toutes les échéances'], ['retard', 'En retard'], ['semaine', 'Dans les 7 jours'], ['avec', 'Avec échéance'], ['sans', 'Sans échéance']]
          .map(([v, l]) => h('option', { value: v, selected: f.echeance === v }, l))),
      h('span.compte-filtre#compte-filtre', { role: 'status' }),
      h('button.btn.btn-discret#effacer-filtres', { type: 'button', hidden: !filtreActif, onclick: () => { T.filtres = { texte: '', membre: '', etiquette: '', echeance: '' }; rendre(); document.getElementById('recherche')?.focus(); } }, 'Effacer les filtres')),
  );
}

function carteVisible(c) {
  const f = T.filtres;
  if (f.texte) {
    const q = f.texte.toLocaleLowerCase('fr').normalize('NFD').replace(/\p{M}/gu, '');
    const titre = c.title.toLocaleLowerCase('fr').normalize('NFD').replace(/\p{M}/gu, '');
    const noms = c.labels.map((l) => etiquette(l)?.name ?? '').join(' ').toLowerCase();
    if (!titre.includes(q) && !noms.includes(q)) return false;
  }
  if (f.membre === 'aucun' && c.assignees.length) return false;
  if (f.membre && f.membre !== 'aucun' && !c.assignees.includes(f.membre)) return false;
  if (f.etiquette && !c.labels.includes(f.etiquette)) return false;
  if (f.echeance) {
    if (f.echeance === 'sans') return !c.dueDate;
    if (!c.dueDate) return false;
    const e = etatEcheance(c.dueDate);
    const jours = (new Date(c.dueDate) - new Date(new Date().toISOString().slice(0, 10))) / 86400000;
    if (f.echeance === 'retard' && e.classe !== 'depassee') return false;
    if (f.echeance === 'semaine' && (jours < 0 || jours > 7)) return false;
  }
  return true;
}

export function appliquerFiltres() {
  if (!zoneColonnes) return;
  const actif = Object.values(T.filtres).some(Boolean);
  let n = 0; let total = 0;
  for (const el of zoneColonnes.querySelectorAll('.carte[data-card-id]')) {
    const t = trouverCarte(el.dataset.cardId);
    if (!t) continue;
    total++;
    const v = !actif || carteVisible(t.carte);
    el.hidden = !v;
    if (v) n++;
  }
  const effacer = document.getElementById('effacer-filtres');
  if (effacer) effacer.hidden = !actif;
  const compte = document.getElementById('compte-filtre');
  if (compte) compte.textContent = actif ? `${n} carte${n > 1 ? 's' : ''} sur ${total}` : '';
}

// ---------- Colonnes ----------

function rendreColonne(k, index) {
  const nb = k.cards.length;
  const depasse = k.wipLimit && nb > k.wipLimit;
  const idTitre = `titre-col-${k.id}`;
  let titre;
  if (T.ui.edition?.type === 'colonne' && T.ui.edition.id === k.id) {
    titre = champEdition(T.ui.edition, (v) => renommerColonne(k.id, v), 'Nom de la colonne', 100);
  } else {
    titre = h(`h2.colonne-titre-h#${idTitre}`,
      ecrit()
        ? h('button.colonne-titre', { type: 'button', 'data-cle': `col-titre-${k.id}`, title: 'Cliquer pour renommer', onclick: () => { T.ui.edition = { type: 'colonne', id: k.id, texte: k.name }; rendre(); } }, k.name)
        : h('span.colonne-titre', k.name));
  }
  const compte = h('span.colonne-compte', { 'aria-label': k.wipLimit ? `${nb} cartes, limite ${k.wipLimit}` : `${nb} cartes` }, k.wipLimit ? `${nb} / ${k.wipLimit}` : String(nb));
  const entete = h('div.colonne-entete', { 'data-poignee-colonne': '' },
    ecrit() ? h('button.btn.btn-icone.btn-discret.poignee', { type: 'button', 'aria-label': `Déplacer la colonne ${k.name}`, 'aria-describedby': 'aide-colonne', 'data-cle': `col-poignee-${k.id}`, title: 'Glisser pour déplacer',
      onkeydown: (e) => glisserAuClavier(e, 'colonne', zoneColonnes, { surColonne: deposerColonne, rendre }) }, '⠿') : '',
    titre, compte,
    ecrit() ? menuColonne(k, index) : '');
  const liste = h('ol.liste-cartes', { 'aria-labelledby': idTitre }, ...k.cards.map((c) => rendreCarte(c, k)));
  return h(`section.colonne${depasse ? '.depassement' : ''}`, { dataset: { colId: k.id }, 'aria-labelledby': idTitre },
    entete,
    depasse ? h('p.alerte-wip', { role: 'note' }, `⚠ Limite d'en-cours dépassée : ${nb} cartes pour ${k.wipLimit} maximum.`) : '',
    liste,
    ecrit() ? rendrePiedColonne(k) : '');
}

function menuColonne(k, index) {
  const conteneur = h('div.popover');
  const bouton = h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': `Actions de la colonne ${k.name}`, 'aria-haspopup': 'true', 'aria-expanded': 'false', 'data-cle': `col-menu-${k.id}` }, icone('menu'));
  const fermer = () => { conteneur.querySelector('.menu')?.remove(); bouton.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', dehors, true); };
  const dehors = (e) => { if (!conteneur.contains(e.target)) fermer(); };
  bouton.addEventListener('click', () => {
    if (conteneur.querySelector('.menu')) return fermer();
    const n = T.tableau.columns.length;
    const action = (texte, fn, desactive) => h('li', h('button.option', { type: 'button', disabled: desactive, onclick: () => { fermer(); fn(); } }, texte));
    const menu = h('div.menu', { role: 'group', 'aria-label': `Actions de la colonne ${k.name}`, onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); fermer(); bouton.focus(); } } },
      h('h4', 'Actions de la colonne'),
      h('ul',
        action('Ajouter une carte', () => { T.ui.composeur = { colId: k.id, texte: '' }; rendre(); }),
        action('Renommer', () => { T.ui.edition = { type: 'colonne', id: k.id, texte: k.name }; rendre(); }),
        action('Limite d\'en-cours (WIP)…', () => definirWip(k)),
        action('Déplacer vers la gauche', () => deposerColonne(k.id, index - 1), index === 0),
        action('Déplacer vers la droite', () => deposerColonne(k.id, index + 1), index === n - 1),
        action('Archiver la colonne', () => archiverColonne(k))));
    conteneur.append(menu);
    bouton.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
    document.addEventListener('pointerdown', dehors, true);
  });
  conteneur.append(bouton);
  return conteneur;
}

function definirWip(k) {
  const champ = h('input.champ#wip', { type: 'number', min: 1, max: 999, step: 1, inputmode: 'numeric', value: k.wipLimit ?? '', 'aria-describedby': 'aide-wip' });
  const message = h('p.message.message-erreur', { role: 'alert', hidden: true });
  const d = h('dialog.dialog-petit', { 'aria-labelledby': 'titre-wip' },
    h('div.dialog-entete', h('h2#titre-wip', `Limite d'en-cours : ${k.name}`), h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': 'Fermer', onclick: () => d.close() }, icone('x'))),
    h('form.dialog-corps.form-invitation', { onsubmit: (e) => {
      e.preventDefault();
      const brut = champ.value.trim();
      const v = brut === '' ? null : Number(brut);
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 999)) { message.textContent = 'Indiquez un nombre entier entre 1 et 999, ou laissez vide.'; message.hidden = false; champ.setAttribute('aria-invalid', 'true'); return champ.focus(); }
      d.close();
      optimiste((t) => { t.columns.find((c) => c.id === k.id).wipLimit = v; },
        async () => { await patch(`/api/columns/${k.id}`, { wipLimit: v }); annoncer(v ? `Limite fixée à ${v} cartes.` : 'Limite retirée.'); }, 'Limite non enregistrée :');
    } },
    h('label.etiquette-champ', { for: 'wip' }, 'Nombre maximal de cartes dans la colonne'), champ,
    h('p.aide#aide-wip', 'Au-delà, la colonne est signalée. Laissez vide pour ne fixer aucune limite.'), message,
    h('div.rangee', h('button.btn.btn-primaire', { type: 'submit' }, 'Enregistrer'),
      k.wipLimit ? h('button.btn.btn-discret', { type: 'button', onclick: () => { champ.value = ''; d.querySelector('form').requestSubmit(); } }, 'Retirer la limite') : '')));
  d.addEventListener('close', () => { d.remove(); zoneColonnes.querySelector(`[data-cle="col-menu-${k.id}"]`)?.focus(); });
  document.body.append(d);
  d.showModal();
  champ.focus();
}

function rendrePiedColonne(k) {
  const pied = h('div.pied-colonne');
  if (T.ui.composeur?.colId === k.id) return composeur(k);
  pied.append(h('button.btn.btn-discret.btn-ajouter', { type: 'button', 'data-cle': `ajouter-${k.id}`, onclick: () => { T.ui.composeur = { colId: k.id, texte: '' }; rendre(); } }, icone('plus'), 'Ajouter une carte'));
  return pied;
}

/** « + Ajouter une carte » : on tape, Entrée ; le champ reste ouvert pour la suivante ; Échap annule. */
function composeur(k) {
  const etatC = T.ui.composeur;
  const idChamp = `composeur-${k.id}`;
  const champ = h('textarea.champ', { id: idChamp, rows: 2, maxlength: 300, placeholder: 'Titre de la carte', 'data-autofocus': '', 'aria-label': `Titre de la nouvelle carte dans ${k.name}`, value: etatC.texte });
  champ.value = etatC.texte;
  const fermer = () => { T.ui.composeur = null; rendre(); zoneColonnes.querySelector(`[data-cle="ajouter-${k.id}"]`)?.focus(); };
  const valider = () => {
    const titre = champ.value.replace(/\s+/g, ' ').trim();
    if (!titre) return champ.focus();
    etatC.texte = '';
    ajouterCarte(k.id, titre);
  };
  champ.addEventListener('input', () => { etatC.texte = champ.value; });
  champ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); valider(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); }
  });
  champ.addEventListener('blur', () => {
    setTimeout(() => {
      if (T.ui.composeur === etatC && !etatC.texte.trim() && !zoneColonnes.querySelector('.composeur')?.contains(document.activeElement)) fermer();
    }, 150);
  });
  return h('form.composeur', { onsubmit: (e) => { e.preventDefault(); valider(); } },
    champ,
    h('div.rangee', h('button.btn.btn-primaire', { type: 'submit' }, 'Ajouter une carte'),
      h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': 'Annuler l\'ajout', onclick: fermer }, icone('x'))));
}

function rendreAjoutColonne() {
  const bloc = h('div.ajout-colonne');
  if (!T.ui.ajoutColonne) {
    bloc.append(h('button.btn', { type: 'button', 'data-cle': 'ajout-colonne', onclick: () => { T.ui.ajoutColonne = { texte: '' }; rendre(); } }, icone('plus'), 'Ajouter une colonne'));
    return bloc;
  }
  const etatA = T.ui.ajoutColonne;
  const champ = h('input.champ', { type: 'text', maxlength: 100, placeholder: 'Nom de la colonne', 'aria-label': 'Nom de la nouvelle colonne', 'data-autofocus': '', value: etatA.texte });
  const fermer = () => { T.ui.ajoutColonne = null; rendre(); zoneColonnes.querySelector('[data-cle="ajout-colonne"]')?.focus(); };
  champ.addEventListener('input', () => { etatA.texte = champ.value; });
  champ.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); } });
  bloc.append(h('form', { onsubmit: (e) => {
    e.preventDefault();
    const nom = champ.value.trim();
    if (!nom) return champ.focus();
    etatA.texte = '';
    ajouterColonne(nom);
  } }, champ, h('div.rangee', h('button.btn.btn-primaire', { type: 'submit' }, 'Ajouter la colonne'), h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': 'Annuler', onclick: fermer }, icone('x')))));
  return bloc;
}

/** Champ d'édition sur place (titre de tableau, de colonne ou de carte) : Entrée valide, Échap annule, quitter valide. */
function champEdition(etatE, enregistrer, libelle, max) {
  const champ = h('textarea.champ.edition-titre', { rows: 1, maxlength: max, 'aria-label': libelle, 'data-autofocus': '' });
  champ.value = etatE.texte;
  let fini = false;
  const terminer = (garder) => {
    if (fini) return; fini = true;
    const v = champ.value.replace(/\s+/g, ' ').trim();
    const cle = etatE.type === 'colonne' ? `col-titre-${etatE.id}` : etatE.type === 'carte' ? `carte-${etatE.id}` : 'titre-tableau';
    T.ui.edition = null;
    if (garder && v && v !== etatE.initial) enregistrer(v); else rendre();
    document.querySelector(`[data-cle="${cle}"]`)?.focus();
  };
  etatE.initial ??= etatE.texte;
  champ.addEventListener('input', () => { etatE.texte = champ.value; });
  champ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); terminer(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); terminer(false); }
  });
  champ.addEventListener('blur', () => setTimeout(() => { if (T.ui.edition === etatE) terminer(true); }, 0));
  return champ;
}

// ---------- Cartes ----------

function rendreCarte(c, k) {
  if (T.ui.edition?.type === 'carte' && T.ui.edition.id === c.id) {
    return h('li.carte', { dataset: { cardId: c.id } }, champEdition(T.ui.edition, (v) => renommerCarte(c.id, v), 'Titre de la carte', 300));
  }
  const ech = etatEcheance(c.dueDate);
  const etiqs = c.labels.map(etiquette).filter(Boolean);
  const resp = c.assignees.map(membre).filter(Boolean);
  const details = [
    etiqs.length ? `étiquettes : ${etiqs.map((l) => l.name || l.color).join(', ')}` : '',
    c.dueDate ? `échéance ${formaterDate(c.dueDate)}${ech?.texte ? ` (${ech.texte})` : ''}` : '',
    resp.length ? `responsables : ${resp.map((m) => m.name).join(', ')}` : '',
    c.commentCount ? `${c.commentCount} commentaire${c.commentCount > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' ; ');
  const idDetails = `det-${c.id}`;
  const lien = h('a.carte-lien', {
    href: estTmp(c.id) ? undefined : `/b/${T.tableau.id}/c/${c.id}`, 'data-cle': `carte-${c.id}`, tabindex: '0',
    'aria-describedby': `${idDetails} aide-carte`,
    onkeydown: (e) => navigationCarte(e, c.id),
    onclick: (e) => { if (estTmp(c.id) || document.body.dataset.vientDeGlisser) e.preventDefault(); },
  }, c.title);
  return h('li.carte', { dataset: { cardId: c.id }, oncontextmenu: (e) => { if (e.pointerType === 'touch') e.preventDefault(); } },
    etiqs.length ? h('div.carte-etiquettes', { 'aria-hidden': 'true' }, etiqs.map((l) => h(`span.etiq${l.name ? '' : '.etiq-vide'}`, { dataset: { couleur: l.color }, title: l.name }, l.name))) : '',
    h('h3.carte-titre', lien),
    h('div.carte-pied', { 'aria-hidden': 'true' },
      c.dueDate ? h(`span.indic.echeance${ech.classe ? `.${ech.classe}` : ''}`, icone('calendrier'), formaterDate(c.dueDate)) : '',
      c.hasDescription ? h('span.indic', { title: 'Cette carte a une description' }, icone('texte')) : '',
      c.commentCount ? h('span.indic', { title: 'Commentaires' }, icone('commentaire'), String(c.commentCount)) : '',
      resp.length ? h('span.avatars', resp.map(avatar)) : ''),
    h('span.visuellement-cache', { id: idDetails }, details),
    ecrit() && !estTmp(c.id) ? h('button.btn.btn-icone.btn-discret.carte-crayon', { type: 'button', 'aria-label': `Renommer la carte ${c.title}`, title: 'Renommer',
      onclick: (e) => { e.stopPropagation(); T.ui.edition = { type: 'carte', id: c.id, texte: c.title }; rendre(); } }, icone('crayon')) : '');
}

function navigationCarte(e, id) {
  if (e.key === ' ' || e.key === 'Spacebar') {
    if (!ecrit()) return;
    return glisserAuClavier(e, 'carte', zoneColonnes, { surCarte: deposerCarte, rendre });
  }
  const t = trouverCarte(id);
  if (!t) return;
  const cols = T.tableau.columns;
  const ci = cols.indexOf(t.col);
  let cible = null;
  if (e.key === 'ArrowDown') cible = t.col.cards[t.index + 1];
  else if (e.key === 'ArrowUp') cible = t.col.cards[t.index - 1];
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const d = e.key === 'ArrowRight' ? 1 : -1;
    for (let j = ci + d; j >= 0 && j < cols.length; j += d) { if (cols[j].cards.length) { cible = cols[j].cards[Math.min(t.index, cols[j].cards.length - 1)]; break; } }
  } else return;
  e.preventDefault();
  if (cible) zoneColonnes.querySelector(`[data-cle="carte-${cible.id}"]`)?.focus();
}

// ---------- Actions ----------

function ajouterCarte(colId, titre) {
  const id = tmpId();
  optimiste((t) => { t.columns.find((c) => c.id === colId).cards.push({ id, columnId: colId, title: titre, dueDate: null, assignees: [], labels: [], commentCount: 0, hasDescription: false }); },
    async () => {
      const c = await post(`/api/columns/${colId}/cards`, { title: titre });
      const col = T.tableau.columns.find((k) => k.id === colId);
      const i = col?.cards.findIndex((x) => x.id === id) ?? -1;
      if (i >= 0) { col.cards[i] = c; rendre(); }
      annoncer(`Carte « ${titre} » ajoutée.`);
      return c;
    }, 'Carte non ajoutée :');
}

function renommerCarte(id, titre) {
  optimiste((t) => { trouverCarte(id).carte.title = titre; }, () => patch(`/api/cards/${id}`, { title: titre }), 'Titre non enregistré :');
}

function renommerColonne(id, nom) {
  optimiste((t) => { t.columns.find((c) => c.id === id).name = nom; }, () => patch(`/api/columns/${id}`, { name: nom }), 'Colonne non renommée :');
}

function renommerTableau(nom) {
  optimiste((t) => { t.name = nom; document.title = `${nom} — KanbanX`; }, () => patch(`/api/boards/${T.tableau.id}`, { name: nom }), 'Tableau non renommé :');
}

function ajouterColonne(nom) {
  const id = tmpId();
  optimiste((t) => { t.columns.push({ id, name: nom, wipLimit: null, cards: [] }); },
    async () => {
      const k = await post(`/api/boards/${T.tableau.id}/columns`, { name: nom });
      const col = T.tableau.columns.find((c) => c.id === id);
      if (col) { col.id = k.id; rendre(); }
      annoncer(`Colonne « ${nom} » ajoutée.`);
    }, 'Colonne non ajoutée :');
}

export function deposerCarte(id, colId, index) {
  const t = trouverCarte(id);
  if (!t || estTmp(id) || estTmp(colId)) return rendre();
  const dest = T.tableau.columns.find((c) => c.id === colId);
  if (t.col.id === colId && (index === t.index)) return rendre();
  optimiste(() => {
    t.col.cards.splice(t.index, 1);
    t.carte.columnId = colId;
    dest.cards.splice(Math.min(index, dest.cards.length), 0, t.carte);
  }, async () => {
    await post(`/api/cards/${id}/move`, { columnId: colId, index });
    annoncer(`Carte « ${t.carte.title} » déposée dans ${dest.name}, position ${Math.min(index, dest.cards.length - 1) + 1}.`);
  }, 'Déplacement annulé :');
}

export function deposerColonne(id, index) {
  const cols = T.tableau.columns;
  const i = cols.findIndex((c) => c.id === id);
  if (i < 0 || index < 0 || index >= cols.length || index === i || estTmp(id)) return rendre();
  optimiste(() => { const [k] = cols.splice(i, 1); cols.splice(index, 0, k); },
    async () => { await post(`/api/columns/${id}/move`, { index }); annoncer(`Colonne déplacée en position ${index + 1}.`); },
    'Déplacement de la colonne annulé :');
}

function archiverColonne(k) {
  optimiste((t) => { t.columns = t.columns.filter((c) => c.id !== k.id); }, async () => {
    await post(`/api/columns/${k.id}/archive`);
    toast(`Colonne « ${k.name} » archivée.`, { annuler: () => optimiste(() => {}, async () => { await post(`/api/columns/${k.id}/restore`); await recharger(); }, 'Restauration impossible :') });
  }, 'Archivage annulé :');
}

export function archiverCarte(id) {
  const t = trouverCarte(id);
  if (!t) return;
  const { col, index, carte } = t;
  return optimiste(() => { col.cards.splice(index, 1); }, async () => {
    await post(`/api/cards/${id}/archive`);
    toast(`Carte « ${carte.title} » archivée.`, { annuler: () => optimiste(
      (tab) => { const k = tab.columns.find((c) => c.id === col.id); k?.cards.splice(Math.min(index, k.cards.length), 0, carte); },
      async () => { await post(`/api/cards/${id}/restore`); annoncer('Carte restaurée.'); }, 'Restauration impossible :') });
  }, 'Archivage annulé :');
}

/** Ouvre le composeur dans la colonne de la carte qui a le focus, sinon dans la première (raccourci n). */
export function nouvelleCarte() {
  if (!T.tableau || !ecrit() || !T.tableau.columns.length) return false;
  const colEl = document.activeElement?.closest?.('.colonne');
  const colId = colEl?.dataset.colId ?? T.tableau.columns[0].id;
  T.ui.composeur = { colId, texte: '' };
  rendre();
  return true;
}
