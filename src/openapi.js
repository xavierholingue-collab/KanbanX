import { versJsonSchema } from './validation.js';

export function genererOpenApi(routes) {
  const paths = {};
  for (const r of routes) {
    const chemin = r.chemin.replace(/:(\w+)/g, '{$1}');
    const params = r.noms.map((n) => ({ name: n, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }));
    const op = {
      tags: [r.tag ?? 'Divers'], summary: r.resume, parameters: [...params, ...(r.query ?? [])],
      ...(r.corps ? { requestBody: { required: true, content: { 'application/json': { schema: versJsonSchema(r.corps) } } } } : {}),
      responses: { 200: { description: 'Succès' }, 400: { description: 'Requête invalide' }, 401: { description: 'Non authentifié' }, 403: { description: 'Droits insuffisants' }, 404: { description: 'Introuvable' }, 429: { description: 'Trop de requêtes' } },
      ...(r.auth === 'public' ? { security: [] } : {}),
    };
    (paths[chemin] ??= {})[r.methode.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'API KanbanX', version: '1.0.0', description: 'API REST de KanbanX. Authentification par jeton personnel : `Authorization: Bearer kbx_…`. Les erreurs ont la forme `{ "erreur": { "code", "message" } }`.' },
    servers: [{ url: '/' }],
    components: { securitySchemes: { jeton: { type: 'http', scheme: 'bearer', description: 'Jeton d\'API personnel (comptes agent comme Claude).' } } },
    security: [{ jeton: [] }],
    paths,
  };
}
