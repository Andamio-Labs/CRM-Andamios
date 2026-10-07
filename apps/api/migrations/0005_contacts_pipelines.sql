-- Sprint 2: E02 (contactos, empresas, campos, vistas, búsqueda) + E03 (embudos, negocios, cierres).
-- Toda tabla con tenant_id lleva el mismo bloque RLS (verificado por rls-invariants.spec.ts).

-- unaccent() no es IMMUTABLE: este envoltorio permite usarlo en columnas generadas e índices.
CREATE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- E02-S01 Contactos
CREATE TABLE contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  name          text NOT NULL,
  phone         text,                -- E.164: +573001234567
  email         citext,
  tags          text[] NOT NULL DEFAULT '{}',
  notes         text,
  custom_fields jsonb NOT NULL DEFAULT '{}',
  owner_id      text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_by    text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- E02-S07 Búsqueda sin tildes ni mayúsculas, con índice trigram.
  search        text GENERATED ALWAYS AS (
                  lower(f_unaccent(name || ' ' || coalesce(email::text, '') || ' ' || coalesce(phone, '')))
                ) STORED,
  UNIQUE (tenant_id, id)
);
CREATE INDEX contacts_tenant_created_idx ON contacts (tenant_id, created_at DESC, id DESC);
CREATE INDEX contacts_search_trgm_idx ON contacts USING gin (search gin_trgm_ops);
CREATE INDEX contacts_tags_idx ON contacts USING gin (tags);
CREATE INDEX contacts_phone_idx ON contacts (tenant_id, phone);
CREATE INDEX contacts_owner_idx ON contacts (tenant_id, owner_id);

-- E02-S03 Empresas del cliente ("organizaciones" en la UI; "organization" ya es el tenant).
CREATE TABLE companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  name       text NOT NULL,
  domain     text,
  owner_id   text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  search     text GENERATED ALWAYS AS (lower(f_unaccent(name || ' ' || coalesce(domain, '')))) STORED,
  UNIQUE (tenant_id, id)
);
CREATE INDEX companies_search_trgm_idx ON companies USING gin (search gin_trgm_ops);

CREATE TABLE contact_companies (
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  company_id uuid NOT NULL,
  job_title  text,
  PRIMARY KEY (contact_id, company_id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX contact_companies_company_idx ON contact_companies (company_id);

-- E02-S04 Campos personalizados (máx. 50 por entidad, validado en la app).
CREATE TABLE custom_field_definitions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  entity     text NOT NULL CHECK (entity IN ('contact', 'deal')),
  key        text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label      text NOT NULL,
  type       text NOT NULL CHECK (type IN ('text', 'number', 'date', 'select', 'multiselect', 'currency')),
  options    text[] NOT NULL DEFAULT '{}',
  position   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity, key)
);

-- E02-S06 Vistas guardadas (personales o compartidas con el equipo).
CREATE TABLE saved_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  entity     text NOT NULL CHECK (entity IN ('contact', 'deal')),
  name       text NOT NULL,
  filters    jsonb NOT NULL,
  owner_id   text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  shared     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- E03-S01 Embudos y etapas
CREATE TABLE pipelines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  name       text NOT NULL,
  position   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  pipeline_id uuid NOT NULL,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#94a3b8' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  position    int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, pipeline_id) REFERENCES pipelines (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX stages_pipeline_idx ON stages (pipeline_id, position);

-- E03-S04 Motivos de cierre configurables
CREATE TABLE close_reasons (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  outcome   text NOT NULL CHECK (outcome IN ('won', 'lost')),
  label     text NOT NULL,
  active    boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id)
);

-- E03-S03 Negocios. position = orden dentro de la columna (índice fraccional).
CREATE TABLE deals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  pipeline_id         uuid NOT NULL,
  stage_id            uuid NOT NULL,
  title               text NOT NULL,
  value               numeric(16, 2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  currency            char(3) NOT NULL,
  probability         int CHECK (probability BETWEEN 0 AND 100),
  expected_close_date date,
  owner_id            text REFERENCES "user" ("id") ON DELETE SET NULL,
  source              text,
  contact_id          uuid,
  company_id          uuid,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  close_reason_id     uuid,
  close_note          text,
  closed_at           timestamptz,
  position            double precision NOT NULL DEFAULT 0,
  custom_fields       jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (closed_at IS NULL)),
  UNIQUE (tenant_id, id),
  -- FKs compuestas: la BASE impide apuntar a filas de otro tenant (las FK ignoran RLS).
  -- RESTRICT en etapas: tampoco se puede borrar una etapa con negocios (E03-S01).
  FOREIGN KEY (tenant_id, pipeline_id) REFERENCES pipelines (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, stage_id) REFERENCES stages (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id) ON DELETE SET NULL (contact_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id) ON DELETE SET NULL (company_id),
  FOREIGN KEY (tenant_id, close_reason_id) REFERENCES close_reasons (tenant_id, id)
);
CREATE INDEX deals_board_idx ON deals (tenant_id, pipeline_id, stage_id, position) WHERE status = 'open';
CREATE INDEX deals_contact_idx ON deals (contact_id);
CREATE INDEX deals_owner_idx ON deals (tenant_id, owner_id);

-- Historial de negocios: alimenta la línea de tiempo (E02-S05) y los reportes (E08).
CREATE TABLE deal_events (
  id         bigserial PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  deal_id    uuid NOT NULL,
  type       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  actor_id   text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX deal_events_deal_idx ON deal_events (deal_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts', 'companies', 'contact_companies', 'custom_field_definitions',
                           'saved_views', 'pipelines', 'stages', 'close_reasons', 'deals', 'deal_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE deal_events_id_seq TO beecrm_app;
