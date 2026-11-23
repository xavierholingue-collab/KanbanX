// Configuration lue dans l'environnement (et dans .env s'il existe). Aucun secret n'est écrit dans le dépôt.
try { process.loadEnvFile('.env'); } catch { /* pas de .env */ }

const e = process.env;
export const config = {
  env: e.NODE_ENV || 'development',
  port: Number(e.PORT ?? 3000),
  baseUrl: (e.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  databaseUrl: e.DATABASE_URL || 'postgres://kanbanx_app:kanbanx_app_dev@127.0.0.1:5432/kanbanx',
  adminUrl: e.DATABASE_ADMIN_URL || 'postgres://kanbanx:kanbanx_dev@127.0.0.1:5432/kanbanx',
  appPassword: e.KANBANX_APP_PASSWORD || 'kanbanx_app_dev',
  smtpUrl: e.SMTP_URL || '',
  smtpFrom: e.SMTP_FROM || 'KanbanX <no-reply@kanbanx.invalid>',
  seedDemo: e.SEED_DEMO === '1',
  lienTtlMs: 15 * 60 * 1000,
  sessionTtlMs: 30 * 24 * 3600 * 1000,
};
