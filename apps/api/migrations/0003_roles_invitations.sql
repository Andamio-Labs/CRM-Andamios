-- E01-S04 Regla de visibilidad: con true, el vendedor solo ve lo asignado a él.
ALTER TABLE tenant_settings
  ADD COLUMN sellers_see_only_assigned boolean NOT NULL DEFAULT false;

-- E01-S03 Búsquedas por estado al contar el cupo del plan (miembros + invitaciones pendientes).
CREATE INDEX invitation_org_status_idx ON "invitation" ("organizationId", "status");
