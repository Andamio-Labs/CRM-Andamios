-- Sprint 8: E10-S02 prueba gratuita y solo lectura.

-- Estado EFECTIVO de la cuenta: una prueba vencida es solo lectura aunque el barrido todavía no la marcó.
-- La usa SessionGuard en cada request (antes de que exista el tenant de RLS), por eso es SECURITY DEFINER.
CREATE FUNCTION account_status(p_tenant text)
  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT CASE WHEN status = 'trialing' AND trial_ends_at <= now() THEN 'read_only' ELSE status END
        FROM subscriptions WHERE tenant_id = p_tenant $$;

CREATE FUNCTION expired_trials(p_now timestamptz)
  RETURNS TABLE (tenant_id text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT tenant_id FROM subscriptions WHERE status = 'trialing' AND trial_ends_at <= p_now LIMIT 1000 $$;

REVOKE ALL ON FUNCTION account_status(text), expired_trials(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_status(text), expired_trials(timestamptz) TO beecrm_app;

-- E13-S03 Derechos del titular: cada solicitud con su plazo legal (Ley 1581, arts. 14 y 15).
CREATE TABLE privacy_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  contact_id  uuid,
  type        text NOT NULL CHECK (type IN ('access', 'update', 'erase', 'export')),
  channel     text NOT NULL CHECK (channel IN ('whatsapp', 'web_form', 'phone', 'email', 'in_person')),
  details     text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  due_at      timestamptz NOT NULL,
  resolution  text,
  resolved_by text REFERENCES "user" ("id") ON DELETE SET NULL,
  resolved_at timestamptz,
  created_by  text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX privacy_requests_tenant_idx ON privacy_requests (tenant_id, status, due_at);
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON privacy_requests USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- E13-S04 Eliminación de la empresa. Código de confirmación (hash), con vencimiento e intentos.
CREATE TABLE tenant_deletion_codes (
  tenant_id  text PRIMARY KEY REFERENCES "organization" ("id") ON DELETE CASCADE,
  code_hash  text NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
ALTER TABLE tenant_deletion_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_deletion_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_deletion_codes USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Constancia de PLATAFORMA (no es dato de una empresa: la empresa ya no existe), sin datos personales.
-- Sirve para reaplicar eliminaciones al restaurar un backup. La columna NO se llama tenant_id a propósito:
-- no lleva RLS (restore.sh la lee sin tenant activo) y la app no tiene ningún privilegio sobre ella.
CREATE TABLE tenant_deletions (
  organization_id text PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON tenant_deletions FROM beecrm_app;

-- Borra la empresa (todo cae en cascada por tenant_id), y los usuarios que no pertenecen a otra empresa.
-- Defensa en profundidad: solo puede borrar el tenant activo de la transacción (app.tenant_id).
-- restore.sh la usa para reaplicar las eliminaciones posteriores a un backup.
CREATE FUNCTION purge_tenant(p_tenant text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
  AS $$
DECLARE doomed text[];
BEGIN
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM current_setting('app.tenant_id', true) THEN
    RAISE EXCEPTION 'purge_tenant: solo se puede eliminar el tenant activo';
  END IF;
  SELECT coalesce(array_agg(m."userId"), '{}') INTO doomed FROM member m
   WHERE m."organizationId" = p_tenant
     AND NOT EXISTS (SELECT 1 FROM member o WHERE o."userId" = m."userId" AND o."organizationId" <> p_tenant);
  DELETE FROM organization WHERE id = p_tenant;
  DELETE FROM "user" WHERE id = ANY (doomed);
  INSERT INTO tenant_deletions (organization_id) VALUES (p_tenant) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION purge_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_tenant(text) TO beecrm_app;

-- E14-S04 Preferencias de notificaciones por persona y tipo. Sin fila = valores por defecto del catálogo.
ALTER TABLE notifications ADD COLUMN in_app boolean NOT NULL DEFAULT true;
CREATE TABLE notification_preferences (
  tenant_id text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  user_id   text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  type      text NOT NULL,
  in_app    boolean NOT NULL,
  email     boolean NOT NULL,
  PRIMARY KEY (tenant_id, user_id, type)
);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preferences USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- E14-S03 Onboarding: lo único que no se deriva de los datos (qué plantilla eligió y si ocultó la guía).
CREATE TABLE tenant_onboarding (
  tenant_id          text PRIMARY KEY REFERENCES "organization" ("id") ON DELETE CASCADE,
  pipeline_template  text,
  pipeline_chosen_at timestamptz,
  dismissed_at       timestamptz
);
ALTER TABLE tenant_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_onboarding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_onboarding USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- E08-S02 SLA de primera respuesta (minutos) y alerta una sola vez por conversación.
ALTER TABLE tenant_settings ADD COLUMN first_response_sla_minutes int NOT NULL DEFAULT 60 CHECK (first_response_sla_minutes BETWEEN 5 AND 1440);
ALTER TABLE conversations ADD COLUMN first_response_alerted_at timestamptz;
CREATE INDEX messages_conversation_dir_idx ON messages (conversation_id, direction, created_at);

-- Barrido de alertas: conversaciones cuyo primer mensaje del cliente lleva más que el SLA sin respuesta humana.
CREATE FUNCTION sla_breach_candidates(p_now timestamptz)
  RETURNS TABLE (tenant_id text, conversation_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT c.tenant_id, c.id FROM conversations c
        JOIN tenant_settings s ON s.tenant_id = c.tenant_id
        JOIN LATERAL (SELECT min(created_at) AS at FROM messages WHERE conversation_id = c.id AND direction = 'in') f ON f.at IS NOT NULL
        WHERE c.first_response_alerted_at IS NULL
          AND f.at <= p_now - make_interval(mins => s.first_response_sla_minutes)
          AND NOT EXISTS (SELECT 1 FROM messages o WHERE o.conversation_id = c.id AND o.direction = 'out' AND o.sent_by IS NOT NULL AND o.created_at >= f.at)
        LIMIT 1000 $$;

-- E08-S04 Embudo de activación de la PLATAFORMA (cruza empresas): devuelve solo agregados.
CREATE FUNCTION activation_funnel(p_from timestamptz, p_to timestamptz)
  RETURNS TABLE (registered bigint, whatsapp_connected bigint, first_lead bigint, first_deal_won bigint,
                 median_hours_whatsapp double precision, median_hours_first_lead double precision, median_hours_first_won double precision)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    WITH cohort AS (
      SELECT o.id, o."createdAt" AS registered_at,
             (SELECT min(connected_at) FROM whatsapp_channels w WHERE w.tenant_id = o.id) AS wa_at,
             (SELECT min(created_at) FROM contacts c WHERE c.tenant_id = o.id) AS lead_at,
             (SELECT min(closed_at) FROM deals d WHERE d.tenant_id = o.id AND d.status = 'won') AS won_at
      FROM organization o WHERE o."createdAt" >= p_from AND o."createdAt" < p_to
    )
    SELECT count(*), count(wa_at), count(lead_at), count(won_at),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM wa_at - registered_at) / 3600) FILTER (WHERE wa_at IS NOT NULL),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM lead_at - registered_at) / 3600) FILTER (WHERE lead_at IS NOT NULL),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM won_at - registered_at) / 3600) FILTER (WHERE won_at IS NOT NULL)
    FROM cohort $$;

REVOKE ALL ON FUNCTION sla_breach_candidates(timestamptz), activation_funnel(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sla_breach_candidates(timestamptz), activation_funnel(timestamptz, timestamptz) TO beecrm_app;
