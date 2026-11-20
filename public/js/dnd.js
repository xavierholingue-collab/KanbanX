// Glisser-déposer des cartes et des colonnes : souris, tactile (appui long) et clavier.
// Un emplacement « fantôme » montre en permanence où l'élément va tomber.
import { annoncer } from './dom.js';

const SEUIL_SOURIS = 5;
const APPUI_LONG_MS = 280;

/** Index d'un élément parmi ses frères du même type (cartes masquées par un filtre comprises). */
function indexDans(el, selecteur) {
  let i = 0;
  for (let x = el.previousElementSibling; x; x = x.previousElementSibling) if (x.matches(selecteur)) i++;
  return i;
}

export function activerGlisser(zone, { surCarte, surColonne, peut, debut, fin }) {
  let g = null; // geste en cours

  zone.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !peut() || g) return;
    if (e.target.closest('textarea, input, select, .carte-crayon, .menu, .popover > button, .composeur, form')) return;
    const carte = e.target.closest('.carte[data-card-id]');
    const entete = !carte && e.target.closest('[data-poignee-colonne]');
    if (!carte && !entete) return;
    if (entete && e.target.closest('.colonne-titre')) return; // clic sur le titre = renommer
    const el = carte ?? entete.closest('.colonne');
    if (!el || String(el.dataset.cardId ?? el.dataset.colId).startsWith('tmp-')) return;
    g = { type: carte ? 'carte' : 'colonne', el, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, id: e.pointerId, actif: false, tactile: e.pointerType !== 'mouse' };
    if (g.tactile) g.minuteur = setTimeout(() => { if (g && !g.actif) demarrer(); }, APPUI_LONG_MS);
  });

  function demarrer() {
    const r = g.el.getBoundingClientRect();
    g.actif = true;
    g.dx = g.x0 - r.left; g.dy = g.y0 - r.top;
    g.volant = g.el.cloneNode(true);
    g.volant.classList.add('volant');
    g.volant.removeAttribute('id');
    g.volant.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    g.volant.setAttribute('aria-hidden', 'true');
    g.volant.style.width = `${r.width}px`;
    g.volant.style.height = `${r.height}px`;
    document.body.append(g.volant);
    g.el.classList.add('fantome');
    g.depart = { parent: g.el.parentElement, suivant: g.el.nextElementSibling };
    document.body.classList.add('glisse');
    if (navigator.vibrate && g.tactile) navigator.vibrate(15);
    debut?.();
    placer();
    defiler();
  }

  function placer() {
    g.volant.style.transform = `translate(${g.x - g.dx}px, ${g.y - g.dy}px)`;
    const sous = document.elementFromPoint(g.x, g.y);
    if (g.type === 'carte') {
      const col = sous?.closest('.colonne') ?? colonnePlusProche(g.x);
      const liste = col?.querySelector('.liste-cartes');
      if (!liste) return;
      const cartes = [...liste.querySelectorAll(':scope > .carte:not(.fantome)')].filter((c) => !c.hidden);
      const avant = cartes.find((c) => { const r = c.getBoundingClientRect(); return g.y < r.top + r.height / 2; });
      if (avant) { if (avant.previousElementSibling !== g.el) liste.insertBefore(g.el, avant); }
      else if (liste.lastElementChild !== g.el) liste.append(g.el);
    } else {
      const cols = [...zone.querySelectorAll(':scope > .colonne:not(.fantome)')];
      const avant = cols.find((c) => { const r = c.getBoundingClientRect(); return g.x < r.left + r.width / 2; });
      if (avant) { if (avant.previousElementSibling !== g.el) zone.insertBefore(g.el, avant); }
      else {
        const dernier = cols.at(-1);
        if (dernier && dernier.nextElementSibling !== g.el) dernier.after(g.el);
      }
    }
  }

  function colonnePlusProche(x) {
    let meilleure = null; let d = Infinity;
    for (const c of zone.querySelectorAll(':scope > .colonne')) {
      const r = c.getBoundingClientRect();
      const dist = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (dist < d) { d = dist; meilleure = c; }
    }
    return meilleure;
  }

  // Défilement automatique près des bords (horizontal pour le tableau, vertical pour la liste).
  function defiler() {
    if (!g?.actif) return;
    const r = zone.getBoundingClientRect();
    const bord = 60;
    if (g.x < r.left + bord) zone.scrollLeft -= 12;
    else if (g.x > r.right - bord) zone.scrollLeft += 12;
    if (g.type === 'carte') {
      const liste = g.el.parentElement;
      if (liste) {
        const rl = liste.getBoundingClientRect();
        if (g.y < rl.top + 40) liste.scrollTop -= 10;
        else if (g.y > rl.bottom - 40) liste.scrollTop += 10;
      }
    }
    placer();
    g.raf = requestAnimationFrame(defiler);
  }

  function terminer(annuler) {
    if (!g) return;
    clearTimeout(g.minuteur);
    const geste = g;
    g = null;
    if (!geste.actif) return;
    cancelAnimationFrame(geste.raf);
    geste.volant.remove();
    geste.el.classList.remove('fantome');
    document.body.classList.remove('glisse');
    // Le clic qui suit un glisser ne doit pas ouvrir la carte.
    document.body.dataset.vientDeGlisser = '1';
    setTimeout(() => { delete document.body.dataset.vientDeGlisser; }, 50);
    fin?.();
    if (annuler) {
      geste.depart.parent.insertBefore(geste.el, geste.depart.suivant);
      annoncer('Déplacement annulé.');
      return;
    }
    if (geste.type === 'carte') {
      const colId = geste.el.closest('.colonne')?.dataset.colId;
      surCarte(geste.el.dataset.cardId, colId, indexDans(geste.el, '.carte'));
    } else {
      surColonne(geste.el.dataset.colId, indexDans(geste.el, '.colonne'));
    }
  }

  document.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    g.x = e.clientX; g.y = e.clientY;
    if (!g.actif) {
      const d = Math.hypot(g.x - g.x0, g.y - g.y0);
      if (g.tactile) { if (d > 8) { clearTimeout(g.minuteur); g = null; } return; } // l'utilisateur fait défiler
      if (d > SEUIL_SOURIS) demarrer();
      return;
    }
    e.preventDefault();
  });
  document.addEventListener('pointerup', (e) => { if (g && e.pointerId === g.id) terminer(false); });
  document.addEventListener('pointercancel', (e) => { if (g && e.pointerId === g.id) terminer(!g.actif ? true : false); });
  document.addEventListener('keydown', (e) => { if (g?.actif && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); terminer(true); } }, true);
  // Pendant un glisser tactile, on empêche la page de défiler.
  document.addEventListener('touchmove', (e) => { if (g?.actif) e.preventDefault(); }, { passive: false });
  zone.addEventListener('contextmenu', (e) => { if (g) e.preventDefault(); });
}

