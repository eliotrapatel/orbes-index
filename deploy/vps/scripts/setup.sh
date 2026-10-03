#!/usr/bin/env bash
# ORBES GENOME CODE: first-run setup of the VPS stack (run as the `orbes` user).
#
#   scripts/setup.sh [--domain <host>] [--acme-email <email>] [--admin-email <email>]
#                    [--age-recipient <age1…>] [--tls-internal] [--edge-mode direct|cloudflare]
#                    [--no-deploy] [--no-geoip] [--non-interactive]
#
#   1. deploy/vps/.env from .env.example (mode 0600). Existing values are KEPT:
#      only empty secrets are generated (openssl rand, base64url), so running
#      setup again never rotates a secret by accident.
#   2. Domain, ACME e-mail and bootstrap admin e-mail from the flags, or asked
#      for (interactive terminal); the bootstrap admin password is generated.
#   3. Backup encryption: with --age-recipient (recommended: a key you created
#      offline with age-keygen) that public key is used. Otherwise an age key
#      pair is generated here: the PRIVATE key is printed ONCE (store it
#      offline, e.g. in the company password manager AND on paper in a safe)
#      and never written to disk; only the public key stays on the server.
#   4. Newly generated secrets that must be escrowed (KEY_ENCRYPTION_KEY,
#      COOKIE_SECRET, IP_HASH_PEPPER, the first admin's password) are printed
#      once, too.
#   5. scripts/deploy.sh (build, start, first signing key, smoke tests), then
#      scripts/geoip-update.sh (GeoIP database; a failure only warns).
#   6. Checks that the systemd timers (backup, GeoIP) are installed.
#
# Exit codes: 0 ok, 1 failure, 2 usage error.
set -Eeuo pipefail
umask 077
# shellcheck source=deploy/vps/scripts/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"

usage() { sed -n '2,/^set -Eeuo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'; }

DOMAIN=""
ACME=""
ADMIN=""
AGE_RECIPIENT=""
TLS_INTERNAL=false
EDGE=""
DEPLOY=true
GEOIP=true
INTERACTIVE=true
ALLOW_ROOT=false
while (($#)); do
  case "$1" in
    --domain) DOMAIN=${2:?}; shift 2 ;;
    --acme-email) ACME=${2:?}; shift 2 ;;
    --admin-email) ADMIN=${2:?}; shift 2 ;;
    --age-recipient) AGE_RECIPIENT=${2:?}; shift 2 ;;
    --tls-internal) TLS_INTERNAL=true; shift ;;
    --edge-mode) EDGE=${2:?}; shift 2 ;;
    --no-deploy) DEPLOY=false; shift ;;
    --no-geoip) GEOIP=false; shift ;;
    --non-interactive) INTERACTIVE=false; shift ;;
    --allow-root) ALLOW_ROOT=true; shift ;; # tests only
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ -t 0 ]] || INTERACTIVE=false
if [[ "$(id -u)" == 0 && "$ALLOW_ROOT" != true ]]; then
  die "run setup.sh as the deploy user (sudo -iu orbes), not as root"
fi
need_cmd openssl docker age-keygen
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is missing (run bootstrap-ubuntu.sh)"
docker info >/dev/null 2>&1 || die "cannot talk to Docker: is this user in the docker group (log out and in again)?"

DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
EMAIL_RE='^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
b64url() { openssl rand -base64 "$1" | tr -d '\n=' | tr '+/' '-_'; }

ask() { # ask VAR_DESCRIPTION DEFAULT -> answer on stdout
  local prompt=$1 def=$2 answer
  if [[ "$INTERACTIVE" != true ]]; then printf '%s' "$def"; return; fi
  read -r -p "$prompt${def:+ [$def]}: " answer
  printf '%s' "${answer:-$def}"
}

# ── 1. .env ────────────────────────────────────────────────────────────────
step ".env"
if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0600 "$STACK_DIR/.env.example" "$ENV_FILE"
  log "created $ENV_FILE from .env.example"
else
  chmod 600 "$ENV_FILE"
  log "keeping the existing $ENV_FILE (only empty values are filled in)"
fi

