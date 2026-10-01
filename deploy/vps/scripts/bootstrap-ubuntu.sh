#!/usr/bin/env bash
# ORBES GENOME CODE: one-time preparation of a fresh OVH VPS (Ubuntu 26.04 LTS), as root.
#
#   sudo scripts/bootstrap-ubuntu.sh [--dry-run] [--harden-ssh] [--docker-source auto|docker|ubuntu]
#                                    [--app-dir /opt/orbes/orbes-index] [--auto-reboot] [--units-only]
#
# What it does (idempotent: safe to run again; every step checks first):
#   * apt update + upgrade; base tools (curl, git, jq, age, rclone, openssl…)
#   * Docker Engine + compose plugin: from Docker's official apt repository when
#     it publishes this release codename and architecture, otherwise from
#     Ubuntu's archive (docker.io + docker-compose-v2). --docker-source forces one.
#     Docker's daemon.json: json-file log rotation (only written when absent).
#   * ufw: deny incoming, allow SSH (the port sshd really listens on), 80/tcp,
#     443/tcp, 443/udp (HTTP/3). Docker-published ports bypass ufw: the stack
#     publishes only 80/443, so both views agree.
#   * unattended-upgrades (security updates daily; --auto-reboot reboots at 04:00 when needed)
#   * fail2ban for sshd (systemd journal backend)
#   * time sync: an already active NTP client (chrony is Ubuntu's default since
#     25.10) is kept; otherwise systemd-timesyncd is installed and enabled.
#     An accurate clock is a security assumption (TOTP, token expiry, audit times).
#   * a swap file (2 GB) when RAM < 2 GB and no swap is active
#   * deploy user `orbes` (docker group; no sudo, no password), /opt/orbes owned by it,
#     /var/backups/orbes (0700, orbes)
#   * systemd units orbes-backup (nightly) and orbes-geoip (monthly), from
#     ../systemd, pointing at --app-dir (default /opt/orbes/orbes-index)
#   * OPTIONAL --harden-ssh: key-only authentication, no root login. Applied only
#     after checking that a non-root sudo user has a non-empty authorized_keys
#     and can actually use sudo; the drop-in is validated with `sshd -t` and
#     removed again if validation fails. Keep your current session open and test
#     a NEW login before closing it.
#
# --dry-run prints every change instead of making it (detection still runs).
# --units-only installs/refreshes the systemd units and exits.
# Exit codes: 0 ok, 1 failure, 2 usage error.
set -Eeuo pipefail
# shellcheck source=deploy/vps/scripts/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/lib.sh"

usage() { sed -n '2,/^set -Eeuo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'; }

HARDEN_SSH=false
DOCKER_SOURCE=auto
APP_DIR=/opt/orbes/orbes-index
AUTO_REBOOT=false
UNITS_ONLY=false
DEPLOY_USER=orbes
while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --harden-ssh) HARDEN_SSH=true; shift ;;
    --docker-source) DOCKER_SOURCE=${2:?}; shift 2 ;;
    --app-dir) APP_DIR=${2:?}; shift 2 ;;
    --auto-reboot) AUTO_REBOOT=true; shift ;;
    --units-only) UNITS_ONLY=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$DOCKER_SOURCE" =~ ^(auto|docker|ubuntu)$ ]] || { echo "--docker-source: auto, docker or ubuntu" >&2; exit 2; }
