#!/usr/bin/env bash
# ORBES GENOME CODE: restore an encrypted backup (scripts/backup.sh) into the VPS stack.
#
#   scripts/restore.sh --identity <age identity file> [--archive <file> | --latest]
#                      [--db-only | --keys-only] [--no-safety-backup] [--yes] [--dry-run]
#
# DESTRUCTIVE: the current database volume and/or the keys volume are replaced
# by the archive's content. Without --yes you must type the APP_DOMAIN to go on.
#
#   1. Decrypt the archive (needs the OFFLINE age identity: copy it to the
#      server for the restore only, e.g. into a tmpfs, and delete it afterwards),
#      check the manifest checksums, `pg_restore --list` the dump and `tar -t` the
#      key archive. --dry-run stops here and prints what would be restored.
#   2. Safety backup of the current stack when its database is running
#      (scripts/backup.sh --reason pre-restore; --no-safety-backup skips it).
#   3. Stop the app. Database: remove the postgres container and its volume,
#      start an empty postgres, create the app role, pg_restore --exit-on-error
#      --single-transaction --no-privileges (the audit log refuses
#      TRUNCATE/DELETE, so restoring over data cannot work by design), then
#      grant the app role its DML rights again. Keys: empty the keys volume,
#      extract, chown 1000:1000, 0700 directory / 0600 files.
#   4. Start the stack when the app image exists (else run scripts/deploy.sh):
#      pending migrations of that image first (an older backup), then wait for
#      health, smoke test through Caddy, list the signing keys.
#
# --latest picks the newest archive in $BACKUP_DIR/daily, SKIPPING the
# "pre-restore" safety backups this script itself takes (so running the same
# restore twice never restores the state you were replacing).
#
# Needs the same KEY_ENCRYPTION_KEY (.env, from escrow) as when the backup was
# taken: the key files are encrypted under it. Exit codes: 0 ok, 1 failure,
# 2 usage error, 3 aborted by the operator.
set -Eeuo pipefail
umask 077
# shellcheck source=deploy/vps/scripts/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"

usage() { sed -n '2,/^set -Eeuo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'; }

IDENTITY=""
ARCHIVE=""
LATEST=false
DO_DB=true
DO_KEYS=true
SAFETY=true
YES=false
while (($#)); do
  case "$1" in
    --identity) IDENTITY=${2:?--identity needs a file}; shift 2 ;;
    --archive) ARCHIVE=${2:?--archive needs a file}; shift 2 ;;
    --latest) LATEST=true; shift ;;
    --db-only) DO_KEYS=false; shift ;;
    --keys-only) DO_DB=false; shift ;;
    --no-safety-backup) SAFETY=false; shift ;;
    --yes) YES=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ -n "$IDENTITY" ]] || { echo "--identity <age identity file> is required" >&2; usage >&2; exit 2; }
[[ "$DO_DB" == true || "$DO_KEYS" == true ]] || { echo "--db-only and --keys-only exclude each other" >&2; exit 2; }
[[ -r "$IDENTITY" ]] || die "cannot read the identity file $IDENTITY"

need_cmd docker age sha256sum tar
require_env_file
check_db_names
BACKUP_DIR="$(env_get BACKUP_DIR /var/backups/orbes)"
DOMAIN="$(env_get APP_DOMAIN)"
if [[ -z "$ARCHIVE" ]]; then
  [[ "$LATEST" == true ]] || die "name the archive (--archive <file>) or pass --latest"
  ARCHIVE="$(find "$BACKUP_DIR/daily" -maxdepth 1 -type f -name 'orbes-*.tar.age' ! -name '*-pre-restore.tar.age' 2>/dev/null | sort | tail -n1)"
  [[ -n "$ARCHIVE" ]] || die "no archive in $BACKUP_DIR/daily (pre-restore safety backups are only restored by name)"
  log "--latest: $ARCHIVE"
fi
[[ -r "$ARCHIVE" ]] || die "cannot read $ARCHIVE"

# ── 1. Decrypt and check ───────────────────────────────────────────────────
step "check $ARCHIVE"
if [[ -f "$ARCHIVE.sha256" ]]; then
  (cd "$(dirname -- "$ARCHIVE")" && sha256sum --quiet -c "$(basename -- "$ARCHIVE").sha256") || die "archive checksum mismatch (.sha256)"
  log "archive checksum OK"
fi
WORK_PARENT="${ORBES_RESTORE_WORKDIR:-$BACKUP_DIR}"
install -d -m 0700 "$WORK_PARENT"
WORK="$(mktemp -d "$WORK_PARENT/.restore.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
if ! age -d -i "$IDENTITY" "$ARCHIVE" 2>"$WORK/age.err" | tar -C "$WORK" -xf - manifest.json db.dump keys.tar 2>/dev/null; then
  die "cannot decrypt/unpack $ARCHIVE with $IDENTITY: $(head -c 300 "$WORK/age.err" | tr '\n' ' ')(wrong identity, or a damaged archive)"
fi
for f in db.dump keys.tar; do
  want="$(sed -n "/\"$f\"/s/.*\"sha256\": \"\\([0-9a-f]*\\)\".*/\\1/p" "$WORK/manifest.json")"
  [[ -n "$want" && "$(sha256sum "$WORK/$f" | cut -d' ' -f1)" == "$want" ]] || die "$f does not match the manifest checksum"
