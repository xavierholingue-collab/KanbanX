// Routes de l'écran de consentement et de la page « Applications connectées » (application web).
// Le protocole lui-même (/oauth/*, /.well-known/*) est servi à part, dans serveur.js.
import { decrireDemande, deciderDemande, listerAcces, revoquerAcces } from './oauth.js';

export const routesOAuth = [];
function r(methode, chemin, def, handler) { routesOAuth.push({ methode, chemin, ...def, handler }); }

r('GET', '/api/oauth/demande', { auth: 'public', tag: 'Applications connectées',
  resume: 'Décrire une demande d\'autorisation OAuth (paramètres de /oauth/authorize) : application et hôte de retour.' },
({ query }) => decrireDemande(query.toString()));

r('POST', '/api/oauth/accord', { auth: 'session', tag: 'Applications connectées',
  resume: 'Accepter ou refuser une demande d\'autorisation. Renvoie l\'adresse de retour vers l\'application.',
  corps: {
    parametres: { type: 'string', min: 1, max: 4000, required: true, trim: false, description: 'Paramètres de la demande, tels que reçus par /oauth/authorize.' },
    decision: { type: 'string', enum: ['accepter', 'refuser'], required: true },
  } },
({ ctx, body }) => deciderDemande(ctx, body.parametres, body.decision));

r('GET', '/api/oauth/acces', { auth: 'session', tag: 'Applications connectées', resume: 'Lister les applications qui agissent en mon nom.' },
({ ctx }) => listerAcces(ctx));

r('DELETE', '/api/oauth/acces/:id', { auth: 'session', tag: 'Applications connectées', resume: 'Retirer l\'accès d\'une application : ses jetons sont refusés aussitôt.' },
({ ctx, params }) => revoquerAcces(ctx, params.id));
