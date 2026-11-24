// Courriels de mentions (nuit 2, point 6). File en base (mention_emails), boucle en mémoire : un seul processus.
// La requête qui mentionne ne fait qu'ajouter une ligne à la file ; l'envoi a lieu ici, plus tard.
import { pool } from './db.js';
import { config } from './config.js';
import { envoyerMentions } from './courriel.js';

export const INTERVALLE_MIN = 10; // au plus un courriel toutes les 10 minutes par personne
const MAX_PAR_TOUR = 50;

/** Texte réduit à une ligne et à `max` caractères (sans caractères de contrôle). */
export function couper(texte, max) {
  const s = String(texte).replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Met en file les mentions nouvelles de personnes (jamais soi-même, jamais un agent ; « @Claude » n'est pas une personne).
 * Appelée dans la transaction de la requête qui mentionne ; `destinataires` : identifiants de membres du tableau.
 */
export async function mettreEnFile(c, ctx, { boardId, cardId, lieu, texte, destinataires, membres }) {
  const humains = new Set(membres.filter((m) => m.kind === 'human').map((m) => m.id));
  const extrait = couper(texte, 200);
  for (const u of new Set(destinataires)) {
    if (u === ctx.user.id || !humains.has(u)) continue;
    await c.query('insert into mention_emails (user_id, board_id, card_id, author_id, client_name, lieu, extrait) values ($1, $2, $3, $4, $5, $6, $7)',
      [u, boardId, cardId, ctx.user.id, ctx.application ?? null, lieu, extrait]);
  }
}

const LIEU = { titre: 'le titre de la carte', description: 'la description de la carte', commentaire: 'un commentaire de la carte' };

/** Contenu du courriel : qui, sur quel tableau, quelle carte, un extrait court et le lien. Rien d'autre. */
export function rediger(mentions) {
  const n = mentions.length;
  const sujet = n === 1 ? 'KanbanX : une nouvelle mention' : `KanbanX : ${n} nouvelles mentions`;
  const blocs = mentions.map((m) => {
    const qui = couper(m.client ? `${m.client} pour ${m.auteur}` : m.auteur, 80);
    return [`${qui} vous a mentionné dans ${LIEU[m.lieu]} « ${couper(m.carte, 120)} »,`,
      `tableau « ${couper(m.tableau, 100)} » :`,
      `« ${m.extrait} »`,
      `${config.baseUrl}/b/${m.tableauId}/c/${m.carteId}`].join('\n');
  });
  const texte = `Bonjour,\n\n${blocs.join('\n\n')}\n\n--\nNe plus recevoir ces courriels : ${config.baseUrl}/compte\n`;
  return { sujet, texte };
}

let enCours = false;
/** Un tour de la boucle : envoie ce qui peut l'être. Un échec est noté et réessayé plus tard ; jamais d'exception. */
export async function traiterFileMentions() {
  if (enCours) return;
  enCours = true;
  try {
    const { rows } = await pool.query('select * from kx_courriels_a_envoyer($1::interval, $2)', [`${INTERVALLE_MIN} minutes`, MAX_PAR_TOUR]);
    for (const r of rows) {
      try {
        await envoyerMentions({ a: r.email, ...rediger(r.mentions) });
        await pool.query('select kx_courriels_envoyes($1)', [r.ids]);
      } catch (e) {
        // Ni l'adresse ni le contenu dans le journal.
        console.error(`Courriel de mentions non envoyé (${e.message}) : nouvel essai plus tard.`);
        await pool.query('select kx_courriels_echec($1)', [r.ids]).catch(() => {});
      }
    }
  } catch (e) {
    console.error(`File des courriels de mentions inaccessible : ${e.message}`);
  } finally { enCours = false; }
}

/** Lance la boucle (toutes les 30 secondes par défaut). Renvoie une fonction d'arrêt. */
export function demarrerBoucleMentions(periodeMs = 30_000) {
  const t = setInterval(traiterFileMentions, periodeMs);
  t.unref();
  setTimeout(traiterFileMentions, 1000).unref(); // au démarrage : ce qui attendait avant la relance
  return () => clearInterval(t);
}
