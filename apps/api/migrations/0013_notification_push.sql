-- Push del navegador como tercer canal de notificaciones, con una suscripción por dispositivo.
ALTER TABLE notification_preferences ADD COLUMN push boolean NOT NULL DEFAULT true;

-- Una fila por navegador o teléfono suscrito. El servicio de push responde 404/410 cuando caduca: se borra.
CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, endpoint)
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (tenant_id, user_id);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON push_subscriptions USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
