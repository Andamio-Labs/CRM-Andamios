-- E12-S03 Chat interno del equipo: general (toda la empresa), directo (dos personas), grupo
-- (opcionalmente atado a un negocio) y notas personales.
CREATE TABLE team_chats (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('general', 'direct', 'group', 'notes')),
  title           text,
  deal_id         uuid,
  -- Directos: los dos userId ordenados ("a:b"). Evita dos chats directos entre las mismas personas.
  direct_key      text,
  created_by      text REFERENCES "user" ("id") ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, direct_key),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals (tenant_id, id) ON DELETE SET NULL (deal_id)
);
CREATE UNIQUE INDEX team_chats_general_idx ON team_chats (tenant_id) WHERE kind = 'general';
CREATE UNIQUE INDEX team_chats_notes_idx ON team_chats (tenant_id, created_by) WHERE kind = 'notes';

-- Miembros y hasta dónde leyó cada uno. En el chat general la fila se crea al leer por primera vez.
CREATE TABLE team_chat_members (
  tenant_id    text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  chat_id      uuid NOT NULL,
  user_id      text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  last_read_at timestamptz,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (tenant_id, chat_id) REFERENCES team_chats (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX team_chat_members_user_idx ON team_chat_members (tenant_id, user_id);

CREATE TABLE team_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  chat_id    uuid NOT NULL,
  author_id  text REFERENCES "user" ("id") ON DELETE SET NULL,
  body       text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, chat_id) REFERENCES team_chats (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX team_messages_chat_idx ON team_messages (chat_id, created_at DESC);

ALTER TABLE team_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_chats FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON team_chats USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
ALTER TABLE team_chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_chat_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON team_chat_members USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON team_messages USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