/**
 * Glisser-déposer au clavier. Espace saisit l'élément ; les flèches déplacent le fantôme ;
 * Espace ou Entrée dépose ; Échap annule. Chaque étape est annoncée au lecteur d'écran.
 */
export function glisserAuClavier(e, type, zone, { surCarte, surColonne, rendre }) {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  if (e.key === 'Enter' && type === 'carte') return; // Entrée ouvre la carte
  e.preventDefault();
  const declencheur = e.currentTarget;
  const el = type === 'carte' ? declencheur.closest('.carte') : declencheur.closest('.colonne');
  if (!el || zone.dataset.saisie) return;
  zone.dataset.saisie = '1';
  const depart = { parent: el.parentElement, suivant: el.nextElementSibling };
  el.classList.add('saisie-clavier');
  const nom = type === 'carte' ? el.querySelector('.carte-lien')?.textContent : el.querySelector('.colonne-titre')?.textContent;
  const position = () => {
    if (type === 'carte') {
      const col = el.closest('.colonne');
      const n = col.querySelectorAll('.liste-cartes > .carte').length;
      return `${col.querySelector('.colonne-titre')?.textContent}, position ${indexDans(el, '.carte') + 1} sur ${n}`;
    }
    return `position ${indexDans(el, '.colonne') + 1} sur ${zone.querySelectorAll(':scope > .colonne').length}`;
  };
  annoncer(`${type === 'carte' ? 'Carte' : 'Colonne'} « ${nom} » saisie, ${position()}. Flèches pour déplacer, Espace pour déposer, Échap pour annuler.`, true);

  const refocus = () => declencheur.focus();
  const fini = (deposer) => {
    declencheur.removeEventListener('keydown', touche, true);
    declencheur.removeEventListener('blur', perte);
    el.classList.remove('saisie-clavier');
    delete zone.dataset.saisie;
    if (!deposer) {
      depart.parent.insertBefore(el, depart.suivant);
      annoncer('Déplacement annulé.', true);
      rendre();
      refocus();
      return;
    }
    if (type === 'carte') surCarte(el.dataset.cardId, el.closest('.colonne').dataset.colId, indexDans(el, '.carte'));
    else surColonne(el.dataset.colId, indexDans(el, '.colonne'));
  };
  const perte = () => setTimeout(() => { if (zone.dataset.saisie && document.activeElement !== declencheur) fini(false); }, 0);
  const touche = (ev) => {
    ev.stopImmediatePropagation();
    const k = ev.key;
    if (k === 'Escape') { ev.preventDefault(); return fini(false); }
    if (k === ' ' || k === 'Enter') { ev.preventDefault(); return fini(true); }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { if (k !== 'Tab') ev.preventDefault(); return; }
    ev.preventDefault();
    declencheur.removeEventListener('blur', perte);
    if (type === 'carte') {
      const liste = el.parentElement;
      if (k === 'ArrowUp') { const p = el.previousElementSibling; if (p) liste.insertBefore(el, p); }
      else if (k === 'ArrowDown') { const n = el.nextElementSibling; if (n) n.after(el); }
      else {
        const col = el.closest('.colonne');
        const cible = k === 'ArrowLeft' ? col.previousElementSibling : col.nextElementSibling;
        const l2 = cible?.matches('.colonne') ? cible.querySelector('.liste-cartes') : null;
        if (l2) { const idx = Math.min(indexDans(el, '.carte'), l2.children.length); l2.insertBefore(el, l2.children[idx] ?? null); cible.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      }
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (k === 'ArrowLeft') { const p = el.previousElementSibling; if (p?.matches('.colonne')) zone.insertBefore(el, p); }
      else { const n = el.nextElementSibling; if (n?.matches('.colonne')) n.after(el); }
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    refocus();
    declencheur.addEventListener('blur', perte);
    annoncer(position(), true);
  };
  declencheur.addEventListener('keydown', touche, true);
  declencheur.addEventListener('blur', perte);
}
