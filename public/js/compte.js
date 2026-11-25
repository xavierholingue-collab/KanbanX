// Écran « Mon compte » : préférences de la personne (courriel quand on la mentionne) et compte Google lié.
import { h } from './dom.js';
import { get, patch, del } from './api.js';
import { erreur, toast } from './toasts.js';
import { methodesConnexion, resultatGoogle, MESSAGES_COMPTE, messageResultat, boutonGoogle } from './google.js';

export async function ecranCompte(conteneur) {
  document.title = 'Mon compte — KanbanX';
  const resultat = resultatGoogle();
  let moi;
  let google;
  try { [moi, { google }] = await Promise.all([get('/api/me').then((r) => r.user), methodesConnexion()]); } catch (e) { return erreur(e.message); }
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

  // Compte Google : affiché s'il est lié, ou si la connexion avec Google est proposée.
  const zoneGoogle = h('div.liaison-google');
  const zoneMessageGoogle = h('div', { role: 'status' });
  const afficherGoogle = (lie) => {
    if (lie) {
      const delier = h('button.btn.btn-secondaire', { type: 'button' }, 'Délier mon compte Google');
      delier.addEventListener('click', async () => {
        delier.disabled = true;
        try {
          await del('/api/me/google');
          zoneMessageGoogle.replaceChildren();
          afficherGoogle(null);
          toast('Compte Google délié. Vous vous connecterez avec le lien envoyé par courriel.');
          zoneGoogle.querySelector('button')?.focus();
        } catch (e) { erreur(`Compte Google non délié : ${e.message}`); delier.disabled = false; }
      });
      zoneGoogle.replaceChildren(
        h('p', 'Lié au compte Google ', h('strong', lie), '.'),
        h('p.aide', '« Continuer avec Google » vous connecte directement. Le lien de connexion par courriel reste toujours possible.'),
        delier);
    } else {
      zoneGoogle.replaceChildren(
        h('p.aide#aide-lier-google', 'Liez votre compte Google pour vous connecter sans attendre de lien par courriel. Le lien par courriel reste toujours possible.'),
        google ? boutonGoogle({ libelle: 'Lier mon compte Google', chemin: '/api/me/google', zoneMessage: zoneMessageGoogle }) : '');
    }
  };
  afficherGoogle(moi.google ?? null);
  const sectionGoogle = (moi.google || google) ? [h('h2', 'Connexion avec Google'), messageResultat(MESSAGES_COMPTE, resultat), zoneMessageGoogle, zoneGoogle] : [];

  conteneur.replaceChildren(h('div.page', h('section.page-etroite', { 'aria-labelledby': 'titre-compte' },
    h('h1#titre-compte', 'Mon compte'),
    h('p', h('strong', moi.name), h('span.aide', ` · ${moi.email ?? ''}`)),
    h('h2', 'Courriels'),
    h('div.case-preference', caseMentions,
      h('div', h('label', { for: 'pref-mentions' }, 'Me prévenir par courriel quand on me mentionne'),
        h('p.aide#aide-pref-mentions', 'Un courriel regroupé, au plus un toutes les 10 minutes, avec qui vous a mentionné, sur quelle carte, un court extrait et le lien. Jamais pour vos propres mentions.'))),
    sectionGoogle)));
}
