// Table des routes de l'API REST. Elle sert aussi à générer le document OpenAPI : une seule source de vérité.
import * as S from './services.js';
import { demanderLien, ouvrirSession, fermerSession } from './auth.js';
import { cookieSession } from './securite.js';
import { config } from './config.js';
import { ErreurHttp } from './erreurs.js';

export const FLUX = Symbol('flux');
const nom = (max = 100) => ({ type: 'string', min: 1, max, required: true });
const COULEURS = ['bleu', 'turquoise', 'vert', 'orange', 'rouge', 'violet', 'ardoise', 'brun'];
const ROLES = ['owner', 'member', 'reader'];

export const routes = [];
function r(methode, chemin, def, handler) { routes.push({ methode, chemin, ...def, handler }); }

// --- Authentification ---
r('POST', '/api/auth/demander', { auth: 'public', tag: 'Authentification', resume: 'Demander un lien magique par courriel (réponse identique que le compte existe ou non).',
  corps: { email: { type: 'string', format: 'email', max: 254, required: true } } },
async ({ body, ip }) => { await demanderLien(body.email, ip); return { ok: true }; });

r('POST', '/api/auth/verifier', { auth: 'public', tag: 'Authentification', resume: 'Échanger le jeton du lien magique contre une session (cookie).',
  corps: { token: { type: 'string', min: 20, max: 200, required: true } } },
async ({ body, ip, entetes }) => {
  const s = await ouvrirSession(body.token, ip);
  if (!s) throw new ErreurHttp(401, 'lien_invalide', 'Ce lien est invalide ou a expiré. Demandez-en un nouveau.');
  entetes['Set-Cookie'] = cookieSession(s.session, config.sessionTtlMs / 1000);
  return { ok: true, csrf: s.csrf };
});

r('POST', '/api/auth/deconnexion', { auth: 'session', tag: 'Authentification', resume: 'Fermer la session.' },
async ({ req, entetes }) => { await fermerSession(req); entetes['Set-Cookie'] = cookieSession('', 0); return { ok: true }; });

r('GET', '/api/me', { auth: 'tout', tag: 'Authentification', resume: 'Utilisateur courant (et jeton CSRF si session).' },
async ({ ctx }) => ({ user: ctx.user, csrf: ctx.csrf ?? null }));

// --- Tableaux ---
r('GET', '/api/boards', { tag: 'Tableaux', resume: 'Lister les tableaux auxquels on est invité.' }, ({ ctx }) => S.listerTableaux(ctx));
r('POST', '/api/boards', { tag: 'Tableaux', resume: 'Créer un tableau (trois colonnes par défaut). Le créateur en est propriétaire.', corps: { name: nom() } }, ({ ctx, body }) => S.creerTableau(ctx, body));
r('GET', '/api/boards/:id', { tag: 'Tableaux', resume: 'Lire un tableau complet : colonnes, cartes, membres, étiquettes.' }, ({ ctx, params }) => S.obtenirTableau(ctx, params.id));
r('PATCH', '/api/boards/:id', { tag: 'Tableaux', resume: 'Renommer un tableau (propriétaire).', corps: { name: nom() } }, ({ ctx, params, body }) => S.renommerTableau(ctx, params.id, body));

// --- Membres ---
r('GET', '/api/boards/:id/members', { tag: 'Membres', resume: 'Lister les membres.' }, ({ ctx, params }) => S.listerMembres(ctx, params.id));
r('POST', '/api/boards/:id/members', { tag: 'Membres', resume: 'Inviter une personne par courriel (propriétaire). Crée le compte nominatif si besoin.',
  corps: { email: { type: 'string', format: 'email', max: 254, required: true }, name: nom(40), role: { type: 'string', enum: ROLES, required: true } } },
({ ctx, params, body }) => S.inviter(ctx, params.id, body));
r('PATCH', '/api/boards/:id/members/:userId', { tag: 'Membres', resume: 'Changer le rôle d\'un membre (propriétaire).', corps: { role: { type: 'string', enum: ROLES, required: true } } },
({ ctx, params, body }) => S.changerRole(ctx, params.id, params.userId, body));
r('DELETE', '/api/boards/:id/members/:userId', { tag: 'Membres', resume: 'Retirer un membre (propriétaire), ou quitter le tableau.' }, ({ ctx, params }) => S.retirerMembre(ctx, params.id, params.userId));

