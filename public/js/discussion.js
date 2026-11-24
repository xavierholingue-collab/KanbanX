// Fil de discussion d'une carte : commentaires Markdown, mentions @prénom avec suggestions, historique, direct.
import { h, icone, avatar, htmlNettoye, annoncer } from './dom.js';
import { get, post, patch, del } from './api.js';
import { toast, erreur } from './toasts.js';
import { avecMentions } from './saisie-mentions.js';
import { ligneActivite, horodatage } from './activite.js';

// État conservé entre deux rendus de la fenêtre (brouillon, données en cache).
const D = { carteId: null, commentaires: null, activite: null, brouillon: '', historique: false, edition: null, conteneur: null, T: null, chargement: null };

window.addEventListener('kx:evenement', (e) => {
  const ev = e.detail;
  if (!D.carteId || !D.conteneur?.isConnected) return;
  if (ev.cardId === D.carteId || (ev.kind === 'card' && ev.id === D.carteId)) recharger(true);
});

// Reconnexion du direct après une coupure : les commentaires arrivés entre-temps n'ont pas été annoncés.
window.addEventListener('kx:resynchroniser', () => {
  if (D.carteId && D.conteneur?.isConnected) recharger(true);
});

async function recharger(direct = false) {
  const id = D.carteId;
  const [c, a] = await Promise.all([get(`/api/cards/${id}/comments`), get(`/api/cards/${id}/activity`)]).catch(() => [null, null]);
  if (id !== D.carteId || !c) return;
  const nouveaux = direct && D.commentaires ? c.filter((x) => !D.commentaires.some((y) => y.id === x.id)) : [];
  D.commentaires = c; D.activite = a;
  if (D.conteneur?.isConnected && !D.edition) dessiner();
  for (const n of nouveaux) annoncer(`Nouveau commentaire de ${n.client ? `${n.client} pour ${n.author.name}` : n.author.name}.`);
}

export function rendreDiscussion(conteneur, carteId, T) {
  if (D.carteId !== carteId) Object.assign(D, { carteId, commentaires: null, activite: null, brouillon: '', edition: null });
  D.conteneur = conteneur; D.T = T;
  dessiner();
  if (!D.commentaires) recharger();
}

const ecrit = () => D.T.tableau.role !== 'reader';

function dessiner() {
  const c = D.conteneur;
  const focusDansComposeur = document.activeElement?.id === 'nouveau-commentaire';
  const bascule = h('button.btn.btn-discret', { type: 'button', 'aria-pressed': String(D.historique), onclick: () => { D.historique = !D.historique; dessiner(); c.querySelector('[aria-pressed]')?.focus(); } },
    D.historique ? 'Masquer l\'historique' : 'Afficher l\'historique');
  const fil = h('ol.fil', { 'aria-label': 'Commentaires' });
  if (!D.commentaires) fil.append(h('li.vide', 'Chargement des commentaires…'));
  else {
    const elements = [...D.commentaires.map((x) => ({ t: x.createdAt, el: () => rendreCommentaire(x) })),
      ...(D.historique ? (D.activite ?? []).filter((a) => !a.action.startsWith('commentaire.')).map((a) => ({ t: a.createdAt, el: () => ligneActivite(a, { surCarte: true }) })) : [])]
      .sort((a, b) => new Date(a.t) - new Date(b.t));
    if (!elements.length) fil.append(h('li.vide', 'Aucun commentaire. Lancez la discussion !'));
    fil.append(...elements.map((e) => e.el()));
  }
  c.replaceChildren(
    h('div.rangee.entete-section', h('h3#h-disc', icone('commentaire'), 'Discussion'), h('span.espace'), bascule),
    ecrit() ? composeur() : h('p.vide', 'Lecture seule : vous ne pouvez pas commenter.'),
    fil);
  if (focusDansComposeur) { const t = c.querySelector('#nouveau-commentaire'); t?.focus(); t?.setSelectionRange(t.value.length, t.value.length); }
}

