#!/bin/sh
set -eu
umask 077

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_TMP="$BACKUP_DIR/.webplant_${STAMP}.dump.tmp"
UPLOADS_TMP="$BACKUP_DIR/.uploads_${STAMP}.tar.gz.tmp"

cleanup() {
    rm -f "$DB_TMP" "$UPLOADS_TMP"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$BACKUP_DIR"

pg_dump --format=custom --file="$DB_TMP"
test -s "$DB_TMP"
mv "$DB_TMP" "$BACKUP_DIR/webplant_${STAMP}.dump"

if [ -d /uploads ]; then
    tar -czf "$UPLOADS_TMP" -C /uploads .
    test -s "$UPLOADS_TMP"
    mv "$UPLOADS_TMP" "$BACKUP_DIR/uploads_${STAMP}.tar.gz"
fi

find "$BACKUP_DIR" -type f \( -name 'webplant_*.dump' -o -name 'uploads_*.tar.gz' \) \
    -mtime "+$RETENTION_DAYS" -delete

echo "Backup completed at $STAMP"
