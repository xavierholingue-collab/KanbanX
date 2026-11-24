// Écran « Mes mentions » : ce qui me cite (@prénom) dans mes tableaux, avec l'endroit (titre, description, commentaire).
import { h, avatar } from './dom.js';
import { get } from './api.js';
import { erreur } from './toasts.js';
import { horodatage } from './activite.js';

const ENDROIT = { titre: 'le titre de', description: 'la description de', commentaire: 'un commentaire sur' };
const extrait = (t) => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > 200 ? `${s.slice(0, 199)}…` : s; };

export async function ecranMentions(conteneur) {
  document.title = 'Mes mentions — KanbanX';
  const liste = h('ol.liste-mentions', { 'aria-label': 'Mentions, de la plus récente à la plus ancienne' });
  const etat = h('div', { role: 'status' }, h('p.chargement', 'Chargement…'));
  conteneur.replaceChildren(h('div.page', h('section.page-etroite', { 'aria-labelledby': 'titre-mentions' },
    h('h1#titre-mentions', 'Mes mentions'),
    h('p.aide', 'Quand quelqu\'un écrit @', h('span', 'votre prénom'), ' dans le titre, la description ou un commentaire d\'une carte, vous le retrouvez ici.'),
    etat, liste)));
  let mentions;
  try { mentions = await get('/api/mentions?limit=100'); } catch (e) { etat.replaceChildren(); return erreur(e.message); }
  etat.replaceChildren(mentions.length ? '' : h('p.vide', 'Personne ne vous a encore mentionné.'));
  liste.replaceChildren(...mentions.map((m) => {
    const qui = m.client ? `${m.client} pour ${m.author.name}` : m.author.name;
    return h('li.mention-item', avatar(m.author),
      h('div.mention-texte',
        h('p', h('strong', qui), ` vous a mentionné dans ${ENDROIT[m.where] ?? ENDROIT.commentaire} `,
          h('a', { href: `/b/${m.board.id}/c/${m.card.id}` }, m.card.title)),
        h('blockquote.mention-extrait', extrait(m.body)),
        h('p.aide', m.board.name, ' · ', horodatage(m.createdAt))));
  }));
}
