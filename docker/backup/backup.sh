#!/usr/bin/env bash
# E15-S04 — Backup cifrado de Postgres con retención.
#
#   Requiere: PGHOST PGUSER PGPASSWORD PGDATABASE BACKUP_PASSPHRASE
#   Opcional: BACKUP_DIR (/backups) RETENTION_DAYS (30)
#
# Formato custom de pg_dump (-Fc): comprimido y restaurable tabla por tabla.
# Cifrado: gpg simétrico AES-256 con verificación de integridad (MDC):
# un archivo alterado NO se restaura en silencio.
set -euo pipefail

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE es obligatoria}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
export GNUPGHOME="$(mktemp -d)"
trap 'rm -rf "$GNUPGHOME"' EXIT

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/${PGDATABASE}-${stamp}.dump.gpg"
partial="$target.partial"

# Se escribe a .partial y se renombra al final: nunca queda un backup "a medias" con nombre válido.
pg_dump --format=custom --no-password \
  | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 \
        --symmetric --cipher-algo AES256 --output "$partial" 3<<<"$BACKUP_PASSPHRASE"
mv "$partial" "$target"
echo "backup OK: $target ($(du -h "$target" | cut -f1))"

deleted="$(find "$BACKUP_DIR" -name "${PGDATABASE}-*.dump.gpg" -type f -mtime +"$RETENTION_DAYS" -print -delete | wc -l)"
echo "retención ${RETENTION_DAYS} días: ${deleted} backup(s) viejo(s) eliminado(s)"
