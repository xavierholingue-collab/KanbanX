// Import d'un export Trello : association facultative des auteurs Trello aux personnes qui partagent déjà un
// tableau avec moi (jamais la liste de tous les comptes), puis import.
import { h, icone } from './dom.js';
import { get, post } from './api.js';
import { erreur, toast } from './toasts.js';
import { naviguer } from './app.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Membres Trello qui ont écrit au moins un commentaire, avec leur nombre de commentaires. */
export function auteursTrello(data) {
  const noms = new Map((Array.isArray(data.members) ? data.members : []).map((m) => [m?.id, m?.fullName || m?.username]));
  const auteurs = new Map();
  for (const a of Array.isArray(data.actions) ? data.actions : []) {
    if (a?.type !== 'commentCard') continue;
    const id = a.idMemberCreator ?? a.memberCreator?.id;
    if (!id || typeof id !== 'string') continue;
    const x = auteurs.get(id) ?? { id, nom: String(a.memberCreator?.fullName || noms.get(id) || 'Membre Trello').slice(0, 80), n: 0 };
    x.n += 1;
    auteurs.set(id, x);
  }
  return [...auteurs.values()].sort((a, b) => b.n - a.n).slice(0, 100);
}

/** Proposition : la seule personne dont le prénom ou le nom complet correspond, sinon personne. */
function proposer(auteur, personnes) {
  const n = norm(auteur.nom);
  const prenom = n.split(/\s+/)[0];
  const ok = personnes.filter((p) => norm(p.name) === n || norm(p.name) === prenom);
  return ok.length === 1 ? ok[0].id : '';
}

/** Nombre d'images jointes aux cartes ouvertes de l'export. */
export function imagesTrello(data) {
  const ext = /\.(png|jpe?g|gif|webp|svg)$/i;
  return (Array.isArray(data.cards) ? data.cards : []).filter((k) => k && !k.closed)
    .flatMap((k) => (Array.isArray(k.attachments) ? k.attachments : []))
    .filter((pj) => pj && typeof pj.url === 'string' && pj.isUpload !== false && (String(pj.mimeType ?? '').startsWith('image/') || ext.test(pj.name ?? ''))).length;
}

export async function importerFichier(data) {
  const auteurs = auteursTrello(data);
  const nbImages = imagesTrello(data);
  if (!auteurs.length && !nbImages) return envoyer(data, {});
  let personnes = [];
  if (auteurs.length) { try { personnes = await get('/api/import-trello/personnes'); } catch (e) { return erreur(e.message); } }
  const choix = new Map();
  const lignes = auteurs.map((a, i) => {
    const sel = h('select.champ', { id: `assoc-${i}`, 'aria-describedby': `assoc-aide-${i}` },
      h('option', { value: '' }, `Ne pas associer (« ${a.nom} sur Trello »)`),
      personnes.map((p) => h('option', { value: p.id }, `${p.name} · ${p.email}`)));
    sel.value = proposer(a, personnes);
    choix.set(a.id, sel);
    return h('li.association',
      h('label.etiquette-champ', { for: `assoc-${i}` }, a.nom),
      h('p.aide', { id: `assoc-aide-${i}` }, `${a.n} commentaire${a.n > 1 ? 's' : ''} sur Trello`),
      sel);
  });
  // Clé et jeton d'API Trello : facultatifs, servent à cette seule requête (jamais stockés ni journalisés).
  const cle = h('input.champ#trello-cle', { type: 'password', autocomplete: 'off', spellcheck: 'false', maxlength: 256, 'aria-describedby': 'aide-trello-auth' });
  const jeton = h('input.champ#trello-jeton', { type: 'password', autocomplete: 'off', spellcheck: 'false', maxlength: 512, 'aria-describedby': 'aide-trello-auth' });
  const blocImages = nbImages ? h('section.import-images', { 'aria-labelledby': 'h-import-images' },
    h('h3#h-import-images', `Images (${nbImages})`),
    h('p.aide#aide-trello-auth', 'Pour rapatrier les images dans KanbanX, Trello exige votre clé et votre jeton d\'API (trello.com/power-ups/admin). Ils ne servent qu\'à cet import : ils ne sont ni enregistrés ni conservés. Sans eux, les images restent des liens vers Trello.'),
    h('div', h('label.etiquette-champ', { for: 'trello-cle' }, 'Clé d\'API Trello (facultative)'), cle),
    h('div', h('label.etiquette-champ', { for: 'trello-jeton' }, 'Jeton Trello (facultatif)'), jeton)) : '';
  const d = h('dialog.dialog-lateral', { 'aria-labelledby': 'titre-assoc' },
    h('div.dialog-entete', h('h2#titre-assoc', icone('membres'), auteurs.length ? ' Auteurs des commentaires Trello' : ' Importer le tableau Trello'),
      h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': 'Annuler l\'import', onclick: () => d.close() }, icone('x'))),
    h('form.dialog-corps', { onsubmit: async (e) => {
      e.preventDefault();
      const correspondances = Object.fromEntries([...choix].filter(([, s]) => s.value).map(([k, s]) => [k, s.value]));
      const bouton = e.submitter; if (bouton) bouton.disabled = true;
      const auth = cle.value.trim() && jeton.value.trim() ? { cle: cle.value.trim(), jeton: jeton.value.trim() } : null;
      cle.value = ''; jeton.value = ''; // rien ne reste dans la page
      const ok = await envoyer(data, correspondances, auth);
      if (ok) d.close(); else if (bouton) bouton.disabled = false;
    } },
    auteurs.length ? [h('p.aide', 'Associez chaque auteur à une personne qui partage déjà un tableau avec vous. Ses commentaires afficheront son nom, avec « importé de Trello ». Ils restent les vôtres : vous seul pourrez les modifier.'),
      h('ul.liste-associations', lignes)] : '',
    blocImages,
    h('div.rangee', h('button.btn.btn-primaire', { type: 'submit' }, 'Importer le tableau'), h('button.btn.btn-discret', { type: 'button', onclick: () => d.close() }, 'Annuler'))));
  d.addEventListener('close', () => { d.remove(); document.getElementById('fichier-trello')?.focus(); });
  document.body.append(d);
  d.showModal();
  d.querySelector('h2')?.setAttribute('tabindex', '-1');
  d.querySelector('h2')?.focus();
}

async function envoyer(data, correspondances, auth = null) {
  try {
    const enveloppe = Object.keys(correspondances).length || auth;
    const r = await post('/api/boards/import-trello', enveloppe ? { trello: data, correspondances, ...(auth ? { trelloAuth: auth } : {}) } : data);
    const pl = (n, m) => `${n} ${m}${n > 1 ? 's' : ''}`;
    toast(`Tableau « ${r.name} » importé : ${pl(r.colonnes, 'colonne')}, ${pl(r.cartes, 'carte')}, ${pl(r.commentaires, 'commentaire')}${r.images ? `, ${pl(r.images, 'image')}` : ''}.`);
    naviguer(`/b/${r.id}`);
    return true;
  } catch (err) { erreur(`Import impossible : ${err.message}`); return false; }
}
