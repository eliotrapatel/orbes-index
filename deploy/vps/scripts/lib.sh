# shellcheck shell=bash
# ORBES GENOME CODE, VPS stack: helpers shared by the scripts in this directory.
# Sourced, never executed. Callers set `set -Eeuo pipefail` themselves.

# Paths: STACK_DIR = deploy/vps, REPO_DIR = repository root (used by the sourcing scripts).
# shellcheck disable=SC2034
SCRIPTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
STACK_DIR="$(cd -- "$SCRIPTS_DIR/.." && pwd -P)"
REPO_DIR="$(cd -- "$STACK_DIR/../.." && pwd -P)"
# ORBES_STACK_ENV_FILE and ORBES_STATE_DIR point the scripts elsewhere (their tests, genome/test/ops,
# use them); never on the server. restore.sh reads RESTORE_ALLOWED from $STACK_DIR/.env as well.
ENV_FILE="${ORBES_STACK_ENV_FILE:-$STACK_DIR/.env}"
STATE_DIR="${ORBES_STATE_DIR:-$STACK_DIR/.state}"
SCRIPT_NAME="$(basename -- "$0")"

DRY_RUN="${DRY_RUN:-false}"
QUIET="${QUIET:-false}"

# ── Logging ────────────────────────────────────────────────────────────────

_ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { [[ "$QUIET" == true ]] || printf '%s [%s] %s\n' "$(_ts)" "$SCRIPT_NAME" "$*" >&2; }
# Like log, but printed even with --quiet: lines that monitoring reads (backup.sh's photos: line).
notice() { printf '%s [%s] %s\n' "$(_ts)" "$SCRIPT_NAME" "$*" >&2; }
warn() { printf '%s [%s] WARNING: %s\n' "$(_ts)" "$SCRIPT_NAME" "$*" >&2; }
err() { printf '%s [%s] ERROR: %s\n' "$(_ts)" "$SCRIPT_NAME" "$*" >&2; }
die() { err "$@"; exit 1; }
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
  # Unreadable (e.g. created with sudo, owned by root) would silently mean "all defaults".
  [[ -r "$ENV_FILE" ]] || die "$ENV_FILE is not readable by $(id -un): it must belong to the deploy user (chown orbes: $ENV_FILE)"
  local mode
  mode="$(stat -c '%a' "$ENV_FILE")"
  if [[ "$mode" != 600 && "$mode" != 400 ]]; then
    die "$ENV_FILE has mode $mode; it holds secrets: chmod 600 $ENV_FILE"
  fi
}

