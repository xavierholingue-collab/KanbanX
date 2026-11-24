// Import d'un tableau depuis un export JSON de Trello (menu « Imprimer, exporter et partager » → JSON).
// Repris : listes et cartes ouvertes (dans l'ordre), descriptions, échéances, étiquettes, commentaires.
// Membres Trello : la personne qui importe peut associer chacun à une personne qui partage déjà un tableau avec
// elle (nuit 2, point 8). Le commentaire affiche alors ce nom, « importé de Trello », mais reste sa propriété.
// Non repris : pièces jointes, listes de contrôle.
import { agir, journal } from './services.js';
import { invalide } from './erreurs.js';
import { estUuid } from './validation.js';
import { telechargerImage, reglages } from './telechargement.js';
import { enregistrerImage } from './images.js';

const EXT_IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const estImage = (pj) => pj && typeof pj.url === 'string' && pj.isUpload !== false
  && ((typeof pj.mimeType === 'string' && pj.mimeType.startsWith('image/')) || EXT_IMAGE.test(pj.name ?? '') || EXT_IMAGE.test(new URL(pj.url, 'https://x').pathname));
const nomImage = (pj) => (typeof pj.name === 'string' ? pj.name : 'image').replace(/[[\]\r\n()]/g, ' ').trim().slice(0, 80) || 'image';

/**
 * Télécharge les images jointes aux cartes, avant la transaction (pas de transaction ouverte pendant le réseau).
 * La clé et le jeton servent à cette seule requête : ils ne sont ni stockés, ni journalisés, ni renvoyés.
 * Renvoie Map(url → contenu) des images obtenues ; les autres resteront des liens.
 */
async function rapatrier(cartes, auth) {
  const obtenues = new Map();
  if (!auth) return obtenues;
  const entetes = { Authorization: `OAuth oauth_consumer_key="${auth.cle}", oauth_token="${auth.jeton}"` };
  const urls = [...new Set(cartes.flatMap((k) => (Array.isArray(k?.attachments) ? k.attachments : []).filter(estImage).map((pj) => pj.url)))]
    .slice(0, reglages.maxImages);
  const fin = Date.now() + reglages.delaiTotalMs;
  let total = 0; let i = 0;
  const ouvrier = async () => {
    while (i < urls.length && Date.now() < fin && total < reglages.maxTotalOctets) {
      const u = urls[i++];
      try {
        const corps = await telechargerImage(u, { entetes });
        total += corps.length;
        if (total <= reglages.maxTotalOctets) obtenues.set(u, corps);
      } catch { /* l'image reste un lien ; rien n'est journalisé (l'adresse peut identifier la personne) */ }
    }
  };
  await Promise.all(Array.from({ length: 4 }, ouvrier));
  return obtenues;
}

const COULEURS = { green: 'vert', yellow: 'orange', orange: 'orange', red: 'rouge', purple: 'violet', blue: 'bleu', sky: 'turquoise', lime: 'vert', pink: 'violet', black: 'ardoise' };
const couleur = (c) => COULEURS[String(c ?? '').replace(/_(dark|light)$/, '')] ?? 'ardoise';
const texte = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);
const tableau = (v) => (Array.isArray(v) ? v : null);

/**
 * Corps accepté : l'export Trello tel quel, ou { trello: <export>, correspondances: { idMembreTrello: idPersonne },
 * trelloAuth: { cle, jeton } } (clé et jeton d'API Trello de la personne, pour rapatrier les images).
 */
