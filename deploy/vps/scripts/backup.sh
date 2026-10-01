#!/usr/bin/env bash
# ORBES GENOME CODE: encrypted backup of the VPS stack (database + signing-key files).
#
#   scripts/backup.sh [--reason <label>] [--no-upload] [--verify-identity <age identity file>]
#                     [--dry-run] [--quiet]
#
# One archive per run: $BACKUP_DIR/daily/orbes-<UTC time>[-<reason>].tar.age
#   = age-encrypted tar of
#       manifest.json   time, image tag, schema migrations, key ids/status, checksums
#       db.dump         pg_dump --format=custom of the database (dumped FIRST)
#       keys.tar        the `keys` volume (key files stay AES-GCM-encrypted under
#                       KEY_ENCRYPTION_KEY, which is NOT in the backup)
# encrypted to every recipient of BACKUP_AGE_RECIPIENTS_FILE (age public keys).
# The private identity lives offline: this server cannot read its own backups.
#
# Integrity: the dump is checked with pg_restore --list and the key tar with
# tar -t before encryption; the archive is re-read after writing (SHA-256 of
# the bytes streamed == SHA-256 of the file on disk, age header and recipient
# count). With --verify-identity (restore drills, never on the server in
# steady state) the archive is fully decrypted and every checksum compared.
#
# Retention: newest BACKUP_KEEP_DAILY archives in daily/, plus the first archive
# of each ISO week hard-linked into weekly/ (newest BACKUP_KEEP_WEEKLY kept).
# Off-site: with BACKUP_RCLONE_DEST (e.g. ovh-s3:orbes-backups/verify) each new
# archive is copied with rclone, checked, and remote copies older than the
# local retention are deleted.
#
# Plaintext handling: the dump and the key tar are staged in a 0700 work
# directory inside BACKUP_DIR for the duration of the run and removed on exit
# (also on failure). Exit codes: 0 ok, 1 failure, 2 usage error.
set -Eeuo pipefail
umask 077
# shellcheck source=deploy/vps/scripts/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"

usage() { sed -n '2,/^set -Eeuo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'; }

REASON=""
UPLOAD=true
VERIFY_IDENTITY=""
while (($#)); do
  case "$1" in
    --reason) REASON=${2:?--reason needs a value}; shift 2 ;;
    --no-upload) UPLOAD=false; shift ;;
    --verify-identity) VERIFY_IDENTITY=${2:?--verify-identity needs a file}; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --quiet) QUIET=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ -z "$REASON" || "$REASON" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "--reason: letters, digits, . _ - only (max 64)" >&2; exit 2; }

need_cmd docker age sha256sum tar
require_env_file
BACKUP_DIR="$(env_get BACKUP_DIR /var/backups/orbes)"
RECIPIENTS="$(env_get BACKUP_AGE_RECIPIENTS_FILE /opt/orbes/backup-recipients.txt)"
KEEP_DAILY="$(env_get BACKUP_KEEP_DAILY 14)"
KEEP_WEEKLY="$(env_get BACKUP_KEEP_WEEKLY 8)"
RCLONE_DEST="$(env_get BACKUP_RCLONE_DEST)"
[[ "$KEEP_DAILY" =~ ^[1-9][0-9]*$ && "$KEEP_WEEKLY" =~ ^[0-9]+$ ]] || die "BACKUP_KEEP_DAILY / BACKUP_KEEP_WEEKLY must be integers (daily ≥ 1)"

# Recipients: at least one age public key (age1…) or SSH public key; never a private identity.
[[ -s "$RECIPIENTS" ]] || die "no age recipients file at $RECIPIENTS (scripts/setup.sh creates it)"
if grep -q 'AGE-SECRET-KEY-' "$RECIPIENTS"; then die "$RECIPIENTS contains a PRIVATE age key: keep only public keys on the server"; fi
N_RECIPIENTS="$(grep -cE '^(age1[0-9a-z]+|ssh-(ed25519|rsa) )' "$RECIPIENTS" || true)"
(( N_RECIPIENTS > 0 )) || die "$RECIPIENTS holds no age1… or ssh public key"

