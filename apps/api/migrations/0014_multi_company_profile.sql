-- E01-S10 Multiempresa: código para unirse, solicitudes que aprueba el equipo y perfil personal.

-- Código para invitar empleados: 10 caracteres sin los que se confunden (0/O, 1/I).
CREATE FUNCTION new_join_code() RETURNS text
  LANGUAGE sql VOLATILE
  AS $$ SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + get_byte(b, i) % 32, 1), '' ORDER BY i)
        FROM (SELECT decode(md5(gen_random_uuid()::text), 'hex') AS b) s, generate_series(0, 9) AS i $$;

ALTER TABLE tenant_settings ADD COLUMN join_code text NOT NULL DEFAULT new_join_code();
ALTER TABLE tenant_settings ADD CONSTRAINT tenant_settings_join_code_key UNIQUE (join_code);

-- Quien pide unirse todavía NO es miembro: la fila es de la empresa destino (RLS) y la persona
-- la ve solo por my_join_requests().
CREATE TABLE join_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  decided_by text REFERENCES "user" ("id") ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX join_requests_pending_idx ON join_requests (tenant_id, user_id) WHERE status = 'pending';
CREATE INDEX join_requests_user_idx ON join_requests (user_id, created_at DESC);
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON join_requests USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Pedir unirse sin ser miembro: la app no entra al contexto de la empresa ajena, lo hace esta función.
-- outcome: not_found | member | requested (ya había una pendiente) | created.
CREATE FUNCTION request_to_join(p_code text, p_user text)
  RETURNS TABLE (outcome text, id uuid, tenant_id text, company_name text, created_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
#variable_conflict use_column
DECLARE t record; r record;
BEGIN
  SELECT s.tenant_id, o.name INTO t FROM tenant_settings s JOIN organization o ON o.id = s.tenant_id
   WHERE s.join_code = upper(p_code);
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::text, NULL::timestamptz; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM member m WHERE m."organizationId" = t.tenant_id AND m."userId" = p_user) THEN
    RETURN QUERY SELECT 'member'::text, NULL::uuid, t.tenant_id, t.name, NULL::timestamptz; RETURN;
  END IF;
  INSERT INTO join_requests (tenant_id, user_id) VALUES (t.tenant_id, p_user)
    ON CONFLICT (tenant_id, user_id) WHERE status = 'pending' DO NOTHING
    RETURNING join_requests.id, join_requests.created_at INTO r;
  IF NOT FOUND THEN RETURN QUERY SELECT 'requested'::text, NULL::uuid, t.tenant_id, t.name, NULL::timestamptz; RETURN; END IF;
  RETURN QUERY SELECT 'created'::text, r.id, t.tenant_id, t.name, r.created_at;
END $$;
REVOKE ALL ON FUNCTION request_to_join(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_to_join(text, text) TO beecrm_app;

-- "Mis solicitudes": las de UNA persona en todas las empresas.
CREATE FUNCTION my_join_requests(p_user text)
  RETURNS TABLE (id uuid, tenant_id text, company_name text, status text, created_at timestamptz, decided_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT r.id, r.tenant_id, o.name, r.status, r.created_at, r.decided_at
        FROM join_requests r JOIN organization o ON o.id = r.tenant_id
        WHERE r.user_id = p_user ORDER BY r.created_at DESC LIMIT 50 $$;
REVOKE ALL ON FUNCTION my_join_requests(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_join_requests(text) TO beecrm_app;

-- Cancelar la propia solicitud pendiente sin ser miembro de esa empresa.
CREATE FUNCTION cancel_my_join_request(p_id uuid, p_user text)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$ WITH done AS (UPDATE join_requests SET status = 'canceled', decided_at = now()
                      WHERE id = p_id AND user_id = p_user AND status = 'pending' RETURNING 1)
        SELECT EXISTS (SELECT 1 FROM done) $$;
REVOKE ALL ON FUNCTION cancel_my_join_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_my_join_request(uuid, text) TO beecrm_app;

-- Perfil personal: es de la persona, no de una empresa (se ve igual en todas las suyas).
CREATE TABLE user_profiles (
  user_id    text PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  position   text CHECK (char_length(position) <= 80),
  phone      text CHECK (char_length(phone) <= 40),
  address    text CHECK (char_length(address) <= 200),
  bio        text CHECK (char_length(bio) <= 1000),
  avatar_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
