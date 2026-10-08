#!/usr/bin/env bash
# E15-S04 — Restaura un backup cifrado en una base NUEVA (nunca pisa la de origen).
#
#   restore.sh <archivo.dump.gpg> <base_destino>
#   Requiere: PGHOST PGUSER PGPASSWORD BACKUP_PASSPHRASE
#   Opcional: LIVE_DATABASE=<base viva> reaplica las empresas eliminadas DESPUÉS del backup (E13-S04).
#
# Restaurar en otra base permite verificar el backup sin tocar producción.
# Para un desastre real: restaurar acá, validar, y recién ahí apuntar la app.
set -euo pipefail

file="${1:?uso: restore.sh <archivo.dump.gpg> <base_destino>}"
target_db="${2:?uso: restore.sh <archivo.dump.gpg> <base_destino>}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE es obligatoria}"

export GNUPGHOME="$(mktemp -d)"
plain="$(mktemp)"
trap 'rm -rf "$GNUPGHOME" "$plain"' EXIT

# Primero se descifra y verifica COMPLETO: si la clave está mal o el archivo fue alterado, no se toca nada.
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt --output "$plain" "$file" 3<<<"$BACKUP_PASSPHRASE"

if psql --no-password -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$target_db'" | grep -q 1; then
  echo "La base $target_db ya existe: elegí una nueva para no pisar datos." >&2
  exit 1
fi
createdb --no-password "$target_db"
# Las extensiones viven por base: deben existir antes de restaurar las tablas que las usan.
psql --no-password -d "$target_db" -v ON_ERROR_STOP=1 -qc \
  "CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS unaccent;
   CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;"
pg_restore --no-password --exit-on-error --dbname="$target_db" "$plain"

# E13-S04 — Una empresa eliminada no puede "revivir" por restaurar un backup anterior a su eliminación.
# La lista sale de la base VIVA (la del backup no conoce las eliminaciones posteriores).
if [[ -n "${LIVE_DATABASE:-}" ]]; then
  purged=0
  while IFS= read -r tenant; do
    [[ -z "$tenant" ]] && continue
    psql --no-password -d "$target_db" -v ON_ERROR_STOP=1 -q -v tid="$tenant" <<'SQL'
BEGIN;
SELECT set_config('app.tenant_id', :'tid', true);
SELECT purge_tenant(:'tid') WHERE EXISTS (SELECT 1 FROM organization WHERE id = :'tid');
COMMIT;
SQL
    purged=$((purged + 1))
  done < <(psql --no-password -d "$LIVE_DATABASE" -tAc "SELECT organization_id FROM tenant_deletions")
  echo "eliminaciones reaplicadas: $purged"
fi
echo "restore OK: $file → $target_db"
