import { config } from './config.js';
import { creerServeur } from './serveur.js';
import { migrer } from '../scripts/migrer.js';
import { demo } from '../scripts/demo.js';

if (config.env !== 'test') {
  try { await migrer(config.adminUrl, config.appPassword); }
  catch (e) { console.error(`Base de données inaccessible (${e.message}).\nLancez « docker compose up -d » puis réessayez.`); process.exit(1); }
  if (config.seedDemo) await demo(config.adminUrl);
}
const s = creerServeur();
s.listen(config.port, '0.0.0.0', () => console.log(`KanbanX écoute sur ${config.baseUrl} (port ${config.port})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { s.close(); s.closeAllConnections(); process.exit(0); });
