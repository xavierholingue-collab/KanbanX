// Import d'un tableau depuis un export JSON de Trello (menu « Imprimer, exporter et partager » → JSON).
// Repris : listes et cartes ouvertes (dans l'ordre), descriptions, échéances, étiquettes, commentaires.
// Non repris : membres Trello (aucune correspondance fiable avec les comptes), pièces jointes, listes de contrôle.
import { agir, journal } from './services.js';
import { invalide } from './erreurs.js';

const COULEURS = { green: 'vert', yellow: 'orange', orange: 'orange', red: 'rouge', purple: 'violet', blue: 'bleu', sky: 'turquoise', lime: 'vert', pink: 'violet', black: 'ardoise' };
const couleur = (c) => COULEURS[String(c ?? '').replace(/_(dark|light)$/, '')] ?? 'ardoise';
const texte = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);
const tableau = (v) => (Array.isArray(v) ? v : null);

export async function importerTrello(ctx, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalide('Export Trello invalide.');
  const listes = tableau(data.lists); const cartes = tableau(data.cards);
  if (!listes || !cartes) throw invalide('Export Trello invalide : « lists » et « cards » sont attendus.');
  const nom = texte(data.name, 100).trim() || 'Tableau importé de Trello';
  const etiquettes = tableau(data.labels) ?? [];
  const actions = tableau(data.actions) ?? [];
  if (listes.length > 500 || cartes.length > 10000 || etiquettes.length > 500) throw invalide('Export trop volumineux.');

  return agir(ctx, async (c) => {
    const id = (await c.query('select kx_creer_tableau($1) as id', [nom])).rows[0].id;
    const colonnes = new Map();
    const ouvertes = listes.filter((l) => l && !l.closed).sort((a, b) => (Number(a.pos) || 0) - (Number(b.pos) || 0));
    for (const [i, l] of ouvertes.entries()) {
      const k = (await c.query('insert into columns (board_id, name, position) values ($1, $2, $3) returning id', [id, texte(l.name, 100).trim() || 'Sans titre', (i + 1) * 1024])).rows[0];
      colonnes.set(l.id, k.id);
    }
    const etiq = new Map();
    for (const l of etiquettes) {
      if (!l?.id) continue;
      const r = (await c.query('insert into labels (board_id, name, color) values ($1, $2, $3) returning id', [id, texte(l.name, 40), couleur(l.color)])).rows[0];
      etiq.set(l.id, r.id);
    }
    const idsCartes = new Map();
    const parListe = new Map();
    for (const k of cartes) {
      if (!k || k.closed || !colonnes.has(k.idList)) continue;
      if (!parListe.has(k.idList)) parListe.set(k.idList, []);
      parListe.get(k.idList).push(k);
    }
    let n = 0;
    for (const [liste, lot] of parListe) {
      lot.sort((a, b) => (Number(a.pos) || 0) - (Number(b.pos) || 0));
      for (const [i, k] of lot.entries()) {
        const echeance = typeof k.due === 'string' && /^\d{4}-\d{2}-\d{2}/.test(k.due) ? k.due.slice(0, 10) : null;
        const r = (await c.query('insert into cards (board_id, column_id, title, description, position, created_by, due_date) values ($1, $2, $3, $4, $5, $6, $7) returning id',
          [id, colonnes.get(liste), texte(k.name, 300).trim() || 'Sans titre', texte(k.desc, 20000), (i + 1) * 1024, ctx.user.id, echeance])).rows[0];
        idsCartes.set(k.id, r.id);
        for (const l of new Set(tableau(k.idLabels) ?? [])) {
          if (etiq.has(l)) await c.query('insert into card_labels (card_id, label_id, board_id) values ($1, $2, $3)', [r.id, etiq.get(l), id]);
        }
        n++;
      }
    }
    // Les commentaires Trello sont repris au nom de la personne qui importe, avec l'auteur et la date d'origine.
    const comms = actions.filter((a) => a?.type === 'commentCard' && idsCartes.has(a.data?.card?.id) && typeof a.data?.text === 'string')
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const a of comms) {
      const auteur = texte(a.memberCreator?.fullName, 80) || 'inconnu';
      const date = /^\d{4}-\d{2}-\d{2}/.test(a.date ?? '') ? new Date(a.date).toLocaleDateString('fr-FR') : '';
      const corps = `*${auteur} sur Trello${date ? `, le ${date}` : ''} :*\n\n${texte(a.data.text, 9800)}`;
      await c.query('insert into comments (board_id, card_id, author_id, body) values ($1, $2, $3, $4)', [id, idsCartes.get(a.data.card.id), ctx.user.id, corps]);
    }
    await journal(c, ctx, id, null, 'tableau.importe', { name: nom, cartes: n, commentaires: comms.length });
    return { id, name: nom, cartes: n, colonnes: colonnes.size, commentaires: comms.length };
  });
}
