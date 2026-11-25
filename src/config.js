// Configuration lue dans l'environnement (et dans .env s'il existe). Aucun secret n'est écrit dans le dépôt.
try { process.loadEnvFile('.env'); } catch { /* pas de .env */ }

const e = process.env;
export const config = {
  env: e.NODE_ENV || 'development',
  port: Number(e.PORT ?? 3000),
  // Par défaut, écoute locale uniquement (derrière un proxy inverse en production).
  host: e.HOST || '127.0.0.1',
  // Derrière un proxy inverse qui pose X-Real-IP : TRUST_PROXY=1, pour limiter le débit par vraie adresse.
  trustProxy: e.TRUST_PROXY === '1',
  baseUrl: (e.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  databaseUrl: e.DATABASE_URL || 'postgres://kanbanx_app:kanbanx_app_dev@127.0.0.1:5432/kanbanx',
  adminUrl: e.DATABASE_ADMIN_URL || 'postgres://kanbanx:kanbanx_dev@127.0.0.1:5432/kanbanx',
  appPassword: e.KANBANX_APP_PASSWORD || 'kanbanx_app_dev',
  smtpUrl: e.SMTP_URL || '',
  smtpFrom: e.SMTP_FROM || 'KanbanX <no-reply@kanbanx.invalid>',
  seedDemo: e.SEED_DEMO === '1',
  // « Continuer avec Google » : actif seulement si l'identifiant et le secret du client sont fournis.
  // Les adresses de Google sont fixes ; seuls les tests les remplacent, en mémoire, par un faux Google local.
  google: {
    clientId: e.GOOGLE_CLIENT_ID || '',
    clientSecret: e.GOOGLE_CLIENT_SECRET || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
  },
  lienTtlMs: 15 * 60 * 1000,
  sessionTtlMs: 30 * 24 * 3600 * 1000,
};
