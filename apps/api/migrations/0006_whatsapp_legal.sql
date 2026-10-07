-- Sprint 3: E04-S01..S04 (WhatsApp), E15-S06 (ritmo de envío), E13-S01 (aceptación legal).

-- E04-S01 Números de WhatsApp conectados. phone_number_id es único en TODO el sistema:
-- un número no puede pertenecer a dos empresas (el webhook se enruta por ese id).
CREATE TABLE whatsapp_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  waba_id         text NOT NULL,
  phone_number_id text NOT NULL UNIQUE,
  display_phone   text,
  verified_name   text,
  name_status     text,          -- verificación del nombre visible (APPROVED, PENDING_REVIEW…)
  quality_rating  text,          -- GREEN | YELLOW | RED | UNKNOWN
  messaging_limit text,          -- tier de Meta (TIER_1K, TIER_10K…)
  status          text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error')),
  connected_by    text REFERENCES "user" ("id") ON DELETE SET NULL,
  connected_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- Conversación = contacto × número. last_inbound_at define la ventana de 24 h (E04-S04).
CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  channel_id      uuid NOT NULL,
  contact_id      uuid NOT NULL,
  assigned_to     text REFERENCES "user" ("id") ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_inbound_at timestamptz,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  unread_count    int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel_id, contact_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, channel_id) REFERENCES whatsapp_channels (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX conversations_inbox_idx ON conversations (tenant_id, last_message_at DESC);

-- wa_message_id UNIQUE = idempotencia: Meta reintenta webhooks y el mismo mensaje no se duplica.
CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  conversation_id   uuid NOT NULL,
  direction         text NOT NULL CHECK (direction IN ('in', 'out')),
  wa_message_id     text UNIQUE,
  type              text NOT NULL,
  body              text,
  media             jsonb,
  status            text NOT NULL CHECK (status IN ('received', 'pending', 'sent', 'delivered', 'read', 'failed')),
  error             jsonb,
  sent_by           text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  status_updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_channels', 'conversations', 'messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- El webhook de Meta llega SIN tenant. Esta función (SECURITY DEFINER, dueña: beecrm_owner)
-- es la ÚNICA puerta que salta RLS, y solo traduce phone_number_id → (tenant, canal).
-- Todo lo demás del webhook corre con withTenant() como cualquier request.
CREATE FUNCTION whatsapp_channel_route(p_phone_number_id text)
  RETURNS TABLE (tenant_id text, channel_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT tenant_id, id FROM whatsapp_channels
        WHERE phone_number_id = p_phone_number_id AND status = 'connected' $$;
REVOKE ALL ON FUNCTION whatsapp_channel_route(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_channel_route(text) TO beecrm_app;

-- Unicidad global sin poder ver otros tenants: dice SI un número ya está tomado, no por quién.
CREATE FUNCTION whatsapp_phone_taken(p_phone_number_id text, p_tenant_id text)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM whatsapp_channels
        WHERE phone_number_id = p_phone_number_id AND tenant_id <> p_tenant_id) $$;
REVOKE ALL ON FUNCTION whatsapp_phone_taken(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_phone_taken(text, text) TO beecrm_app;

-- E13-S01 Aceptación de términos y aviso de privacidad (Habeas Data, Ley 1581/2012).
-- Append-only: la app solo puede insertar y leer.
CREATE TABLE legal_acceptances (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  document    text NOT NULL CHECK (document IN ('terms', 'privacy')),
  version     text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  user_agent  text
);
CREATE INDEX legal_acceptances_user_idx ON legal_acceptances (user_id, document);
REVOKE UPDATE, DELETE ON legal_acceptances FROM beecrm_app;
GRANT USAGE, SELECT ON SEQUENCE legal_acceptances_id_seq TO beecrm_app;