# ── 2. Domain and e-mails ──────────────────────────────────────────────────
cur_domain="$(env_get APP_DOMAIN)"
DOMAIN="${DOMAIN:-$(ask 'Public host name of the service' "$cur_domain")}"
DOMAIN="${DOMAIN,,}"
[[ "$DOMAIN" =~ $DOMAIN_RE ]] || die "invalid domain: $DOMAIN"
env_set APP_DOMAIN "$DOMAIN"

cur_acme="$(env_get ACME_EMAIL)"
[[ "$cur_acme" == ops@example.com ]] && cur_acme=""
ACME="${ACME:-$(ask "E-mail for Let's Encrypt notices" "$cur_acme")}"
[[ "$ACME" =~ $EMAIL_RE ]] || die "invalid ACME e-mail: ${ACME:-<empty>} (--acme-email)"
env_set ACME_EMAIL "$ACME"

if [[ "$TLS_INTERNAL" == true ]]; then env_set TLS_MODE internal; fi
if [[ -n "$EDGE" ]]; then
  [[ "$EDGE" == direct || "$EDGE" == cloudflare ]] || die "--edge-mode must be direct or cloudflare"
  env_set EDGE_MODE "$EDGE"
fi

# ── 3. Secrets (only the empty ones) ───────────────────────────────────────
step "secrets"
declare -a NEW_SECRETS=()
PGDATA_EXISTS=false
docker volume inspect "$(volume_name pgdata)" >/dev/null 2>&1 && PGDATA_EXISTS=true
KEYS_EXISTS=false
docker volume inspect "$(volume_name keys)" >/dev/null 2>&1 && KEYS_EXISTS=true

gen() { # gen NAME VALUE ESCROW(true|false)
  local name=$1 value=$2 escrow=$3
  if [[ -n "$(env_get "$name")" ]]; then log "$name: kept"; return; fi
  env_set "$name" "$value"
  log "$name: generated"
  if [[ "$escrow" == true ]]; then NEW_SECRETS+=("$name=$value"); fi
}
if [[ -z "$(env_get POSTGRES_PASSWORD)" && "$PGDATA_EXISTS" == true ]]; then
  die "POSTGRES_PASSWORD is empty but the database volume already exists: put the original password back into .env"
fi
if [[ -z "$(env_get KEY_ENCRYPTION_KEY)" && "$KEYS_EXISTS" == true ]]; then
  die "KEY_ENCRYPTION_KEY is empty but the keys volume exists: restore the escrowed value into .env"
fi
gen POSTGRES_PASSWORD "$(openssl rand -hex 24)" false
gen POSTGRES_APP_PASSWORD "$(openssl rand -hex 24)" false # applied to the role by every deploy
gen COOKIE_SECRET "$(b64url 48)" true
gen IP_HASH_PEPPER "$(b64url 48)" true
gen KEY_ENCRYPTION_KEY "$(b64url 32)" true

if [[ "$PGDATA_EXISTS" != true ]]; then
  cur_admin="$(env_get BOOTSTRAP_ADMIN_EMAIL)"
  ADMIN="${ADMIN:-$(ask 'E-mail of the first admin (console sign-in)' "$cur_admin")}"
  [[ "$ADMIN" =~ $EMAIL_RE ]] || die "invalid admin e-mail: ${ADMIN:-<empty>} (--admin-email)"
  env_set BOOTSTRAP_ADMIN_EMAIL "$ADMIN"
  gen BOOTSTRAP_ADMIN_PASSWORD "$(b64url 24)" true
else
  log "database volume exists: first-admin bootstrap skipped"
fi

