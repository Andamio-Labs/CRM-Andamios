#!/usr/bin/env bash
# Backup al arrancar y luego cada BACKUP_INTERVAL_SECONDS (por defecto, diario).
# En la nube esto lo reemplaza un cron gestionado + bucket con retención y bloqueo de objetos.
set -euo pipefail
interval="${BACKUP_INTERVAL_SECONDS:-86400}"
while true; do
  /scripts/backup.sh || echo "ERROR: el backup falló" >&2
  sleep "$interval"
done
