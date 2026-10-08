-- E05 — Agente de IA en WhatsApp: embeddings, traspaso a humano, cuotas y registro de interacciones.

-- E05-S02 Embeddings. bge-m3 (1024 dimensiones). Búsqueda EXACTA filtrada por tenant: con RLS, un índice
-- aproximado (HNSW) busca entre los vectores de todas las empresas y filtra después, y puede devolver menos
-- resultados de los pedidos. Cada empresa tiene pocos miles de fragmentos: el recorrido exacto es rápido.
ALTER TABLE knowledge_chunks ADD COLUMN embedding vector(1024);
CREATE INDEX knowledge_chunks_tenant_idx ON knowledge_chunks (tenant_id, source_id);

-- PDF y URL: el texto extraído va en `content`; la URL se guarda para volver a leerla.
ALTER TABLE knowledge_sources DROP CONSTRAINT knowledge_sources_kind_check;
ALTER TABLE knowledge_sources DROP CONSTRAINT knowledge_sources_check;
ALTER TABLE knowledge_sources
  ADD COLUMN url text,
  ADD COLUMN file_name text,
  ADD CONSTRAINT knowledge_sources_kind_check CHECK (kind IN ('text', 'faq', 'pdf', 'url')),
  ADD CONSTRAINT knowledge_sources_body_check CHECK ((kind = 'faq') = (faq IS NOT NULL) AND (kind <> 'faq') = (content IS NOT NULL)),
  ADD CONSTRAINT knowledge_sources_url_check CHECK ((kind = 'url') = (url IS NOT NULL));

-- E05-S04/S05/S06 Configuración nueva del agente.
ALTER TABLE ai_agents
  ADD COLUMN handoff_keywords text[] NOT NULL DEFAULT '{asesor,humano,persona,agente}',
  ADD COLUMN qualification text[] NOT NULL DEFAULT '{contact.name,contact.email,deal.description,deal.value}',
  ADD COLUMN block_on_quota boolean NOT NULL DEFAULT true;

-- E05-S05 Pausa por conversación. Hasta `ai_paused_until` la IA no responde (9999-12-31 = hasta reanudar a mano;
-- no se usa 'infinity' porque el driver lo convierte en una fecha inválida).
ALTER TABLE conversations
  ADD COLUMN ai_paused_until timestamptz,
  ADD COLUMN ai_pause_reason text CHECK (ai_pause_reason IN ('human_reply', 'manual', 'handoff', 'guardrail'));

-- Las respuestas de la IA se distinguen en la bandeja. No tienen sent_by: no cuentan como respuesta humana (SLA).
ALTER TABLE messages ADD COLUMN ai_generated boolean NOT NULL DEFAULT false;

-- E05-S08 Registro de cada turno del agente. Se borra con la conversación (supresión del titular).
CREATE TABLE ai_interactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  conversation_id  uuid REFERENCES conversations (id) ON DELETE CASCADE,
  message_id       uuid REFERENCES messages (id) ON DELETE SET NULL,
  reply_message_id uuid REFERENCES messages (id) ON DELETE SET NULL,
  channel          text NOT NULL CHECK (channel IN ('whatsapp', 'preview')),
  outcome          text NOT NULL CHECK (outcome IN ('replied', 'handoff', 'blocked', 'error', 'quota')),
  model            text,
  prompt           jsonb NOT NULL,
  response         text,
  input_tokens     int NOT NULL DEFAULT 0,
  output_tokens    int NOT NULL DEFAULT 0,
  cost_micros      bigint NOT NULL DEFAULT 0,
  latency_ms       int,
  violations       text[] NOT NULL DEFAULT '{}',
  captured         jsonb NOT NULL DEFAULT '{}',
  sources          jsonb NOT NULL DEFAULT '[]',
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_interactions_tenant_idx ON ai_interactions (tenant_id, created_at DESC);
-- E05-S06 La cuota cuenta solo respuestas enviadas por WhatsApp.
CREATE INDEX ai_interactions_quota_idx ON ai_interactions (tenant_id, created_at) WHERE outcome = 'replied' AND channel = 'whatsapp';
ALTER TABLE ai_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_interactions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_interactions USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
-- Registro inmutable: se agrega y se borra (supresión, retención), nunca se edita.
REVOKE UPDATE ON ai_interactions FROM beecrm_app;

-- E05-S06 Avisos de cuota enviados: uno por umbral y mes.
CREATE TABLE ai_usage_alerts (
  tenant_id text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  month     date NOT NULL,
  threshold int NOT NULL CHECK (threshold IN (80, 100)),
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, month, threshold)
);
ALTER TABLE ai_usage_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_usage_alerts USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- E05-S02 Barrido de indexación: fuentes que esperan la IA, que fallaron o que quedaron trabadas indexando.
CREATE FUNCTION knowledge_pending_sources(p_now timestamptz)
  RETURNS TABLE (tenant_id text, source_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT tenant_id, id FROM knowledge_sources
        WHERE status IN ('waiting_ai', 'failed') OR (status = 'indexing' AND updated_at < p_now - interval '10 minutes')
        ORDER BY updated_at LIMIT 500 $$;
REVOKE ALL ON FUNCTION knowledge_pending_sources(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION knowledge_pending_sources(timestamptz) TO beecrm_app;
