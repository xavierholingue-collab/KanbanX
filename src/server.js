import { config } from './config.js';
import { creerServeur } from './serveur.js';
import { pool } from './db.js';
import { verifierConfigProduction, verifierRoleApplicatif } from './demarrage.js';
import { demarrerBoucleMentions } from './notifications.js';

function refuser(problemes) {
  console.error(`Démarrage refusé :\n- ${problemes.join('\n- ')}`);
  process.exit(1);
}

if (config.env === 'production') {
  // En production, le serveur ne détient jamais les identifiants administrateur de la base :
  // les migrations sont une étape séparée du déploiement (npm run db:migrer).
  const pb = verifierConfigProduction(process.env);
  if (pb.length) refuser(pb);
  let pbRole;
  try { pbRole = await verifierRoleApplicatif(pool); } catch (e) { refuser([`Base de données inaccessible (${e.message}).`]); }
  if (pbRole.length) refuser(pbRole);
  if (!config.trustProxy) console.warn('Attention : TRUST_PROXY n\'est pas activé. Derrière un proxy inverse, toutes les requêtes sembleraient venir de la même adresse.');
} else if (config.env !== 'test') {
  // En développement : migrations et données de démonstration au démarrage, pour la simplicité.
  const { migrer } = await import('../scripts/migrer.js');
  const { demo } = await import('../scripts/demo.js');
  try { await migrer(config.adminUrl, config.appPassword); }
  catch (e) { console.error(`Base de données inaccessible (${e.message}).\nLancez « docker compose up -d » puis réessayez.`); process.exit(1); }
  if (config.seedDemo) await demo(config.adminUrl);
}

const s = creerServeur();
demarrerBoucleMentions(); // courriels de mentions : file en base, envoi en arrière-plan
s.listen(config.port, config.host, () => console.log(`KanbanX écoute sur ${config.host}:${config.port} (adresse publique : ${config.baseUrl})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { s.close(); s.closeAllConnections(); process.exit(0); });
