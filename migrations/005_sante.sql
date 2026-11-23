-- La route de santé (GET /api/sante) vérifie, sous le rôle applicatif, que toutes les migrations sont appliquées.
-- Règle des migrations : on ajoute ; on ne renomme ni ne supprime dans la même livraison (voir CLAUDE.md).
grant select on schema_migrations to kanbanx_app;
