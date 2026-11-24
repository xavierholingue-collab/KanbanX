// Écran « Mon compte » : préférences de la personne (courriel quand on la mentionne).
import { h } from './dom.js';
import { get, patch } from './api.js';
import { erreur, toast } from './toasts.js';

export async function ecranCompte(conteneur) {
  document.title = 'Mon compte — KanbanX';
  let moi;
  try { moi = (await get('/api/me')).user; } catch (e) { return erreur(e.message); }
  const caseMentions = h('input#pref-mentions', { type: 'checkbox', checked: !!moi.mentionEmails, 'aria-describedby': 'aide-pref-mentions' });
  caseMentions.addEventListener('change', async () => {
    const voulu = caseMentions.checked;
    caseMentions.disabled = true;
    try {
      const r = await patch('/api/me/preferences', { mentionEmails: voulu });
      caseMentions.checked = r.mentionEmails;
      toast(r.mentionEmails ? 'Vous serez prévenu par courriel quand on vous mentionne.' : 'Vous ne recevrez plus de courriel quand on vous mentionne.');
    } catch (e) {
      caseMentions.checked = !voulu;
      erreur(`Préférence non enregistrée : ${e.message}`);
    } finally { caseMentions.disabled = false; caseMentions.focus(); }
  });
  conteneur.replaceChildren(h('div.page', h('section.page-etroite', { 'aria-labelledby': 'titre-compte' },
    h('h1#titre-compte', 'Mon compte'),
    h('p', h('strong', moi.name), h('span.aide', ` · ${moi.email ?? ''}`)),
    h('h2', 'Courriels'),
    h('div.case-preference', caseMentions,
      h('div', h('label', { for: 'pref-mentions' }, 'Me prévenir par courriel quand on me mentionne'),
        h('p.aide#aide-pref-mentions', 'Un courriel regroupé, au plus un toutes les 10 minutes, avec qui vous a mentionné, sur quelle carte, un court extrait et le lien. Jamais pour vos propres mentions.'))))));
}