function rendreCommentaire(x) {
  const moi = x.author.id === D.T.moi.id;
  if (D.edition?.id === x.id) {
    const champ = h('textarea.champ', { rows: 3, maxlength: 10000, 'aria-label': 'Modifier le commentaire' });
    champ.value = D.edition.texte;
    champ.addEventListener('input', () => { D.edition.texte = champ.value; });
    const finir = async (garder) => {
      const texte = champ.value;
      D.edition = null;
      if (garder && texte.trim() && texte !== x.body) {
        const avant = x.body;
        x.body = texte;
        dessiner();
        try { Object.assign(x, await patch(`/api/comments/${x.id}`, { body: texte })); dessiner(); }
        catch (e) { x.body = avant; dessiner(); erreur(`Commentaire non modifié : ${e.message}`); }
      } else dessiner();
      D.conteneur.querySelector(`[data-comm="${x.id}"]`)?.focus();
    };
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finir(false); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finir(true); }
    });
    setTimeout(() => champ.focus(), 0);
    return h('li.commentaire', avatar(x.author), h('div.bulle-edition', avecMentions(champ, () => D.T.tableau.members),
      h('div.rangee', h('button.btn.btn-primaire', { type: 'button', onclick: () => finir(true) }, 'Enregistrer'), h('button.btn.btn-discret', { type: 'button', onclick: () => finir(false) }, 'Annuler'))));
  }
  return h(`li.commentaire${x.enAttente ? '.en-attente' : ''}`, { 'aria-busy': x.enAttente ? 'true' : undefined },
    avatar(x.author),
    h('div.bulle-conteneur',
      h('p.auteur', h('strong', x.client ? `${x.client} pour ${x.author.name}` : x.author.name),
        x.author.kind === 'agent' ? h('span.badge-agent', 'agent') : x.client ? h('span.badge-agent', 'application') : '', ' ', horodatage(x.createdAt), x.editedAt ? h('span.vide', ' · modifié') : ''),
      htmlNettoye(h('div.bulle.markdown'), x.html ?? ''),
      moi && !x.enAttente && ecrit() ? h('div.rangee.actions-comm',
        h('button.btn.btn-discret', { type: 'button', 'data-comm': x.id, onclick: () => { D.edition = { id: x.id, texte: x.body }; dessiner(); } }, 'Modifier'),
        h('button.btn.btn-discret', { type: 'button', onclick: () => supprimer(x) }, 'Supprimer')) : ''));
}

async function supprimer(x) {
  const i = D.commentaires.indexOf(x);
  D.commentaires.splice(i, 1);
  dessiner();
  try {
    await del(`/api/comments/${x.id}`);
    toast('Commentaire supprimé.', { annuler: async () => {
      try { await post(`/api/comments/${x.id}/restore`); await recharger(); annoncer('Commentaire restauré.'); }
      catch (e) { erreur(`Restauration impossible : ${e.message}`); }
    } });
  } catch (e) {
    D.commentaires.splice(i, 0, x); dessiner();
    erreur(`Commentaire non supprimé : ${e.message}`);
  }
}

// ---------- Composeur avec suggestions de mentions ----------

function composeur() {
  const champ = h('textarea.champ#nouveau-commentaire', {
    rows: 2, maxlength: 10000, placeholder: 'Écrire un commentaire… (@prénom pour mentionner)', 'aria-label': 'Nouveau commentaire',
    'aria-describedby': 'aide-comm' });
  champ.value = D.brouillon;
  const zone = avecMentions(champ, () => D.T.tableau.members);
  const envoyer = async () => {
    const texte = champ.value.trim();
    if (!texte) return champ.focus();
    const temporaire = { id: `tmp-${crypto.randomUUID()}`, body: texte, html: '', createdAt: new Date().toISOString(), author: { id: D.T.moi.id, name: D.T.moi.name, kind: D.T.moi.kind }, enAttente: true };
    temporaire.html = '';
    D.commentaires = [...(D.commentaires ?? []), temporaire];
    D.brouillon = '';
    const id = D.carteId;
    dessiner();
    const el = D.conteneur.querySelector('.commentaire.en-attente .bulle');
    if (el) el.textContent = texte; // aperçu immédiat (texte brut) en attendant le rendu nettoyé du serveur
    D.conteneur.querySelector('#nouveau-commentaire')?.focus();
    try {
      const c = await post(`/api/cards/${id}/comments`, { body: texte });
      if (D.carteId !== id) return;
      D.commentaires = D.commentaires.map((x) => (x === temporaire ? c : x));
      dessiner();
      annoncer('Commentaire publié.');
      const k = D.T.tableau.columns.flatMap((col) => col.cards).find((x) => x.id === id);
      if (k) { k.commentCount += 1; import('./tableau.js').then((m) => m.rendre()); }
    } catch (e) {
      D.commentaires = D.commentaires.filter((x) => x !== temporaire);
      D.brouillon = texte;
      dessiner();
      erreur(`Commentaire non publié : ${e.message}`);
    }
  };
  champ.addEventListener('input', () => { D.brouillon = champ.value; });
  champ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return envoyer(); }
    if (e.key === 'Escape' && champ.value) { e.preventDefault(); e.stopPropagation(); champ.blur(); }
  });
  return h('form.composeur-commentaire', { onsubmit: (e) => { e.preventDefault(); envoyer(); } },
    avatar(D.T.moi.kind ? D.T.moi : { ...D.T.moi, kind: 'human' }),
    h('div.zone-comm', zone,
      h('p.aide#aide-comm', 'Markdown accepté. @ pour mentionner, Ctrl+Entrée pour publier.'),
      h('button.btn.btn-primaire', { type: 'submit' }, 'Commenter')));
}
