-- E03-S08 Pool compartido de leads. Activo: los leads nuevos no se reparten por turnos; el primer
-- vendedor que toma uno se queda con él. Con "solo lo asignado", el vendedor ve además lo que no tiene dueño.
ALTER TABLE tenant_settings ADD COLUMN lead_pool boolean NOT NULL DEFAULT false;
