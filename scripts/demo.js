// Données de démonstration : comptes fictifs (adresses en .invalid, jamais réelles) et un tableau d'exemple.
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { creerJeton } from './jeton.js';

export async function demo(adminUrl) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    if ((await c.query('select 1 from users limit 1')).rowCount) return false;
    await c.query('begin');
    const u = {};
    for (const [cle, nom, kind] of [['xavier', 'Xavier', 'human'], ['eric', 'Eric', 'human'], ['alexis', 'Alexis', 'human'], ['claude', 'Claude', 'agent']]) {
      u[cle] = (await c.query('insert into users (email, name, kind) values ($1, $2, $3) returning id', [`${cle}@kanbanx.invalid`, nom, kind])).rows[0].id;
    }
    const b = (await c.query('insert into boards (name, created_by) values ($1, $2) returning id', ['Lancement de KanbanX', u.xavier])).rows[0].id;
    await c.query("insert into board_members (board_id, user_id, role) values ($1,$2,'owner'),($1,$3,'member'),($1,$4,'member'),($1,$5,'member')", [b, u.xavier, u.eric, u.alexis, u.claude]);
    const col = {};
    for (const [i, n] of ['À faire', 'En cours', 'Fait'].entries()) {
      col[n] = (await c.query('insert into columns (board_id, name, position, wip_limit) values ($1,$2,$3,$4) returning id', [b, n, (i + 1) * 1024, n === 'En cours' ? 3 : null])).rows[0].id;
    }
    const lab = {};
    for (const [n, color] of [['Urgent', 'rouge'], ['Design', 'violet'], ['Technique', 'bleu'], ['Documentation', 'turquoise']]) {
      lab[n] = (await c.query('insert into labels (board_id, name, color) values ($1,$2,$3) returning id', [b, n, color])).rows[0].id;
    }
    const carte = async (colonne, pos, titre, desc, resp, etiq, echeance) => {
      const id = (await c.query('insert into cards (board_id, column_id, title, description, position, created_by, due_date) values ($1,$2,$3,$4,$5,$6,$7) returning id',
        [b, col[colonne], titre, desc, pos * 1024, u.xavier, echeance])).rows[0].id;
      for (const r of resp) await c.query('insert into card_assignees (card_id, user_id, board_id) values ($1,$2,$3)', [id, u[r], b]);
      for (const l of etiq) await c.query('insert into card_labels (card_id, label_id, board_id) values ($1,$2,$3)', [id, lab[l], b]);
      return id;
    };
    const jours = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const c1 = await carte('À faire', 1, 'Choisir la palette de couleurs', 'Dominante **bleue**, touches d\'orange.\n\n- Contrastes AA\n- Mode sombre si le temps le permet', ['alexis'], ['Design'], jours(5));
    await carte('À faire', 2, 'Écrire le guide de démarrage', 'Un court guide pour les nouvelles personnes invitées.', [], ['Documentation'], null);
    const c3 = await carte('En cours', 1, 'Brancher Claude au serveur MCP', 'Exposer les outils : lister, lire, créer, déplacer, commenter.', ['eric', 'claude'], ['Technique', 'Urgent'], jours(-1));
    await carte('En cours', 2, 'Glisser-déposer au clavier', 'Espace pour saisir, flèches pour déplacer, Espace pour déposer.', ['eric'], ['Technique'], jours(2));
    await carte('Fait', 1, 'Cahier des charges v1', 'Validé par toute l\'équipe.', ['xavier'], [], null);
    const com = async (carteId, auteur, corps, mentions) => {
      await c.query('insert into comments (board_id, card_id, author_id, body, mentions) values ($1,$2,$3,$4,$5)', [b, carteId, u[auteur], corps, mentions.map((m) => u[m])]);
      await c.query("insert into activity (board_id, card_id, actor_id, via, action, data) values ($1,$2,$3,$4,'commentaire.ajoute','{}')", [b, carteId, u[auteur], auteur === 'claude' ? 'mcp' : 'web']);
    };
    await com(c3, 'xavier', 'Salut @Eric, tu peux regarder l\'authentification par jeton ? @Claude, dis-nous où tu en es.', ['eric', 'claude']);
    await com(c3, 'claude', 'Bonjour @Xavier ! Le transport Streamable HTTP répond, il reste à tester la lecture des mentions.', ['xavier']);
    await com(c1, 'alexis', 'Je propose `#0b5cad` pour le bleu principal.', []);
    await c.query('commit');
    const jeton = await creerJeton(c, 'claude@kanbanx.invalid', 'jeton de démonstration');
    console.log(`\nDonnées de démonstration créées : xavier / eric / alexis / claude @kanbanx.invalid\nJeton d'API de Claude (affiché une seule fois) :\n  ${jeton}\n`);
    return true;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { config } = await import('../src/config.js');
  console.log((await demo(config.adminUrl)) ? '' : 'Des données existent déjà : rien à faire.');
}
