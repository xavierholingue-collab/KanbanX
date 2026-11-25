// « Continuer avec Google » côté écran : bouton, départ vers Google, messages de retour.
// Le serveur ne renvoie qu'un code de résultat dans l'adresse (?google=…), jamais une adresse ni un texte libre.
import { h } from './dom.js';
import { get, post } from './api.js';

let methodes = null;
/** Moyens de connexion proposés par le serveur (demandé une fois). */
export function methodesConnexion() {
  methodes ??= get('/api/auth/methodes').catch(() => { methodes = null; return { google: false }; });
  return methodes;
}

/** Lit le résultat d'un retour de Google et le retire de l'adresse (rien ne reste dans l'historique). */
export function resultatGoogle() {
  const p = new URLSearchParams(location.search);
  const r = p.get('google');
  if (r !== null) history.replaceState(null, '', location.pathname);
  return r;
}

const REESSAYER = 'Réessayez dans quelques minutes.';
// erreur : message d'erreur (annoncé immédiatement) ; sinon simple information.
export const MESSAGES_CONNEXION = {
  annule: { texte: 'Connexion avec Google annulée. Vous pouvez recommencer, ou recevoir un lien par courriel.' },
  expire: { erreur: true, texte: 'La connexion avec Google a expiré, ou elle a été commencée dans un autre navigateur. Recommencez ici.' },
  echec: { erreur: true, texte: 'Google n\'a pas pu confirmer votre identité. Réessayez, ou recevez un lien de connexion par courriel.' },
  inconnu: { erreur: true, texte: 'Ce compte Google n\'a pas accès à KanbanX : aucune invitation n\'a été faite à son adresse. Demandez à la personne qui vous invite d\'utiliser cette adresse, ou recevez un lien par courriel à l\'adresse invitée.' },
  non_autoritaire: { erreur: true, texte: 'Pour l\'adresse de ce compte Google, Google ne suffit pas à prouver qu\'elle est la vôtre. Connectez-vous une première fois avec le lien par courriel, puis liez votre compte Google depuis « Mon compte ».' },
  autre_compte: { erreur: true, texte: 'Votre compte KanbanX est déjà lié à un autre compte Google. Continuez avec celui-là, ou connectez-vous par courriel.' },
  trop: { erreur: true, texte: `Trop de tentatives de connexion. ${REESSAYER}` },
};
export const MESSAGES_COMPTE = {
  lie: { texte: 'Votre compte Google est lié.' },
  annule: { texte: 'Liaison avec Google annulée.' },
  expire: { erreur: true, texte: 'La liaison avec Google a expiré, ou la session a changé entre-temps. Recommencez.' },
  echec: { erreur: true, texte: 'Google n\'a pas pu confirmer votre identité. Réessayez.' },
  deja_lie: { erreur: true, texte: 'Ce compte Google est déjà lié à un autre compte KanbanX. Choisissez un autre compte Google.' },
  autre_compte: { erreur: true, texte: 'Votre compte est déjà lié à un autre compte Google. Déliez-le d\'abord.' },
  trop: { erreur: true, texte: `Trop de tentatives. ${REESSAYER}` },
};

/** Paragraphe de message pour un résultat connu, ou rien. */
export function messageResultat(table, resultat) {
  const m = table[resultat];
  if (!m) return null;
  return m.erreur ? h('p.message.message-erreur', { role: 'alert' }, m.texte) : h('p.message', { role: 'status' }, m.texte);
}

/**
 * Bouton qui part chez Google. chemin : /api/auth/google (connexion) ou /api/me/google (liaison).
 * En cas d'erreur, le message s'affiche dans zoneMessage et le bouton redevient utilisable.
 */
export function boutonGoogle({ libelle, chemin, zoneMessage, classe = '' }) {
  const bouton = h(`button.btn.btn-google${classe}`, { type: 'button' }, libelle);
  bouton.addEventListener('click', async () => {
    bouton.disabled = true;
    try {
      const r = await post(chemin);
      location.assign(r.url);
    } catch (e) {
      zoneMessage.replaceChildren(h('p.message.message-erreur', { role: 'alert' }, e.message));
      bouton.disabled = false;
    }
  });
  // Retour arrière depuis Google : la page revient du cache, le bouton doit être de nouveau utilisable.
  window.addEventListener('pageshow', (e) => { if (e.persisted) bouton.disabled = false; });
  return bouton;
}