# ── Shared host: no stray exported setting ─────────────────────────────────
# This stack shares its Docker host with other projects. Two variables left exported in the
# operator's shell (by other work on the host, a profile, a copied command) would redirect it
# without a word, because docker compose prefers the environment to .env:
#   COMPOSE_PROJECT_NAME  another project's containers and volumes (restore.sh deletes the
#                         pgdata volume of the project it names);
#   ORBES_IMAGE_TAG       compose would run that image, not the one deploy.sh records in .env.
# deploy.sh, backup.sh and restore.sh call this right after require_env_file, before any
# docker command. A COMPOSE_PROJECT_NAME equal to the stack's own (orbes, or the value of
# .env) changes nothing and is accepted.
guard_shared_host_env() {
  local stack
  stack="$(env_get COMPOSE_PROJECT_NAME orbes)"
  if [[ -n "${COMPOSE_PROJECT_NAME+x}" && "${COMPOSE_PROJECT_NAME}" != "$stack" ]]; then
    die "COMPOSE_PROJECT_NAME is exported in this shell (\"${COMPOSE_PROJECT_NAME}\"), but this stack is the compose project \"$stack\": docker compose would act on another project's containers and volumes. Run: unset COMPOSE_PROJECT_NAME (and remove the export from your shell profile), then run the script again. Nothing was changed."
  fi
  if [[ -n "${ORBES_IMAGE_TAG+x}" ]]; then
    die "ORBES_IMAGE_TAG is exported in this shell (\"${ORBES_IMAGE_TAG}\"): docker compose would prefer it to $ENV_FILE and run that image, not the one this stack records. Run: unset ORBES_IMAGE_TAG, then run the script again (scripts/deploy.sh --image <tag> rolls out a given image). Nothing was changed."
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
      if (( $(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0) >= 3 )); then
        warn "$svc is crash-looping (restarted 3 times)"; return 1
      fi
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

# ── Database roles (least privilege) ───────────────────────────────────────
# POSTGRES_USER (superuser created by the postgres image) owns the schema: it runs the
# migrations, backups and restores. The app connects as POSTGRES_APP_USER: no superuser,
# no DDL, only SELECT/INSERT/UPDATE/DELETE on the tables, so the append-only guards
# (audit log, key ids) hold against it, and it cannot SET session_replication_role,
# COPY … TO PROGRAM or ALTER/DROP anything (docs/DEPLOYMENT.md §6.2).

db_owner() { env_get POSTGRES_USER orbes; }
db_name() { env_get POSTGRES_DB orbes; }
db_app_user() { env_get POSTGRES_APP_USER orbes_app; }

check_db_names() {
  local owner app db pw
  owner="$(db_owner)"; app="$(db_app_user)"; db="$(db_name)"; pw="$(env_get POSTGRES_APP_PASSWORD)"
  local re='^[a-z_][a-z0-9_]{0,62}$'
  [[ "$owner" =~ $re && "$app" =~ $re && "$db" =~ $re ]] || die "POSTGRES_USER, POSTGRES_APP_USER and POSTGRES_DB: lower-case letters, digits and _ only"
  [[ "$app" != "$owner" ]] || die "POSTGRES_APP_USER must differ from POSTGRES_USER (the app must not own the schema)"
  [[ "$pw" =~ ^[A-Za-z0-9_-]{16,}$ ]] || die "POSTGRES_APP_PASSWORD: at least 16 URL-safe characters (scripts/setup.sh generates it)"
}

# psql as the owner inside the postgres container; SQL on stdin (never on a command line).
db_psql_owner() {
  # shellcheck disable=SC2016 # expanded by the container's shell
  compose exec -T postgres sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# Create the app role if missing and (re)set its password and attributes. Idempotent.
db_ensure_app_role() {
  check_db_names
  local app pw
  app="$(db_app_user)"; pw="$(env_get POSTGRES_APP_PASSWORD)"
  db_psql_owner >/dev/null <<SQL
\\set app '$app'
\\set pw '$pw'
-- Keep the password out of the server log (only the generated statement carries it).
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SELECT format('CREATE ROLE %I LOGIN', :'app') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \\gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 30 PASSWORD %L', :'app', :'pw') \\gexec
SQL
}

# Privileges of the app role on everything the migrations created. Idempotent; run after
# every migration and restore (new tables get them from the default privileges as well).
db_grant_app_role() {
  check_db_names
  local app owner db
  app="$(db_app_user)"; owner="$(db_owner)"; db="$(db_name)"
  db_psql_owner >/dev/null <<SQL
\\set app '$app'
\\set owner '$owner'
\\set db '$db'
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'app') \\gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL ON SCHEMA public FROM %I', :'app') \\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app') \\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app') \\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app') \\gexec
-- The migration bookkeeping is read-only for the app (it only checks that nothing is pending).
SELECT format('REVOKE INSERT, UPDATE, DELETE ON TABLE %I.%I FROM %I', schemaname, tablename, :'app')
  FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('kysely_migration', 'kysely_migration_lock') \\gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'owner', :'app') \\gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'owner', :'app') \\gexec
SQL
}

