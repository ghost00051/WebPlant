#!/bin/sh
set -eu
umask 077

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
ENCRYPTION_PASSPHRASE="${BACKUP_ENCRYPTION_PASSPHRASE:-}"
OFFSITE_TARGET="${BACKUP_OFFSITE_TARGET:-}"

HEARTBEAT="$BACKUP_DIR/.last-success"
LOG_FILE="$BACKUP_DIR/backup.log"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

TMP_PREFIX="$BACKUP_DIR/.tmp_${STAMP}"
DB_TMP="${TMP_PREFIX}_db.dump"
DB_TOC_TMP="${TMP_PREFIX}_db.toc"
DB_ENC_TMP="${TMP_PREFIX}_db.dump.enc"
UPLOADS_TMP="${TMP_PREFIX}_uploads.tar.gz"
UPLOADS_ENC_TMP="${TMP_PREFIX}_uploads.tar.gz.enc"

PRODUCED_FILES=""
TOTAL_BYTES=0
OFFSITE_FAILED=0
ENCRYPTION_KIND="none"
ENCRYPTED_PATH=""

log() {
    _level="$1"
    shift
    _line="$(date -u +%Y-%m-%dT%H:%M:%SZ) [${_level}] $*"
    case "$_level" in
        ERROR|WARN) printf '%s\n' "$_line" >&2 ;;
        *) printf '%s\n' "$_line" ;;
    esac
    printf '%s\n' "$_line" >> "$LOG_FILE" 2>/dev/null || true
}

cleanup() {
    _status=$?
    rm -f "$DB_TMP" "$DB_TOC_TMP" "$DB_ENC_TMP" "$UPLOADS_TMP" "$UPLOADS_ENC_TMP" 2>/dev/null || true
    rm -f "$BACKUP_DIR/.tmp_${STAMP}_"* 2>/dev/null || true
    rm -f "$HEARTBEAT.tmp" 2>/dev/null || true
    if [ "$_status" -ne 0 ]; then
        log ERROR "backup run failed (exit ${_status}); temporary files removed, heartbeat left untouched"
    fi
    exit "$_status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

encrypt_backup_file() {
    _src="$1"
    _base="$2"
    _enc="$3"

    if [ -z "$ENCRYPTION_PASSPHRASE" ]; then
        return 2
    fi

    rm -f "$_enc" 2>/dev/null || true

    if command -v gpg >/dev/null 2>&1; then
        if printf '%s' "$ENCRYPTION_PASSPHRASE" | gpg --batch --yes --quiet \
                --pinentry-mode loopback --symmetric --cipher-algo AES256 \
                --passphrase-fd 0 --output "$_enc" "$_src" 2>/dev/null \
                && [ -s "$_enc" ]; then
            mv "$_enc" "${_base}.gpg"
            ENCRYPTED_PATH="${_base}.gpg"
            ENCRYPTION_KIND="gpg"
            return 0
        fi
        rm -f "$_enc" 2>/dev/null || true
        log ERROR "gpg --symmetric failed for $(basename "$_base") (empty output or gpg error)"
        return 1
    fi

    if command -v age >/dev/null 2>&1; then
        if age --passphrase --output "$_enc" "$_src" < /dev/null 2>/dev/null \
                && [ -s "$_enc" ]; then
            mv "$_enc" "${_base}.age"
            ENCRYPTED_PATH="${_base}.age"
            ENCRYPTION_KIND="age"
            return 0
        fi
        rm -f "$_enc" 2>/dev/null || true
        log ERROR "age --passphrase failed for $(basename "$_base"): age needs an interactive terminal, use gpg for unattended runs"
        return 1
    fi

    log WARN "BACKUP_ENCRYPTION_PASSPHRASE is set but neither gpg nor age is installed; keeping the file unencrypted"
    return 2
}

offsite_copy() {
    if [ -z "$OFFSITE_TARGET" ]; then
        return 0
    fi
    if ! command -v rclone >/dev/null 2>&1; then
        log ERROR "BACKUP_OFFSITE_TARGET is set but rclone is not installed; offsite copy skipped"
        return 1
    fi
    if rclone copy --no-traverse --retries 3 "$1" "$OFFSITE_TARGET" >/dev/null 2>&1; then
        log INFO "offsite copy ok: $(basename "$1") -> ${OFFSITE_TARGET}"
        return 0
    fi
    log ERROR "rclone copy failed: $(basename "$1") -> ${OFFSITE_TARGET}"
    return 1
}

register_backup_file() {
    _path="$1"
    _size="$(wc -c < "$_path" | tr -d ' ')"
    PRODUCED_FILES="${PRODUCED_FILES}file=${_path}
size_bytes=${_size}
"
    TOTAL_BYTES=$((TOTAL_BYTES + _size))
    log INFO "created ${_path} (${_size} bytes)"
    offsite_copy "$_path" || OFFSITE_FAILED=1
}

publish_backup_file() {
    _src="$1"
    _base="$2"
    _enc_tmp="$3"
    _label="$4"

    ENCRYPTED_PATH=""
    _rc=0
    encrypt_backup_file "$_src" "$_base" "$_enc_tmp" || _rc=$?

    case "$_rc" in
        0)
            rm -f "$_src" 2>/dev/null || true
            register_backup_file "$ENCRYPTED_PATH"
            log INFO "${_label} encrypted with ${ENCRYPTION_KIND}: $(basename "$ENCRYPTED_PATH")"
            ;;
        2)
            mv "$_src" "$_base"
            register_backup_file "$_base"
            log WARN "${_label} stored WITHOUT encryption: $(basename "$_base")"
            ;;
        *)
            log ERROR "${_label} encryption failed; aborting so that no unverified artifact is kept"
            exit 1
            ;;
    esac
}