export async function importerTrello(ctx, corps) {
  const enveloppe = corps && typeof corps === 'object' && !Array.isArray(corps) && 'trello' in corps;
  const data = enveloppe ? corps.trello : corps;
  const a = enveloppe ? corps.trelloAuth : null;
  const auth = a?.cle || a?.jeton ? a : null;
  if (auth && !(typeof auth.cle === 'string' && typeof auth.jeton === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(auth.cle) && /^[A-Za-z0-9_-]{8,512}$/.test(auth.jeton))) {
    throw invalide('Clé ou jeton Trello invalide.');
  }
  const correspondances = enveloppe ? (corps.correspondances ?? {}) : {};
  if (!correspondances || typeof correspondances !== 'object' || Array.isArray(correspondances)) throw invalide('« correspondances » doit être un objet.');
  const paires = Object.entries(correspondances).filter(([, v]) => v !== null && v !== '');
  if (paires.length > 500) throw invalide('Trop de correspondances.');
  for (const [, v] of paires) if (typeof v !== 'string' || !estUuid(v)) throw invalide('Correspondance invalide : identifiant de personne attendu.');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalide('Export Trello invalide.');
  const listes = tableau(data.lists); const cartes = tableau(data.cards);
  if (!listes || !cartes) throw invalide('Export Trello invalide : « lists » et « cards » sont attendus.');
  const nom = texte(data.name, 100).trim() || 'Tableau importé de Trello';
  const etiquettes = tableau(data.labels) ?? [];
  const actions = tableau(data.actions) ?? [];
  if (listes.length > 500 || cartes.length > 10000 || etiquettes.length > 500) throw invalide('Export trop volumineux.');

  const images = await rapatrier(cartes.filter((k) => k && !k.closed), auth);
  let nbImages = 0;
  return agir(ctx, async (c) => {
    // Seules les personnes qui partagent déjà un tableau sont visibles (RLS sur users) : jamais tous les comptes.
    const personnes = new Map();
    if (paires.length) {
      const { rows } = await c.query("select id, name from users where id = any($1::uuid[]) and kind = 'human' and kx_shares_board(id)", [paires.map(([, v]) => v)]);
      for (const r of rows) personnes.set(r.id, r.name);
      if (paires.some(([, v]) => !personnes.has(v))) throw invalide('Une personne associée ne partage aucun tableau avec vous : choisissez parmi les personnes proposées.');
    }
    const associee = new Map(paires.map(([k, v]) => [k, { id: v, name: personnes.get(v) }]));
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
        // Images jointes : rapatriées dans KanbanX, sinon laissées en lien avec un encart clair.
        let desc = typeof k.desc === 'string' ? k.desc : '';
        const ajouts = [];
        for (const pj of (Array.isArray(k.attachments) ? k.attachments : []).filter(estImage)) {
          const contenu = images.get(pj.url);
          const idImage = contenu ? await enregistrerImage(c, ctx, id, contenu) : null;
          if (idImage) {
            nbImages++;
            const local = `/api/images/${idImage}`;
            if (desc.includes(pj.url)) desc = desc.replaceAll(pj.url, local);
            else ajouts.push(`![${nomImage(pj)}](${local})`);
          } else {
            ajouts.push(`> Image restée sur Trello : [${nomImage(pj)}](${pj.url}) (elle ne s'affiche qu'avec un compte Trello)`);
          }
        }
        if (ajouts.length) desc = `${desc}${desc ? '\n\n' : ''}${ajouts.join('\n\n')}`;
        const r = (await c.query('insert into cards (board_id, column_id, title, description, position, created_by, due_date) values ($1, $2, $3, $4, $5, $6, $7) returning id',
          [id, colonnes.get(liste), texte(k.name, 300).trim() || 'Sans titre', desc.slice(0, 20000), (i + 1) * 1024, ctx.user.id, echeance])).rows[0];
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
      // Date d'origine : sinon tous les commentaires d'un import auraient la même heure (celle de la transaction)
      // et leur ordre dans le fil serait aléatoire.
      const quand = /^\d{4}-\d{2}-\d{2}T/.test(a.date ?? '') && !Number.isNaN(Date.parse(a.date)) ? new Date(a.date) : new Date();
      const p = associee.get(a.idMemberCreator ?? a.memberCreator?.id);
      if (p) {
        const date = quand;
        await c.query(`insert into comments (board_id, card_id, author_id, body, created_at, imported_from, imported_author_id, imported_author_name)
          values ($1, $2, $3, $4, $5, 'trello', $6, $7)`, [id, idsCartes.get(a.data.card.id), ctx.user.id, texte(a.data.text, 10000) || '(vide)', date, p.id, p.name]);
        continue;
      }
      const auteur = texte(a.memberCreator?.fullName, 80) || 'inconnu';
      const date = /^\d{4}-\d{2}-\d{2}/.test(a.date ?? '') ? new Date(a.date).toLocaleDateString('fr-FR') : '';
      const corps = `*${auteur} sur Trello${date ? `, le ${date}` : ''} :*\n\n${texte(a.data.text, 9800)}`;
      await c.query('insert into comments (board_id, card_id, author_id, body, created_at) values ($1, $2, $3, $4, $5)', [id, idsCartes.get(a.data.card.id), ctx.user.id, corps, quand]);
    }
    await journal(c, ctx, id, null, 'tableau.importe', { name: nom, cartes: n, commentaires: comms.length, images: nbImages });
    return { id, name: nom, cartes: n, colonnes: colonnes.size, commentaires: comms.length, images: nbImages };
  });
}
