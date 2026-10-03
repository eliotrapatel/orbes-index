#!/usr/bin/env bash
# ORBES GENOME CODE: deploy a git ref of this repository to the VPS stack.
#
#   scripts/deploy.sh [<git-ref> | --ref <git-ref>] [--worktree] [--no-backup] [--skip-smoke]
#                     [--timeout <s>] [--dry-run]
#   scripts/deploy.sh --image <tag>      roll out an image that already exists (e.g. a tag
#                                        from .state/deploys.log), without building; refused
#                                        when it does not know every migration the database
#                                        holds (it cannot run on that schema: repair forward)
#   scripts/deploy.sh --rebuild          rebuild the same commit with fresh base images
#                                        (docker build --pull; tag <commit>-r<time>)
#
# Shared host: refuses to run while COMPOSE_PROJECT_NAME (another value than the
# stack's) or ORBES_IMAGE_TAG is exported in the shell (lib.sh guard_shared_host_env).
#
# Steps
#   1. Export the ref (default HEAD) with `git archive` into a temporary build
#      context: the working tree is never checked out or modified, and
#      uncommitted changes are never deployed by accident (--worktree builds
#      the working tree as it is, tagged <commit>-dirty-<time>). Its files are
#      made readable by everyone whatever the caller's umask (setup.sh runs
#      under 077): the image's `node` user must read its root-owned sources.
#   2. docker build -> orbes-genome:<commit12>. BUILD_EXTRA_CA_FILE (.env) is
#      passed as the extra_ca BuildKit secret when set (TLS-inspecting proxy).
#      An existing image of that commit is reused, unless its user cannot read
#      its sources (built under umask 077 before step 1 normalised them).
#   3. The Caddy configuration is made readable by the Caddy container (it has
#      no capabilities) and validated with the values of .env (a typo
#      must not take the only public entry point down). Then the schema
#      check: the migrations applied in the database (PostgreSQL is started
#      for it when it is down) must all be known to the image, or the
#      deployment stops here, before any backup and with nothing stopped.
#      Then an encrypted backup (scripts/backup.sh) when the stack was already
#      running and holds data (--no-backup skips it).
#   4. ORBES_IMAGE_TAG=<tag> in .env; PostgreSQL up; the app role
#      (POSTGRES_APP_USER, DML only) ensured; pending migrations applied with
#      the new image as the schema owner, all in one transaction (the app is
#      stopped first when its image changes, so old code never runs on a
#      newer schema); privileges granted; `docker compose up -d`; wait until
#      everything is healthy.
#   5. First signing key if none is ACTIVE (npm run keys:generate in the app).
#   6. Smoke tests through Caddy: https://$APP_DOMAIN/api/v1/health,
#      /.well-known/orbes-keys.json (an ACTIVE key), /verify.
#   7. Any failure in 4–6, when this release applied no migration: automatic
#      rollback to the previous image tag, then exit 1. When it did (its
#      migrations committed, then health, Caddy, the signing key or the smoke
#      tests failed), the previous image cannot run on the new schema: no
#      rollback is attempted, ORBES_IMAGE_TAG stays on the new image with the
#      stack started on it, and the way to repair forward is printed
#      (scripts/deploy.sh --image <new tag> after a transient incident,
#      otherwise a corrective commit), then exit 1. The same when this cannot
#      be told (the applied migrations cannot be read after the migration
#      step), or when the previous image does not know every migration the
#      database holds. On success, the rollback hint is given only when the
#      schema was read and this release applied no migration. restore.sh is
#      not used on the shared server (RESTORE_ALLOWED=false,
#      docs/DEPLOYMENT.md §15.9).
#
# Exit codes: 0 deployed, 1 failed (rolled back, or kept to be repaired
# forward, as printed), 2 usage error.
set -Eeuo pipefail
# shellcheck source=deploy/vps/scripts/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  sed -n '2,/^set -Eeuo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}

REF=HEAD
IMAGE_TAG=""
REBUILD=false
WORKTREE=false
BACKUP=true
SMOKE=true
TIMEOUT=180
while (($#)); do
  case "$1" in
    --ref) REF=${2:?--ref needs a value}; shift 2 ;;
    --ref=*) REF=${1#*=}; shift ;;
    --worktree) WORKTREE=true; shift ;;
    --image) IMAGE_TAG=${2:?--image needs a tag}; shift 2 ;;
    --rebuild) REBUILD=true; shift ;;
    --no-backup) BACKUP=false; shift ;;
    --skip-smoke) SMOKE=false; shift ;;
    --timeout) TIMEOUT=${2:?--timeout needs seconds}; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) usage >&2; exit 2 ;;
    *) REF=$1; shift ;; # positional ref: scripts/deploy.sh <commit|tag|branch>
  esac
