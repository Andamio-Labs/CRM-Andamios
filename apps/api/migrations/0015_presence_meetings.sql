-- E01-S09 Estado del empleado y E12-S03 Reuniones.

-- E01-S09 Estado que elige cada persona. Sin fila = en línea. `until` NULL = hasta que lo cambie;
-- al vencer vuelve a "en línea". Quien no tiene ninguna sesión abierta (cerró sesión) se ve desconectado.
CREATE TABLE member_presence (
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  status     text NOT NULL CHECK (status IN ('online', 'visit', 'dnd', 'offline')),
  until      timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE member_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_presence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_presence USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- E12-S03 Reuniones online con colegas (participant_ids) e invitados externos (guest_emails),
-- opcionalmente atadas a un negocio. El acta y el enlace de la grabación se completan después.
CREATE TABLE meetings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  title           text NOT NULL,
  agenda          text,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  join_url        text NOT NULL,
  organizer_id    text REFERENCES "user" ("id") ON DELETE SET NULL,
  participant_ids text[] NOT NULL DEFAULT '{}',
  guest_emails    text[] NOT NULL DEFAULT '{}',
  deal_id         uuid,
  minutes         text,
  recording_url   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals (tenant_id, id) ON DELETE SET NULL (deal_id)
);
CREATE INDEX meetings_tenant_starts_idx ON meetings (tenant_id, starts_at);
CREATE INDEX meetings_participants_idx ON meetings USING gin (participant_ids);
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meetings USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
