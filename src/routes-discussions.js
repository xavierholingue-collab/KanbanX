// Routes P2 : commentaires, activité, flux en direct.
import * as D from './services-discussions.js';
import { agir, roleSur } from './services.js';
import { abonner, nbFluxUtilisateur, MAX_FLUX_PAR_UTILISATEUR } from './evenements.js';
import { FLUX } from './routes.js';
import { estUuid } from './validation.js';
import { invalide, ErreurHttp } from './erreurs.js';

export const routesDiscussions = [];
function r(methode, chemin, def, handler) { routesDiscussions.push({ methode, chemin, ...def, handler }); }
const corps = { body: { type: 'string', min: 1, max: 10000, required: true, trim: false, description: 'Markdown. Les mentions @prénom citent les membres du tableau.' } };
const limite = (q) => Math.min(Math.max(Number.parseInt(q.get('limit') ?? '50', 10) || 50, 1), 200);
const QLIM = [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } }];

r('GET', '/api/cards/:id/comments', { tag: 'Discussions', resume: 'Fil de commentaires d\'une carte (Markdown source et HTML nettoyé).' }, ({ ctx, params }) => D.listerCommentaires(ctx, params.id));
r('POST', '/api/cards/:id/comments', { tag: 'Discussions', resume: 'Commenter une carte (mentions @prénom).', corps }, ({ ctx, params, body }) => D.ajouterCommentaire(ctx, params.id, body));
r('PATCH', '/api/comments/:id', { tag: 'Discussions', resume: 'Modifier son commentaire.', corps }, ({ ctx, params, body }) => D.modifierCommentaire(ctx, params.id, body));
r('DELETE', '/api/comments/:id', { tag: 'Discussions', resume: 'Supprimer son commentaire (annulable).' }, ({ ctx, params }) => D.supprimerCommentaire(ctx, params.id, true));
r('POST', '/api/comments/:id/restore', { tag: 'Discussions', resume: 'Restaurer son commentaire supprimé.' }, ({ ctx, params }) => D.supprimerCommentaire(ctx, params.id, false));
r('GET', '/api/cards/:id/activity', { tag: 'Activité', resume: 'Historique d\'une carte : qui a fait quoi, et quand.', query: QLIM }, ({ ctx, params, query }) => D.activiteCarte(ctx, params.id, limite(query)));
r('GET', '/api/boards/:id/activity', { tag: 'Activité', resume: 'Historique d\'un tableau (le plus récent d\'abord).',
  query: [...QLIM, { name: 'before', in: 'query', schema: { type: 'integer' }, description: 'Pagination : identifiants inférieurs à cette valeur.' }] },
({ ctx, params, query }) => D.activiteTableau(ctx, params.id, limite(query), /^\d+$/.test(query.get('before') ?? '') ? query.get('before') : null));

r('GET', '/api/mentions', { tag: 'Discussions', resume: 'Commentaires qui me mentionnent, dans mes tableaux (le plus récent d\'abord).', query: QLIM },
({ ctx, query }) => D.mentionsDe(ctx, limite(query)));
r('GET', '/api/comments/recent', { tag: 'Discussions', resume: 'Commentaires récents de mes tableaux (ou d\'un tableau : ?boardId=).',
  query: [...QLIM, { name: 'boardId', in: 'query', schema: { type: 'string', format: 'uuid' } }] },
({ ctx, query }) => {
  const b = query.get('boardId');
  if (b && !estUuid(b)) throw invalide('Identifiant « boardId » invalide.');
  return D.commentairesRecents(ctx, { boardId: b || null, limite: limite(query) });
});

r('GET', '/api/boards/:id/events', { tag: 'Direct', resume: 'Flux Server-Sent Events des changements du tableau (événement « maj » : {kind, id, cardId, par}).' },
async ({ ctx, params, req, res }) => {
  await agir(ctx, (c) => roleSur(c, params.id));
  if (nbFluxUtilisateur(ctx.user.id) >= MAX_FLUX_PAR_UTILISATEUR) {
    throw new ErreurHttp(429, 'trop_de_flux', 'Trop de flux en direct ouverts. Fermez des onglets et réessayez.', { reessayerDansS: 30 });
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n: connecté\n\n');
  const desabonner = abonner(params.id, res, ctx.user.id);
  const battement = setInterval(() => res.write(': battement\n\n'), 25_000);
  const fin = () => { clearInterval(battement); desabonner(); };
  req.on('close', fin);
  res.on('close', fin);
  return FLUX;
});
