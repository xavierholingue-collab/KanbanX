// Table des routes de l'API REST. Elle sert aussi à générer le document OpenAPI : une seule source de vérité.
import * as S from './services.js';
import { demanderLien, ouvrirSession, fermerSession } from './auth.js';
import { cookieSession } from './securite.js';
import { config } from './config.js';
import { ErreurHttp } from './erreurs.js';
import { importerTrello } from './import-trello.js';
import { lireImage } from './images.js';

export const FLUX = Symbol('flux');
const nom = (max = 100, required = true) => ({ type: 'string', min: 1, max, required });
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

r('GET', '/api/me', { auth: 'tout', tag: 'Authentification', resume: 'Utilisateur courant, ses préférences (et jeton CSRF si session).' },
async ({ ctx }) => ({ user: { ...ctx.user, ...(await S.lirePreferences(ctx)) }, csrf: ctx.csrf ?? null }));

r('PATCH', '/api/me/preferences', { auth: 'session', tag: 'Authentification', resume: 'Changer ses préférences : courriel quand on me mentionne.',
  corps: { mentionEmails: { type: 'boolean', required: true, description: 'Recevoir un courriel (regroupé, au plus un toutes les 10 minutes) quand on me mentionne.' } } },
({ ctx, body }) => S.changerPreferences(ctx, body));

// --- Tableaux ---
r('GET', '/api/boards', { tag: 'Tableaux', resume: 'Lister les tableaux auxquels on est invité.' }, ({ ctx }) => S.listerTableaux(ctx));
r('POST', '/api/boards', { tag: 'Tableaux', resume: 'Créer un tableau (trois colonnes par défaut). Le créateur en est propriétaire.', corps: { name: nom() } }, ({ ctx, body }) => S.creerTableau(ctx, body));
r('POST', '/api/boards/import-trello', { tag: 'Tableaux', resume: 'Importer un tableau depuis un export JSON de Trello (corps : le fichier JSON tel quel, ou { trello, correspondances } pour associer les membres Trello ; 10 Mo au plus).', corpsLibre: true, maxCorps: 10_000_000 },
({ ctx, body }) => importerTrello(ctx, body));
r('GET', '/api/boards/archived', { tag: 'Tableaux', resume: 'Lister mes tableaux archivés (restaurables par leur propriétaire).' }, ({ ctx }) => S.listerTableauxArchives(ctx));
r('GET', '/api/import-trello/personnes', { tag: 'Tableaux', resume: 'Personnes à qui associer les membres d\'un export Trello : celles qui partagent déjà un tableau avec moi.' },
({ ctx }) => S.personnesPourImport(ctx));
r('GET', '/api/boards/:id', { tag: 'Tableaux', resume: 'Lire un tableau complet : colonnes, cartes, membres, étiquettes.' }, ({ ctx, params }) => S.obtenirTableau(ctx, params.id));
r('PATCH', '/api/boards/:id', { tag: 'Tableaux', resume: 'Renommer un tableau (propriétaire).', corps: { name: nom() } }, ({ ctx, params, body }) => S.renommerTableau(ctx, params.id, body));

r('POST', '/api/boards/:id/archive', { tag: 'Tableaux', resume: 'Archiver un tableau entier (propriétaire). Il quitte l\'accueil et ne se modifie plus.' },
({ ctx, params }) => S.archiverTableau(ctx, params.id, true));
r('POST', '/api/boards/:id/restore', { tag: 'Tableaux', resume: 'Restaurer un tableau archivé (propriétaire).' }, ({ ctx, params }) => S.archiverTableau(ctx, params.id, false));
r('GET', '/api/boards/:id/archives', { tag: 'Tableaux', resume: 'Cartes et colonnes archivées d\'un tableau, à restaurer.' }, ({ ctx, params }) => S.archivesDuTableau(ctx, params.id));

// --- Membres ---
r('GET', '/api/boards/:id/members', { tag: 'Membres', resume: 'Lister les membres.' }, ({ ctx, params }) => S.listerMembres(ctx, params.id));
r('POST', '/api/boards/:id/members', { tag: 'Membres', resume: 'Inviter une personne par courriel (propriétaire). Crée le compte nominatif si besoin.',
  corps: { email: { type: 'string', format: 'email', max: 254, required: true }, name: nom(40), role: { type: 'string', enum: ROLES, required: true } } },
({ ctx, params, body }) => S.inviter(ctx, params.id, body));
r('PATCH', '/api/boards/:id/members/:userId', { tag: 'Membres', resume: 'Changer le rôle d\'un membre (propriétaire).', corps: { role: { type: 'string', enum: ROLES, required: true } } },
({ ctx, params, body }) => S.changerRole(ctx, params.id, params.userId, body));
r('DELETE', '/api/boards/:id/members/:userId', { tag: 'Membres', resume: 'Retirer un membre (propriétaire), ou quitter le tableau.' }, ({ ctx, params }) => S.retirerMembre(ctx, params.id, params.userId));