// --- Colonnes ---
r('POST', '/api/boards/:id/columns', { tag: 'Colonnes', resume: 'Créer une colonne, à la fin.', corps: { name: nom() } }, ({ ctx, params, body }) => S.creerColonne(ctx, params.id, body));
r('PATCH', '/api/columns/:id', { tag: 'Colonnes', resume: 'Renommer une colonne ou fixer sa limite d\'en-cours (WIP).',
  corps: { name: nom(), wipLimit: { type: 'integer', min: 1, max: 999, nullable: true } } }, ({ ctx, params, body }) => S.modifierColonne(ctx, params.id, body));
r('POST', '/api/columns/:id/move', { tag: 'Colonnes', resume: 'Réordonner une colonne : nouvel index (0 = première).', corps: { index: { type: 'integer', min: 0, max: 10000, required: true } } },
({ ctx, params, body }) => S.deplacerColonne(ctx, params.id, body));
r('POST', '/api/columns/:id/archive', { tag: 'Colonnes', resume: 'Archiver une colonne (annulable).' }, ({ ctx, params }) => S.archiverColonne(ctx, params.id, true));
r('POST', '/api/columns/:id/restore', { tag: 'Colonnes', resume: 'Restaurer une colonne archivée.' }, ({ ctx, params }) => S.archiverColonne(ctx, params.id, false));

// --- Cartes ---
r('POST', '/api/columns/:id/cards', { tag: 'Cartes', resume: 'Créer une carte à la fin de la colonne.', corps: { title: nom(300) } }, ({ ctx, params, body }) => S.creerCarte(ctx, params.id, body));
r('GET', '/api/cards/:id', { tag: 'Cartes', resume: 'Lire une carte (description Markdown et rendue).' }, ({ ctx, params }) => S.obtenirCarte(ctx, params.id));
r('PATCH', '/api/cards/:id', { tag: 'Cartes', resume: 'Modifier titre, description (Markdown), échéance, responsables, étiquettes.',
  corps: { title: nom(300), description: { type: 'string', max: 20000, trim: false }, dueDate: { type: 'date', nullable: true },
    assignees: { type: 'uuids', description: 'Identifiants des responsables (membres du tableau).' }, labels: { type: 'uuids' } } },
({ ctx, params, body }) => S.modifierCarte(ctx, params.id, body));
r('POST', '/api/cards/:id/move', { tag: 'Cartes', resume: 'Déplacer une carte : colonne cible et index dans cette colonne.',
  corps: { columnId: { type: 'uuid' }, index: { type: 'integer', min: 0, max: 10000, required: true } } }, ({ ctx, params, body }) => S.deplacerCarte(ctx, params.id, body));
r('POST', '/api/cards/:id/archive', { tag: 'Cartes', resume: 'Archiver une carte (annulable).' }, ({ ctx, params }) => S.archiverCarte(ctx, params.id, true));
r('POST', '/api/cards/:id/restore', { tag: 'Cartes', resume: 'Restaurer une carte archivée.' }, ({ ctx, params }) => S.archiverCarte(ctx, params.id, false));

// --- Étiquettes ---
r('POST', '/api/boards/:id/labels', { tag: 'Étiquettes', resume: 'Créer une étiquette de couleur.', corps: { name: { type: 'string', max: 40 }, color: { type: 'string', enum: COULEURS, required: true } } },
({ ctx, params, body }) => S.creerEtiquette(ctx, params.id, body));
r('PATCH', '/api/labels/:id', { tag: 'Étiquettes', resume: 'Modifier une étiquette.', corps: { name: { type: 'string', max: 40 }, color: { type: 'string', enum: COULEURS } } },
({ ctx, params, body }) => S.modifierEtiquette(ctx, params.id, body));
r('DELETE', '/api/labels/:id', { tag: 'Étiquettes', resume: 'Supprimer une étiquette.' }, ({ ctx, params }) => S.supprimerEtiquette(ctx, params.id));

export { COULEURS };
