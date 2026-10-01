# ORBES GENOME CODE™ — Deployment and Operations

Status: v0.1 · Owner: ORBES Digital Identity · Companion documents: [ARCHITECTURE](ARCHITECTURE.md) (§D, §E phase 13), [SECURITY-MODEL](SECURITY-MODEL.md), [CRYPTOGRAPHY](CRYPTOGRAPHY.md) (§5 key management), [DATABASE](DATABASE.md) (§9 migrations, §11 backups), [API](API.md).

This is the runbook for running the verification service in production: what to deploy, how to configure it, how to bring it up the first time, and what to do on key rotation, key compromise, upgrade and restore. Every variable name, default and rule below is taken from `genome/src/server/config.ts`, `genome/src/server/index.ts`, `genome/src/server/context.ts`, `genome/scripts/db.ts`, `genome/scripts/keys.ts`, `genome/scripts/admin.ts`, `genome/Dockerfile` and `genome/docker-compose.yml`. When this document and the code disagree, the code wins: please fix the document.

Contents

1. [Deployment architecture](#1-deployment-architecture)
2. [Prerequisites](#2-prerequisites)
3. [Configuration reference](#3-configuration-reference)
4. [Secrets](#4-secrets)
5. [First deployment](#5-first-deployment)
6. [Database and migrations](#6-database-and-migrations)
7. [Signing keys](#7-signing-keys)
8. [Admin accounts](#8-admin-accounts)
9. [Health checks, logging and monitoring](#9-health-checks-logging-and-monitoring)
10. [Backups and point-in-time recovery](#10-backups-and-point-in-time-recovery)
11. [Scaling](#11-scaling)
12. [Upgrade and rollback](#12-upgrade-and-rollback)
13. [Smoke tests](#13-smoke-tests)
14. [Production security checklist](#14-production-security-checklist)

---

## 1. Deployment architecture

```
 phone / browser
        │ HTTPS
        ▼
 ┌────────────────────────────────────────────────────────────┐
 │ TLS edge / CDN (Cloudflare, a load balancer, Caddy, nginx) │
 │  · terminates TLS, redirects HTTP → HTTPS                  │
 │  · ORBES GENOME paths (§1.1) → reverse proxy → app         │
 │  · everything else on theorbes.com → existing static host  │
 └──────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
   static host (unchanged)        app container (orbes-genome image)
   theorbes.com/ → index.html     port 8080 · Node 22 · uid 1000
                                  read-only root filesystem
                                      │                  │
                                      ▼                  ▼
                           PostgreSQL 16/17         signing keys
                           registry, scans,         KEY_DIR volume, encrypted
                           audit log (TLS,          under KEY_ENCRYPTION_KEY,
                           never published)         or a KMS/HSM provider
```

One image (`genome/Dockerfile`) contains everything the service needs:

| Path | Served by the app | Notes |
|---|---|---|
| `/verify`, `/verify/*` | Mobile scanner (`dist/web/verify`) | Needs HTTPS: browsers only open the camera in a secure context. |
| `/admin`, `/admin/*` | Admin console (`dist/web/admin`) | Restrict at the edge (§14). |
| `/assets/*` | Content-hashed bundles, CSS, favicons | `Cache-Control: public, max-age=31536000, immutable`. |
| `/api/v1/*` | Public and account API | `Cache-Control: no-store`, except `/api/v1/keys` (5 min) and `/api/v1/categories` (1 min). |
| `/api/admin/*` | Admin API | Cookie sessions, CSRF, TOTP enforced in production. |
| `/.well-known/orbes-keys.json` | Public signing keys (same document as `/api/v1/keys`) | CORS `*`, `max-age=300`. |
| `/` | `302` → `/verify` | Only meaningful on a dedicated hostname. |

The web apps reference their assets and the API with **absolute paths** (`/assets/…`, `/api/…`). The service must therefore be reached at the root of its origin, or with these paths forwarded unchanged. A path prefix that the proxy strips (for example `theorbes.com/genome/…`) does not work.

### 1.1 Mapping `theorbes.com/verify` to the service

The ORBES website is a single static file (`index.html` at the repository root, with every asset embedded). Neither option below changes it or its hosting.

**Option A: dedicated subdomain (recommended).** Serve the service at `https://verify.theorbes.com` and add a redirect at the edge or on the static host:

```
https://theorbes.com/verify      301 → https://verify.theorbes.com/verify
https://theorbes.com/verify/*    301 → https://verify.theorbes.com/verify/$1
```

- `PUBLIC_ORIGIN=https://verify.theorbes.com`.
- The service gets its own origin. Its CSP, cookies (`__Host-orbes_session`, `__Host-orbes_admin`, `__Host-orbes_device` in production: host-only by construction), HSTS and rate limits stay isolated from the marketing site.
- The app sends `Strict-Transport-Security: max-age=63072000; includeSubDomains` in production. On `verify.theorbes.com` this only covers that host and its own subdomains.
- Nothing has to change on the static host except the redirect. With Cloudflare in front of `theorbes.com`, a Redirect Rule does it. On a host without redirect rules, a CDN in front can do it.

**Option B: path routing on `theorbes.com`.** The edge sends these paths to the service and everything else to the static host:

```
/verify   /verify/*   /api/*   /assets/*   /.well-known/orbes-keys.json   (/admin  /admin/* only if wanted, see below)
```

- `PUBLIC_ORIGIN=https://theorbes.com`. It must equal the browser's origin exactly, because the CSRF check compares the `Origin` header with it. Pick one canonical host and redirect the other (`www.theorbes.com` → `theorbes.com`, or the reverse).
- Do not route `/` to the service: it would redirect the homepage to `/verify`.
- `/assets/*` belongs to the service. `index.html` embeds its assets today, so nothing collides. Keep it that way, or move website assets elsewhere.
- **HSTS caveat.** The service's responses would carry `includeSubDomains` for `theorbes.com`, which forces HTTPS on **every** subdomain of `theorbes.com` for two years. Only choose Option B when every subdomain already serves HTTPS, or override the header at the edge.
- Serve the admin console on a separate, access-restricted hostname, or block `/admin*` and `/api/admin/*` at the edge for everyone outside the staff network.

Example nginx configuration for Option B: a shared proxy include, then the server block. For Option A, use the same include in a `verify.theorbes.com` server block with a single `location / { proxy_pass http://127.0.0.1:8080; include conf.d/orbes-genome-proxy.inc; }`.

```nginx
# /etc/nginx/conf.d/orbes-genome-proxy.inc
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-For   $remote_addr;   # overwrite: never forward a client-supplied chain
proxy_set_header X-Forwarded-Proto $scheme;
proxy_http_version 1.1;
proxy_read_timeout 35s;                            # the app's request timeout is 30 s
```

```nginx
# /etc/nginx/conf.d/theorbes.com.conf
server {
    listen 443 ssl;
    http2 on;
    server_name theorbes.com;
    # ssl_certificate … (managed by your ACME client)

    root /srv/theorbes.com;                        # the existing static site, unchanged
    location = / { try_files /index.html =404; }

    location = /verify                       { proxy_pass http://127.0.0.1:8080; include conf.d/orbes-genome-proxy.inc; }
    location ^~ /verify/                     { proxy_pass http://127.0.0.1:8080; include conf.d/orbes-genome-proxy.inc; }
    location ^~ /api/                        { proxy_pass http://127.0.0.1:8080; include conf.d/orbes-genome-proxy.inc; }
    location ^~ /assets/                     { proxy_pass http://127.0.0.1:8080; include conf.d/orbes-genome-proxy.inc; }
    location = /.well-known/orbes-keys.json  { proxy_pass http://127.0.0.1:8080; include conf.d/orbes-genome-proxy.inc; }
}
```

With Caddy (Option A), `reverse_proxy` already replaces `X-Forwarded-For` with the peer address when no `trusted_proxies` are configured:

```caddyfile
verify.theorbes.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
```

### 1.2 Edge requirements

| Requirement | Why |
|---|---|
| HTTPS only, TLS 1.2+, HTTP redirected to HTTPS | Camera access, Secure cookies, HSTS. |
| Client IP forwarded in `X-Forwarded-For`, and the proxy's address listed in `TRUST_PROXY` | Rate limits and IP pseudonyms are per client. Without trust, every client shares the proxy's IP and one rate-limit bucket. |
| Origin cache headers honoured. Never cache `/api/*` beyond what the app allows. | API responses can carry session-bound data (`no-store`). |
| `Set-Cookie` passed through untouched on `/api/*` | Sessions and the device cookie. |
| Request bodies ≥ 16 KB allowed, upstream timeout > 30 s | The app limits JSON bodies to 16 KB and requests to 30 s. |
| No iframe embedding | The CSP has `frame-ancestors 'none'`. Link or redirect to `/verify`; do not embed it. |
| With Cloudflare and `GEO_MODE=cloudflare`: the origin only accepts Cloudflare (firewall on Cloudflare's published ranges, Authenticated Origin Pulls or a Tunnel). The reverse proxy restores the client IP from Cloudflare (nginx `set_real_ip_from <Cloudflare ranges>` + `real_ip_header CF-Connecting-IP`; Caddy `trusted_proxies`). | Otherwise anyone can send forged `cf-ipcountry` headers straight to the origin, and every client shares Cloudflare's IPs. |

---

## 2. Prerequisites

| Component | Version / requirement |
|---|---|
| Container runtime | Docker Engine 24+ with BuildKit (the Dockerfile uses `RUN --mount`), or any OCI runtime and orchestrator. |
| Docker Compose (single-host setup) | v2.24 or later (`env_file` with `path`/`required`). |
| PostgreSQL | 16 or 17. `docker-compose.yml` runs `postgres:17`; CI tests against `postgres:16`. No extension is needed (`gen_random_uuid()` is built in). A managed service with point-in-time recovery is recommended. |
| Node.js (only to run the tools outside the image) | 22 or later (`engines.node`). The image ships Node 22. |
| TLS edge | A reverse proxy or CDN that terminates TLS for `verify.theorbes.com` (or `theorbes.com`, Option B). |
| Secret storage | A secret manager, or at least a root-only env file (`0600`) outside the checkout. Somewhere separate to keep `KEY_ENCRYPTION_KEY`. |
| Authenticator app | For each admin (TOTP, RFC 6238), mandatory in production. |
| Persistent storage | A volume for `KEY_DIR` (local key provider) and the database volume or managed database. |

---

## 3. Configuration reference

All configuration comes from environment variables. It is parsed **once at start** by `loadConfig()`. Nothing is read from files except through the environment.

**How validation works**

- **Empty means unset.** Values are trimmed, and `FOO=` behaves exactly like an unset `FOO`.
- **Every problem is reported at once.** The process prints `Invalid configuration:` followed by one line per problem on stderr, then exits with code **78** (EX_CONFIG). Messages name the variable and the rule, never the value.
- **Validation is two-pass.** Field rules (format, ranges, required fields) are checked first. The production hardening rules (§3.2) run only once every field is valid, so fixing the first batch of errors can reveal a second one.
- **Production fails safe.** `ORBES_ENV` selects the environment. When it is unset and `NODE_ENV=production`, production rules apply. The image sets both to `production`.
- **Development and test have working defaults** (in-memory PGlite, memory keys, well-known dev secrets). **Production has none**: every secret is required.

### 3.1 Variables

**Runtime**

| Variable | Default | Rules |
|---|---|---|
| `ORBES_ENV` | `development` (`production` if unset and `NODE_ENV=production`). The image sets `production`. | One of `development`, `test`, `production`. |
| `NODE_ENV` | The image sets `production` | Only consulted when `ORBES_ENV` is unset. Not an operator setting. |
| `HOST` | `0.0.0.0` in production, `127.0.0.1` otherwise. Compose pins `0.0.0.0`. | Hostname or IP address characters (`[A-Za-z0-9.:_-[]]`), 1–255. |
| `PORT` | `8080` | Integer 1–65535. Compose pins `8080` inside the container. |
| `PUBLIC_ORIGIN` | `http://localhost:<PORT>` outside production. **Required in production.** | Absolute `http`/`https` URL origin: no credentials, path, query, fragment or trailing slash. **Production: must be `https://`.** Used for the CSRF `Origin` check, so it must match the browser's address bar exactly. |
| `TRUST_PROXY` | `false` | `true`/`yes` → trust every hop. `false`/`no`/`0` → trust none. A bare number (hop count) is **refused** in every environment. Anything else is passed to Fastify as a comma-separated list of IPs, CIDRs or the names `loopback`, `linklocal`, `uniquelocal`. **Production refuses `true`** (the left-most `X-Forwarded-For` entry is client-forgeable). See §3.3. |
| `LOG_LEVEL` | `info` in production, `debug` in development, `warn` in test | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` (case-insensitive). Validated by `loadConfig()` (`config.logLevel`); anything else is a configuration error. |
| `MIGRATE_ON_START` | `false` (compose: `true`) | `1`/`true`/`yes` or `0`/`false`/`no` (case-insensitive; anything else is a configuration error, `config.migrateOnStart`). Production only: `true` applies pending migrations at start, like the `--migrate` flag. Development and test always migrate. |
| `ADMIN_REQUIRE_MFA` | `true` in production, `false` otherwise | Same boolean syntax (`config.adminRequireMfa`). Admin sessions must have passed TOTP before using any admin route except sign-in and enrolment. `false` in production is accepted but logged as a warning at every start (`risky configuration`): use it only for an enrolment window, and prefer enrolling admins with `scripts/admin.ts` (§8.1). |
| `ORBES_DEMO` | unset | Same as the `--demo` flag (§13.1): development and test only, `DATABASE_URL=pglite:memory` only. |

**Database**

| Variable | Default | Rules |
|---|---|---|
| `DATABASE_URL` | `pglite:memory` outside production. **Required in production.** Compose builds it from `POSTGRES_*`. | `postgres://…` or `postgresql://…` (a host is required; unix sockets via `?host=/path`), `pglite:memory`, or `pglite:/absolute/dir`. **Production refuses `pglite:`.** Error messages never echo the URL. TLS options go in the query string, e.g. `?sslmode=verify-full&sslrootcert=/etc/orbes/pg-ca.pem`. |
| `POSTGRES_DB` | `orbes` | Compose only: database of the `db` service. |
| `POSTGRES_USER` | `orbes` | Compose only. |
| `POSTGRES_PASSWORD` | none, **required by compose** | Compose only. Use URL-safe characters (it is embedded in `DATABASE_URL`), e.g. `openssl rand -hex 24`. |

**Secrets**

| Variable | Default | Rules |
|---|---|---|
| `COOKIE_SECRET` | Well-known dev value outside production. **Required in production.** | At least 32 characters. Production also refuses the dev default, fewer than 10 distinct characters ("too little variety"), and a value equal to `IP_HASH_PEPPER`. Signs the session and device cookies. |
| `IP_HASH_PEPPER` | Well-known dev value outside production. **Required in production.** | Same rules as `COOKIE_SECRET`, and it must be a different secret. HMAC key that pseudonymises IPs, device ids and session ids before storage. |

**Signing keys**

| Variable | Default | Rules |
|---|---|---|
| `KEY_PROVIDER` | `local` in production, `memory` otherwise | `local` or `memory`. **Production refuses `memory`** (keys would vanish on restart). |
| `KEY_DIR` | none (image/compose: `/var/lib/orbes/keys`) | Required when `KEY_PROVIDER=local`. Absolute path. Created with mode `0700`; group/world bits on an existing directory are removed (with a warning). |
| `KEY_ENCRYPTION_KEY` | none | Required when `KEY_PROVIDER=local`. base64url **without padding** of **exactly 32 bytes** (43 characters). Production refuses a key whose bytes are all identical. The AES-256-GCM key-encryption key for every key file. The admin TOTP sealing key is also derived from it (HKDF), see §7.7. |

**First admin**

| Variable | Default | Rules |
|---|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | unset | Set both or neither. An email address (≤ 254 characters). |
| `BOOTSTRAP_ADMIN_PASSWORD` | unset | 12–1024 characters. Creates one ADMIN at start **only when no admin exists**, and is ignored afterwards. Remove both variables after the first start. |

**Geolocation** (feeds anomaly scoring only)

| Variable | Default | Rules |
|---|---|---|
| `GEO_MODE` | `none` | `none`, `mmdb` (local GeoIP database, §3.4; the `.env.example` value), `cloudflare` (`cf-ipcountry`, `cf-iplatitude`, `cf-iplongitude`, `cf-region`) or `headers`. **Production: `mmdb`, `cloudflare` and `headers` require `TRUST_PROXY`** (not `false`). |
| `GEO_MMDB_PATH` | unset | Absolute path of the `.mmdb` file. **Required when `GEO_MODE=mmdb`.** Its existence is not checked at start: a missing file only disables geolocation (§3.4). |
| `GEO_COUNTRY_HEADER` | unset | A valid HTTP header name (case-insensitive). **Required when `GEO_MODE=headers`.** |
| `GEO_LAT_HEADER`, `GEO_LON_HEADER` | unset | Valid header names. In `headers` mode, set both or neither. Only use `headers` behind a proxy that **overwrites** these headers on every request. |

**Rate limits** (requests per minute per client IP, IPv6 grouped by /64, per process, see §11)

| Variable | Default (test: 10 000) | Rules |
|---|---|---|
| `RATE_LIMIT_VERIFY_PER_MINUTE` | `60` | Integer 1–1 000 000. Applies to `POST /api/v1/verify`. |
| `RATE_LIMIT_AUTH_PER_MINUTE` | `10` | Same range. Applies to logins, registration, claim and transfer codes, and TOTP enrolment, all sharing one budget. |
| `RATE_LIMIT_ADMIN_PER_MINUTE` | `300` | Same range. Applies to every other admin route. |
| `RATE_LIMIT_API_PER_MINUTE` | `120` | Same range. Applies to the remaining public and account routes (health, keys, categories, account reads, …): the `api` group. |

Any other `RATE_LIMIT_*` name is rejected, so a typo cannot silently keep a default.

**Sessions**

| Variable | Default | Rules |
|---|---|---|
| `SESSION_TTL_ACCOUNT_HOURS` | `720` | Integer 1–8760. |
| `SESSION_TTL_ADMIN_HOURS` | `8` | Integer 1–168. |

**Anomaly thresholds** (internal, never exposed by the API). Any other `ANOMALY_*` name is rejected.

| Variable | Default | Range |
|---|---|---|
| `ANOMALY_SUSPICIOUS_THRESHOLD` | `60` | integer 1–100 |
| `ANOMALY_IMPOSSIBLE_TRAVEL_KMH` | `900` | 1–100 000 |
| `ANOMALY_MIN_TRAVEL_KM` | `500` | 0–40 075 |
| `ANOMALY_VELOCITY_WINDOW_MIN` | `60` | integer 1–10 080 |
| `ANOMALY_VELOCITY_MAX_SCANS` | `20` | integer 1–1 000 000 |
| `ANOMALY_VELOCITY_MIN_DEVICES` | `5` | integer 1–1 000 000 |
| `ANOMALY_DEVICE_WINDOW_DAYS` | `7` | integer 1–3 650 |
| `ANOMALY_DEVICE_MAX` | `12` | integer 1–1 000 000 |
| `ANOMALY_GEO_WINDOW_DAYS` | `7` | integer 1–3 650 |
| `ANOMALY_GEO_MAX_COUNTRIES` | `3` | integer 1–250 |
| `ANOMALY_DECAY_DAYS` | `30` | 0.001–3 650 |

**Compose and tooling only**

| Variable | Default | Used by |
|---|---|---|
| `APP_BIND` | `127.0.0.1` | Compose: host address the app is published on. Keep it on loopback behind a reverse proxy. |
| `APP_PORT` | `8080` | Compose: host port. |
| `ORBES_IMAGE_TAG` | `latest` | Compose: image tag built and run (`orbes-genome:<tag>`). |
| `ORBES_ENV_FILE` | `.env` | Compose: path of the env file, e.g. `/etc/orbes/genome.env`. Export it in the shell. |
| `DEMO_ACCOUNT_PASSWORD` | random, printed once | `db seed` / `db reset-demo` only, ≥ 12 characters. Both commands refuse production. |
| `ADMIN_PASSWORD` | unset | `scripts/admin.ts create` only: the new admin's password (12–1024 characters), read from the environment so it never appears in argv or shell history. |

`genome/.env.example` lists every variable above with the production template values. The test `test/ops/deployment-files.test.ts` keeps it in sync with the code.

### 3.2 Production refusals at a glance

With `ORBES_ENV=production` (or `NODE_ENV=production` and no `ORBES_ENV`), the server and the CLIs refuse to start when:

| Rule | Message (abridged) |
|---|---|
| `PUBLIC_ORIGIN`, `DATABASE_URL`, `COOKIE_SECRET` or `IP_HASH_PEPPER` is missing | `…: required in production` |
| `DATABASE_URL` is `pglite:` | `pglite is refused in production` |
| `KEY_PROVIDER=memory` | `memory is refused in production` |
| `KEY_PROVIDER=local` without `KEY_DIR` (absolute) or `KEY_ENCRYPTION_KEY` (32 bytes, base64url) | `required when KEY_PROVIDER=local` / `must be an absolute path` / `must be base64url (no padding) encoding exactly 32 bytes` |
| `KEY_ENCRYPTION_KEY` with all bytes identical | `refused (all bytes identical)` |
| A secret shorter than 32 characters, the dev default, or fewer than 10 distinct characters | `must be at least 32 characters` / `the development default is refused` / `too little variety` |
| `COOKIE_SECRET` equals `IP_HASH_PEPPER` | `must be different secrets` |
| `PUBLIC_ORIGIN` is not `https://` | `must be https:// in production` |
| `TRUST_PROXY=true` (or `yes`) | `"true" trusts every X-Forwarded-For hop (client-forgeable)` |
| `TRUST_PROXY` is a number (any environment) | `hop counts are not supported` |
| `GEO_MODE=mmdb`, `cloudflare` or `headers` without `TRUST_PROXY` | `… mode requires TRUST_PROXY in production` |
| `GEO_MODE=mmdb` without an absolute `GEO_MMDB_PATH` (any environment) | `GEO_MMDB_PATH: required when GEO_MODE=mmdb` / `must be an absolute path` |
| Pending migrations, without `--migrate` / `MIGRATE_ON_START` | `startup failed`, reason `database schema is not up to date (pending: …)`, exit code 1 |

Production also changes behaviour at runtime:

- admin sessions must pass **TOTP** before any admin route except sign-in and TOTP enrolment (`MFA_REQUIRED`, 403), unless `ADMIN_REQUIRE_MFA=false` (warned at start);
- cookies are `Secure` and `__Host-` prefixed (`__Host-orbes_session`, `__Host-orbes_admin`, `__Host-orbes_device`: `Path=/`, no `Domain`), and HSTS is sent;
- `--demo` / `ORBES_DEMO` is refused;
- no signing key is created automatically;
- `db seed`, `db reset-demo` and `scripts/export-demo-codes.ts` refuse to run.

### 3.3 Choosing `TRUST_PROXY`

`TRUST_PROXY` must list exactly the addresses your proxy connects **from**, as the app sees them.

| Topology | Peer address seen by the app | `TRUST_PROXY` |
|---|---|---|
| Compose (`127.0.0.1:8080` published) + Caddy/nginx on the host | Docker bridge gateway (`172.16.0.0/12`) | `uniquelocal` (the `.env.example` default) |
| App and proxy containers on the same Docker network | The proxy container's private IP | `uniquelocal`, or its subnet |
| Proxy on the same host, app run with host networking or as a plain process | `127.0.0.1` / `::1` | `loopback` |
| Cloud load balancer in a VPC | The LB's private addresses | The VPC subnet CIDR, e.g. `10.0.0.0/16` |
| No proxy (development only) | The client | `false` |

The client IP is the first untrusted address, counting from the right of `X-Forwarded-For`. A proxy that appends to the header is therefore safe. One that forwards the client's header unchanged and without its own entry is not.

### 3.4 GeoIP database (`GEO_MODE=mmdb`)

Anomaly scoring (impossible travel, geographic dispersion) needs a coarse location per scan. Without a CDN in front, the app locates the client itself: the client IP it already computes (`request.ip`, with `TRUST_PROXY` applied to `X-Forwarded-For`) is looked up in a local MaxMind-format file. Cloudflare remains optional (`GEO_MODE=cloudflare`, §1.2).

**Data and licence.** [DB-IP](https://db-ip.com) "IP to City Lite", published monthly at `https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz` (≈ 57 MiB compressed, ≈ 121 MiB installed), licence [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The attribution "IP Geolocation by DB-IP" with a link to db-ip.com is kept in `NOTICE.md` at the repository root; if a location derived from it is ever displayed (the admin console, a report), show the same attribution there. The file is never committed: locally it lives in `genome/.data/geoip/` (git-ignored). MaxMind GeoLite2-City uses the same format and also works (its own licence key and EULA; not automated here).

**What the app does with it**

| Situation | Behaviour |
|---|---|
| Public client IP | `{ country, lat, lon }`, coordinates rounded to 1 decimal (≈ 10 km), stored on the scan event like the other modes. Unknown countries and out-of-range values are dropped. |
| Private, loopback, link-local, CGNAT, documentation, multicast or other special-purpose IP | Not looked up: no location. |
| Raw IP | Used in memory for the lookup only. Never logged (lookup errors log only the error class), never stored: only the peppered HMAC is kept. |
| File missing, unreadable or corrupt at start | One warning (`geoip database unavailable; scans get no location until it is installed`), scans get no location, **verification is unaffected**. |
| File replaced | Checked at most every 10 minutes (mtime, size, inode; lazily, on lookups) and reloaded in the background: `geoip database reloaded`. No restart. |
| Replacement corrupt, or file deleted | The copy already in memory keeps serving; one warning (`keeping the copy already in memory`). |
| Cost | ≈ 125 MiB of RAM in the app (twice that for a moment during a reload), load ≈ 0.15 s, lookup ≈ 6–9 µs (measured on the 2026-10 edition, 100 000 random IPv4 addresses). |

**Configuration.** `GEO_MODE=mmdb`, `GEO_MMDB_PATH=/var/lib/orbes/geoip/dbip-city-lite.mmdb` (absolute, inside the container) and a `TRUST_PROXY` that lists the proxy (§3.3). Mount the GeoIP directory into the app container **read-only**; only the updater writes to it.

**Install and refresh: `scripts/geoip-update.ts`**

```bash
# Install or refresh $GEO_MMDB_PATH (or --path <file>); default without either: genome/.data/geoip/dbip-city-lite.mmdb
node --import tsx scripts/geoip-update.ts
#   geoip-update: downloading https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz
#   geoip-update: downloaded 57.4 MiB compressed, 121.1 MiB uncompressed; gzip integrity OK
#   geoip-update: probe 8.8.8.8 → US (37.4, -122.1) OK
#   geoip-update: validated DBIP-City-Lite built 2026-10-01T01:41:21.000Z (14297794 nodes)
#   geoip-update: installed edition 2026-10 at /var/lib/orbes/geoip/dbip-city-lite.mmdb

node --import tsx scripts/geoip-update.ts --dry-run          # what would be downloaded (HEAD only); writes nothing
node --import tsx scripts/geoip-update.ts --check /var/lib/orbes/geoip/dbip-city-lite.mmdb --probe 81.2.69.160=GB
node --import tsx scripts/geoip-update.ts --rollback         # the previous file becomes current again
node --import tsx scripts/geoip-update.ts --help             # every option (--month, --force, --probe, --json, …)
```

- The current UTC month is tried first; while it is not published (HTTP 404) the previous month is used. Any other HTTP error fails without falling back.
- The archive is size-capped and gunzipped as a stream (CRC and length checked), then opened with the server's own code and must resolve the probes (default `8.8.8.8=US`) before it is installed. A failed run leaves the installed file untouched and exits 1.
- Install is atomic (temporary file in the same directory, fsync, rename); the replaced file is kept as `<file>.previous`, and `<file>.json` records the edition, URL, SHA-256 and build date. A lock file (`<file>.lock`, stale after one hour) prevents concurrent runs.
- Idempotent: an edition that is installed and intact is not downloaded again (`--force` overrides), so the job can run **daily**: it downloads once, when the new edition appears, and is a local no-op otherwise.
- Exit codes: 0 installed or already up to date, 1 failure, 2 usage error. Alert on a non-zero exit, and on a `buildEpoch` older than 45 days in the startup or reload log.

**Checking it in production.** After a start or a reload the log carries `geoip database loaded` / `reloaded` with `databaseType`, `buildEpoch` and `nodeCount`. A scan made from a mobile network should then have `country`, `lat` and `lon` set on its `scan_events` row; scans from the VPS itself or a LAN have none (private addresses).

---

## 4. Secrets

### 4.1 Generating them

`openssl rand` has no base64url output, so convert the base64 output (strip padding and newlines, map `+/` to `-_`). Any equivalent CSPRNG works as well.

```sh
# COOKIE_SECRET and IP_HASH_PEPPER: 48 random bytes, base64url (64 characters). Generate each separately.
openssl rand -base64 48 | tr -d '\n=' | tr '+/' '-_'

# KEY_ENCRYPTION_KEY: exactly 32 random bytes, base64url without padding (43 characters).
openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_'

# POSTGRES_PASSWORD: URL-safe (it is embedded in DATABASE_URL).
openssl rand -hex 24

# BOOTSTRAP_ADMIN_PASSWORD: 12–1024 characters; a long random passphrase.
openssl rand -base64 24

# Node equivalents
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 4.2 Storing them

- Keep the env file outside the checkout, owned by root with mode `0600`, and point compose at it: `export ORBES_ENV_FILE=/etc/orbes/genome.env`, and `docker compose --env-file /etc/orbes/genome.env …` for the variables compose interpolates itself (`POSTGRES_*`, `APP_*`, `ORBES_IMAGE_TAG`). With an orchestrator, inject the values from its secret store instead.
- Store `KEY_ENCRYPTION_KEY` in the secret manager **and** in an offline escrow (sealed envelope, HSM-backed vault, split between two custodians). It must never be stored with the key volume or its backups (§7.3).
- Use different values per environment (staging must never share production secrets).
- Never commit a filled-in env file. `.gitignore` and `.dockerignore` exclude `.env` and `.env.*`.

### 4.3 What rotating each secret does

| Secret | Effect of changing it | Procedure |
|---|---|---|
| `COOKIE_SECRET` | Device cookies are re-issued, so devices look new to the anomaly rules for a while (session cookies are not signed and survive). Pending ownership transfer codes stop working (their lookup key is derived from it): owners start a new transfer. When `KEY_ENCRYPTION_KEY` is unset, enrolled admin TOTP secrets can no longer be opened either. | Change and restart. Schedule a quiet period. |
| `IP_HASH_PEPPER` | New IP, device and session pseudonyms cannot be linked to older scans. Anomaly scoring (device, IP and geo diversity) starts again from scratch. | Change and restart. Rotate only when it may have leaked or on a planned schedule. |
| `KEY_ENCRYPTION_KEY` | Existing key files can no longer be decrypted, and enrolled admin TOTP secrets can no longer be opened. | Follow §7.7. Never just swap it. |
| `POSTGRES_PASSWORD` | The app cannot connect until `DATABASE_URL` matches. | `ALTER ROLE … PASSWORD …`, update the env file, restart. With compose, the `POSTGRES_PASSWORD` variable only applies when the data volume is first created. |
| `BOOTSTRAP_ADMIN_PASSWORD` | None after the first admin exists. | Remove it from the environment after the first start. |

---

## 5. First deployment

The steps below use the single-host compose stack (`genome/docker-compose.yml`: the app plus `postgres:17`, two named volumes `pgdata` and `keys`, the app published on `127.0.0.1:8080`, read-only root filesystem, all capabilities dropped, `no-new-privileges`). §5.6 covers the same steps without compose.

### 5.1 Prepare the configuration

```sh
cd genome
sudo install -d -m 0700 /etc/orbes
sudo cp .env.example /etc/orbes/genome.env && sudo chmod 0600 /etc/orbes/genome.env
export ORBES_ENV_FILE=/etc/orbes/genome.env
```

Compose reads the variables it interpolates itself (`POSTGRES_*`, `APP_*`, `ORBES_IMAGE_TAG`, `MIGRATE_ON_START`) from `genome/.env` by default. With the env file in `/etc/orbes`, every `docker compose` command in this document needs `--env-file /etc/orbes/genome.env` (shown in full in this section, implied later). The alternative is to keep the file as `genome/.env`, with mode `0600`.

Edit `/etc/orbes/genome.env` and set at least:

```sh
ORBES_ENV=production
PUBLIC_ORIGIN=https://verify.theorbes.com        # Option A (or https://theorbes.com for Option B)
TRUST_PROXY=uniquelocal                          # see §3.3
POSTGRES_PASSWORD=<openssl rand -hex 24>
COOKIE_SECRET=<48 random bytes, base64url>
IP_HASH_PEPPER=<48 other random bytes, base64url>
KEY_ENCRYPTION_KEY=<32 random bytes, base64url>
BOOTSTRAP_ADMIN_EMAIL=<first admin's email>
BOOTSTRAP_ADMIN_PASSWORD=<long random passphrase>
# DATABASE_URL stays empty: compose builds it from POSTGRES_*.
```

### 5.2 Build the image

```sh
docker compose --env-file /etc/orbes/genome.env build
# or, equivalently:
docker build -t orbes-genome:latest .
```

The build is multi-stage:

1. `npm ci --omit=dev --ignore-scripts` from `package-lock.json`. The toolchain, test libraries and Playwright stay out of the image, and no third-party install script runs.
2. esbuild builds the web apps into `dist/web`.
3. A slim runtime stage holds `src/core`, `src/server`, `scripts/db.ts` and `scripts/keys.ts`, owned by root and read-only for the `node` user (uid 1000).

The image contains no secret and no key.

**Behind a TLS-inspecting proxy.** If `npm ci` fails with certificate errors, pass the proxy's CA as a BuildKit secret. It is added to Node's default trust store for that one step and never stored in a layer:

```sh
docker build --secret id=extra_ca,src=/path/to/proxy-ca.pem \
  --build-arg HTTPS_PROXY="$HTTPS_PROXY" -t orbes-genome:latest .
docker compose --env-file /etc/orbes/genome.env up -d     # uses the image just built (no --build)
```

Compose does not forward build secrets. Build with `docker build` using the tag compose expects (`orbes-genome:${ORBES_IMAGE_TAG:-latest}`), then start compose without `--build`.

### 5.3 Start the stack

```sh
docker compose --env-file /etc/orbes/genome.env up -d
docker compose logs -f app
```

On the first start the logs show, in order:

```
{"level":"info",…,"applied":["0001_initial"],"msg":"database migrations applied"}       ← MIGRATE_ON_START=true (compose default)
{"level":"info",…,"adminId":"…","msg":"bootstrap admin created"}
{"level":"error",…,"msg":"signing key self-test failed or no ACTIVE key: issuance is unavailable until a key is rotated in"}
{"level":30,…,"msg":"Server listening at http://0.0.0.0:8080"}
{"level":30,…,"version":"0.1.0","config":{…redacted summary…},"msg":"ORBES GENOME server started"}
```

The `error` line is expected on a fresh database. Production never creates a signing key implicitly. Verification works without one; issuance waits for §5.4.

### 5.4 Create the first signing key

```sh
docker compose exec app npm run keys:generate
#   Created signing key #1 (orbes-k001-20261001-e562), ACTIVE.
docker compose exec app npm run keys:list
#   ID  STATUS   KID                        PROVIDER ACTIVATED         …  FINGERPRINT
#   1   ACTIVE   orbes-k001-20261001-e562   local    2026-10-01 10:55  …  56:2F:17:FE:A4:15:0F:CE
```

(`npm run keys:generate` is the same as `node --import tsx scripts/keys.ts generate`.)

- The command is idempotent: a second run reports "already ACTIVE; nothing to do". It exits non-zero if the ACTIVE key cannot sign with the configured provider (wrong `KEY_DIR` or `KEY_ENCRYPTION_KEY`).
- It refuses to run on a schema with pending migrations ("run `npm run db:migrate` first"). With compose the schema was migrated in §5.3.
- The running server picks the key up without a restart. Issuance re-reads the ACTIVE key, and `/api/v1/keys` shows it within 30 s (key cache TTL).
- Record the key id, kid and **fingerprint** in the key register, outside the system. The fingerprint is how anyone can later confirm, by eye or over the phone, that `/.well-known/orbes-keys.json` serves the right key.

### 5.5 First admin and TOTP

See §8.1. In short: enrol the bootstrap admin's TOTP from the shell (`scripts/admin.ts totp-setup` / `totp-enable`, recommended) or in the console when it asks, sign in at `https://<origin>/admin`, then remove `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` from the env file and run `docker compose up -d` (the container is recreated with the new environment).

Finish with the smoke tests (§13) and the checklist (§14).

### 5.6 Without compose

The container needs the same hardening as the compose file:

```sh
docker volume create orbes-keys
docker run -d --name orbes-genome --restart unless-stopped --init \
  --env-file /etc/orbes/genome.env \
  -e DATABASE_URL='postgres://orbes_app:…@db.internal:5432/orbes?sslmode=verify-full' \
  -e KEY_PROVIDER=local -e KEY_DIR=/var/lib/orbes/keys \
  -v orbes-keys:/var/lib/orbes/keys \
  --read-only --tmpfs /tmp:size=64m --tmpfs /home/node:size=16m,uid=1000,gid=1000 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -p 127.0.0.1:8080:8080 --stop-timeout 30 \
  orbes-genome:latest
docker exec orbes-genome npm run db:migrate          # if MIGRATE_ON_START is not set
docker exec orbes-genome npm run keys:generate
```

On Kubernetes or a similar orchestrator:

- run as uid/gid 1000 with `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false` and all capabilities dropped;
- mount `emptyDir` at `/tmp` and `/home/node`, and a persistent volume at `/var/lib/orbes/keys` (local provider, see §11 for replicas);
- inject secrets from the platform's secret store;
- run migrations as a Job (`npm run db:migrate`) before rolling out;
- use `/api/v1/health` as the readiness probe (§9.1).

A bind-mounted key directory must belong to uid 1000 with mode `0700`:

```sh
sudo install -d -m 0700 -o 1000 -g 1000 /srv/orbes/keys
```

---

## 6. Database and migrations

### 6.1 How migrations run

- Migrations are compiled into the server (`src/server/db/migrate.ts`, today `0001_initial`). Kysely records them in `kysely_migration` and takes an advisory lock, so instances starting together apply each one exactly once.
- **Development and test** always migrate at start.
- **Production** migrates at start only with `--migrate` (`npm start -- --migrate`) or `MIGRATE_ON_START=1|true|yes`. Compose defaults to `MIGRATE_ON_START=true`. Without either, a production server refuses to start while migrations are pending.
- The stand-alone CLI works in every environment:

```sh
npm run db:status      # applied / PENDING per migration (tsx scripts/db.ts status [--json])
npm run db:migrate     # apply pending migrations; "Schema is up to date." when nothing is pending
```

In the container: `docker compose exec app npm run db:status`, or `docker compose run --rm app npm run db:migrate` when the app is not running.

### 6.2 Recommended production procedure

Starting with `MIGRATE_ON_START=true` is convenient for a single host. For anything larger, follow [DATABASE §9.3 and §11.6](DATABASE.md#9-migrations):

1. **Two database roles.** A migration role that owns the schema, and an application role with only `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the tables, `USAGE` on the sequences and `SELECT` on `kysely_migration`. The guard triggers (append-only audit log, immutable categories) stop the application role, but not a table owner or a superuser.
2. **Migrate once per release** from a deployment step using the migration role:
   `DATABASE_URL=<owner URL> npm run db:migrate` (or `docker compose run --rm -e DATABASE_URL=<owner URL> app npm run db:migrate`).
3. **Start the application instances** with the application role and **without** `--migrate` / `MIGRATE_ON_START`. Each instance checks that nothing is pending and refuses to start otherwise.
4. **Take a backup or PITR marker** before every migration (§10).

`migrateDown` (used by `db reset-demo`) is development tooling. It drops everything and is never run in production. `db seed` and `db reset-demo` refuse `ORBES_ENV=production` outright.

### 6.3 Connection settings

- Each server process opens a `pg` pool of up to **10** connections, and each CLI run opens its own short-lived pool. Size `max_connections` for `instances × 10 + CLI runs + backups + headroom`.
- A connection pooler (PgBouncer) in **transaction** mode is incompatible with the session-level advisory lock that migrations take. Run migrations against PostgreSQL directly.
- For a remote or managed database, require TLS in the URL (`?sslmode=verify-full`, plus `&sslrootcert=/path/ca.pem` for a private CA, mounted read-only into the container).
- In the compose stack, PostgreSQL is reachable only on the internal `backend` network and is never published.

---

## 7. Signing keys

Background: [CRYPTOGRAPHY §5](CRYPTOGRAPHY.md#5-key-management). Every code carries the 1-byte id of the key that signed it. The `cryptographic_keys` table holds the **public** keys and their status:

- `ACTIVE`: exactly one, signs new codes;
- `RETIRED`: verify only;
- `REVOKED`: trusted only for codes recorded before `compromised_at`.

Private keys live only in the key provider.

### 7.1 Commands

Every change is audited. The actor is `system:cli:keys:<os user>` for the CLI, or the admin for the console and API.

| Task | CLI (inside the container: `docker compose exec app …`) | Console / API (ADMIN) |
|---|---|---|
| First key | `npm run keys:generate` | `POST /api/admin/keys/rotate` (KEYS page) |
| List keys | `npm run keys:list` (`-- --json` for JSON) | `GET /api/admin/keys` |
| Rotate | `npm run keys:rotate` (`-- --kid <label>`, label `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`) | `POST /api/admin/keys/rotate` |
| Retire the ACTIVE key (issuance stops) | `node --import tsx scripts/keys.ts retire <keyId> --yes` | `POST /api/admin/keys/:keyId/retire` |
| Revoke | `node --import tsx scripts/keys.ts revoke <keyId> --reason "<text>" [--compromised-at <ISO 8601 with Z or offset>] --yes` | `POST /api/admin/keys/:keyId/revoke` `{ reason, compromisedAt? }` |

`generate` and `rotate` refuse `KEY_PROVIDER=memory`. Exit codes: `0` success, `1` failure, `2` usage error (including a missing `--yes`), `78` configuration error.

### 7.2 Local key provider: what is on disk

- One file per key, `KEY_DIR/<kid>.key.json`, mode `0600`, in a `0700` directory owned by the process user (uid 1000 in the image). It holds the 32-byte Ed25519 seed under AES-256-GCM with `KEY_ENCRYPTION_KEY`, a random 96-bit IV, and the kid as additional authenticated data.
- Files are written atomically and never overwritten. Group- or world-readable key files are refused.
- A modified file, a file renamed to another kid, or the wrong `KEY_ENCRYPTION_KEY` fails the GCM tag. The key is then refused instead of signing with garbage.
- The image creates `/var/lib/orbes/keys` owned by `node:node`, mode `0700`, and a fresh named volume inherits that ownership. A bind mount must be prepared by hand (§5.6).
- The local provider suits a single host with an encrypted disk. For several hosts, or stronger custody, see §7.6.

### 7.3 Backing up keys

Two independent pieces are needed to sign. Back them up **separately**.

| Piece | Where | Backup |
|---|---|---|
| Encrypted key files | `keys` volume / `KEY_DIR` | Copy after every rotation (below). Useless without `KEY_ENCRYPTION_KEY`. |
| `KEY_ENCRYPTION_KEY` | Secret manager + offline escrow | Never in the same backup set, bucket or ticket as the key files or the database dumps. |

```sh
# Backup the compose `keys` volume (preserves modes)
docker run --rm -v orbes-genome_keys:/keys:ro -v "$PWD":/backup busybox \
  tar -C /keys -czpf /backup/orbes-keys-$(date +%F).tgz .

# Restore into an empty volume
docker run --rm -v orbes-genome_keys:/keys -v "$PWD":/backup busybox sh -c \
  'tar -C /keys -xzpf /backup/orbes-keys-YYYY-MM-DD.tgz && chown -R 1000:1000 /keys && chmod 700 /keys && chmod 600 /keys/*.key.json'
```

What losing each piece means:

- **Losing the key files or `KEY_ENCRYPTION_KEY`** never breaks verification: the public keys are in the database. It stops issuance under that key. Rotate to a new key (`npm run keys:rotate`) and carry on.
- **Leaking both** is a key compromise (§7.5).

### 7.4 Rotation runbook

Cadence: yearly, after any change of key custodians, and immediately on suspicion of compromise.

1. **Before.** Check the backups (database and `keys` volume) and that `npm run keys:list` shows exactly one ACTIVE key.
2. **Rotate.**
   ```sh
   docker compose exec app npm run keys:rotate -- --kid orbes-2027
   #   Created signing key #2 (orbes-2027), ACTIVE.
   #   Key #1 (orbes-k001-…) is now RETIRED: codes it signed keep verifying.
   ```
   The new key is generated by the provider, must prove possession (a signed probe that verifies) and must be a strict Ed25519 key before it is registered. The previous ACTIVE key becomes RETIRED in the same transaction.
3. **Propagation.**
   - Other instances see the change within **30 s** (public-key cache TTL; 5 s for an unknown key id).
   - Issuance cannot sign with a stale key: each issuance re-checks the key row inside its transaction and retries with the new signer.
   - CDNs may keep `/api/v1/keys` and `/.well-known/orbes-keys.json` for up to **5 min** (`max-age=300`). Purge both paths if third parties need the new key at once.
4. **Record** the new key id, kid and fingerprint in the key register. Back up the `keys` volume (§7.3).
5. **Verify.**
   - `curl -fsS https://<origin>/.well-known/orbes-keys.json` lists the new ACTIVE key and the RETIRED one.
   - Issue one product (console GENERATOR) and scan it.
   - Scan an older product: still AUTHENTIC.

Key ids are one byte, so there are 255 of them for the life of the system, and ids are never reused. A yearly rotation is far from that limit; avoid rotating as a routine test in production (use staging).

RETIRED keys are kept forever: historical products stay verifiable. A RETIRED key never signs again, and there is no un-retire. Its private key file is no longer needed for operation; keep or destroy it according to the key-custody policy.

### 7.5 Key compromise runbook

Use this when a private key, or the key files together with `KEY_ENCRYPTION_KEY`, may be in someone else's hands.

1. **Fix the compromise time `T`.** Take the earliest moment the key could have been exposed, and err early. Codes **recorded before `T` stay trusted**. Codes recorded at or after `T` verify as `INVALID_SIGNATURE` (reason `KEY_REVOKED`), and that includes codes ORBES itself issued in that window.
2. **Revoke, then rotate** ([CRYPTOGRAPHY §5.3](CRYPTOGRAPHY.md#53-compromise-response)). Issuance pauses between the two commands.
   ```sh
   docker compose exec app node --import tsx scripts/keys.ts revoke 1 \
     --reason "INC-2026-014: key file and KEK exposed" --compromised-at 2026-09-28T00:00:00Z --yes
   docker compose exec app npm run keys:rotate
   ```
   The time must carry `Z` or an offset. A future time is refused. If the investigation later shows an earlier exposure, run `revoke` again with the earlier `--compromised-at`: the cutoff can only move earlier (audited as `key.revoke.amend`).
3. **Make it effective everywhere.**
   - Other instances apply the revocation within 30 s. Restart them (`docker compose restart app`) to make it immediate.
   - Purge the CDN cache for `/api/v1/keys` and `/.well-known/orbes-keys.json`.
4. **Re-issue the legitimate codes caught after `T`.** List them:
   ```sql
   SELECT p.product_id, c.issue, c.created_at
   FROM codes c JOIN products p ON p.id = c.product_id
   WHERE c.key_id = 1 AND c.status = 'ACTIVE' AND c.created_at >= '2026-09-28T00:00:00Z'
   ORDER BY c.created_at;
   ```
   Re-issue each one under the new key: product page → codes → REISSUE, or `POST /api/admin/products/:productId/codes/reissue { reason }`. Then replace the physical code. Optionally re-issue high-value products signed before `T` as well.
5. **Investigate CRITICAL anomalies.** These are the fingerprints of minted forgeries:
   - `VALID_SIGNATURE_UNREGISTERED`: a valid signature on an identity or code issue that ORBES never recorded;
   - `CODE_MISMATCH`: a valid signature on a different payload for a registered product.

   Both record the signing key id.
   ```sql
   SELECT type, details->>'keyId' AS key_id, count(*) AS findings, sum(occurrences) AS scans,
          min(first_seen_at) AS first_seen, max(last_seen_at) AS last_seen
   FROM anomalies
   WHERE severity = 'CRITICAL' AND status IN ('OPEN', 'ACKNOWLEDGED')
   GROUP BY 1, 2 ORDER BY last_seen DESC;
   ```
   In the console, ANOMALIES with severity CRITICAL, or `GET /api/admin/anomalies?severity=CRITICAL&status=OPEN`. VERIFICATION EVENTS with state `UNKNOWN` (`GET /api/admin/scans?state=UNKNOWN`) show where and when the forgeries were scanned. The earliest finding is evidence for `T`.
6. **Find the root cause.** With the local provider, signing needs both the key file and `KEY_ENCRYPTION_KEY`. Check access to the `keys` volume, its backups, the secret manager and the host.
   - Rotate `KEY_ENCRYPTION_KEY` (§7.7) if it may have leaked.
   - Rotate `COOKIE_SECRET` and the database credentials if the host was compromised.
   - Review the audit log (`GET /api/admin/audit`, actions `key.*`, `admin.login*`, `admin.totp.*`) and check its integrity with `GET /api/admin/audit/verify` against the last exported anchor (§10).
7. **Close.** Resolve or dismiss each anomaly with a note (console or `PATCH /api/admin/anomalies/:id`). Record the incident, `T`, the affected products and the re-issues. Rehearse this runbook (a revocation drill on staging) at least yearly.

The system never revokes anything automatically. Anomalies are reviewed by people ([SECURITY-MODEL §3.8](SECURITY-MODEL.md)).

### 7.6 Migrating to a KMS or HSM

Key custody sits behind one interface (`src/server/keys/key-provider.ts`):

```ts
interface KeyProvider {
  readonly name: string;
  generate(kid: string): Promise<{ publicKey: Uint8Array; providerRef: string }>;
  sign(providerRef: string, message: Uint8Array): Promise<Uint8Array>;   // Ed25519, 64 bytes
}
```

The rest of the system only sees public keys and the opaque `providerRef`, which is stored in `cryptographic_keys.provider_ref` and is never a secret. A KMS/HSM provider is a code change.

1. **Implement the provider** (for example `src/server/keys/kms-provider.ts`).
   - `generate` creates a **non-exportable Ed25519** key in the KMS/HSM and returns its raw 32-byte public key and the KMS key reference.
   - `sign` calls the KMS with the **raw message** (PureEdDSA, not Ed25519ph or a pre-hash) and returns the 64-byte signature.
   - Check the vendor's EdDSA support and its authentication model at integration time.
2. **Wire it in.**
   - Add the provider name to the `KEY_PROVIDER` enum and its settings to `loadConfig()` (`src/server/config.ts`).
   - Add the provider to `createKeyProvider()` (`src/server/keys/index.ts`).
   - Document the new variables in `.env.example`.
   - Add the provider tests next to `test/keys/local-provider.test.ts`.
3. **No custom safety code is needed.** `KeyService` refuses weak or non-canonical public keys, requires a proof-of-possession signature before registering a key, and verifies every signature after signing. A faulty KMS cannot put an invalid code into circulation.
4. **Cut over** with an ordinary rotation: deploy with `KEY_PROVIDER=<kms>`, then run `npm run keys:rotate`.
   - The new ACTIVE key lives in the KMS, and the local keys become RETIRED. They keep verifying, because their public keys are in the database.
   - The server refuses to sign with an ACTIVE key that belongs to another provider (`SIGNING_UNAVAILABLE`), so run the rotation right after the deploy.
5. **Afterwards**, archive or destroy the local key files and retire `KEY_ENCRYPTION_KEY` according to policy. Keep in mind that `KEY_ENCRYPTION_KEY` also seals admin TOTP secrets (§7.7).

### 7.7 Rotating `KEY_ENCRYPTION_KEY`

There is no re-encryption tool. Changing the key-encryption key has two effects:

1. **Existing key files become undecryptable.** The ACTIVE key fails the start-up self-test and issuance stops. Verification is unaffected.
2. **Admin TOTP secrets become undecryptable.** The TOTP sealing key is derived from `KEY_ENCRYPTION_KEY` with HKDF, and admins with TOTP get `TOTP_UNAVAILABLE` (503) at sign-in. The code fails closed and never falls back to password-only.

Procedure:

1. Announce a short maintenance window for admins.
2. Set the new `KEY_ENCRYPTION_KEY` and restart the app.
3. Run `npm run keys:rotate`. A new key is created and sealed under the new key-encryption key, and the old ACTIVE key becomes RETIRED (verify-only).
4. **Break-glass**, for each admin with TOTP, as the database owner: clear the TOTP secret so the admin re-enrols at the next sign-in. Record it in the change ticket: this bypasses the application audit log.
   ```sql
   UPDATE admin_users SET totp_secret_enc = NULL, updated_at = now() WHERE email_normalized = lower('admin@theorbes.com');
   ```
5. Each admin signs in and enrols again (§8.1).
6. Back up the `keys` volume, escrow the new key-encryption key, and destroy the old one once no backup needs it.

---

## 8. Admin accounts

### 8.1 First admin and TOTP enrolment

1. Before the first start, set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (12–1024 characters). On start, if `admin_users` is empty, one **ADMIN** is created. The log says `bootstrap admin created`. The step is idempotent and race-safe across instances, and the variables are ignored once any admin exists.
2. Open `https://<origin>/admin` and sign in. In production the response says `"mfaRequired": true, "mfaPassed": false`, and every admin route except sign-in and enrolment answers `403 MFA_REQUIRED` until TOTP is enrolled.
3. Enrol TOTP. **Recommended: from the shell, before the password is ever used in the console** (enrolment in the console is trust on first use: whoever signs in first with the password enrols their device):
   ```sh
   docker compose exec app node --import tsx scripts/admin.ts totp-setup --email admin@theorbes.com
   #   prints the secret and the otpauth:// URI once; hand them to the admin in person
   docker compose exec app node --import tsx scripts/admin.ts totp-enable --email admin@theorbes.com --secret <SECRET> --code <current code>
   ```
   Or when the console asks:
   - the console calls `POST /api/admin/auth/totp/setup` and shows the `otpauth://` URI / QR code;
   - scan it with an authenticator app (RFC 6238: SHA-1, 6 digits, 30 s) and enter the current code;
   - `POST /api/admin/auth/totp/enable` verifies it, stores the secret sealed with AES-256-GCM and replaces the session by a new MFA-passed one (new cookie and CSRF token).

   Every later sign-in asks for a code. Each code is accepted once, ±1 time step.
4. Remove `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` from the environment and recreate the container (`docker compose up -d`).

Lockout: 10 failed sign-ins lock the admin for 15 minutes. Admin sessions last `SESSION_TTL_ADMIN_HOURS` (8 h by default).

### 8.2 Further admins, lost authenticators: `scripts/admin.ts`

Console users are managed from the shell (every change is audited as `system:cli:admin:<os user>`):

```sh
# a new OPERATOR (or ADMIN, AUDITOR); the password comes from the environment, never argv
docker compose exec -e ADMIN_PASSWORD='…' app node --import tsx scripts/admin.ts create --email ops@theorbes.com --role OPERATOR
docker compose exec app node --import tsx scripts/admin.ts list                      # role, 2FA on/off, locked/disabled
docker compose exec app node --import tsx scripts/admin.ts totp-setup --email ops@theorbes.com
docker compose exec app node --import tsx scripts/admin.ts totp-enable --email ops@theorbes.com --secret <SECRET> --code <code>
docker compose exec app node --import tsx scripts/admin.ts reset-totp --email ops@theorbes.com --yes   # lost device
```

- **A lost authenticator:** after an identity check, an ADMIN resets it from the console (SECURITY page, *Reset two-factor*, typed confirmation; `POST /api/admin/admins/:id/totp/reset`) or with `reset-totp` above. The reset removes the enrolment and ends every session of that admin; they sign in with the password and enrol again. If no ADMIN with a working second factor is left, use the shell command.
- **Lockout as denial of service:** anyone who knows an admin's email can keep that admin locked out with wrong passwords (10 per 15 minutes suffice). Keep admin emails private and, ideally, put `/admin` and `/api/admin` behind an IP allow-list or VPN at the edge (SECURITY-MODEL §3.3).
- **Still missing:** changing passwords, changing roles and disabling admins have no command or route yet (they exist in `AuthService` or need a statement in SQL).

---

## 9. Health checks, logging and monitoring

### 9.1 Health

`GET /api/v1/health` checks liveness plus a database round trip (`SELECT 1`, 2 s timeout).

| Situation | Status | Body |
|---|---|---|
| Healthy | `200` | `{"ok":true,"version":"0.1.0"}` |
| Database unreachable | `503` | `{"ok":false,"version":"0.1.0"}`. The reason goes to the log (`health check: database unavailable`), never to the response. |
| Server shutting down | `503` | `{"error":{"code":"SERVICE_UNAVAILABLE","message":…}}` with `Connection: close`, for requests still arriving on open connections. |

- The image's `HEALTHCHECK` calls the endpoint with Node's built-in `fetch` (interval 30 s, timeout 5 s, start period 40 s, 3 retries). `docker compose ps` shows `healthy`.
- On an orchestrator, use the endpoint as the **readiness** probe. For **liveness**, prefer a TCP check or a generous failure threshold. Otherwise a database outage restarts every instance in a loop.
- Health is rate-limited with the `api` group (`RATE_LIMIT_API_PER_MINUTE` per client IP, 120 by default). Probes every few seconds are far below that.

**Shutdown.** On `SIGTERM`/`SIGINT` the server stops accepting connections, lets in-flight requests finish (up to 25 s), stops housekeeping, closes the database and exits 0. Compose gives it 30 s (`stop_grace_period`), and `docker run --stop-timeout 30` does the same. Fatal errors (unhandled rejection, uncaught exception, failed start) go through the same shutdown with exit code 1, so the orchestrator restarts a clean process.

### 9.2 Logging

- **Format.** JSON lines (pino) on **stdout**. Lines written before the HTTP logger exists (migrations, bootstrap, key self-test) are JSON on **stderr**. Configuration errors are plain text on stderr, followed by exit code 78.
- **Level.** `LOG_LEVEL` (default `info` in production). Accepted but risky settings (`ADMIN_REQUIRE_MFA=false` in production) are logged as `risky configuration` warnings at every start.
- **Contents.** Each request logs the method, the path **without the query string**, a server-generated request id (`reqId`; client-supplied ids are ignored), the status code and the response time. **Never logged:** client IPs, cookies, the CSRF header, `Set-Cookie`, request bodies or secrets. The startup line carries a redacted configuration summary (database password masked, secrets shown as `[set]`, no anomaly thresholds).
- **Shipping.** Collect stdout and stderr with the platform's log driver. With plain Docker, cap local logs in a compose override:
  ```yaml
  # docker-compose.override.yml
  services:
    app:
      logging: { driver: json-file, options: { max-size: "10m", max-file: "5" } }
  ```

### 9.3 What to alert on

| Signal | Source | Severity |
|---|---|---|
| Health `503`, or container unhealthy or restarting | Probe / orchestrator | Page |
| `signing key self-test failed or no ACTIVE key` | Log (error, at start) | Page: issuance is down |
| `signature failed verify-after-sign; refused`, `signing failed`, `key generation failed` | Log (error) | Page: custody problem |
| `startup failed`, `uncaught exception`, `unhandled rejection`, `graceful shutdown timed out` | Log (error) | Page |
| New CRITICAL anomaly (`VALID_SIGNATURE_UNREGISTERED`, `CODE_MISMATCH`) | SQL query of §7.5 step 5, polled every few minutes, or `GET /api/admin/anomalies?severity=CRITICAL&status=OPEN` | Page: possible key compromise |
| `verification flagged` (SUSPICIOUS ACTIVITY) | Log (warn) | Ticket / dashboard |
| `housekeeping job failed`, `health check: database unavailable` | Log (error) | Ticket |
| Audit chain broken | `GET /api/admin/audit/verify` (daily job) returns `ok: false` | Page |
| Spikes of `429` | Request logs | Dashboard (abuse or a misconfigured `TRUST_PROXY`) |

---

## 10. Backups and point-in-time recovery

Full guidance: [DATABASE §11](DATABASE.md#11-backup-restore-and-point-in-time-recovery). In short:

| What | How | Notes |
|---|---|---|
| Database | Continuous WAL archiving plus base backups (managed PostgreSQL PITR, pgBackRest, WAL-G), and nightly logical dumps | Holds the registry, codes, public keys, accounts, sealed TOTP secrets, pseudonymous scans and the audit log. Encrypt backups and restrict access: they contain personal data. |
| Key files | `keys` volume archive after every rotation (§7.3) | Encrypted under `KEY_ENCRYPTION_KEY`. |
| `KEY_ENCRYPTION_KEY`, `COOKIE_SECRET`, `IP_HASH_PEPPER` | Secret manager plus offline escrow | Never in the same backup set as the database or the key files. A database backup plus `KEY_ENCRYPTION_KEY` opens the stored TOTP secrets. |
| Audit chain anchor | Export `head.id` / `head.hash` from `GET /api/admin/audit/verify` to write-once storage, daily | Compare after any restore. |

Logical dump and restore with the compose stack:

```sh
# Dump (custom format), from the db container
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > orbes-$(date +%F).dump

# Restore into an EMPTY database (audit_logs rejects TRUNCATE/DELETE/UPDATE, so restoring over data fails by design)
docker compose stop app
docker compose rm -sf db && docker volume rm orbes-genome_pgdata
docker compose up -d db
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < orbes-YYYY-MM-DD.dump
docker compose up -d app
```

After any restore:

1. Run `npm run db:status`: no migration may be PENDING, unless the restore predates an upgrade.
2. Run `GET /api/admin/audit/verify` and compare its head with the last exported anchor. A point-in-time restore legitimately drops the newest entries; the anchor tells how many.
3. Scan a known product end to end (§13).
4. Check the keys. Any key created after the backup is missing from `cryptographic_keys`, but its file may still be in `KEY_DIR`. Rotate if `keys:list` shows no usable ACTIVE key.

Test restores on a schedule, on a separate host.

---

## 11. Scaling

The service is stateless apart from a few per-process pieces. Sessions, scan tokens, anomalies and keys all live in PostgreSQL, so no sticky sessions are needed.

| Topic | Behaviour | Consequence |
|---|---|---|
| Rate limits | In-process LRU stores (`@fastify/rate-limit`), per group | With N instances behind round-robin, a client gets up to N × the configured budget. Divide the limits by N, or enforce a global limit at the edge (CDN or nginx `limit_req`). |
| Public-key cache | 30 s TTL (5 s for unknown key ids), per process | Rotations and revocations made on another instance or by the CLI take up to 30 s to apply everywhere. Restart for immediate effect (§7.5). Issuance is never affected: it re-checks the key row in its own transaction. |
| Housekeeping | Every 10 min per process (expired sessions, scan tokens, stale transfers) | Idempotent, so running it on every instance is harmless. |
| Migrations | Advisory lock | Safe if several instances start with `--migrate`, but prefer one migration step per release (§6.2). |
| Database connections | 10 per process | Size `max_connections`. Prefer PostgreSQL directly over transaction-mode poolers (§6.3). |
| CPU | Node is single-threaded. Verification is cheap (Ed25519 verification plus a few indexed queries; p95 target < 300 ms excluding network, see [docs/reports/performance.md](reports/performance.md)). Rendering PNG/PDF artifacts in the admin console is the heaviest work. | Scale out with one process per vCPU. |
| Local key provider | Key files on one volume | Several containers on **one host** can share the `keys` volume. Across **several hosts**, only instances that see the same key files can issue. Use a KMS/HSM provider (§7.6), or route admin traffic (issuance and rotation) to a single designated instance. Verification never needs private keys, so it scales freely. |
| PGlite | In-process PostgreSQL (WebAssembly) | Development, tests and demos only. **Never in production**: `loadConfig()` refuses it. |

---

## 12. Upgrade and rollback

### 12.1 Upgrade

1. **Read the change.** Look for new entries in `MIGRATIONS` (`src/server/db/migrate.ts`), new or renamed environment variables (`.env.example`; an unknown `ANOMALY_*` or `RATE_LIMIT_*` name now fails the start), and dependency changes.
2. **Back up.** Take a database dump or note the PITR timestamp, and archive the `keys` volume (§10).
3. **Build and tag** the new image, keeping the previous tag for rollback:
   ```sh
   export ORBES_IMAGE_TAG=2026-10-15
   docker compose --env-file /etc/orbes/genome.env build app
   ```
4. **Migrate**, if the release has new migrations, with the new image:
   ```sh
   docker compose --env-file /etc/orbes/genome.env run --rm app npm run db:migrate
   ```
   (Or rely on `MIGRATE_ON_START=true` on a single host.)
5. **Deploy:** `docker compose --env-file /etc/orbes/genome.env up -d app`. Wait for `healthy`.
6. **Smoke test** (§13) and watch the error logs for 15 minutes.

### 12.2 Rollback

- **No schema change in the release.** Redeploy the previous tag: `ORBES_IMAGE_TAG=<previous> docker compose up -d app`.
- **The release migrated the schema.**
  - An older image refuses to apply migrations to a database that holds migrations it does not know (Kysely "corrupted migrations"). Roll back with `MIGRATE_ON_START=false`.
  - That only works if the new migration is backward compatible with the old code (additive changes).
  - Otherwise, restore the pre-upgrade backup or PITR timestamp (§10). Everything written since the upgrade is lost: prefer a forward fix when you can.
- **Never** run `migrateDown` or `db reset-demo` against production. They drop the schema, and both refuse production anyway.

### 12.3 Dependencies and base image

- Rebuild the image regularly (`docker build --pull`) to pick up `node:22-slim` security updates, even when the code has not changed.
- CI runs `npm audit --omit=dev --audit-level=high` as a report on every change (`.github/workflows/genome-ci.yml`). Act on high and critical findings in runtime dependencies.

---

## 13. Smoke tests

Run after every deployment, upgrade and restore. Example outputs are from a production-configured server against PostgreSQL.

```sh
ORIGIN=https://verify.theorbes.com        # or https://theorbes.com (Option B)

# 1. Health: 200 and ok:true (database reachable)
curl -fsS "$ORIGIN/api/v1/health"
#   {"ok":true,"version":"0.1.0"}

# 2. Public keys: the ACTIVE key (and RETIRED/REVOKED ones) with the fingerprint recorded in §5.4
curl -fsS "$ORIGIN/api/v1/keys"
#   {"keys":[{"keyId":1,"kid":"orbes-k001-20261001-e562","alg":"Ed25519","publicKey":"ZTvRQVVP…","status":"ACTIVE",
#             "activatedAt":"2026-10-01T10:55:37.987Z","retiredAt":null,"revokedAt":null}]}
curl -fsS "$ORIGIN/.well-known/orbes-keys.json"           # same document, CORS *, max-age=300

# 3. Scanner page: 200, CSP, camera permission, HSTS
curl -fsS -D - -o /dev/null "$ORIGIN/verify" | grep -iE '^(HTTP|content-security-policy|permissions-policy|strict-transport-security|cache-control)'
#   HTTP/2 200                                    (HTTP/1.1 200 OK when talking to the container directly)
#   strict-transport-security: max-age=63072000; includeSubDomains
#   content-security-policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; …
#   permissions-policy: camera=(self)
#   cache-control: no-cache

# 4. Admin console shell (restricted at the edge if configured)
curl -fsS -o /dev/null -w '%{http_code}\n' "$ORIGIN/admin"           # 200 (or 403 from the edge outside the staff network)

# 5. Verification path end to end with a malformed code (records one MALFORMED scan event)
curl -fsS -X POST -H 'content-type: application/json' -d '{"code":"AAAA"}' "$ORIGIN/api/v1/verify"
#   {"state":"MALFORMED_CODE","scanId":"…","verifiedAt":"…","title":"UNREADABLE CODE","message":"…"}

```

**One-time proxy-trust check** (after the first deployment and after any change to the proxy chain or `TRUST_PROXY`; run it in a quiet period). It proves that the app sees real client IPs, i.e. that clients do not share one rate-limit bucket:

```sh
# From one machine: exceed the `api` budget (RATE_LIMIT_API_PER_MINUTE, 120 by default) on a no-store route
for i in $(seq 1 121); do curl -s -o /dev/null -w '%{http_code}\n' "$ORIGIN/api/v1/health"; done | sort | uniq -c
#   120 200      (fewer if you made other requests in the last minute)
#     1 429      (with x-ratelimit-limit: 120 and retry-after headers)
# Within the same minute, from ANOTHER network (e.g. a phone on mobile data):
curl -s -o /dev/null -w '%{http_code}\n' "$ORIGIN/api/v1/health"       # must be 200; 429 means TRUST_PROXY is wrong (§3.3)
```

Then, in a browser on a phone:

- open `$ORIGIN/verify`: the camera starts after permission;
- scan a code issued from the console GENERATOR: AUTHENTIC;
- sign in to `$ORIGIN/admin` with TOTP and check that the dashboard loads.

### 13.1 Local demo (development only)

```sh
cd genome && npx tsx scripts/build-web.ts            # once, for /verify and /admin
node --import tsx src/server/index.ts --demo          # or ORBES_DEMO=true; npm start -- --demo
```

The server starts on `pglite:memory`, loads the demo dataset through the real services (41 products, 8 accounts, scan histories and anomalies; about 15 s), then serves it; the clock replays the catalogue's history during the seed and follows real time afterwards. It prints the console sign-in once: `BOOTSTRAP_ADMIN_*` when set, otherwise `demo-admin@example.com` with a random password, plus the demo accounts' password and a claim code. Everything is lost on exit. `--demo` is refused in production and with any `DATABASE_URL` other than `pglite:memory`. (`package.json` has no `npm run demo` alias: it cannot be edited in this change; `npm start -- --demo` is the equivalent.)

---

## 14. Production security checklist

Configuration

- [ ] `ORBES_ENV=production` (the image default). The server starts without configuration errors, so every production refusal of §3.2 is satisfied.
- [ ] `COOKIE_SECRET`, `IP_HASH_PEPPER` and `KEY_ENCRYPTION_KEY` are freshly generated (§4.1), unique to this environment, held in a secret manager, and never committed. The env file is `0600` and outside the checkout.
- [ ] `KEY_ENCRYPTION_KEY` is escrowed separately from the `keys` volume and from database backups.
- [ ] `PUBLIC_ORIGIN` is the exact `https://` origin users see. Other hostnames redirect to it.
- [ ] `TRUST_PROXY` lists only your proxies (§3.3), never `true`. The app port is reachable only by the proxy (`APP_BIND=127.0.0.1` or a firewall).
- [ ] `GEO_MODE=cloudflare` / `headers` only behind a proxy that overwrites those headers, with the origin locked to it.
- [ ] `GEO_MODE=mmdb`: the startup log shows `geoip database loaded` with a recent `buildEpoch`, the update timer runs (§3.4), and `NOTICE.md` keeps the DB-IP attribution.
- [ ] `BOOTSTRAP_ADMIN_*` removed after the first start.

Edge and network

- [ ] TLS 1.2+, HTTP → HTTPS, HSTS. Consider preload once the domain is stable, and mind `includeSubDomains` with Option B (§1.1).
- [ ] `/admin*` and `/api/admin/*` restricted at the edge (IP allow-list, VPN, or an identity-aware proxy) in addition to the app's TOTP.
- [ ] The CDN honours origin cache headers and never caches `/api/*` responses beyond what the app sets.
- [ ] PostgreSQL is not exposed publicly. Remote connections use TLS (`sslmode=verify-full`).

Runtime

- [ ] The container runs as uid 1000 with a read-only root filesystem, all capabilities dropped and `no-new-privileges` (the compose defaults).
- [ ] The database uses a least-privilege application role, and migrations run with the owner role (§6.2).
- [ ] The local key provider is used only on a single host with an encrypted disk, with a KMS/HSM provider planned for growth (§7.6).
- [ ] Admins use TOTP (enforced in production). Analysts get the AUDITOR role once staff management exists (§8.2).
- [ ] The demo dataset is never loaded (`db seed` refuses production).

Operations

- [ ] Backups are encrypted, PITR is enabled, and a restore was tested this quarter (§10).
- [ ] The audit chain anchor is exported daily, and `audit/verify` is monitored.
- [ ] Alerts are configured (§9.3), CRITICAL anomalies first.
- [ ] Keys are rotated at least yearly. The compromise runbook (§7.5) has been rehearsed on staging, and the key register (ids, kids, fingerprints) is current.
- [ ] The image is rebuilt regularly for base-image patches. `npm audit` findings are triaged.
