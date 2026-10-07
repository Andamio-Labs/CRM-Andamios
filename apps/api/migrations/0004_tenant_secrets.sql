-- E13-S05 Secretos por tenant, cifrados en la aplicación (AES-256-GCM, ver SecretBox).
-- La base nunca ve el texto plano. ciphertext = "v1:<keyId>:<iv>:<tag>:<body>".
CREATE TABLE tenant_secrets (
  tenant_id  text        NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  name       text        NOT NULL,
  ciphertext text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);

ALTER TABLE tenant_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_secrets
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