[[ -n "$(service_container postgres)" ]] || die "the postgres service is not running (docker compose up -d postgres)"
KEYS_VOLUME="$(volume_name keys)"
docker volume inspect "$KEYS_VOLUME" >/dev/null 2>&1 || die "volume $KEYS_VOLUME not found"
PG_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$(service_container postgres)")"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="orbes-${STAMP}${REASON:+-$REASON}.tar.age"
DAILY="$BACKUP_DIR/daily"
WEEKLY="$BACKUP_DIR/weekly"
OUT="$DAILY/$NAME"

if [[ "$DRY_RUN" == true ]]; then
  log "[dry-run] would dump database + volume $KEYS_VOLUME, encrypt to $N_RECIPIENTS recipient(s) from $RECIPIENTS"
  log "[dry-run] would write $OUT (+ .sha256), keep $KEEP_DAILY daily / $KEEP_WEEKLY weekly${RCLONE_DEST:+, copy to $RCLONE_DEST}"
  exit 0
fi

install -d -m 0700 "$BACKUP_DIR" "$DAILY" "$WEEKLY"
WORK="$(mktemp -d "$BACKUP_DIR/.work.XXXXXX")"
cleanup() { rm -rf -- "$WORK"; rm -f -- "$OUT.partial"; }
trap cleanup EXIT

# ── Database (first: a rotation during the run then only adds a key FILE, which is harmless) ──
step "database dump"
compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6' >"$WORK/db.dump"
docker run --rm -i --network none --entrypoint pg_restore "$PG_IMAGE" --list <"$WORK/db.dump" >"$WORK/db.toc"
grep -q 'TABLE DATA public cryptographic_keys' "$WORK/db.toc" || die "the dump has no cryptographic_keys data: wrong database?"
log "db.dump: $(stat -c %s "$WORK/db.dump") bytes, $(grep -c 'TABLE DATA' "$WORK/db.toc") tables"

psql_q() { compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -XAtqc \"$1\""; }
MIGRATIONS="$(psql_q "select coalesce(json_agg(name order by name), '[]') from kysely_migration")"
KEYS_JSON="$(psql_q "select coalesce(json_agg(json_build_object('keyId', id, 'kid', kid, 'status', status) order by id), '[]') from cryptographic_keys")"
PG_VERSION="$(psql_q 'show server_version')"

# ── Signing-key files ──────────────────────────────────────────────────────
step "keys volume"
docker run --rm --network none --user 1000:1000 -v "$KEYS_VOLUME:/keys:ro" --entrypoint tar "$PG_IMAGE" \
  -C /keys --numeric-owner -cpf - . >"$WORK/keys.tar"
N_KEYFILES="$(tar -tf "$WORK/keys.tar" | grep -c '\.key\.json$' || true)"
log "keys.tar: $N_KEYFILES key file(s)"

# ── Manifest ───────────────────────────────────────────────────────────────
APP_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$(service_container app)" 2>/dev/null || echo unknown)"
DB_SHA="$(sha256sum "$WORK/db.dump" | cut -d' ' -f1)"
KEYS_SHA="$(sha256sum "$WORK/keys.tar" | cut -d' ' -f1)"
cat >"$WORK/manifest.json" <<JSON
{
  "format": "orbes-vps-backup/1",
  "createdAt": "$(_ts)",
  "reason": "${REASON:-scheduled}",
  "host": "$(hostname)",
  "appDomain": "$(env_get APP_DOMAIN)",
  "appImage": "$APP_IMAGE",
  "postgres": { "image": "$PG_IMAGE", "serverVersion": "$PG_VERSION" },
  "migrations": $MIGRATIONS,
  "keys": $KEYS_JSON,
  "files": {
    "db.dump": { "sha256": "$DB_SHA", "bytes": $(stat -c %s "$WORK/db.dump") },
    "keys.tar": { "sha256": "$KEYS_SHA", "bytes": $(stat -c %s "$WORK/keys.tar"), "keyFiles": $N_KEYFILES }
  }
}
JSON