[[ "$APP_DIR" == /* ]] || { echo "--app-dir must be absolute" >&2; exit 2; }

if [[ "$(id -u)" != 0 ]]; then
  if [[ "$DRY_RUN" == true ]]; then warn "not root: dry-run only shows what root would do"; else die "run as root (sudo $0)"; fi
fi

export DEBIAN_FRONTEND=noninteractive
APT_OPTS=(-y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

# write_file PATH MODE: content from stdin; only rewritten when it differs (idempotent).
write_file() {
  local path=$1 mode=$2 content
  content="$(cat)"
  if [[ -f "$path" ]] && [[ "$(cat "$path")" == "$content" ]]; then
    log "unchanged: $path"
    return 1
  fi
  if [[ "$DRY_RUN" == true ]]; then
    log "[dry-run] would write $path (mode $mode):"
    printf '%s\n' "$content" | sed 's/^/    | /' >&2
    return 0
  fi
  install -d -m 0755 "$(dirname -- "$path")"
  printf '%s\n' "$content" >"$path.tmp.$$"
  chmod "$mode" "$path.tmp.$$"
  mv -f "$path.tmp.$$" "$path"
  log "wrote $path"
  return 0
}

pkg_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }

apt_install() {
  local -a missing=()
  local p
  for p in "$@"; do pkg_installed "$p" || missing+=("$p"); done
  if ((${#missing[@]} == 0)); then log "packages present: $*"; return 0; fi
  log "installing: ${missing[*]}"
  run apt-get install "${APT_OPTS[@]}" --no-install-recommends "${missing[@]}"
}

# fetch_ok URL: HTTP 200 (curl, else wget). Used for detection only (runs in dry-run too).
fetch_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --max-time 20 -o /dev/null "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 20 -O /dev/null "$1"
  else
    return 2
  fi
}

# ── Detection ──────────────────────────────────────────────────────────────
step "detect the system"
[[ -r /etc/os-release ]] || die "/etc/os-release not found"
# shellcheck disable=SC1091
OS_ID="$(. /etc/os-release && printf '%s' "${ID:-}")"
# shellcheck disable=SC1091
OS_VERSION="$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")"
# shellcheck disable=SC1091
CODENAME="$(. /etc/os-release && printf '%s' "${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}")"
ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
MEM_KB="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
log "OS: ${OS_ID} ${OS_VERSION} (${CODENAME:-no codename}), architecture ${ARCH}, RAM $((MEM_KB / 1024)) MB"
[[ "$OS_ID" == ubuntu ]] || die "this script targets Ubuntu (found ${OS_ID:-unknown})"
[[ -n "$CODENAME" ]] || die "cannot determine the release codename from /etc/os-release"
case "$ARCH" in
  amd64 | arm64) ;;
  *) die "unsupported architecture $ARCH (amd64 or arm64)" ;;
esac
if [[ "${OS_VERSION%%.*}" -lt 24 ]]; then warn "Ubuntu $OS_VERSION is older than the tested releases (24.04, 26.04)"; fi
HAVE_SYSTEMD=false
[[ -d /run/systemd/system ]] && HAVE_SYSTEMD=true
[[ "$HAVE_SYSTEMD" == true ]] || warn "systemd is not running (container?): service steps are skipped"

svc() { # svc ARGS…: systemctl, skipped without a running systemd
  if [[ "$HAVE_SYSTEMD" == true ]]; then run systemctl "$@"; else log "[no systemd] systemctl $*"; fi
}

# ── systemd units ──────────────────────────────────────────────────────────
install_units() {
  step "systemd units (backup nightly, GeoIP monthly)"
  local src="$STACK_DIR/systemd" u changed=false
  [[ -d "$src" ]] || die "unit templates not found in $src"
  [[ -d "$APP_DIR/deploy/vps" ]] || warn "$APP_DIR/deploy/vps does not exist yet: clone the repository there (or pass --app-dir)"
  for u in orbes-backup.service orbes-backup.timer orbes-geoip.service orbes-geoip.timer; do
    if sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@DEPLOY_USER@|$DEPLOY_USER|g" "$src/$u" | write_file "/etc/systemd/system/$u" 0644; then
      changed=true
    fi
  done
  if [[ "$changed" == true ]]; then svc daemon-reload; fi
  svc enable --now orbes-backup.timer orbes-geoip.timer
}

if [[ "$UNITS_ONLY" == true ]]; then
  install_units
  log "units installed"
  exit 0
fi

# ── Packages ───────────────────────────────────────────────────────────────
step "apt update + upgrade"
run apt-get update -q
run apt-get upgrade "${APT_OPTS[@]}"
apt_install ca-certificates curl gnupg git jq openssl age rclone ufw fail2ban python3-systemd \
  unattended-upgrades needrestart

# ── Docker ─────────────────────────────────────────────────────────────────
step "Docker Engine"
docker_repo_supported() {
  fetch_ok "https://download.docker.com/linux/ubuntu/dists/$CODENAME/Release" \
    && fetch_ok "https://download.docker.com/linux/ubuntu/dists/$CODENAME/stable/binary-$ARCH/Packages.gz"
}
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Docker already installed: $(docker --version) / $(docker compose version --short 2>/dev/null)"
else
  source_choice=$DOCKER_SOURCE
  if [[ "$source_choice" == auto ]]; then
    if docker_repo_supported; then
      source_choice=docker
      log "Docker's apt repository publishes $CODENAME/$ARCH: using it"
    else
      rc=$?
      source_choice=ubuntu
      if ((rc == 2)); then
        warn "neither curl nor wget is available to probe download.docker.com: using Ubuntu's archive"
      else
        log "Docker's apt repository does not (yet) publish $CODENAME/$ARCH: using Ubuntu's archive"
      fi
    fi
  fi
  if [[ "$source_choice" == docker ]]; then
    run install -d -m 0755 /etc/apt/keyrings
    if [[ ! -s /etc/apt/keyrings/docker.asc ]]; then
      run curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
      run chmod a+r /etc/apt/keyrings/docker.asc
    fi
    write_file /etc/apt/sources.list.d/docker.sources 0644 <<EOF || true
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $CODENAME
Components: stable
Architectures: $ARCH
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    run apt-get update -q
    apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    apt_install docker.io docker-compose-v2 docker-buildx
  fi
fi
write_file /etc/docker/daemon.json 0644 <<'EOF' && svc restart docker || true
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true
}
EOF
svc enable --now docker
if [[ "$DRY_RUN" != true ]] && command -v docker >/dev/null 2>&1; then
  compose_v="$(docker compose version --short 2>/dev/null || echo 0)"
  log "docker compose $compose_v"
  if [[ "$(printf '%s\n2.24.0\n' "${compose_v#v}" | sort -V | head -n1)" != 2.24.0 ]]; then
    die "docker compose $compose_v is older than 2.24 (needed by compose.yaml): use --docker-source docker"
  fi
fi

# ── Firewall ───────────────────────────────────────────────────────────────
step "ufw"
SSH_PORTS="22"
if command -v sshd >/dev/null 2>&1; then
  ports="$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2}' | sort -u | tr '\n' ' ')"
  [[ -n "${ports// /}" ]] && SSH_PORTS="$ports"
fi
log "SSH listens on: $SSH_PORTS"
run ufw default deny incoming
run ufw default allow outgoing
for p in $SSH_PORTS; do run ufw allow "$p/tcp" comment 'SSH'; done
run ufw allow 80/tcp comment 'HTTP (ACME, redirect)'
run ufw allow 443/tcp comment 'HTTPS'
run ufw allow 443/udp comment 'HTTP/3'
run ufw --force enable

# ── Automatic security updates ─────────────────────────────────────────────
step "unattended-upgrades"
write_file /etc/apt/apt.conf.d/20auto-upgrades 0644 <<'EOF' || true
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
write_file /etc/apt/apt.conf.d/52orbes-unattended-upgrades 0644 <<EOF || true
// ORBES: written by deploy/vps/scripts/bootstrap-ubuntu.sh
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "$AUTO_REBOOT";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
svc enable --now unattended-upgrades

# ── fail2ban ───────────────────────────────────────────────────────────────
step "fail2ban (sshd)"
write_file /etc/fail2ban/jail.d/orbes-sshd.local 0644 <<EOF && svc restart fail2ban || true
# ORBES: written by deploy/vps/scripts/bootstrap-ubuntu.sh
[sshd]
enabled  = true
backend  = systemd
port     = ${SSH_PORTS// /,}
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
svc enable --now fail2ban

# ── Time synchronisation ───────────────────────────────────────────────────
step "time synchronisation"
ntp_active=""
if [[ "$HAVE_SYSTEMD" == true ]]; then
  for s in chrony chronyd systemd-timesyncd ntpsec ntp; do
    if systemctl is-active --quiet "$s" 2>/dev/null; then ntp_active=$s; break; fi
  done
fi
if [[ -n "$ntp_active" ]]; then
  log "NTP client already active: $ntp_active (kept)"
else
  if pkg_installed chrony; then
    log "chrony is installed: enabling it"
    svc enable --now chrony
  else
    apt_install systemd-timesyncd
    svc enable --now systemd-timesyncd
    if [[ "$HAVE_SYSTEMD" == true ]]; then run timedatectl set-ntp true; fi
  fi
fi
if [[ "$HAVE_SYSTEMD" == true && "$DRY_RUN" != true ]]; then
  log "clock: $(timedatectl show -p NTPSynchronized --value 2>/dev/null | sed 's/yes/synchronised/;s/no/NOT synchronised yet/')"
fi

# ── Swap ───────────────────────────────────────────────────────────────────
step "swap"
if ((MEM_KB < 2 * 1024 * 1024)); then
  if [[ -n "$(swapon --noheadings --show=NAME 2>/dev/null)" ]]; then
    log "swap already active"
  elif [[ -f /swapfile ]]; then
    run swapon /swapfile
  else
    log "RAM < 2 GB and no swap: creating a 2 GB /swapfile"
    run fallocate -l 2G /swapfile
    run chmod 600 /swapfile
    run mkswap /swapfile
    run swapon /swapfile
  fi
  grep -qs '^/swapfile ' /etc/fstab || { if [[ "$DRY_RUN" == true ]]; then log "[dry-run] would add /swapfile to /etc/fstab"; else echo '/swapfile none swap sw 0 0' >>/etc/fstab; fi; }
  write_file /etc/sysctl.d/90-orbes-swap.conf 0644 <<<'vm.swappiness = 10' && run sysctl -q -p /etc/sysctl.d/90-orbes-swap.conf || true
else
  log "RAM ≥ 2 GB: no swap file needed"
fi

# ── Deploy user and directories ────────────────────────────────────────────
step "deploy user $DEPLOY_USER"
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  log "user $DEPLOY_USER exists"
else
  run useradd --create-home --shell /bin/bash --user-group "$DEPLOY_USER"
fi
if getent group docker >/dev/null 2>&1 || [[ "$DRY_RUN" == true ]]; then
  if id -nG "$DEPLOY_USER" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    log "$DEPLOY_USER is in the docker group (note: docker access is root-equivalent)"
  else
    run usermod -aG docker "$DEPLOY_USER"
  fi
fi
run install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/orbes
run install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/backups/orbes
if [[ -d "$APP_DIR" && "$DRY_RUN" != true ]]; then
  owner="$(stat -c %U "$APP_DIR")"
  [[ "$owner" == "$DEPLOY_USER" ]] || { log "chown -R $DEPLOY_USER $APP_DIR"; chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"; }
fi

install_units

# ── Optional SSH hardening ─────────────────────────────────────────────────
if [[ "$HARDEN_SSH" == true ]]; then
  step "SSH hardening (key-only, no root login)"
  need_cmd sshd ssh-keygen
  candidate=""
  candidates=()
  [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != root ]] && candidates+=("$SUDO_USER")
  while IFS= read -r u; do candidates+=("$u"); done < <(getent group sudo | cut -d: -f4 | tr ',' '\n' | sed '/^$/d')
  for u in "${candidates[@]}"; do
    home="$(getent passwd "$u" | cut -d: -f6)"
    keys="$home/.ssh/authorized_keys"
    [[ -s "$keys" ]] || continue
    ssh-keygen -l -f "$keys" >/dev/null 2>&1 || continue          # at least one valid public key
    id -nG "$u" | tr ' ' '\n' | grep -qxE 'sudo|admin' || continue
    # sudo must work for that user without a root password: NOPASSWD or a usable password.
    if sudo -l -U "$u" 2>/dev/null | grep -q 'NOPASSWD' || passwd -S "$u" 2>/dev/null | awk '{exit !($2 == "P")}'; then
      candidate=$u; break
    fi
  done
  if [[ -z "$candidate" ]]; then
    die "refusing --harden-ssh: no non-root sudo user with a valid ~/.ssh/authorized_keys and a working sudo (NOPASSWD or a password). Create one first, test 'ssh <user>@host sudo -v', then rerun."
  fi
  log "verified fallback admin: $candidate ($(ssh-keygen -l -f "$(getent passwd "$candidate" | cut -d: -f6)/.ssh/authorized_keys" | wc -l) key(s))"
  DROPIN=/etc/ssh/sshd_config.d/10-orbes-hardening.conf
  grep -qsE '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config \
    || die "/etc/ssh/sshd_config does not include sshd_config.d/*.conf: harden it by hand"
  if write_file "$DROPIN" 0644 <<'EOF'
# ORBES: written by deploy/vps/scripts/bootstrap-ubuntu.sh --harden-ssh
# First match wins in sshd, and this file sorts before cloud-init's 50-cloud-init.conf.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 4
X11Forwarding no
EOF
  then
    if [[ "$DRY_RUN" != true ]]; then
      if ! sshd -t; then
        rm -f "$DROPIN"
        die "sshd -t rejected the configuration: hardening drop-in removed, nothing changed"
      fi
      effective="$(sshd -T 2>/dev/null | grep -E '^(permitrootlogin|passwordauthentication) ')"
      log "effective: $(tr '\n' ' ' <<<"$effective")"
      svc reload ssh || svc reload sshd || true
    fi
    warn "SSH now accepts keys only and refuses root. KEEP THIS SESSION OPEN and test a NEW login as $candidate (and 'sudo -v') before closing it."
  fi
fi

step "done"
cat >&2 <<EOF
Next, as $DEPLOY_USER (sudo -iu $DEPLOY_USER):
  git clone <repository URL> $APP_DIR        (if not done yet; a read-only deploy key works for a private repo)
  cd $APP_DIR/deploy/vps && scripts/setup.sh
EOF