done
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || { echo "--timeout must be a number of seconds" >&2; exit 2; }

need_cmd docker curl git tar sha256sum
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is missing"
require_env_file
guard_shared_host_env
check_db_names
ensure_state_dir
DOMAIN="$(env_get APP_DOMAIN)"
[[ -n "$DOMAIN" ]] || die "APP_DOMAIN is empty in $ENV_FILE"

# ── 1–2. Source snapshot and build (skipped with --image) ─────────────────
if [[ -n "$IMAGE_TAG" ]]; then
  [[ "$IMAGE_TAG" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || die "invalid image tag: $IMAGE_TAG"
  TAG="$IMAGE_TAG"
  IMAGE="orbes-genome:$TAG"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "image $IMAGE not found (docker images orbes-genome)"
  log "rolling out the existing image $IMAGE (no build)"
else
  step "source"
  BUILD_CTX="$(mktemp -d "${TMPDIR:-/tmp}/orbes-build.XXXXXX")"
  cleanup() { rm -rf -- "$BUILD_CTX"; }
  trap cleanup EXIT

  if git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    COMMIT="$(git -C "$REPO_DIR" rev-parse --verify --quiet "${REF}^{commit}")" || die "unknown git ref: $REF (git fetch first?)"
    SHORT="${COMMIT:0:12}"
  else
    [[ "$WORKTREE" == true ]] || die "$REPO_DIR is not a git checkout: use --worktree"
    COMMIT=unknown
    SHORT=nogit
  fi

  if [[ "$WORKTREE" == true ]]; then
    TAG="${SHORT}-dirty-$(date -u +%Y%m%d%H%M%S)"
    log "building the working tree of $REPO_DIR/genome as is (tag $TAG)"
    # Same exclusions as the image build itself (.dockerignore), applied by docker build.
    tar -C "$REPO_DIR/genome" --exclude=./node_modules --exclude=./dist --exclude=./out \
      --exclude=./.vitest --exclude='./*.y4m' -cf - . | tar -C "$BUILD_CTX" -xf -
  else
    TAG="$SHORT"
    if [[ "$REBUILD" == true ]]; then TAG="${SHORT}-r$(date -u +%Y%m%d%H%M%S)"; fi
    log "ref $REF = commit $COMMIT (tag $TAG)"
    if [[ -n "$(git -C "$REPO_DIR" status --porcelain -- genome 2>/dev/null)" && "$REF" == HEAD ]]; then
      warn "genome/ has uncommitted changes: they are NOT deployed (commit them, or use --worktree)"
    fi
    git -C "$REPO_DIR" archive --format=tar "$COMMIT" genome | tar -C "$BUILD_CTX" -xf - --strip-components=1
  fi
  [[ -f "$BUILD_CTX/Dockerfile" ]] || die "no genome/Dockerfile in the build context"
  normalize_build_context "$BUILD_CTX"

  # ── 2. Build ───────────────────────────────────────────────────────────────
  step "build orbes-genome:$TAG"
  IMAGE="orbes-genome:$TAG"
  build_args=(--label "org.opencontainers.image.revision=$COMMIT" --label "org.opencontainers.image.version=$TAG" -t "$IMAGE")
  if [[ "$REBUILD" == true ]]; then build_args+=(--pull); fi
  EXTRA_CA="$(env_get BUILD_EXTRA_CA_FILE)"
  if [[ -n "$EXTRA_CA" ]]; then
    [[ -r "$EXTRA_CA" ]] || die "BUILD_EXTRA_CA_FILE=$EXTRA_CA is not readable"
    build_args+=(--secret "id=extra_ca,src=$EXTRA_CA")
  fi
  for v in HTTPS_PROXY HTTP_PROXY NO_PROXY; do
    if [[ -n "${!v:-}" ]]; then build_args+=(--build-arg "$v=${!v}"); fi
  done
  reuse=false
  if docker image inspect "$IMAGE" >/dev/null 2>&1 && [[ "$WORKTREE" != true ]]; then
    if image_sources_readable "$IMAGE"; then
      reuse=true
    else
      warn "$IMAGE exists, but its user cannot read its sources (built under a restrictive umask): rebuilding it"
    fi
  fi
  if [[ "$reuse" == true ]]; then
    log "$IMAGE already exists: reusing it"
  else
    run env DOCKER_BUILDKIT=1 docker build "${build_args[@]}" "$BUILD_CTX"
  fi
fi

# ── 3. Caddy configuration, schema check, pre-deploy backup ───────────────
step "Caddy configuration"
ensure_caddy_config_readable
caddy_validate || die "fix $ENV_FILE (or the Caddyfile) first: nothing was changed"

PREV_TAG="$(env_get ORBES_IMAGE_TAG latest)"
APP_CID="$(service_container app)"
if [[ -n "$APP_CID" ]]; then
  PREV_TAG="$(docker inspect -f '{{.Config.Image}}' "$APP_CID" | sed 's/^orbes-genome://')"
fi
log "previous image tag: $PREV_TAG"

# The way out of a failed release that migrated: never a rollback (the previous image cannot
# run on the new schema), never restore.sh on the shared server (RESTORE_ALLOWED=false).
repair_forward_help() {
  local tag=$1
  printf '%s\n' \
    "  Repair forward:" \
    "  - after a transient incident (network, full disk, a service briefly down): fix it, then" \
    "      scripts/deploy.sh --image $tag" \
    "  - otherwise: a corrective commit, deployed normally (git pull && scripts/deploy.sh)." \
    "  restore.sh is not used on the shared server (RESTORE_ALLOWED=false; docs/DEPLOYMENT.md §15.7, §15.9)." >&2
}

# Schema check, before any backup and before anything is stopped.
# An image that does not know every migration applied in the database cannot migrate, so it
# cannot run here (e.g. `--image <tag of an older release>` after a release that migrated):
# without this check, the rollout would stop the app, write .env, fail at the migration step
# and leave the site down, after a pre-deploy backup named after the wrong image.
step "schema"
PG_WAS_RUNNING=false
if [[ -n "$(service_container postgres)" ]]; then PG_WAS_RUNNING=true; fi
APPLIED_BEFORE=""
if [[ "$DRY_RUN" == true && "$PG_WAS_RUNNING" != true ]]; then
  log "[dry-run] PostgreSQL is not running: the schema check would start it"
elif [[ "$DRY_RUN" == true ]] && ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  log "[dry-run] $IMAGE is not built: schema check skipped"
else
  # What a stop here leaves behind: nothing, or PostgreSQL started for this check.
  UNCHANGED="nothing was changed"
  PG_STARTED=""
  if [[ "$PG_WAS_RUNNING" != true ]]; then
    log "starting PostgreSQL to read the schema"
    compose up -d postgres || die "PostgreSQL did not start: nothing else was changed"
    wait_healthy postgres "$TIMEOUT" || die "PostgreSQL is not healthy: nothing else was changed"
    PG_STARTED=" (PostgreSQL was started to read the schema)"
    UNCHANGED="nothing else was changed$PG_STARTED"
  fi
  APPLIED_BEFORE="$(db_applied_migrations)" || die "cannot read the applied migrations (kysely_migration): $UNCHANGED"
  KNOWN="$(image_migrations "$IMAGE")" || die "cannot list the migrations $IMAGE knows: $UNCHANGED"
  UNKNOWN="$(lines_not_in "$APPLIED_BEFORE" "$KNOWN")"
  if [[ -n "$UNKNOWN" ]]; then
    err "this image cannot run on this schema: repair forward. The database holds migration(s) that $IMAGE does not know: $(words "$UNKNOWN")."
    warn "nothing was stopped and no backup was written; the stack stays on orbes-genome:$PREV_TAG$PG_STARTED."
    repair_forward_help "$PREV_TAG"
    exit 1
  fi
  log "schema: $(grep -c . <<<"$APPLIED_BEFORE" || true) migration(s) applied, all known to $IMAGE"
fi

if [[ "$BACKUP" == true && "$PG_WAS_RUNNING" == true ]]; then
  step "pre-deploy backup"
  run "$SCRIPTS_DIR/backup.sh" --reason "pre-deploy-$TAG"
fi

if [[ "$DRY_RUN" == true ]]; then
  log "[dry-run] would set ORBES_IMAGE_TAG=$TAG, run docker compose up -d, wait for health, check keys and smoke test"
  exit 0
fi

# ── 4. Roll out ────────────────────────────────────────────────────────────
CADDY_CONFIG_HASH="$(cat "$STACK_DIR/Caddyfile" "$STACK_DIR"/caddy.d/*.caddy | sha256sum | cut -c1-16)"
export CADDY_CONFIG_HASH

# Called as `rollout … || rollback …` (errexit is off in there): every step checks itself.
# MIGRATE_REACHED: the migration step has started, so this release may have migrated.
MIGRATE_REACHED=false
rollout() {
  local tag=$1 running
  env_set ORBES_IMAGE_TAG "$tag"
  compose up -d postgres || return 1
  wait_healthy postgres "$TIMEOUT" || return 1
  running="$(service_container app)"
  if [[ -n "$running" && "$(docker inspect -f '{{.Config.Image}}' "$running" 2>/dev/null)" != "orbes-genome:$tag" ]]; then
    log "stopping the running app before migrating to $tag"
    compose stop app >/dev/null || return 1
  fi
  MIGRATE_REACHED=true
  db_prepare || return 1
  compose up -d --remove-orphans || return 1
  recreate_caddy_if_fixed || return 1
  wait_healthy app "$TIMEOUT" && wait_healthy caddy 60
}

ACTIVE_KEY_CHECK='const keys=JSON.parse(require("fs").readFileSync(0,"utf8"));const list=Array.isArray(keys)?keys:(keys.keys||[]);process.exit(list.some(k=>k.status==="ACTIVE")?0:1)'

ensure_signing_key() {
  # shellcheck disable=SC2016 # expanded by the container's shell
  if compose exec -T -e ACTIVE_KEY_CHECK="$ACTIVE_KEY_CHECK" app \
    sh -c 'node --import tsx scripts/keys.ts list --json | node -e "$ACTIVE_KEY_CHECK"'; then
    log "an ACTIVE signing key exists"
  else
    log "no ACTIVE signing key: generating the first one"
    compose exec -T app npm run --silent keys:generate
  fi
}

smoke() {
  local body
  body="$(https_get /api/v1/health)" || { warn "health: $body"; return 1; }
  [[ "$body" == *'"ok":true'* ]] || { warn "health answered: $body"; return 1; }
  log "health: $body"
  body="$(https_get /.well-known/orbes-keys.json)" || { warn "keys document unavailable"; return 1; }
  [[ "$body" == *'"status":"ACTIVE"'* ]] || { warn "no ACTIVE key in /.well-known/orbes-keys.json"; return 1; }
  log "/.well-known/orbes-keys.json lists an ACTIVE key"
  https_get /verify -o /dev/null || { warn "/verify failed"; return 1; }
  log "/verify: 200"
}

# A failure after this release's migrations committed: the previous image cannot run on the
# new schema (rolling back would stop the app and fail at its migration step, leaving the site
# down with ORBES_IMAGE_TAG on the old tag). The release stays: ORBES_IMAGE_TAG keeps the new
# tag, the stack is (re)started on it, and the way to repair forward is printed.
keep_release() {
  local why=$1 reason=$2
  step "no rollback: repair forward"
  warn "$reason"
  if [[ "$(env_get ORBES_IMAGE_TAG)" != "$TAG" ]]; then env_set ORBES_IMAGE_TAG "$TAG"; fi
  compose up -d --remove-orphans >/dev/null || warn "docker compose up -d failed: see docker compose ps and docker compose logs app"
  warn "deployment of $TAG failed ($why) and is KEPT: ORBES_IMAGE_TAG=$TAG in .env, the stack started on orbes-genome:$TAG."
  repair_forward_help "$TAG"
  printf '%s deploy %s FAILED (%s): kept, no rollback, repair forward\n' "$(_ts)" "$TAG" "$why" >>"$STATE_DIR/deploys.log"
  exit 1
}

rollback() {
  local why=$1 applied new prev_known unknown
  warn "deployment of $TAG failed: $why"
  compose logs --tail 60 app >&2 || true
  # Did this release migrate? Only once the migration step was reached (all its migrations
  # commit together, or none: a failed migration leaves the schema as it was).
  if [[ "$MIGRATE_REACHED" == true ]]; then
    if ! applied="$(db_applied_migrations)"; then
      keep_release "$why" "the migrations applied in the database cannot be read (is PostgreSQL down?): this release may have migrated, so no rollback is attempted."
    fi
    new="$(lines_not_in "$applied" "$APPLIED_BEFORE")"
    if [[ -n "$new" ]]; then
      keep_release "$why" "$TAG applied the migration(s) $(words "$new"): orbes-genome:$PREV_TAG cannot run on this schema, so no rollback is attempted."
    fi
    # No new migration: the previous image normally knows them all. Make sure of it.
    if [[ "$PREV_TAG" != "$TAG" ]] && docker image inspect "orbes-genome:$PREV_TAG" >/dev/null 2>&1 \
      && prev_known="$(image_migrations "orbes-genome:$PREV_TAG")"; then
      unknown="$(lines_not_in "$applied" "$prev_known")"
      if [[ -n "$unknown" ]]; then
        keep_release "$why" "orbes-genome:$PREV_TAG does not know the migration(s) $(words "$unknown") of this database: it cannot run on this schema, so no rollback is attempted."
      fi
    fi
  fi
  if [[ "$PREV_TAG" == "$TAG" ]] || ! docker image inspect "orbes-genome:$PREV_TAG" >/dev/null 2>&1; then
    warn "no previous image to roll back to (orbes-genome:$PREV_TAG)"
    repair_forward_help "$TAG"
    printf '%s deploy %s FAILED (no rollback)\n' "$(_ts)" "$TAG" >>"$STATE_DIR/deploys.log"
    exit 1
  fi
  step "rollback to orbes-genome:$PREV_TAG"
  if rollout "$PREV_TAG"; then
    warn "rolled back to $PREV_TAG; the stack is healthy"
    printf '%s deploy %s FAILED, rolled back to %s\n' "$(_ts)" "$TAG" "$PREV_TAG" >>"$STATE_DIR/deploys.log"
  else
    warn "rollback to $PREV_TAG is NOT healthy either: docker compose ps, docker compose logs app."
    repair_forward_help "$PREV_TAG"
    printf '%s deploy %s FAILED, rollback to %s FAILED\n' "$(_ts)" "$TAG" "$PREV_TAG" >>"$STATE_DIR/deploys.log"
  fi
  exit 1
}

step "roll out $IMAGE"
rollout "$TAG" || rollback "the stack did not become healthy"
compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true

step "signing key"
ensure_signing_key || rollback "signing-key bootstrap failed"

if [[ "$SMOKE" == true ]]; then
  step "smoke tests via https://$DOMAIN"
  ok=false
  for _ in 1 2 3 4 5 6; do
    if smoke; then ok=true; break; fi
    sleep 5
  done
  [[ "$ok" == true ]] || rollback "smoke tests failed"
fi

# The migrations this release applied (none when it only changed code).
NEW_MIGRATIONS=""
SCHEMA_READ=true
if APPLIED_AFTER="$(db_applied_migrations)"; then
  NEW_MIGRATIONS="$(lines_not_in "$APPLIED_AFTER" "$APPLIED_BEFORE")"
else
  SCHEMA_READ=false
fi
MIGRATED_NOTE=""
if [[ "$SCHEMA_READ" != true ]]; then
  MIGRATED_NOTE="; schema not read"
elif [[ -n "$NEW_MIGRATIONS" ]]; then
  MIGRATED_NOTE="; migrations $(words "$NEW_MIGRATIONS")"
fi
printf '%s deploy %s OK (previous %s%s)\n' "$(_ts)" "$TAG" "$PREV_TAG" "$MIGRATED_NOTE" >>"$STATE_DIR/deploys.log"
if [[ "$SCHEMA_READ" != true ]]; then
  # Whether this release migrated is unknown: never suggest a rollback that may be impossible.
  rm -f -- "$STATE_DIR/previous-tag"
  log "deployed $IMAGE (previous: $PREV_TAG)."
  warn "the schema could not be read after the rollout (kysely_migration): whether this release applied migrations is unknown, so no rollback is suggested. scripts/deploy.sh --image <tag> checks the schema before it stops anything; if anything goes wrong, repair forward: scripts/deploy.sh --image $TAG after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7)."
elif [[ "$PREV_TAG" != "$TAG" ]] && docker image inspect "orbes-genome:$PREV_TAG" >/dev/null 2>&1; then
  if [[ -n "$NEW_MIGRATIONS" ]]; then
    # Rolling back is no longer possible: never suggest it.
    rm -f -- "$STATE_DIR/previous-tag"
    log "deployed $IMAGE (previous: $PREV_TAG). This release applied the migration(s) $(words "$NEW_MIGRATIONS"):"
    log "orbes-genome:$PREV_TAG cannot run on this schema any more (scripts/deploy.sh --image $PREV_TAG refuses it). If anything goes wrong, repair forward: scripts/deploy.sh --image $TAG after a transient incident, otherwise a corrective commit (docs/DEPLOYMENT.md §15.7)."
  else
    printf '%s\n' "$PREV_TAG" >"$STATE_DIR/previous-tag"
    log "deployed $IMAGE (previous: $PREV_TAG). Manual rollback: scripts/deploy.sh --image $PREV_TAG"
  fi
elif [[ "$PREV_TAG" == "$TAG" ]]; then
  log "redeployed $IMAGE (same image as before)${NEW_MIGRATIONS:+; it applied the migration(s) $(words "$NEW_MIGRATIONS")}"
else
  log "deployed $IMAGE (no previous image on this host to roll back to)${NEW_MIGRATIONS:+; it applied the migration(s) $(words "$NEW_MIGRATIONS")}"
fi