# ── Encrypt + write + verify ───────────────────────────────────────────────
step "encrypt to $N_RECIPIENTS recipient(s)"
STREAM_SHA="$(tar -C "$WORK" -cf - manifest.json db.dump keys.tar | age -R "$RECIPIENTS" | tee "$OUT.partial" | sha256sum | cut -d' ' -f1)"
sync -f "$OUT.partial" 2>/dev/null || sync
FILE_SHA="$(sha256sum "$OUT.partial" | cut -d' ' -f1)"
[[ "$STREAM_SHA" == "$FILE_SHA" ]] || die "archive re-read mismatch ($STREAM_SHA != $FILE_SHA): disk problem?"
[[ "$(head -c 21 "$OUT.partial")" == "age-encryption.org/v1" ]] || die "archive does not start with an age header"
STANZAS="$(head -c 65536 "$OUT.partial" | grep -a -c '^-> ' || true)"
(( STANZAS >= N_RECIPIENTS )) || die "archive has $STANZAS recipient stanza(s), expected $N_RECIPIENTS"
mv -f "$OUT.partial" "$OUT"
(cd "$DAILY" && sha256sum "$NAME" >"$NAME.sha256")
log "wrote $OUT ($(stat -c %s "$OUT") bytes, sha256 $FILE_SHA)"

if [[ -n "$VERIFY_IDENTITY" ]]; then
  step "full decryption check"
  CHECK="$WORK/check"
  mkdir -m 0700 "$CHECK"
  age -d -i "$VERIFY_IDENTITY" "$OUT" | tar -C "$CHECK" -xf -
  [[ "$(sha256sum "$CHECK/db.dump" | cut -d' ' -f1)" == "$DB_SHA" ]] || die "decrypted db.dump checksum mismatch"
  [[ "$(sha256sum "$CHECK/keys.tar" | cut -d' ' -f1)" == "$KEYS_SHA" ]] || die "decrypted keys.tar checksum mismatch"
  log "decrypted with $VERIFY_IDENTITY: checksums match"
fi

# ── Weekly copy + retention ────────────────────────────────────────────────
WEEK="$(date -u +%G-W%V)"
if ! compgen -G "$WEEKLY/orbes-$WEEK-*.tar.age" >/dev/null; then
  ln -f "$OUT" "$WEEKLY/orbes-$WEEK-${NAME#orbes-}"
  (cd "$WEEKLY" && sha256sum "orbes-$WEEK-${NAME#orbes-}" >"orbes-$WEEK-${NAME#orbes-}.sha256")
  log "weekly copy for $WEEK"
fi

prune() {
  local dir=$1 keep=$2 f
  local -a files=()
  mapfile -t files < <(find "$dir" -maxdepth 1 -type f -name 'orbes-*.tar.age' -printf '%f\n' | sort -r)
  local i
  for ((i = keep; i < ${#files[@]}; i++)); do
    f="$dir/${files[i]}"
    rm -f -- "$f" "$f.sha256"
    log "pruned ${files[i]}"
  done
}
prune "$DAILY" "$KEEP_DAILY"
prune "$WEEKLY" "$KEEP_WEEKLY"

# ── Off-site copy (rclone → OVH Object Storage) ────────────────────────────
if [[ -n "$RCLONE_DEST" && "$UPLOAD" == true ]]; then
  step "off-site copy to $RCLONE_DEST"
  need_cmd rclone
  rclone copy --no-traverse "$DAILY" "$RCLONE_DEST/daily" --include "$NAME" --include "$NAME.sha256"
  rclone check --one-way "$DAILY" "$RCLONE_DEST/daily" --include "$NAME"
  if [[ -f "$WEEKLY/orbes-$WEEK-${NAME#orbes-}" ]]; then
    rclone copy --no-traverse "$WEEKLY" "$RCLONE_DEST/weekly" --include "orbes-$WEEK-${NAME#orbes-}" --include "orbes-$WEEK-${NAME#orbes-}.sha256"
  fi
  # Remote retention mirrors the local one (by age). An Object Lock / versioning policy
  # on the bucket (docs §15.8) protects against a compromised server deleting backups.
  rclone delete --min-age "$((KEEP_DAILY + 1))d" "$RCLONE_DEST/daily" || warn "remote daily pruning failed"
  rclone delete --min-age "$((KEEP_WEEKLY * 7 + 7))d" "$RCLONE_DEST/weekly" || warn "remote weekly pruning failed"
  log "copied and checked off-site"
fi

ensure_state_dir
printf '%s %s %s\n' "$(_ts)" "$OUT" "$FILE_SHA" >"$STATE_DIR/last-backup"
log "backup complete: $OUT"