# ── 4. Backup encryption key (age) ─────────────────────────────────────────
step "backup encryption (age)"
RECIPIENTS="$(env_get BACKUP_AGE_RECIPIENTS_FILE /opt/orbes/backup-recipients.txt)"
AGE_PRIVATE=""
if [[ -n "$AGE_RECIPIENT" ]]; then
  [[ "$AGE_RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]] || die "--age-recipient must be an age public key (age1…)"
  install -d -m 0700 "$(dirname -- "$RECIPIENTS")" 2>/dev/null || true
  if ! grep -qxF "$AGE_RECIPIENT" "$RECIPIENTS" 2>/dev/null; then
    printf '%s\n' "$AGE_RECIPIENT" >>"$RECIPIENTS"
  fi
  log "recipient $AGE_RECIPIENT in $RECIPIENTS"
elif [[ -s "$RECIPIENTS" ]]; then
  log "keeping the recipients in $RECIPIENTS"
else
  AGE_PRIVATE="$(age-keygen 2>/dev/null)"      # stays in memory: never written to disk
  PUB="$(age-keygen -y <<<"$AGE_PRIVATE")"
  install -d -m 0700 "$(dirname -- "$RECIPIENTS")" 2>/dev/null || true
  printf '# ORBES backup recipient (public key), created %s by setup.sh\n%s\n' "$(_ts)" "$PUB" >"$RECIPIENTS"
  log "generated an age key pair; public key $PUB written to $RECIPIENTS"
fi
chmod 0644 "$RECIPIENTS"

# ── Escrow notice (printed once) ───────────────────────────────────────────
if ((${#NEW_SECRETS[@]})) || [[ -n "$AGE_PRIVATE" ]]; then
  {
    printf '\n'
    printf '════════════════════════════════════════════════════════════════════════════\n'
    printf ' STORE THESE NOW, OFFLINE (password manager + sealed copy). Shown only once.\n'
    printf '════════════════════════════════════════════════════════════════════════════\n'
    if [[ -n "$AGE_PRIVATE" ]]; then
      printf '\n Backup decryption key (age identity). The ONLY way to read the backups;\n'
      printf ' it is not stored on this server. Save it as a file, e.g. orbes-backup.agekey:\n\n'
      printf '%s\n' "$AGE_PRIVATE"
    fi
    if ((${#NEW_SECRETS[@]})); then
      printf '\n Secrets (also in %s; the backups do NOT contain them):\n\n' "$ENV_FILE"
      printf '   %s\n' "${NEW_SECRETS[@]}"
      printf '\n KEY_ENCRYPTION_KEY decrypts the signing keys and the admin TOTP secrets:\n'
      printf ' keep it apart from the backups. BOOTSTRAP_ADMIN_PASSWORD is the first\n'
      printf ' console password: enrol TOTP, then remove BOOTSTRAP_* from .env.\n'
    fi
    printf '════════════════════════════════════════════════════════════════════════════\n\n'
  } >&2
  AGE_PRIVATE=""
  if [[ "$INTERACTIVE" == true ]]; then read -r -p "Type 'stored' once these are safely stored: " _ack; fi
fi

# ── 5. Deploy + GeoIP ──────────────────────────────────────────────────────
if [[ "$DEPLOY" == true ]]; then
  step "deploy"
  "$SCRIPTS_DIR/deploy.sh" --no-backup
  if [[ "$GEOIP" == true ]]; then
    step "GeoIP database"
    "$SCRIPTS_DIR/geoip-update.sh" || warn "GeoIP download failed: geolocation stays off until scripts/geoip-update.sh succeeds"
  fi
else
  log "--no-deploy: run scripts/deploy.sh when ready"
fi

# ── 6. Timers ──────────────────────────────────────────────────────────────
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files orbes-backup.timer >/dev/null 2>&1 \
  && systemctl is-enabled orbes-backup.timer >/dev/null 2>&1; then
  log "systemd timers: orbes-backup.timer and orbes-geoip.timer are installed"
else
  warn "systemd timers not installed: sudo $SCRIPTS_DIR/bootstrap-ubuntu.sh --units-only"
fi

cat >&2 <<EOF

Next steps (docs/DEPLOYMENT.md §15):
  1. TOTP for the first admin, from the shell (recommended):
       docker compose exec app node --import tsx scripts/admin.ts totp-setup --email $(env_get BOOTSTRAP_ADMIN_EMAIL '<admin>')
       read -rs ADMIN_TOTP_SECRET && export ADMIN_TOTP_SECRET   # paste the secret printed above: nothing shows, nothing enters the history
       clear
       docker compose exec -e ADMIN_TOTP_SECRET app node --import tsx scripts/admin.ts totp-enable --email <admin> --code <code>
       unset ADMIN_TOTP_SECRET
  2. Remove BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD from .env, then: scripts/deploy.sh
  3. First backup + restore drill: scripts/backup.sh, then §15.9.
  4. External uptime check on https://$DOMAIN/api/v1/health.
EOF
