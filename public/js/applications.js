// Applications connectées (OAuth) : écran de consentement et page de révocation.
// Une application autorisée (Claude, par exemple) agit au nom de la personne, avec ses droits, et ses actions
// apparaissent « Claude pour Eric » dans l'historique.
import { h, icone } from './dom.js';
import { get, post, del } from './api.js';
import { toast, erreur } from './toasts.js';
import { horodatage } from './activite.js';

export function ecranDemandeInvalide(conteneur, message) {
  document.title = 'Demande d\'autorisation invalide — KanbanX';
  conteneur.replaceChildren(h('div.page', h('section.boite', { 'aria-labelledby': 'titre-demande' },
    h('h1#titre-demande', { tabindex: '-1' }, 'Demande d\'autorisation invalide'),
    h('p.message.message-erreur', { role: 'alert' }, message),
    h('p.aide', 'Aucun accès n\'a été accordé. Relancez la connexion depuis l\'application qui vous a envoyé ici.'),
    h('p', h('a.btn.btn-secondaire', { href: '/' }, 'Revenir à mes tableaux')))));
}

/** Écran de consentement : jamais d'accord implicite, la personne choisit. */
export function ecranConsentement(conteneur, demande, moi) {
  const nom = demande.client.nom;
  document.title = `Autoriser « ${nom} » — KanbanX`;
  const zoneMessage = h('div', { role: 'status' });
  const autoriser = h('button.btn.btn-primaire', { type: 'button', onclick: () => decider('accepter') }, icone('coche'), 'Autoriser');
  const refuser = h('button.btn.btn-secondaire', { type: 'button', onclick: () => decider('refuser') }, 'Refuser');

  async function decider(decision) {
    autoriser.disabled = true; refuser.disabled = true;
    zoneMessage.replaceChildren(h('p.aide', decision === 'accepter' ? 'Autorisation en cours…' : 'Refus en cours…'));
    try {
      const r = await post('/api/oauth/accord', { parametres: location.search.slice(1), decision });
      // Navigation par script : la directive form-action de la CSP ne s'applique pas, et rien n'est soumis ailleurs.
      location.assign(r.redirection);
    } catch (e) {
      autoriser.disabled = false; refuser.disabled = false;
      zoneMessage.replaceChildren(h('p.message.message-erreur', { role: 'alert' }, e.message));
    }
  }

  conteneur.replaceChildren(h('div.page', h('section.boite.boite-large', { 'aria-labelledby': 'titre-consentement' },
    h('h1#titre-consentement', { tabindex: '-1' }, `Autoriser « ${nom} » à accéder à KanbanX\u00a0?`),
    h('p', `Une application qui se présente sous le nom « ${nom} » demande à agir en votre nom. Elle pourra :`),
    h('ul.liste-droits',
      h('li', 'lire les tableaux, les cartes et les commentaires auxquels vous avez accès ;'),
      h('li', 'créer, modifier et déplacer des cartes, et commenter, là où vous en avez le droit.')),
    h('p', 'Elle ne verra rien de plus que vous. Ses actions apparaîtront sous le nom ', h('strong', `« ${nom} pour ${moi.name} »`), ' dans l\'historique.'),
    demande.boucleLocale
      ? h('p.message.message-attention', { role: 'note' }, h('strong', 'Programme de cet ordinateur. '),
        'Cette demande vient d\'un programme qui tourne sur votre ordinateur (Claude Code, par exemple). N\'autorisez que si vous venez de le lancer vous-même.')
      : '',
    h('p.retour-hote', 'Après votre réponse, vous serez renvoyé vers ', h('strong', demande.hote), '.'),
    h('p.aide', 'Vous pourrez retirer cet accès à tout moment, depuis Applications connectées.'),
    h('div.rangee.actions-consentement', autoriser, refuser),
    zoneMessage)));
  // Le focus va au titre, pas au bouton : une touche Entrée ne doit jamais accorder un accès par mégarde.
  document.getElementById('titre-consentement').focus();
}

/** Page « Applications connectées » : voir et retirer les accès accordés. */
export async function ecranApplications(conteneur) {
  document.title = 'Applications connectées — KanbanX';
  const liste = h('ul.liste-applications', { 'aria-label': 'Applications autorisées' });
  const etatListe = h('div', { role: 'status' });
  const adresseMcp = `${location.origin}/mcp`;
  conteneur.replaceChildren(h('div.page', h('section.page-etroite', { 'aria-labelledby': 'titre-applications' },
    h('h1#titre-applications', 'Applications connectées'),
    h('p.aide', 'Ces applications agissent en votre nom dans KanbanX, avec vos droits. Retirer un accès le coupe aussitôt : l\'application devra vous redemander votre accord.'),
    etatListe, liste,
    h('h2', 'Brancher Claude'),
    h('p', 'Dans Claude, ajoutez un connecteur personnalisé avec cette adresse, puis cliquez sur « Se connecter » :'),
    h('p', h('code.adresse-mcp', adresseMcp)))));

  async function charger() {
    let r;
    try { r = await get('/api/oauth/acces'); } catch (e) { return erreur(e.message); }
    liste.replaceChildren(...r.acces.map(ligne));
    etatListe.replaceChildren(r.acces.length ? '' : h('p.vide', 'Aucune application n\'a accès à votre compte.'));
  }

  function ligne(a) {
    const actions = h('div.rangee');
    const li = h('li.application',
      h('div.application-texte',
        h('p', h('strong', a.client), h('span.aide', ` · retour vers ${a.hote}`)),
        h('p.aide', 'Autorisée ', horodatage(a.creeLe), ' · ', a.utiliseLe ? h('span', 'dernière utilisation ', horodatage(a.utiliseLe)) : 'pas encore utilisée')),
      actions);
    const retirer = h('button.btn.btn-danger', { type: 'button', 'aria-label': `Retirer l'accès de « ${a.client} »`, onclick: confirmer }, icone('x'), 'Retirer l\'accès');
    actions.append(retirer);

    function confirmer() {
      const oui = h('button.btn.btn-danger', { type: 'button', onclick: async () => {
        oui.disabled = true;
        try {
          await del(`/api/oauth/acces/${a.id}`);
          toast(`Accès de « ${a.client} » retiré.`);
          await charger();
        } catch (e) { oui.disabled = false; erreur(e.message); }
      } }, 'Confirmer le retrait');
      const non = h('button.btn.btn-discret', { type: 'button', onclick: () => { actions.replaceChildren(retirer); retirer.focus(); } }, 'Annuler');
      actions.replaceChildren(h('span', 'Retirer cet accès ?'), oui, non);
      oui.focus();
    }
    return li;
  }

  await charger();
}