done
PG_IMAGE="$(sed -n 's/.*"image": "\([^"]*\)".*/\1/p' "$WORK/manifest.json" | head -n1)"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
docker run --rm -i --network none --entrypoint pg_restore "$PG_IMAGE" --list <"$WORK/db.dump" >"$WORK/db.toc"
grep -q 'TABLE DATA public cryptographic_keys' "$WORK/db.toc" || die "db.dump holds no cryptographic_keys data"
N_KEYFILES="$(tar -tf "$WORK/keys.tar" | grep -c '\.key\.json$' || true)"
log "archive verified: manifest checksums, $(grep -c 'TABLE DATA' "$WORK/db.toc") tables, $N_KEYFILES key file(s)"
printf '\n── manifest ──\n%s\n\n' "$(cat "$WORK/manifest.json")" >&2

PGDATA_VOLUME="$(volume_name pgdata)"
KEYS_VOLUME="$(volume_name keys)"
what=()
[[ "$DO_DB" == true ]] && what+=("database (volume $PGDATA_VOLUME is DELETED and recreated)")
[[ "$DO_KEYS" == true ]] && what+=("signing-key files (volume $KEYS_VOLUME is EMPTIED)")
log "will restore: ${what[*]}"
if [[ "$DRY_RUN" == true ]]; then
  log "[dry-run] nothing changed"
  exit 0
fi

# ── Confirmation ───────────────────────────────────────────────────────────
if [[ "$YES" != true ]]; then
  [[ -t 0 ]] || die "not a terminal: pass --yes to confirm a non-interactive restore"
  printf 'This REPLACES the live data of %s. Type the domain to continue: ' "$DOMAIN" >&2
  read -r answer
  [[ "$answer" == "$DOMAIN" ]] || { warn "aborted"; exit 3; }
fi

# ── 2. Safety backup ───────────────────────────────────────────────────────
if [[ "$SAFETY" == true && -n "$(service_container postgres)" ]]; then
  step "safety backup of the current state"
  "$SCRIPTS_DIR/backup.sh" --reason pre-restore --no-upload || die "safety backup failed (use --no-safety-backup to skip it knowingly)"
fi

# ── 3. Restore ─────────────────────────────────────────────────────────────
step "stop the app"
compose stop app >/dev/null 2>&1 || true

# A named volume that compose did not create gets these labels so compose adopts it.
ensure_volume() {
  local short=$1 full
  full="$(volume_name "$short")"
  docker volume inspect "$full" >/dev/null 2>&1 && return 0
  docker volume create --label "com.docker.compose.project=$(project_name)" \
    --label "com.docker.compose.volume=$short" "$full" >/dev/null
}

if [[ "$DO_DB" == true ]]; then
  step "database"
  compose rm -sf postgres >/dev/null 2>&1 || true
  if docker volume inspect "$PGDATA_VOLUME" >/dev/null 2>&1; then docker volume rm "$PGDATA_VOLUME" >/dev/null; fi
  compose up -d postgres
  wait_healthy postgres 180 || die "postgres did not become healthy"
  db_ensure_app_role
  # --no-privileges: the archive's GRANTs name the source host's roles; db_grant_app_role sets them here.
  # shellcheck disable=SC2016 # expanded by the container's shell
  compose exec -T postgres sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error --single-transaction' <"$WORK/db.dump"
  db_grant_app_role
  log "database restored; app role $(db_app_user) granted"
fi

if [[ "$DO_KEYS" == true ]]; then
  step "signing-key files"
  ensure_volume keys
  docker run --rm -i --network none -v "$KEYS_VOLUME:/keys" --entrypoint sh "$PG_IMAGE" -c '
    set -eu
    find /keys -mindepth 1 -delete
    tar -C /keys --no-same-owner -xf -
    chown -R 1000:1000 /keys
    chmod 0700 /keys
    find /keys -type f -exec chmod 0600 {} +
    find /keys -mindepth 1 -type d -exec chmod 0700 {} +' <"$WORK/keys.tar"
  log "keys volume restored ($N_KEYFILES key file(s))"
fi

# ── 4. Start and check ─────────────────────────────────────────────────────
TAG="$(env_get ORBES_IMAGE_TAG latest)"
if ! docker image inspect "orbes-genome:$TAG" >/dev/null 2>&1; then
  warn "image orbes-genome:$TAG not found: run scripts/deploy.sh to build and start the app"
  exit 0
fi
step "start the stack"
CADDY_CONFIG_HASH="$(cat "$STACK_DIR/Caddyfile" "$STACK_DIR"/caddy.d/*.caddy | sha256sum | cut -c1-16)"
export CADDY_CONFIG_HASH
ensure_caddy_config_readable
compose up -d postgres
wait_healthy postgres 180 || die "postgres did not become healthy"
db_prepare || die "database preparation (role, migrations of orbes-genome:$TAG, privileges) failed"
compose up -d
recreate_caddy_if_fixed
wait_healthy app 240 || die "the app is not healthy after the restore: docker compose logs app"
wait_healthy caddy 60 || die "caddy is not healthy"
body="$(https_get /api/v1/health)" || die "health check through Caddy failed: $body"
[[ "$body" == *'"ok":true'* ]] || die "health: $body"
log "health: $body"
compose exec -T app node --import tsx scripts/keys.ts list >&2 || warn "keys list failed"
log "restore complete. Next: check the audit chain anchor (docs/DEPLOYMENT.md §10) and scan a known product."
