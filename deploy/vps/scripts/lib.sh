# shellcheck shell=bash
# ORBES GENOME CODE, VPS stack: helpers shared by the scripts in this directory.
# Sourced, never executed. Callers set `set -Eeuo pipefail` themselves.

# Paths: STACK_DIR = deploy/vps, REPO_DIR = repository root.
SCRIPTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
STACK_DIR="$(cd -- "$SCRIPTS_DIR/.." && pwd -P)"
REPO_DIR="$(cd -- "$STACK_DIR/../.." && pwd -P)"
ENV_FILE="${ORBES_STACK_ENV_FILE:-$STACK_DIR/.env}"
STATE_DIR="${ORBES_STATE_DIR:-$STACK_DIR/.state}"
SCRIPT_NAME="$(basename -- "$0")"

DRY_RUN="${DRY_RUN:-false}"
QUIET="${QUIET:-false}"

# ── Logging ────────────────────────────────────────────────────────────────

_ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { [[ "$QUIET" == true ]] || printf '%s [%s] %s\n' "$(_ts)" "$SCRIPT_NAME" "$*" >&2; }
warn() { printf '%s [%s] WARNING: %s\n' "$(_ts)" "$SCRIPT_NAME" "$*" >&2; }
die() { printf '%s [%s] ERROR: %s\n' "$(_ts)" "$SCRIPT_NAME" "$*" >&2; exit 1; }
step() { [[ "$QUIET" == true ]] || printf '\n%s [%s] ── %s\n' "$(_ts)" "$SCRIPT_NAME" "$*" >&2; }

# Print the location of an unexpected failure (set -E propagates the ERR trap).
on_err() {
  local code=$? line=${1:-?}
  printf '%s [%s] ERROR: command failed (exit %s) at line %s: %s\n' "$(_ts)" "$SCRIPT_NAME" "$code" "$line" "${BASH_COMMAND}" >&2
}
trap 'on_err $LINENO' ERR

# Run a command, or only print it with --dry-run.
run() {
  if [[ "$DRY_RUN" == true ]]; then
    printf '%s [%s] [dry-run] %s\n' "$(_ts)" "$SCRIPT_NAME" "$(printf '%q ' "$@")" >&2
    return 0
  fi
  "$@"
}

need_cmd() {
  local c
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "required command not found: $c"; done
}

# ── .env access (parsed, never sourced: values may contain spaces and are data) ──

# env_get KEY [default]: last KEY=value line of $ENV_FILE, surrounding quotes removed.
env_get() {
  local key=$1 default=${2-} line value=''
  local found=false
  [[ -r "$ENV_FILE" ]] || { printf '%s' "$default"; return 0; }
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" == "$key="* ]]; then
      value="${line#"$key="}"
      found=true
    fi
  done <"$ENV_FILE"
  if [[ "$found" != true ]]; then printf '%s' "$default"; return 0; fi
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
    value="${BASH_REMATCH[1]}"
  else
    value="${value%%[[:space:]]#*}"           # inline comment
    value="${value%"${value##*[![:space:]]}"}" # trailing blanks
  fi
  if [[ -z "$value" ]]; then printf '%s' "$default"; else printf '%s' "$value"; fi
}

# env_set KEY VALUE: replace (or append) KEY=VALUE in $ENV_FILE atomically, keeping mode 0600.
env_set() {
  local key=$1 value=$2 tmp
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "env_set: invalid key $key"
  [[ "$value" != *$'\n'* ]] || die "env_set: newline in value of $key"
  if [[ "$DRY_RUN" == true ]]; then log "[dry-run] would set $key in $ENV_FILE"; return 0; fi
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  chmod 600 "$tmp"
  if grep -q "^${key}=" "$ENV_FILE"; then
    KEY="$key" VALUE="$value" awk 'BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"] }
      index($0, k "=") == 1 { print k "=" v; next } { print }' "$ENV_FILE" >"$tmp"
  else
    cat "$ENV_FILE" >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  mv -f "$tmp" "$ENV_FILE"
}

require_env_file() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found: run scripts/setup.sh first (or copy .env.example)"
  local mode
  mode="$(stat -c '%a' "$ENV_FILE")"
  if [[ "$mode" != 600 && "$mode" != 400 ]]; then
    die "$ENV_FILE has mode $mode; it holds secrets: chmod 600 $ENV_FILE"
  fi
}

# ── Docker / compose ───────────────────────────────────────────────────────

# docker compose with this stack's file, project directory and env file.
compose() {
  docker compose --project-directory "$STACK_DIR" -f "$STACK_DIR/compose.yaml" --env-file "$ENV_FILE" "$@"
}

project_name() {
  if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then printf '%s' "$COMPOSE_PROJECT_NAME"; return; fi
  env_get COMPOSE_PROJECT_NAME orbes
}

# Full docker name of one of the stack's named volumes (e.g. keys → orbes_keys).
volume_name() { printf '%s_%s' "$(project_name)" "$1"; }

# Container id of a running service ('' when it is not running).
service_container() { compose ps -q "$1" 2>/dev/null | head -n1; }

# wait_healthy SERVICE TIMEOUT_SECONDS: wait for the container's healthcheck to report healthy.
wait_healthy() {
  local svc=$1 timeout=$2 cid status deadline
  deadline=$(( $(date +%s) + timeout ))
  while :; do
    cid="$(service_container "$svc")"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      case "$status" in
        healthy) log "$svc is healthy"; return 0 ;;
        unhealthy) warn "$svc is unhealthy"; return 1 ;;
        exited | dead) warn "$svc container $status"; return 1 ;;
      esac
    fi
    if (( $(date +%s) >= deadline )); then warn "$svc not healthy after ${timeout}s (last status: ${status:-none})"; return 1; fi
    sleep 2
  done
}

# Root CA of Caddy's internal issuer (TLS_MODE=internal), for curl --cacert.
caddy_internal_ca() {
  local out=$1
  compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt >"$out"
}

# https_get URL_PATH [curl args…]: request https://$APP_DOMAIN$PATH through Caddy on this host
# (--resolve to 127.0.0.1, so it works before DNS propagates). TLS is verified: with
# TLS_MODE=internal against Caddy's local root CA, otherwise against the system store.
https_get() {
  local path=$1; shift
  local domain port tls_mode
  domain="$(env_get APP_DOMAIN)"
  port="$(env_get HTTPS_PORT 443)"
  tls_mode="$(env_get TLS_MODE acme)"
  local -a tls_args=()
  if [[ "$tls_mode" == internal ]]; then
    local ca="$STATE_DIR/caddy-local-root.crt"
    mkdir -p "$STATE_DIR"
    caddy_internal_ca "$ca"
    tls_args=(--cacert "$ca")
  fi
  curl -sS --fail-with-body --max-time 20 --noproxy '*' --resolve "$domain:$port:127.0.0.1" \
    "${tls_args[@]}" "$@" "https://$domain:$port$path"
}

ensure_state_dir() { install -d -m 0700 "$STATE_DIR"; }
