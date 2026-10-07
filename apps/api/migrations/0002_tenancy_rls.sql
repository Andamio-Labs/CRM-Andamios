-- E01-S05 Aislamiento multi-tenant (tenant_id + RLS)
--
-- REGLA DE ORO: toda tabla con columna tenant_id DEBE tener RLS habilitado Y forzado,
-- y una política de aislamiento. El test `rls-invariants.spec.ts` lo verifica en CI
-- para cada tabla nueva: si te olvidás, el pipeline se rompe.
--
-- El tenant activo viaja en la variable de transacción `app.tenant_id`
-- (SET LOCAL vía set_config(..., true)). Sin tenant seteado → NULL → cero filas.

CREATE FUNCTION app_current_tenant() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '') $$;

-- E01-S06 Configuración de empresa
CREATE TABLE tenant_settings (
  tenant_id      text PRIMARY KEY REFERENCES "organization" ("id") ON DELETE CASCADE,
  timezone       text        NOT NULL DEFAULT 'America/Bogota',
  currency       char(3)     NOT NULL DEFAULT 'COP',
  locale         text        NOT NULL DEFAULT 'es-CO',
  -- { "mon": [{"from":"08:00","to":"18:00"}], ..., "sun": [] }
  business_hours jsonb       NOT NULL DEFAULT '{
    "mon": [{"from": "08:00", "to": "18:00"}],
    "tue": [{"from": "08:00", "to": "18:00"}],
    "wed": [{"from": "08:00", "to": "18:00"}],
    "thu": [{"from": "08:00", "to": "18:00"}],
    "fri": [{"from": "08:00", "to": "18:00"}],
    "sat": [{"from": "08:00", "to": "13:00"}],
    "sun": []
  }'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- E01-S01 (plan de prueba). E10 la va a extender con planes, pagos y límites.
CREATE TABLE subscriptions (
  tenant_id     text PRIMARY KEY REFERENCES "organization" ("id") ON DELETE CASCADE,
  plan          text        NOT NULL DEFAULT 'trial',
  status        text        NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'read_only', 'canceled')),
  trial_ends_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_settings
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Las tablas de identidad las usa Better Auth con el rol de la app.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user", "session", "account", "verification", "organization", "member", "invitation"
  TO beecrm_app;
