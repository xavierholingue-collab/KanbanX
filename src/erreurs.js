export class ErreurHttp extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const introuvable = (m = 'Introuvable') => new ErreurHttp(404, 'introuvable', m);
export const interdit = (m = 'Droits insuffisants') => new ErreurHttp(403, 'interdit', m);
export const invalide = (m, details) => new ErreurHttp(400, 'requete_invalide', m, details);
