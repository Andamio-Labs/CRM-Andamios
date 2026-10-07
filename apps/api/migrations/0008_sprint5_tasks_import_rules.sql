-- Sprint 5 + brechas de la referencia (docs/GAP-REFERENCIA.md).

-- X-07 Datos del cliente vistos en la referencia + E09-S01 (origen y campaña).
ALTER TABLE contacts
  ADD COLUMN source   text,
  ADD COLUMN campaign text,
  ADD COLUMN priority text CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  ADD COLUMN kind     text NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'company'));
CREATE INDEX contacts_source_idx ON contacts (tenant_id, source);

-- X-07 Buscador del embudo por descripción.
ALTER TABLE deals ADD COLUMN description text;

-- E06-S01/S02 Tareas: vinculadas a un negocio o a un contacto (al menos uno), con recordatorio.
CREATE TABLE tasks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  title                 text NOT NULL,
  description           text,
  deal_id               uuid,
  contact_id            uuid,
  assignee_id           text REFERENCES "user" ("id") ON DELETE SET NULL,
  due_at                timestamptz,
  remind_before_minutes int CHECK (remind_before_minutes BETWEEN 0 AND 43200),
  reminded_at           timestamptz,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  completed_at          timestamptz,
  created_by            text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (deal_id IS NOT NULL OR contact_id IS NOT NULL),
  CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX tasks_assignee_idx ON tasks (tenant_id, assignee_id, status, due_at);
CREATE INDEX tasks_deal_idx ON tasks (deal_id) WHERE status = 'open';
CREATE INDEX tasks_reminder_idx ON tasks (due_at) WHERE status = 'open' AND reminded_at IS NULL AND remind_before_minutes IS NOT NULL;

-- E06-S02 / E14-S04 Notificaciones in-app (la campana).
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (tenant_id, user_id, created_at DESC);

-- E02-S09 (y base de E13-S06) Auditoría append-only.
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  actor_id   text REFERENCES "user" ("id") ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  data       jsonb NOT NULL DEFAULT '{}',
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, created_at DESC);

-- E02-S08 Importaciones CSV (el archivo vive en el almacenamiento; acá el estado y el reporte).
CREATE TABLE import_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  created_by   text REFERENCES "user" ("id") ON DELETE SET NULL,
  file_key     text NOT NULL,
  headers      text[] NOT NULL,
  mapping      jsonb,
  status       text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'done', 'failed')),
  total_rows   int NOT NULL DEFAULT 0,
  imported     int NOT NULL DEFAULT 0,
  skipped      int NOT NULL DEFAULT 0,
  report_key   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

-- E09-S01 Enlaces Click-to-WhatsApp con UTM.
CREATE TABLE wa_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  code         text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]{6,12}$'),
  phone        text NOT NULL,
  message      text NOT NULL,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  clicks       int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- E07-S01 Reglas predefinidas activables + log de ejecuciones.
CREATE TABLE automation_rules (
  tenant_id text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  rule      text NOT NULL CHECK (rule IN ('new_lead', 'no_reply', 'stage_template', 'won_notify')),
  enabled   boolean NOT NULL DEFAULT false,
  config    jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, rule)
);
CREATE TABLE automation_runs (
  id         bigserial PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  rule       text NOT NULL,
  entity_id  text,
  status     text NOT NULL CHECK (status IN ('ok', 'skipped', 'error')),
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_runs_idx ON automation_runs (tenant_id, created_at DESC);
-- "Sin respuesta en X horas": una sola alerta por conversación hasta que vuelva a escribir el cliente.
ALTER TABLE conversations ADD COLUMN no_reply_alerted_at timestamptz;

-- E10-S01 Uso del plan (almacenamiento).
CREATE TABLE tenant_usage (
  tenant_id     text PRIMARY KEY REFERENCES "organization" ("id") ON DELETE CASCADE,
  storage_bytes bigint NOT NULL DEFAULT 0
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks', 'notifications', 'audit_log', 'import_jobs', 'wa_links',
                           'automation_rules', 'automation_runs', 'tenant_usage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

REVOKE UPDATE, DELETE ON audit_log, automation_runs FROM beecrm_app;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq, automation_runs_id_seq TO beecrm_app;

-- Barridos periódicos (recordatorios, "sin respuesta") recorren todos los tenants: estas funciones
-- devuelven SOLO ids y tenant; cada tenant se procesa después con withTenant(), como siempre.
CREATE FUNCTION due_task_reminders(p_now timestamptz)
  RETURNS TABLE (tenant_id text, task_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT tenant_id, id FROM tasks
        WHERE status = 'open' AND reminded_at IS NULL AND remind_before_minutes IS NOT NULL AND due_at IS NOT NULL
          AND due_at - make_interval(mins => remind_before_minutes) <= p_now
        LIMIT 1000 $$;

CREATE FUNCTION tenants_with_rule(p_rule text)
  RETURNS TABLE (tenant_id text, config jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT tenant_id, config FROM automation_rules WHERE rule = p_rule AND enabled $$;

-- El clic en un enlace llega sin sesión ni tenant: se resuelve por código (único global).
CREATE FUNCTION wa_link_resolve(p_code text)
  RETURNS TABLE (tenant_id text, link_id uuid, phone text, message text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT tenant_id, id, phone, message FROM wa_links WHERE code = p_code $$;

REVOKE ALL ON FUNCTION due_task_reminders(timestamptz), tenants_with_rule(text), wa_link_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION due_task_reminders(timestamptz), tenants_with_rule(text), wa_link_resolve(text) TO beecrm_app;
