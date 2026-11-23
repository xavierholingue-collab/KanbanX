// Vérifications au démarrage en production : le serveur refuse de démarrer plutôt que de tourner mal configuré.

/** Valeurs de développement de .env.exemple et de docker-compose.yml : jamais acceptées en production. */
export const VALEURS_DEV = ['kanbanx_app_dev', 'kanbanx_dev'];

/** @param {Record<string, string|undefined>} env  @returns {string[]} les problèmes trouvés (vide si tout va bien) */
export function verifierConfigProduction(env) {
  const pb = [];
  if (!env.DATABASE_URL) pb.push('DATABASE_URL est obligatoire (connexion avec le rôle applicatif kanbanx_app).');
  else if (VALEURS_DEV.some((v) => env.DATABASE_URL.includes(v))) pb.push('DATABASE_URL utilise un mot de passe de développement.');
  if (env.DATABASE_ADMIN_URL) pb.push('DATABASE_ADMIN_URL ne doit pas être fourni au serveur : les migrations se lancent à part (npm run db:migrer).');
  if (env.KANBANX_APP_PASSWORD) pb.push('KANBANX_APP_PASSWORD ne doit pas être fourni au serveur : il ne sert qu\'aux migrations.');
  if (!env.BASE_URL) pb.push('BASE_URL est obligatoire (adresse publique, en https://).');
  else if (!env.BASE_URL.startsWith('https://')) pb.push('BASE_URL doit être une adresse https://.');
  if (!env.SMTP_URL) pb.push('SMTP_URL est obligatoire (envoi des liens de connexion).');
  else {
    let u = null;
    try { u = new URL(env.SMTP_URL); } catch { /* traité ci-dessous */ }
    if (!u || !['smtp:', 'smtps:'].includes(u.protocol)) pb.push('SMTP_URL doit commencer par smtp:// (STARTTLS exigé) ou smtps://.');
    else if (u.searchParams.get('tls') === 'non') pb.push('SMTP_URL ne peut pas désactiver TLS en production.');
  }
  if (env.SEED_DEMO === '1') pb.push('SEED_DEMO doit être désactivé en production (comptes de démonstration).');
  return pb;
}

/** Le rôle de connexion doit être soumis aux politiques RLS. @returns {Promise<string[]>} */
export async function verifierRoleApplicatif(pool) {
  const { rows } = await pool.query(`select r.rolsuper, r.rolbypassrls,
      (select count(*)::int from pg_tables where schemaname = 'public' and tableowner = current_user) as tables_possedees
    from pg_roles r where r.rolname = current_user`);
  const r = rows[0];
  const pb = [];
  if (r.rolsuper) pb.push('Le rôle de connexion est superutilisateur : les politiques RLS ne s\'appliquent pas à lui.');
  if (r.rolbypassrls) pb.push('Le rôle de connexion contourne les politiques RLS (BYPASSRLS).');
  if (r.tables_possedees > 0) pb.push('Le rôle de connexion est propriétaire de tables : les politiques RLS ne s\'appliquent pas à lui.');
  return pb;
}
