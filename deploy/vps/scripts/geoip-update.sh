#!/usr/bin/env bash
# ORBES GENOME CODE: refresh the GeoIP database (GEO_MODE=mmdb) in the `geoip` volume.
#
#   scripts/geoip-update.sh [--force] [--month YYYY-MM] [--dry-run]
#   scripts/geoip-update.sh --check                 validate the installed file (no network)
#   scripts/geoip-update.sh --rollback              put the previous file back
#   scripts/geoip-update.sh --from-file <x.mmdb>    install a file obtained elsewhere (validated first)
#
# Wrapper around genome/scripts/geoip-update.ts (DB-IP "IP to City Lite",
# CC BY 4.0, "IP Geolocation by DB-IP", https://db-ip.com), run in the app
# image as the one-off compose service `geoip-update` (uid 1000, read-only
# root filesystem, outbound access through the `tools` network only). The
# updater validates the download with the server's own reader, installs it
# atomically and keeps <file>.previous; the running app picks the new file up
# within 10 minutes without a restart. Idempotent: an edition already
# installed is not downloaded again (unless --force).
#
# Runs monthly from the orbes-geoip.timer systemd unit. A failed refresh keeps
# the current file; a missing file only disables geolocation (never
# verification). Exit codes: 0 ok, 1 failure, 2 usage error.
set -Eeuo pipefail
# shellcheck source=deploy/vps/scripts/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"

usage() { sed -n '2,/^set -Eeuo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'; }

MODE=update
FROM_FILE=""
args=()
while (($#)); do
  case "$1" in
    --force) args+=(--force); shift ;;
    --month) args+=(--month "${2:?--month needs YYYY-MM}"); shift 2 ;;
    --dry-run) DRY_RUN=true; args+=(--dry-run); shift ;;
    --check) MODE=check; shift ;;
    --rollback) MODE=rollback; shift ;;
    --from-file) MODE=import; FROM_FILE=${2:?--from-file needs a file}; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

need_cmd docker
require_env_file
TAG="$(env_get ORBES_IMAGE_TAG latest)"
IMAGE="orbes-genome:$TAG"
FILE="$(env_get GEOIP_FILE dbip-city-lite.mmdb)"
[[ "$FILE" =~ ^[A-Za-z0-9._-]+\.mmdb$ ]] || die "GEOIP_FILE must be a plain file name ending in .mmdb"
TARGET="/var/lib/orbes/geoip/$FILE"
docker image inspect "$IMAGE" >/dev/null 2>&1 || die "image $IMAGE not found: run scripts/deploy.sh first"

# The volume: created with compose's labels (so compose adopts it) and owned by uid 1000.
VOLUME="$(volume_name geoip)"
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  run docker volume create --label "com.docker.compose.project=$(project_name)" --label com.docker.compose.volume=geoip "$VOLUME" >/dev/null
fi
run docker run --rm --network none --user 0 -v "$VOLUME:/geo" --entrypoint chown "$IMAGE" 1000:1000 /geo

# The updater ships in the image when the Dockerfile copies it; otherwise mount it from this checkout.
extra=()
if ! docker run --rm --network none --entrypoint test "$IMAGE" -f scripts/geoip-update.ts; then
  UPDATER="$REPO_DIR/genome/scripts/geoip-update.ts"
  [[ -r "$UPDATER" ]] || die "genome/scripts/geoip-update.ts not found (neither in $IMAGE nor in $REPO_DIR)"
  extra+=(-v "$UPDATER:/app/scripts/geoip-update.ts:ro")
fi

case "$MODE" in
  update)
    log "refreshing $TARGET in volume $VOLUME"
    # --dry-run is handled by the updater itself (it downloads and writes nothing).
    compose run --rm --no-deps "${extra[@]}" geoip-update --path "$TARGET" "${args[@]}"
    ;;
  check)
    compose run --rm --no-deps "${extra[@]}" geoip-update --check "$TARGET"
    ;;
  rollback)
    run compose run --rm --no-deps "${extra[@]}" geoip-update --path "$TARGET" --rollback
    ;;
  import)
    [[ -r "$FROM_FILE" ]] || die "cannot read $FROM_FILE"
    SRC="$(cd -- "$(dirname -- "$FROM_FILE")" && pwd -P)/$(basename -- "$FROM_FILE")"
    log "validating $SRC"
    compose run --rm --no-deps "${extra[@]}" -v "$SRC:/import/in.mmdb:ro" geoip-update --check /import/in.mmdb
    log "installing it as $TARGET (the current file is kept as $FILE.previous)"
    run compose run --rm --no-deps -v "$SRC:/import/in.mmdb:ro" --entrypoint sh geoip-update -c '
      set -eu
      t="$1"; d="$(dirname "$t")"
      cp /import/in.mmdb "$d/.import.tmp"
      sync
      if [ -f "$t" ]; then ln -f "$t" "$t.previous"; fi
      mv -f "$d/.import.tmp" "$t"
      rm -f "$t.json"' sh "$TARGET"
    ;;
esac
log "done"