# Apply pending migrations with the CURRENT image (ORBES_IMAGE_TAG) as the schema owner, in a
# one-off app container (the running app has no DDL rights). The owner URL travels in the
# environment of the compose process, never on a command line.
db_migrate() {
  check_db_names
  local pw
  pw="$(env_get POSTGRES_PASSWORD)"
  [[ -n "$pw" ]] || die "POSTGRES_PASSWORD is empty in $ENV_FILE"
  DATABASE_URL="postgres://$(db_owner):${pw}@postgres:5432/$(db_name)" \
    compose run --rm --no-deps -T -e DATABASE_URL app node --import tsx scripts/db.ts migrate
}

# Everything the database needs before the app starts: role, migrations, privileges.
db_prepare() {
  db_ensure_app_role || return 1
  db_migrate || return 1
  db_grant_app_role || return 1
  log "database ready: migrations applied, app role $(db_app_user) has DML rights only"
}

# ── Schema: the migrations a database holds, the migrations an image knows ──
# `db.ts migrate` applies every pending migration in ONE transaction (docs/DATABASE.md §9.2)
# and Kysely records each in kysely_migration. An image can migrate, and so be deployed, only
# on a schema whose applied migrations it all knows ("previously executed migration … is
# missing" otherwise). Once a release's migrations have committed, the previous image cannot
# come back: deploy.sh repairs forward instead of rolling back (docs/DEPLOYMENT.md §15.7).
# The SELECTs are plain SQL, also run against a migrated database by genome/test/ops.
APPLIED_MIGRATIONS_SQL='SELECT name FROM kysely_migration ORDER BY name'
PHOTO_USAGE_SQL="SELECT count(*) || ' ' || coalesce(sum(octet_length(bytes)), 0) FROM media_objects"

