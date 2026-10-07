-- Se ejecuta UNA vez, al crear el volumen de Postgres.
-- beecrm_owner (superusuario del contenedor) corre migraciones y es dueño de las tablas.
-- beecrm_app es el rol con el que corre la aplicación: NO es dueño, NO tiene BYPASSRLS.
-- Así Row Level Security aplica siempre (E01-S05).
CREATE ROLE beecrm_app LOGIN PASSWORD 'beecrm_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

GRANT CONNECT ON DATABASE beecrm TO beecrm_app;
GRANT USAGE ON SCHEMA public TO beecrm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE beecrm_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO beecrm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE beecrm_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO beecrm_app;
