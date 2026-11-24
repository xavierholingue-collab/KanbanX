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

export async function importerFichier(data) {
  const auteurs = auteursTrello(data);
  if (!auteurs.length) return envoyer(data, {});
  let personnes;
  try { personnes = await get('/api/import-trello/personnes'); } catch (e) { return erreur(e.message); }
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
  const d = h('dialog.dialog-lateral', { 'aria-labelledby': 'titre-assoc' },
    h('div.dialog-entete', h('h2#titre-assoc', icone('membres'), ' Auteurs des commentaires Trello'),
      h('button.btn.btn-icone.btn-discret', { type: 'button', 'aria-label': 'Annuler l\'import', onclick: () => d.close() }, icone('x'))),
    h('form.dialog-corps', { onsubmit: async (e) => {
      e.preventDefault();
      const correspondances = Object.fromEntries([...choix].filter(([, s]) => s.value).map(([k, s]) => [k, s.value]));
      const bouton = e.submitter; if (bouton) bouton.disabled = true;
      const ok = await envoyer(data, correspondances);
      if (ok) d.close(); else if (bouton) bouton.disabled = false;
    } },
    h('p.aide', 'Associez chaque auteur à une personne qui partage déjà un tableau avec vous. Ses commentaires afficheront son nom, avec « importé de Trello ». Ils restent les vôtres : vous seul pourrez les modifier.'),
    h('ul.liste-associations', lignes),
    h('div.rangee', h('button.btn.btn-primaire', { type: 'submit' }, 'Importer le tableau'), h('button.btn.btn-discret', { type: 'button', onclick: () => d.close() }, 'Annuler'))));
  d.addEventListener('close', () => { d.remove(); document.getElementById('fichier-trello')?.focus(); });
  document.body.append(d);
  d.showModal();
  d.querySelector('h2')?.setAttribute('tabindex', '-1');
  d.querySelector('h2')?.focus();
}

async function envoyer(data, correspondances) {
  try {
    const r = await post('/api/boards/import-trello', Object.keys(correspondances).length ? { trello: data, correspondances } : data);
    const pl = (n, m) => `${n} ${m}${n > 1 ? 's' : ''}`;
    toast(`Tableau « ${r.name} » importé : ${pl(r.colonnes, 'colonne')}, ${pl(r.cartes, 'carte')}, ${pl(r.commentaires, 'commentaire')}.`);
    naviguer(`/b/${r.id}`);
    return true;
  } catch (err) { erreur(`Import impossible : ${err.message}`); return false; }
}
