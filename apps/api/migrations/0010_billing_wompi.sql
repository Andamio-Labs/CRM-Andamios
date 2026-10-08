-- E10-S03 Suscripción recurrente en COP con Wompi.

ALTER TABLE subscriptions
  ADD COLUMN current_period_end timestamptz,
  ADD COLUMN payment_source_id  text,
  ADD COLUMN card_brand         text,
  ADD COLUMN card_last4         char(4),
  ADD COLUMN failed_attempts    int NOT NULL DEFAULT 0,
  ADD COLUMN next_retry_at      timestamptz;

-- Cada intento de cobro. La referencia es determinística (empresa + período + intento) y única:
-- un barrido repetido no puede cobrar dos veces. Nunca hay dos cobros pendientes por empresa.
CREATE TABLE billing_charges (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  reference            text NOT NULL UNIQUE,
  kind                 text NOT NULL CHECK (kind IN ('subscribe', 'renewal')),
  plan                 text NOT NULL,
  amount_in_cents      bigint NOT NULL CHECK (amount_in_cents > 0),
  currency             char(3) NOT NULL DEFAULT 'COP',
  attempt              int NOT NULL CHECK (attempt >= 1),
  period_start         timestamptz NOT NULL,
  period_end           timestamptz NOT NULL,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  wompi_transaction_id text UNIQUE,
  failure_reason       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX billing_charges_one_pending ON billing_charges (tenant_id) WHERE status = 'pending';
CREATE INDEX billing_charges_tenant_idx ON billing_charges (tenant_id, created_at DESC);

ALTER TABLE billing_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_charges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_charges USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- El webhook de Wompi llega sin sesión: se enruta por referencia (única global). Solo devuelve el tenant.
CREATE FUNCTION billing_charge_route(p_reference text)
  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT tenant_id FROM billing_charges WHERE reference = p_reference $$;

-- Barrido de renovaciones: empresas con el período vencido o con un reintento que ya toca.
CREATE FUNCTION billing_due_subscriptions(p_now timestamptz)
  RETURNS TABLE (tenant_id text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT s.tenant_id FROM subscriptions s
        WHERE s.payment_source_id IS NOT NULL
          AND ((s.status = 'active' AND s.current_period_end <= p_now)
            OR (s.status = 'past_due' AND s.next_retry_at <= p_now))
          AND NOT EXISTS (SELECT 1 FROM billing_charges c WHERE c.tenant_id = s.tenant_id AND c.status = 'pending')
        LIMIT 500 $$;

REVOKE ALL ON FUNCTION billing_charge_route(text), billing_due_subscriptions(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_charge_route(text), billing_due_subscriptions(timestamptz) TO beecrm_app;