mkdir -p "$BACKUP_DIR"

for _tool in pg_dump pg_restore; do
    if ! command -v "$_tool" >/dev/null 2>&1; then
        log ERROR "${_tool} not found in PATH"
        exit 1
    fi
done

if [ -n "$ENCRYPTION_PASSPHRASE" ]; then
    _enc_state="requested"
else
    _enc_state="off"
fi
if [ -n "$OFFSITE_TARGET" ]; then
    _offsite_state="requested"
else
    _offsite_state="off"
fi
log INFO "backup started (stamp=${STAMP}, retention=${RETENTION_DAYS}d, encryption=${_enc_state}, offsite=${_offsite_state})"

log INFO "running pg_dump --format=custom"
if pg_dump --format=custom --file="$DB_TMP"; then
    :
else
    _rc=$?
    log ERROR "pg_dump failed with exit code ${_rc}"
    exit 1
fi

if [ ! -s "$DB_TMP" ]; then
    log ERROR "pg_dump produced an empty or missing file (${DB_TMP}); refusing to publish it"
    exit 1
fi
log INFO "pg_dump wrote $(wc -c < "$DB_TMP" | tr -d ' ') bytes"

log INFO "verifying the dump with pg_restore --list"
if pg_restore --list "$DB_TMP" > "$DB_TOC_TMP"; then
    :
else
    _rc=$?
    log ERROR "pg_restore --list rejected the dump (exit code ${_rc}): archive is corrupt or truncated"
    exit 1
fi
if [ ! -s "$DB_TOC_TMP" ]; then
    log ERROR "pg_restore --list returned an empty table of contents"
    exit 1
fi
log INFO "dump verified: pg_restore --list reports $(wc -l < "$DB_TOC_TMP") entries"

publish_backup_file "$DB_TMP" "$BACKUP_DIR/webplant_${STAMP}.dump" "$DB_ENC_TMP" "database dump"

if [ -d /uploads ]; then
    log INFO "archiving /uploads"
    if tar -czf "$UPLOADS_TMP" -C /uploads . 2>/dev/null; then
        :
    else
        _rc=$?
        log ERROR "tar failed for /uploads (exit code ${_rc})"
        exit 1
    fi
    if [ ! -s "$UPLOADS_TMP" ]; then
        log ERROR "uploads archive is empty (${UPLOADS_TMP})"
        exit 1
    fi
    publish_backup_file "$UPLOADS_TMP" "$BACKUP_DIR/uploads_${STAMP}.tar.gz" "$UPLOADS_ENC_TMP" "uploads archive"
else
    log WARN "/uploads is not mounted; skipping the uploads archive"
fi

log INFO "applying retention: deleting backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -type f \
    \( -name 'webplant_*.dump*' -o -name 'uploads_*.tar.gz*' \) \
    -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true

if [ "$OFFSITE_FAILED" -ne 0 ]; then
    log ERROR "offsite copy failed for at least one file; heartbeat not updated so monitoring sees the failure"
    exit 1
fi

{
    printf 'finished_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'started_at=%s\n' "$STARTED_AT"
    printf 'stamp=%s\n' "$STAMP"
    printf 'encryption=%s\n' "$ENCRYPTION_KIND"
    if [ -n "$OFFSITE_TARGET" ]; then
        printf 'offsite=%s\n' "$OFFSITE_TARGET"
    else
        printf 'offsite=off\n'
    fi
    printf 'total_bytes=%s\n' "$TOTAL_BYTES"
    printf 'retention_days=%s\n' "$RETENTION_DAYS"
    printf '%s' "$PRODUCED_FILES"
} > "$HEARTBEAT.tmp"
mv "$HEARTBEAT.tmp" "$HEARTBEAT"

log INFO "backup finished: stamp=${STAMP} encryption=${ENCRYPTION_KIND} total=${TOTAL_BYTES} bytes (heartbeat: ${HEARTBEAT})"
