# ORBES GENOME CODE on one OVH VPS

Production stack for `https://verify.theorbes.com`: **Caddy** (automatic HTTPS) → **app** (the `genome/` image) → **PostgreSQL 17**, on one Ubuntu 26.04 LTS VPS. The website `theorbes.com` stays on Vercel; its only change is the redirect of `/verify` in the root `vercel.json`.

Full runbook: [docs/DEPLOYMENT.md §15](../../docs/DEPLOYMENT.md#15-ovh-vps-deployment). This page is the short version.

```
internet ──80/443──▶ caddy ──edge (internal)──▶ app:8080 ──backend (internal)──▶ postgres
                     172.30.80.2 = the app's TRUST_PROXY
```

| File | Purpose |
|---|---|
| `compose.yaml` | The three services and the `geoip-update` tool. Only Caddy publishes ports (IPv4 only). The app connects as `POSTGRES_APP_USER`, a role with SELECT/INSERT/UPDATE/DELETE only; the superuser `POSTGRES_USER` is used by the scripts alone. |
| `Caddyfile`, `caddy.d/` | TLS, HTTP→HTTPS, one trusted `X-Forwarded-For` entry, filtered JSON access log, optional `/admin` allowlist, optional Cloudflare mode. |
| `.env.example` | Every stack variable. `scripts/setup.sh` turns it into `.env` (mode 0600, never committed). |
| `scripts/bootstrap-ubuntu.sh` | Once, as root: updates, Docker, ufw, fail2ban, unattended-upgrades, time sync, swap, the `orbes` user, systemd timers, optional SSH hardening. |
| `scripts/setup.sh` | Once, as `orbes`: `.env` with generated secrets, backup key, first deployment, GeoIP database. |
| `scripts/deploy.sh` | Build a git ref, validate the Caddy configuration, back up, migrate (as the schema owner), roll out, first signing key, smoke tests, automatic rollback. |
| `scripts/backup.sh` / `restore.sh` | Encrypted (age) database + key-volume archives, retention, optional copy to OVH Object Storage; restore with checks and confirmation. |
| `scripts/geoip-update.sh` | DB-IP City Lite refresh into the `geoip` volume (weekly timer; a new edition appears monthly). |
| `systemd/` | `orbes-backup.timer` (nightly), `orbes-geoip.timer` (weekly). |

## Quick start

```bash
# 1. On the new VPS (OVH's Ubuntu image logs you in as `ubuntu`, with sudo):
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/<org>/orbes-index.git /opt/orbes/orbes-index
sudo /opt/orbes/orbes-index/deploy/vps/scripts/bootstrap-ubuntu.sh --dry-run    # read what it will do
sudo /opt/orbes/orbes-index/deploy/vps/scripts/bootstrap-ubuntu.sh              # add --harden-ssh once your key login works

# 2. DNS: an A record verify.theorbes.com → the VPS's IPv4 address. Wait until it resolves.

# 3. As the deploy user:
sudo -iu orbes
cd /opt/orbes/orbes-index/deploy/vps
scripts/setup.sh --domain verify.theorbes.com --acme-email ops@theorbes.com --admin-email <first admin>
#   prints the secrets to escrow and the backup decryption key ONCE: store them offline

# 4. TOTP for the first admin, then drop the bootstrap credentials:
docker compose exec app node --import tsx scripts/admin.ts totp-setup --email <first admin>
docker compose exec app node --import tsx scripts/admin.ts totp-enable --email <first admin> --secret <SECRET> --code <code>
#   remove BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD from .env, then:
docker compose up -d
```

Day to day (as `orbes`, in this directory):

```bash
git pull && scripts/deploy.sh            # update (backup first, automatic rollback on failure)
scripts/deploy.sh --image <previous tag> # manual rollback to an image still on the host
docker compose ps                        # health of caddy / app / postgres
docker compose logs -f --tail 100 app    # JSON logs
scripts/backup.sh                        # on-demand encrypted backup (nightly via systemd anyway)
systemctl list-timers 'orbes-*'          # next backup / GeoIP refresh
```

Changing `.env` (e.g. `ADMIN_ALLOWED_IPS="203.0.113.7/32 198.51.100.0/24"`, space-separated, no commas): apply it with `scripts/deploy.sh`, which validates the Caddy configuration before touching anything. A bare `docker compose up -d` skips that check, and an invalid value stops Caddy, i.e. the whole site.

## Local trial of the whole stack

```bash
cp .env.example .env && chmod 600 .env
scripts/setup.sh --tls-internal --domain verify.orbes.test --acme-email ops@orbes.test \
  --admin-email admin@orbes.test --no-geoip
docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > /tmp/orbes-local-root.crt
curl --cacert /tmp/orbes-local-root.crt --resolve verify.orbes.test:443:127.0.0.1 https://verify.orbes.test/api/v1/health
```

`TLS_MODE=internal` uses Caddy's local CA: never in production.