// --- Colonnes ---
r('POST', '/api/boards/:id/columns', { tag: 'Colonnes', resume: 'Créer une colonne, à la fin ou à un index donné (0 = première).',
  corps: { name: nom(), index: { type: 'integer', min: 0, max: 1000 } } }, ({ ctx, params, body }) => S.creerColonne(ctx, params.id, body));
r('PATCH', '/api/columns/:id', { tag: 'Colonnes', resume: 'Renommer une colonne ou fixer sa limite d\'en-cours (WIP).',
  corps: { name: nom(100, false), wipLimit: { type: 'integer', min: 1, max: 999, nullable: true } } }, ({ ctx, params, body }) => S.modifierColonne(ctx, params.id, body));
r('POST', '/api/columns/:id/move', { tag: 'Colonnes', resume: 'Réordonner une colonne : nouvel index (0 = première).', corps: { index: { type: 'integer', min: 0, max: 10000, required: true } } },
({ ctx, params, body }) => S.deplacerColonne(ctx, params.id, body));
r('POST', '/api/columns/:id/archive', { tag: 'Colonnes', resume: 'Archiver une colonne (annulable).' }, ({ ctx, params }) => S.archiverColonne(ctx, params.id, true));
r('POST', '/api/columns/:id/restore', { tag: 'Colonnes', resume: 'Restaurer une colonne archivée.' }, ({ ctx, params }) => S.archiverColonne(ctx, params.id, false));

// --- Cartes ---
r('POST', '/api/columns/:id/cards', { tag: 'Cartes', resume: 'Créer une carte à la fin de la colonne.', corps: { title: nom(300) } }, ({ ctx, params, body }) => S.creerCarte(ctx, params.id, body));
r('GET', '/api/cards/:id', { tag: 'Cartes', resume: 'Lire une carte (description Markdown et rendue).' }, ({ ctx, params }) => S.obtenirCarte(ctx, params.id));
r('PATCH', '/api/cards/:id', { tag: 'Cartes', resume: 'Modifier titre, description (Markdown), échéance, responsables, étiquettes.',
  corps: { title: nom(300, false), description: { type: 'string', max: 20000, trim: false }, dueDate: { type: 'date', nullable: true },
    assignees: { type: 'uuids', description: 'Identifiants des responsables (membres du tableau).' }, labels: { type: 'uuids' } } },
({ ctx, params, body }) => S.modifierCarte(ctx, params.id, body));
r('POST', '/api/cards/:id/move', { tag: 'Cartes', resume: 'Déplacer une carte : colonne cible et index dans cette colonne.',
  corps: { columnId: { type: 'uuid' }, index: { type: 'integer', min: 0, max: 10000, required: true } } }, ({ ctx, params, body }) => S.deplacerCarte(ctx, params.id, body));
r('POST', '/api/cards/:id/archive', { tag: 'Cartes', resume: 'Archiver une carte (annulable).' }, ({ ctx, params }) => S.archiverCarte(ctx, params.id, true));
r('POST', '/api/cards/:id/restore', { tag: 'Cartes', resume: 'Restaurer une carte archivée.' }, ({ ctx, params }) => S.archiverCarte(ctx, params.id, false));

// --- Images (rapatriées de Trello) ---
// Type fixé par le serveur (signature vérifiée à l'enregistrement), jamais deviné par le navigateur ; affichée en
// ligne, dans un bac à sable sans aucun droit (CSP sandbox) si on l'ouvre seule.
r('GET', '/api/images/:id', { tag: 'Cartes', resume: 'Lire une image d\'un tableau (PNG, JPEG, GIF ou WebP), avec les droits de la personne.' },
async ({ ctx, params, res }) => {
  const img = await lireImage(ctx, params.id);
  res.writeHead(200, {
    'Content-Type': img.mime, 'Content-Length': String(img.contenu.length), 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'private, max-age=86400',
  });
  res.end(img.contenu);
  return FLUX;
});

// --- Étiquettes ---
r('POST', '/api/boards/:id/labels', { tag: 'Étiquettes', resume: 'Créer une étiquette de couleur.', corps: { name: { type: 'string', max: 40 }, color: { type: 'string', enum: COULEURS, required: true } } },
({ ctx, params, body }) => S.creerEtiquette(ctx, params.id, body));
r('PATCH', '/api/labels/:id', { tag: 'Étiquettes', resume: 'Modifier une étiquette.', corps: { name: { type: 'string', max: 40 }, color: { type: 'string', enum: COULEURS } } },
({ ctx, params, body }) => S.modifierEtiquette(ctx, params.id, body));
r('DELETE', '/api/labels/:id', { tag: 'Étiquettes', resume: 'Supprimer une étiquette.' }, ({ ctx, params }) => S.supprimerEtiquette(ctx, params.id));

export { COULEURS };
