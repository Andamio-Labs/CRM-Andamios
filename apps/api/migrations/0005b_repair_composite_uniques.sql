-- Reparación 2026-10-06: los UNIQUE compuestos (tenant_id, id) se agregaron al
-- 0005_contacts_pipelines.sql DESPUÉS de que algunos volúmenes ya lo habían aplicado.
-- Como el migrador solo registra nombres de archivo, esos volúmenes quedaron sin los
-- UNIQUE y el 0006 (FKs compuestas hacia contacts) falla con:
--   "there is no unique constraint matching given keys for referenced table contacts"
--
-- REGLA: nunca se edita una migración aplicada; se repara hacia adelante. Este archivo
-- corre entre el 0005 y el 0006 (orden alfabético) y es idempotente: en bases nuevas,
-- donde el 0005 ya trae los UNIQUE, cada bloque se saltea solo.
-- Es seguro: id es PRIMARY KEY, así que (tenant_id, id) nunca tiene duplicados.
--
-- Tablas afectadas: contacts, companies, pipelines, stages, close_reasons, deals.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_tenant_id_id_key') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_tenant_id_id_key') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipelines_tenant_id_id_key') THEN
    ALTER TABLE pipelines ADD CONSTRAINT pipelines_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stages_tenant_id_id_key') THEN
    ALTER TABLE stages ADD CONSTRAINT stages_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'close_reasons_tenant_id_id_key') THEN
    ALTER TABLE close_reasons ADD CONSTRAINT close_reasons_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_tenant_id_id_key') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;
