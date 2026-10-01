#!/usr/bin/env bash
# ORBES GENOME CODE: deploy a git ref of this repository to the VPS stack.
#
#   scripts/deploy.sh [--ref <git-ref>] [--worktree] [--no-backup] [--skip-smoke] [--timeout <s>] [--dry-run]
#   scripts/deploy.sh --image <tag>      roll out an image that already exists (e.g. a previous
#                                        tag from .state/deploys.log), without building
#   scripts/deploy.sh --rebuild          rebuild the same commit with fresh base images
#                                        (docker build --pull; tag <commit>-r<time>)
#
# Steps
#   1. Export the ref (default HEAD) with `git archive` into a temporary build
#      context: the working tree is never checked out or modified, and
#      uncommitted changes are never deployed by accident (--worktree builds
#      the working tree as it is, tagged <commit>-dirty-<time>).
#   2. docker build -> orbes-genome:<commit12>. BUILD_EXTRA_CA_FILE (.env) is
#      passed as the extra_ca BuildKit secret when set (TLS-inspecting proxy).
#   3. Encrypted backup first (scripts/backup.sh) when the stack is already
#      running and holds data (--no-backup skips it).
#   4. ORBES_IMAGE_TAG=<tag> in .env, `docker compose up -d`, wait until the
#      app is healthy (migrations run at start: MIGRATE_ON_START=true).
#   5. First signing key if none is ACTIVE (npm run keys:generate in the app).
#   6. Smoke tests through Caddy: https://$APP_DOMAIN/api/v1/health,
#      /.well-known/orbes-keys.json (an ACTIVE key), /verify.
#   7. Any failure in 4–6: automatic rollback to the previous image tag, then
#      exit 1. A release whose migration already ran may refuse to roll back
#      (older code, newer schema): restore the pre-deploy backup then
#      (scripts/restore.sh, docs/DEPLOYMENT.md §15.9).
#
# Exit codes: 0 deployed, 1 failed (rolled back when possible), 2 usage error.
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
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || { echo "--timeout must be a number of seconds" >&2; exit 2; }

need_cmd docker curl git tar sha256sum
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is missing"
require_env_file
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
  if docker image inspect "$IMAGE" >/dev/null 2>&1 && [[ "$WORKTREE" != true ]]; then
    log "$IMAGE already exists: reusing it"
  else
    run env DOCKER_BUILDKIT=1 docker build "${build_args[@]}" "$BUILD_CTX"
  fi
fi

# ── 3. Pre-deploy backup ───────────────────────────────────────────────────
PREV_TAG="$(env_get ORBES_IMAGE_TAG latest)"
APP_CID="$(service_container app)"
if [[ -n "$APP_CID" ]]; then
  PREV_TAG="$(docker inspect -f '{{.Config.Image}}' "$APP_CID" | sed 's/^orbes-genome://')"
fi
log "previous image tag: $PREV_TAG"
if [[ "$BACKUP" == true && -n "$(service_container postgres)" ]]; then
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

rollout() {
  local tag=$1
  env_set ORBES_IMAGE_TAG "$tag"
  compose up -d --remove-orphans
  wait_healthy postgres "$TIMEOUT" && wait_healthy app "$TIMEOUT" && wait_healthy caddy 60
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

rollback() {
  local why=$1
  warn "deployment of $TAG failed: $why"
  compose logs --tail 60 app >&2 || true
  if [[ "$PREV_TAG" == "$TAG" ]] || ! docker image inspect "orbes-genome:$PREV_TAG" >/dev/null 2>&1; then
    warn "no previous image to roll back to (orbes-genome:$PREV_TAG)"
    printf '%s deploy %s FAILED (no rollback)\n' "$(_ts)" "$TAG" >>"$STATE_DIR/deploys.log"
    exit 1
  fi
  step "rollback to orbes-genome:$PREV_TAG"
  if rollout "$PREV_TAG"; then
    warn "rolled back to $PREV_TAG; the stack is healthy"
    printf '%s deploy %s FAILED, rolled back to %s\n' "$(_ts)" "$TAG" "$PREV_TAG" >>"$STATE_DIR/deploys.log"
  else
    warn "rollback to $PREV_TAG is NOT healthy either. If $TAG applied a migration, restore the pre-deploy backup (scripts/restore.sh)."
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

printf '%s deploy %s OK (previous %s)\n' "$(_ts)" "$TAG" "$PREV_TAG" >>"$STATE_DIR/deploys.log"
printf '%s\n' "$PREV_TAG" >"$STATE_DIR/previous-tag"
log "deployed $IMAGE (previous: $PREV_TAG). Manual rollback: scripts/deploy.sh --image $PREV_TAG"
