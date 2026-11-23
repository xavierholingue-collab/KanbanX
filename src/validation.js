// Validation minimale d'un corps JSON à partir d'un schéma simple, partagé avec la génération OpenAPI.
import { invalide } from './erreurs.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const estUuid = (v) => typeof v === 'string' && UUID.test(v);

function verifierChamp(nom, spec, v) {
  switch (spec.type) {
    case 'string': {
      if (typeof v !== 'string') throw invalide(`« ${nom} » doit être un texte.`);
      const s = spec.trim === false ? v : v.trim();
      if (s.length < (spec.min ?? 0)) throw invalide(`« ${nom} » est trop court.`);
      if (s.length > (spec.max ?? 1000)) throw invalide(`« ${nom} » est trop long (${spec.max ?? 1000} caractères au plus).`);
      if (spec.enum && !spec.enum.includes(s)) throw invalide(`« ${nom} » doit valoir : ${spec.enum.join(', ')}.`);
      if (spec.format === 'email' && !/^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(s)) throw invalide('Adresse courriel invalide.');
      return s;
    }
    case 'integer':
      if (!Number.isInteger(v) || v < (spec.min ?? -1e9) || v > (spec.max ?? 1e9)) throw invalide(`« ${nom} » doit être un entier valide.`);
      return v;
    case 'boolean':
      if (typeof v !== 'boolean') throw invalide(`« ${nom} » doit être vrai ou faux.`);
      return v;
    case 'uuid':
      if (!estUuid(v)) throw invalide(`« ${nom} » doit être un identifiant.`);
      return v;
    case 'date':
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw invalide(`« ${nom} » doit être une date AAAA-MM-JJ.`);
      return v;
    case 'uuids':
      if (!Array.isArray(v) || v.length > (spec.max ?? 100) || !v.every(estUuid)) throw invalide(`« ${nom} » doit être une liste d'identifiants.`);
      return [...new Set(v)];
    default:
      throw new Error(`type inconnu ${spec.type}`);
  }
}

/** Retourne un objet nettoyé : seuls les champs du schéma sont conservés. `null` autorisé si spec.nullable. */
export function valider(schema, corps) {
  if (!schema) return {};
  if (corps === null || typeof corps !== 'object' || Array.isArray(corps)) throw invalide('Corps JSON (objet) attendu.');
  const out = {};
  for (const [nom, spec] of Object.entries(schema)) {
    const v = corps[nom];
    if (v === undefined) {
      if (spec.required) throw invalide(`« ${nom} » est obligatoire.`);
      continue;
    }
    if (v === null && spec.nullable) { out[nom] = null; continue; }
    out[nom] = verifierChamp(nom, spec, v);
  }
  return out;
}

/** Schéma JSON (OpenAPI) équivalent. */
export function versJsonSchema(schema) {
  const properties = {};
  const required = [];
  for (const [nom, spec] of Object.entries(schema)) {
    let p;
    switch (spec.type) {
      case 'string': p = { type: 'string', minLength: spec.min, maxLength: spec.max ?? 1000, enum: spec.enum, format: spec.format }; break;
      case 'integer': p = { type: 'integer', minimum: spec.min, maximum: spec.max }; break;
      case 'boolean': p = { type: 'boolean' }; break;
      case 'uuid': p = { type: 'string', format: 'uuid' }; break;
      case 'date': p = { type: 'string', format: 'date' }; break;
      case 'uuids': p = { type: 'array', items: { type: 'string', format: 'uuid' } }; break;
    }
    if (spec.nullable) p.nullable = true;
    if (spec.description) p.description = spec.description;
    properties[nom] = JSON.parse(JSON.stringify(p));
    if (spec.required) required.push(nom);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}