# psql as the owner, SQL on stdin, unaligned tuples only: one value per line, nothing else.
db_query_owner() {
  # shellcheck disable=SC2016 # expanded by the container's shell
  compose exec -T postgres sh -c 'exec psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# db_applied_migrations: the migrations applied in the database, one name per line, oldest
# first; nothing at all before the first migration (no kysely_migration table yet).
db_applied_migrations() {
  printf '%s\n' \
    "SELECT to_regclass('public.kysely_migration') IS NOT NULL AS has_table \\gset" \
    '\if :has_table' "$APPLIED_MIGRATIONS_SQL;" '\endif' | db_query_owner
}

# image_migrations IMAGE: the migrations IMAGE knows (MIGRATIONS of src/server/db/migrate.ts),
# one name per line, read from the image itself (throw-away container: no network, no database).
# Keep IMAGE_MIGRATIONS_JS on one single-quoted line: CI (.github/workflows/genome-ci.yml, image
# job) extracts it and runs it in the image it builds; genome/test/ops runs it with Node too.
IMAGE_MIGRATIONS_JS='import("./src/server/db/migrate.ts").then((m) => { process.stdout.write(Object.keys(m.MIGRATIONS).join("\n") + "\n"); }, (e) => { console.error(String(e)); process.exit(1); })'
image_migrations() {
  docker run --rm --network none --entrypoint node "$1" --import tsx -e "$IMAGE_MIGRATIONS_JS"
}

# lines_not_in A B: the non-empty lines of A that are not a line of B, in A's order.
lines_not_in() {
  local line
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    grep -Fxq -- "$line" <<<"$2" || printf '%s\n' "$line"
  done <<<"$1"
}

# words LINES: the lines of LINES joined with ", " (for messages).
words() { local s="${1//$'\n'/, }"; printf '%s' "${s%, }"; }

# db_photo_usage: "<count> <bytes>" of the photographs (media_objects, F-04: bytea inside the
# pgdata volume, so in every backup); "0 0" on a schema older than migration 0012 (no table).
db_photo_usage() {
  printf '%s\n' \
    "SELECT to_regclass('public.media_objects') IS NOT NULL AS has_media \\gset" \
    '\if :has_media' "$PHOTO_USAGE_SQL;" '\else' "SELECT '0 0';" '\endif' | db_query_owner
}

# Validate Caddyfile + caddy.d with the values of .env BEFORE Caddy is (re)created: a typo
# (EDGE_MODE, a comma in ADMIN_ALLOWED_IPS…) would otherwise crash-loop the only public
# entry point. Same defaults as compose.yaml. Prints Caddy's error on failure.
caddy_validate() {
  local out
  if out="$(docker run --rm --network none -w /etc/caddy \
    -e APP_DOMAIN="$(env_get APP_DOMAIN)" -e ACME_EMAIL="$(env_get ACME_EMAIL)" \
    -e TLS_MODE="$(env_get TLS_MODE acme)" -e EDGE_MODE="$(env_get EDGE_MODE direct)" \
    -e ADMIN_ALLOWED_IPS="$(env_get ADMIN_ALLOWED_IPS '0.0.0.0/0 ::/0')" \
    -v "$STACK_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$STACK_DIR/caddy.d:/etc/caddy/caddy.d:ro" \
    caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1)"; then
    log "Caddy configuration valid (TLS_MODE=$(env_get TLS_MODE acme), EDGE_MODE=$(env_get EDGE_MODE direct))"
  else
    printf '%s\n' "$out" | grep -E '^Error|"level":"error"' | tail -n 3 >&2
    warn "the Caddy configuration is invalid with the values of $ENV_FILE (TLS_MODE, EDGE_MODE, ADMIN_ALLOWED_IPS…)"
    return 1
  fi
}

# Caddy runs as root WITHOUT capabilities (compose.yaml: cap_drop ALL), so it reads its
# bind-mounted configuration through the "other" permission bits only. A checkout made under
# a restrictive umask (0600 files, 0700 directories) would crash-loop Caddy, while
# caddy_validate (default capabilities) still passes. These files hold no secret; nothing
# else in the checkout (.env, .state/) is touched. Sets CADDY_CONFIG_FIXED=true when it
# changed something: see recreate_caddy_if_fixed.
CADDY_CONFIG_FIXED=false
ensure_caddy_config_readable() {
  local unreadable
  unreadable="$(find "$STACK_DIR/Caddyfile" "$STACK_DIR/caddy.d" \( -type f ! -perm -004 \) -o \( -type d ! -perm -005 \))"
  [[ -n "$unreadable" ]] || return 0
  log "making the Caddy configuration readable by the Caddy container (no capabilities): ${unreadable//$'\n'/ }"
  run chmod -R a+rX "$STACK_DIR/Caddyfile" "$STACK_DIR/caddy.d"
  if [[ "$DRY_RUN" != true ]]; then CADDY_CONFIG_FIXED=true; fi
}

# After `compose up -d`: a Caddy container started while its configuration was unreadable is
# crash-looping, and the label hash (file contents) has not changed, so compose keeps it. A
# fresh container also resets the restart count that wait_healthy treats as a crash loop.
recreate_caddy_if_fixed() {
  [[ "$CADDY_CONFIG_FIXED" == true ]] || return 0
  log "recreating Caddy: its configuration was unreadable until now"
  compose up -d --force-recreate --no-deps caddy
}

# normalize_build_context DIR: everything below DIR readable (directories traversable) by
# everyone; DIR itself, made 0700 by mktemp, is left alone, so nothing in it is ever
# reachable by other local users, and symbolic links are skipped (chmod would follow them
# out of DIR). GNU tar, run by a non-root user, applies the umask, and setup.sh runs (and
# calls deploy.sh) under umask 077: COPY keeps those 0600/0700 modes, root-owned, and the
# image's `node` user could not read its own sources (EACCES on /app/package.json).
normalize_build_context() {
  local dir=$1
  [[ -d "$dir" ]] || die "normalize_build_context: $dir is not a directory"
  find "$dir" -mindepth 1 ! -type l -exec chmod a+rX {} +
}

# image_sources_readable IMAGE: the image's own user can read /app/package.json (an image
# built before normalize_build_context, under umask 077, cannot: EACCES at start).
image_sources_readable() {
  docker run --rm --network none --entrypoint node "$1" \
    -e 'require("fs").accessSync("package.json", require("fs").constants.R_OK)' >/dev/null 2>&1
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
