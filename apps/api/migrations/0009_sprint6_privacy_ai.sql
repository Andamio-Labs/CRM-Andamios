-- Sprint 6: E13-S02 consentimiento y finalidad por contacto; E05-S01/S02 base del agente (sin IA real todavía).

-- Historial append-only: el estado actual de cada finalidad es su último registro.
-- Bases legales de la Ley 1581 de 2012 (autorización y las excepciones del art. 10 que aplican a un CRM).
CREATE TABLE contact_consents (
  id          bigserial PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  contact_id  uuid NOT NULL,
  legal_basis text NOT NULL CHECK (legal_basis IN ('consent', 'contract', 'legal_obligation', 'public_data')),
  purposes    text[] NOT NULL CHECK (cardinality(purposes) > 0
                AND purposes <@ ARRAY['sales', 'customer_service', 'marketing', 'billing']),
  granted     boolean NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('whatsapp', 'web_form', 'phone', 'email', 'in_person', 'import')),
  evidence    text,
  recorded_by text REFERENCES "user" ("id") ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX contact_consents_contact_idx ON contact_consents (tenant_id, contact_id, recorded_at DESC);

ALTER TABLE contact_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contact_consents USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

REVOKE UPDATE, DELETE ON contact_consents FROM beecrm_app;
GRANT USAGE, SELECT ON SEQUENCE contact_consents_id_seq TO beecrm_app;

-- E05-S01 Configuración del agente: una por empresa; apagado hasta que haya un proveedor de IA.
CREATE TABLE ai_agents (
  tenant_id    text PRIMARY KEY REFERENCES "organization" ("id") ON DELETE CASCADE,
  name         text NOT NULL DEFAULT 'Asistente' CHECK (length(name) BETWEEN 1 AND 60),
  tone         text NOT NULL DEFAULT 'friendly' CHECK (tone IN ('friendly', 'formal', 'neutral')),
  language     text NOT NULL DEFAULT 'es-CO' CHECK (language IN ('es-CO', 'es-MX', 'pt-BR')),
  schedule     text NOT NULL DEFAULT 'always' CHECK (schedule IN ('always', 'business_hours', 'out_of_hours')),
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 8000),
  enabled      boolean NOT NULL DEFAULT false,
  updated_by   text REFERENCES "user" ("id") ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_agents USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- E05-S02 Base de conocimiento. Los fragmentos son la unidad que se indexa; la columna de
-- embedding (pgvector) se agrega cuando se elija el modelo, porque su dimensión depende de él.
CREATE TABLE knowledge_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('text', 'faq')),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  content     text,
  faq         jsonb,
  status      text NOT NULL CHECK (status IN ('waiting_ai', 'indexing', 'ready', 'failed')),
  error       text,
  chunk_count int NOT NULL DEFAULT 0,
  created_by  text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((kind = 'text') = (content IS NOT NULL) AND (kind = 'faq') = (faq IS NOT NULL))
);
CREATE INDEX knowledge_sources_tenant_idx ON knowledge_sources (tenant_id, created_at DESC);

CREATE TABLE knowledge_chunks (
  id         bigserial PRIMARY KEY,
  tenant_id  text NOT NULL,
  source_id  uuid NOT NULL,
  ordinal    int NOT NULL,
  content    text NOT NULL,
  UNIQUE (source_id, ordinal),
  FOREIGN KEY (tenant_id, source_id) REFERENCES knowledge_sources (tenant_id, id) ON DELETE CASCADE
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['knowledge_sources', 'knowledge_chunks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE knowledge_chunks_id_seq TO beecrm_app;
