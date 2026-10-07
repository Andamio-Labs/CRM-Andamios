-- Sprint 4: E04-S05..S10 (plantillas, multimedia, bandeja, notas, consentimiento, fuera de horario).

-- E04-S08 Notas internas: viven en el hilo pero nunca salen a Meta.
ALTER TABLE messages DROP CONSTRAINT messages_direction_check;
ALTER TABLE messages ADD CONSTRAINT messages_direction_check CHECK (direction IN ('in', 'out', 'note'));
ALTER TABLE messages DROP CONSTRAINT messages_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_status_check
  CHECK (status IN ('received', 'pending', 'sent', 'delivered', 'read', 'failed', 'internal'));

-- E04-S10 Respuesta automática fuera de horario: una vez por conversación hasta que responda una persona.
ALTER TABLE conversations ADD COLUMN auto_reply_at timestamptz;
CREATE INDEX conversations_assigned_idx ON conversations (tenant_id, assigned_to);
ALTER TABLE tenant_settings
  ADD COLUMN out_of_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN out_of_hours_message text NOT NULL DEFAULT 'Gracias por escribirnos. En este momento estamos fuera de horario; te responderemos apenas abramos.';

-- E04-S09 Consentimiento (Habeas Data + políticas de Meta).
ALTER TABLE contacts
  ADD COLUMN whatsapp_opt_in_at timestamptz,
  ADD COLUMN whatsapp_opt_in_source text,
  ADD COLUMN whatsapp_opt_out_at timestamptz;

-- E04-S05 Plantillas de WhatsApp (se aprueban en Meta).
CREATE TABLE whatsapp_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  waba_id          text NOT NULL,
  meta_template_id text,
  -- Postgres no acepta {1,512} en regex (máximo 255 repeticiones): largo y formato por separado.
  name             text NOT NULL CHECK (char_length(name) <= 512 AND name ~ '^[a-z0-9_]+$'),
  language         text NOT NULL,
  category         text NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  body             text NOT NULL,
  examples         text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED')),
  rejection_reason text,
  created_by       text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, waba_id, name, language)
);

-- E04-S08 Respuestas rápidas con atajo "/".
CREATE TABLE quick_replies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  shortcut   text NOT NULL CHECK (shortcut ~ '^[a-z0-9_-]{1,30}$'),
  body       text NOT NULL,
  created_by text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, shortcut)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_templates', 'quick_replies'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Las actualizaciones de estado de plantillas llegan por WABA (no por número): misma idea que
-- whatsapp_channel_route, la única puerta acotada que salta RLS para enrutar el webhook.
CREATE FUNCTION whatsapp_waba_route(p_waba_id text)
  RETURNS TABLE (tenant_id text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT DISTINCT tenant_id FROM whatsapp_channels WHERE waba_id = p_waba_id AND status = 'connected' $$;
REVOKE ALL ON FUNCTION whatsapp_waba_route(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_waba_route(text) TO beecrm_app;
