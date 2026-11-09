-- E07-S04 Robots por etapa: "cuando → si → hacer".

-- Desde cuándo está el negocio en su etapa actual: lo usan "lleva X días en la etapa" y la idempotencia.
ALTER TABLE deals ADD COLUMN stage_entered_at timestamptz NOT NULL DEFAULT now();
UPDATE deals d SET stage_entered_at = coalesce(
  (SELECT max(e.created_at) FROM deal_events e WHERE e.deal_id = d.id AND e.type = 'stage_changed'), d.created_at);

-- trigger: {"type":"enter"} | {"type":"stale","days":N} | {"type":"no_reply","hours":N} | {"type":"won"}
-- action:  {"type":"notify","to":"owner|admins"} | {"type":"task","title":"…","dueHours":N}
--          | {"type":"assign","userId":"…"} | {"type":"move","stageId":"…"}
-- condition: {"minValue":N?, "unassigned":bool?}. Los valida la API (Zod) antes de guardar.
CREATE TABLE stage_robots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  pipeline_id uuid NOT NULL,
  -- NULL solo para "al ganar": aplica a todo el embudo.
  stage_id    uuid,
  trigger     jsonb NOT NULL,
  condition   jsonb NOT NULL DEFAULT '{}',
  action      jsonb NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  created_by  text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((trigger->>'type' = 'won') = (stage_id IS NULL)),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, pipeline_id) REFERENCES pipelines (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, stage_id) REFERENCES stages (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX stage_robots_stage_idx ON stage_robots (tenant_id, stage_id) WHERE enabled;
ALTER TABLE stage_robots ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_robots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stage_robots USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Registro e idempotencia: un robot corre una sola vez por negocio y "ocasión" (entrada a la etapa,
-- último mensaje nuestro sin respuesta o cierre).
CREATE TABLE stage_robot_runs (
  id         bigserial PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  robot_id   uuid NOT NULL,
  deal_id    uuid NOT NULL,
  run_key    text NOT NULL,
  status     text NOT NULL CHECK (status IN ('ok', 'skipped', 'error')),
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (robot_id, deal_id, run_key),
  FOREIGN KEY (tenant_id, robot_id) REFERENCES stage_robots (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX stage_robot_runs_tenant_idx ON stage_robot_runs (tenant_id, created_at DESC);
ALTER TABLE stage_robot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_robot_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stage_robot_runs USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- El barrido periódico (estancados y sin respuesta) recorre las empresas que tienen robots de ese tipo.
CREATE FUNCTION tenants_with_timed_robots()
  RETURNS TABLE (tenant_id text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT DISTINCT tenant_id FROM stage_robots WHERE enabled AND trigger->>'type' IN ('stale', 'no_reply') $$;
REVOKE ALL ON FUNCTION tenants_with_timed_robots() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenants_with_timed_robots() TO beecrm_app;
