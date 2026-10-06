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
15. [OVH VPS deployment](#15-ovh-vps-deployment) (the production setup: Caddy + app + PostgreSQL on one VPS, `theorbes.com` on Vercel)

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
| `/legal`, `/legal/*` | The legal pages (`dist/web/legal`, J-06): privacy policy, terms of use, legal notice, FAQ | Public, like `/verify`; also the target of theorbes.com's legal links. |
| `/assets/*` | Content-hashed bundles, CSS, favicons, the display font (WOFF2, preloaded by every shell) | `Cache-Control: public, max-age=31536000, immutable`. |
| `/api/v1/*` | Public and account API | `Cache-Control: no-store`, except `/api/v1/keys` and `/api/v1/client-services` (5 min) and `/api/v1/categories` (1 min). |
| `/api/admin/*` | Admin API | Cookie sessions, CSRF, TOTP enforced in production. |
| `/.well-known/orbes-keys.json` | Public signing keys (same document as `/api/v1/keys`) | CORS `*`, `max-age=300`. |
| `/` | `302` → `/verify` | Only meaningful on a dedicated hostname. |

The web apps reference their assets and the API with **absolute paths** (`/assets/…`, `/api/…`). The service must therefore be reached at the root of its origin, or with these paths forwarded unchanged. A path prefix that the proxy strips (for example `theorbes.com/genome/…`) does not work.

### 1.1 Mapping `theorbes.com/verify` to the service

The ORBES website is a single static file (`index.html` at the repository root, with every asset embedded). Neither option below changes it or its hosting.

**Option A: dedicated subdomain (recommended, and the production choice: §15).** Serve the service at `https://verify.theorbes.com` and add a redirect at the edge or on the static host. In production the static host is Vercel and the redirect is the root `vercel.json` (temporary `307` while the address may still change, §15.10):

```
https://theorbes.com/verify      307 → https://verify.theorbes.com/verify
https://theorbes.com/verify/*    307 → https://verify.theorbes.com/verify/*      (path kept)
```

- `PUBLIC_ORIGIN=https://verify.theorbes.com`.
- The service gets its own origin. Its CSP, cookies (`__Host-orbes_session`, `__Host-orbes_admin`, `__Host-orbes_device` in production: host-only by construction), HSTS and rate limits stay isolated from the marketing site.
- The app sends `Strict-Transport-Security: max-age=63072000; includeSubDomains` in production. On `verify.theorbes.com` this only covers that host and its own subdomains.
- Nothing has to change on the static host except the redirect: `vercel.json` on Vercel (§15.10). With Cloudflare in front of `theorbes.com`, a Redirect Rule would do the same.

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
| Request bodies ≥ 16 KB allowed, and ≥ 1 MiB on the five photograph uploads (`MEDIA_UPLOAD_ROUTES`: `POST /api/admin/models/:id/image`, `POST /api/admin/models/:id/gallery`, `POST /api/admin/products/:productId/photo`, `POST /api/admin/circle/posts/:id/photos`, `POST /api/admin/live/:id/silhouette`); upstream timeout > 30 s | The app limits JSON bodies to 16 KB, the photographs of the console (F-04, P-R02, [API §13.4](API.md#134-models)) and a LIVE RELEASE's silhouette to 1 MiB, and requests to 30 s. With nginx, `client_max_body_size 1200k;` in the `location` that proxies `/api/` (the default, 1 MiB, would refuse the largest photographs with their headers). |
| The three streams (`LIVE_STREAM_ROUTES`: `GET /api/v1/live/:id/stream`, `POST /api/v1/live/:id/board/stream`, `GET /api/admin/live/:id/stream`) passed through unbuffered and uncompressed, with an idle (read) timeout above 20 s | Server-Sent Events of the LIVE RELEASES: each event must reach the phone the moment the app writes it, and a quiet stream carries only a comment line every 20 s. The app sends `X-Accel-Buffering: no` (nginx then does not buffer them); compression must still be off on these paths (nginx: `gzip off;` in their `location`, `proxy_read_timeout` above 20 s). With Caddy, §15.7's `@live_stream`. |
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
| `KEY_ENCRYPTION_KEY` | none | Required when `KEY_PROVIDER=local`. base64url **without padding** of **exactly 32 bytes** (43 characters). Production refuses a key whose bytes are all identical. The AES-256-GCM key-encryption key for every key file. The admin TOTP sealing key and the key that seals the seeds of the releases' draws (P-R03, [DATABASE §5.29](DATABASE.md#529-drops)) are also derived from it (HKDF), see §7.7. |

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
| `RATE_LIMIT_API_PER_MINUTE` | `120` | Same range. Applies to the remaining public and account routes (health, keys, categories, the lookbook, account reads, …): the `api` group. The photographs (`GET /api/v1/media/:sha256`) have their own group, `media`, five times this budget (600 by default; P-R02: a lookbook sheet shows up to nine, and a boutique's customers share its address); it has no variable of its own. |

Any other `RATE_LIMIT_*` name is rejected, so a typo cannot silently keep a default.

**Sessions**

| Variable | Default | Rules |
|---|---|---|
| `SESSION_TTL_ACCOUNT_HOURS` | `720` | Integer 1–8760. |
| `SESSION_TTL_ADMIN_HOURS` | `8` | Integer 1–168. |

**Data retention**

| Variable | Default | Rules |
|---|---|---|
| `SCAN_RETENTION_DAYS` | unset (keep) | Whole days 30–3650, never below the anomaly look-back (the longest `ANOMALY_*_WINDOW` / `ANOMALY_DECAY_DAYS`: 30 days by default). Housekeeping (every 10 min) deletes scan events older than this, with their authentication events, scan tokens and customers' reports on them (DATABASE §10), always after counting every complete day into the anonymous daily statistics the console's Analytics view reads (DATABASE §5.24), which the purge never touches. Unset keeps scan history indefinitely and logs a `risky configuration` warning in production. The period is a legal decision: set the one agreed with counsel. |

**ORBES Client Services** (public contact, supplied by the brand; served by `GET /api/v1/client-services`, API §8.4)

| Variable | Default | Rules |
|---|---|---|
| `CLIENT_SERVICES_EMAIL` | unset | A plain mailbox, ≤ 254 characters: letters, digits and `. _ + -`, an `@` and a dotted domain (nothing a `mailto:` link would read as syntax: no `? & # % / :` or spaces). In the collector app (plan NEXT-NINE, CS-01) it shows only under **FORGOTTEN PASSWORD?**: **CONTACT ORBES CLIENT SERVICES** opens an email to it, prefilled with the scan reference (ORBES Care's SUBSCRIBE keeps its own address, `CARE_SUBSCRIBE_URL`); everywhere else the app shows WRITE TO ORBES CLIENT SERVICES (a message to the console's Messages board). The legal pages show it as before. |
| `CLIENT_SERVICES_PHONE` | unset | International format: `+`, then 7–15 digits with single spaces, dots or hyphens between them (e.g. `+33 1 23 45 67 89`; no `(0)`). Shown as a `tel:` link on the legal pages only (the legal notice, the privacy policy): no longer shown in the collector app (CS-01). |
| `CLIENT_SERVICES_HOURS` | unset | One line of plain text, ≤ 120 characters (e.g. `Monday to Saturday, 10:00–19:00 (Paris)`). Refused unless an email or a phone is set. Shown on the legal pages only: no longer shown in the collector app (CS-01). The three variables themselves are unchanged. |

Each is optional. In the collector app, only FORGOTTEN PASSWORD? shows the email (none set: no email there); every caution and void result and the WARRANTY tab of a warranty that no longer applies show WRITE TO ORBES CLIENT SERVICES, which needs no variable. The legal pages show the email, the phone and the hours that are set. Values are public once served; `redactConfig` still logs only `[set]`. Browsers may keep the details for 5 minutes (`Cache-Control: public, max-age=300`). On the VPS (`deploy/vps/.env`), quote a value that contains ` #`.

**ORBES Care** (P-M02; served by `GET /api/v1/client-services`, API §8.4)

| Variable | Default | Rules |
|---|---|---|
| `CARE_SUBSCRIBE_URL` | unset | Optional: where SUBSCRIBE of ORBES Care leads, from the CARE tab of MY PIECES, opened in a new tab. An `https://` address with a host, no credentials (`user:pass@`) and no spaces, at most 2 048 characters (`config.careSubscribeUrl`; anything else stops the server at startup). Served publicly as `careSubscribeUrl` (5-minute cache). Unset, the tab reads *Subscriptions open soon.*, with nothing to press. |

It stays empty until the ORBES Care subscription opens (on Whop): no deployment needs it. `deploy/vps/compose.yaml` passes it to the app as `${CARE_SUBSCRIBE_URL:-}`, so a line missing from `deploy/vps/.env` is the same as empty. The startup log shows it as `[set]` only (`redactConfig`), and production prints no warning about it, set or not. Setting it later is a change of `deploy/vps/.env` and a recreation of the app, with no migration: check the value with `docker compose run --rm --no-deps -T app node --import tsx scripts/db.ts status` (a malformed one reads `Invalid configuration:` and the variable), then `scripts/deploy.sh`, which reuses the running image and recreates the app with the new environment.

**Ownership transfers** (F-03, API §11.3)

| Variable | Default | Rules |
|---|---|---|
| `TRANSFER_ACCEPT_REQUIRE_PRODUCT` | `true` | Same boolean syntax as `ADMIN_REQUIRE_MFA` (`config.transferAcceptRequireProduct`). `true`: a transfer code is accepted only with the piece the recipient scanned (`productId`; a code of another piece answers `409 TRANSFER_PRODUCT_MISMATCH`) and the 15-minute token of that scan, signed in (`transferToken`). `false` makes both optional, for an acceptance assisted by ORBES Client Services (whatever is sent is still checked); production logs a `risky configuration` warning at every start. It acts on the API only: the verify app still asks for a signed-in scan of the piece and neither it nor the console accepts a transfer without one, so it does not help a client whose piece cannot be scanned (LAUNCH §11); while it is set, the check is off for every pending transfer. Set it back once the assisted acceptance is done. |

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
| `ADMIN_TOTP_SECRET` | unset | `scripts/admin.ts totp-enable` only: the TOTP secret printed by `totp-setup`, read from the environment so it never appears in argv (the process list) or shell history. `--secret` still works, with that exposure. |

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
| `COOKIE_SECRET` | Device cookies are re-issued, so devices look new to the anomaly rules for a while (session cookies are not signed and survive). Pending ownership transfer codes stop working (their lookup key is derived from it): owners start a new transfer. When `KEY_ENCRYPTION_KEY` is unset, enrolled admin TOTP secrets and the sealed seeds of releases not drawn yet (P-R03) can no longer be opened either. | Change and restart. Schedule a quiet period. |
| `IP_HASH_PEPPER` | New IP, device and session pseudonyms cannot be linked to older scans. Anomaly scoring (device, IP and geo diversity) starts again from scratch. | Change and restart. Rotate only when it may have leaked or on a planned schedule. |
| `KEY_ENCRYPTION_KEY` | Existing key files can no longer be decrypted, enrolled admin TOTP secrets can no longer be opened, and neither can the sealed seeds of the releases not drawn yet (their draw fails closed, `503 DROP_SEED_UNAVAILABLE`). | Follow §7.7. Never just swap it. |
| `POSTGRES_PASSWORD` | The app cannot connect until `DATABASE_URL` matches. | `ALTER ROLE … PASSWORD …`, update the env file, restart. With compose, the `POSTGRES_PASSWORD` variable only applies when the data volume is first created. |
| `BOOTSTRAP_ADMIN_PASSWORD` | None after the first admin exists. | Remove it from the environment after the first start. |

---

## 5. First deployment

**Production on the OVH VPS uses `deploy/vps/` and its scripts instead: follow §15.** The steps below describe the generic single-host compose stack (`genome/docker-compose.yml`: the app plus `postgres:17`, two named volumes `pgdata` and `keys`, the app published on `127.0.0.1:8080`, read-only root filesystem, all capabilities dropped, `no-new-privileges`). §5.6 covers the same steps without compose.

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

**No KMS/HSM provider ships with this prototype.** Writing one needs the chosen vendor's account, its non-exportable Ed25519 key type and its SDK or signed-request client, none of which a self-contained prototype can exercise; an untested provider would be worse than none. The interface, the configuration switch (`KEY_PROVIDER`) and the acceptance suite (`test/keys/provider-contract.ts`) are in place.

1. **Implement the provider** (for example `src/server/keys/kms-provider.ts`).
   - `generate` creates a **non-exportable Ed25519** key in the KMS/HSM and returns its raw 32-byte public key and the KMS key reference.
   - `sign` calls the KMS with the **raw message** (PureEdDSA, not Ed25519ph or a pre-hash) and returns the 64-byte signature.
   - Check the vendor's EdDSA support and its authentication model at integration time.
2. **Wire it in.**
   - Add the provider name to the `KEY_PROVIDER` enum and its settings to `loadConfig()` (`src/server/config.ts`).
   - Add the provider to `createKeyProvider()` (`src/server/keys/index.ts`).
   - Document the new variables in `.env.example`.
   - Run the shared provider contract against it: add a `describeKeyProviderContract('<name>', …)` line to `test/keys/provider-contract.test.ts` (strict Ed25519 public keys, 64-byte RFC 8032 signatures valid only under their key, no kid reuse, documented error codes, no key bytes in errors), plus provider-specific tests next to `test/keys/local-provider.test.ts`.
3. **No custom safety code is needed.** `KeyService` refuses weak or non-canonical public keys, requires a proof-of-possession signature before registering a key, and verifies every signature after signing. A faulty KMS cannot put an invalid code into circulation.
4. **Cut over** with an ordinary rotation: deploy with `KEY_PROVIDER=<kms>`, then run `npm run keys:rotate`.
   - The new ACTIVE key lives in the KMS, and the local keys become RETIRED. They keep verifying, because their public keys are in the database.
   - The server refuses to sign with an ACTIVE key that belongs to another provider (`SIGNING_UNAVAILABLE`), so run the rotation right after the deploy.
5. **Afterwards**, archive or destroy the local key files and retire `KEY_ENCRYPTION_KEY` according to policy. Keep in mind that `KEY_ENCRYPTION_KEY` also seals admin TOTP secrets (§7.7).

### 7.7 Rotating `KEY_ENCRYPTION_KEY`

There is no re-encryption tool. Changing the key-encryption key has three effects:

1. **Existing key files become undecryptable.** The ACTIVE key fails the start-up self-test and issuance stops. Verification is unaffected.
2. **Admin TOTP secrets become undecryptable.** The TOTP sealing key is derived from `KEY_ENCRYPTION_KEY` with HKDF, and admins with TOTP get `TOTP_UNAVAILABLE` (503) at sign-in. The code fails closed and never falls back to password-only.
3. **The sealed seeds of the releases not drawn yet become unreadable** (P-R03): they are sealed under a key derived from `KEY_ENCRYPTION_KEY` (from `COOKIE_SECRET` without one) with HKDF, and their draw fails closed (`503 DROP_SEED_UNAVAILABLE`).

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
7. **Releases not drawn yet** (P-R03): their seeds were sealed under the old key and committed by their published SHA-256, so they cannot be re-sealed without breaking that commitment. Their draw now fails closed (`503 DROP_SEED_UNAVAILABLE`, nothing written): cancel each such release from the console's Club page and create it again (a new seed, a new commitment). Rotate between releases where possible. Drawn releases are unaffected: their seed is published.

---

## 8. Admin accounts

### 8.1 First admin and TOTP enrolment

1. Before the first start, set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (12–1024 characters). On start, if `admin_users` is empty, one **ADMIN** is created. The log says `bootstrap admin created`. The step is idempotent and race-safe across instances, and the variables are ignored once any admin exists.
2. Open `https://<origin>/admin` and sign in. In production the response says `"mfaRequired": true, "mfaPassed": false`, and every admin route except sign-in and enrolment answers `403 MFA_REQUIRED` until TOTP is enrolled.
3. Enrol TOTP. **Recommended: from the shell, before the password is ever used in the console** (enrolment in the console is trust on first use: whoever signs in first with the password enrols their device):
   ```sh
   docker compose exec app node --import tsx scripts/admin.ts totp-setup --email admin@theorbes.com
   #   prints the secret and the otpauth:// URI once; hand them to the admin in person
   read -rs ADMIN_TOTP_SECRET && export ADMIN_TOTP_SECRET   # paste the secret: nothing is echoed, nothing reaches the history
   clear                                                    # the secret leaves the screen
   docker compose exec -e ADMIN_TOTP_SECRET app node --import tsx scripts/admin.ts totp-enable --email admin@theorbes.com --code <current code>
   unset ADMIN_TOTP_SECRET
   ```
   Or when the console asks:
   - the console calls `POST /api/admin/auth/totp/setup` and shows the `otpauth://` URI / QR code;
   - scan it with an authenticator app (RFC 6238: SHA-1, 6 digits, 30 s) and enter the current code;
   - `POST /api/admin/auth/totp/enable` verifies it, stores the secret sealed with AES-256-GCM and replaces the session by a new MFA-passed one (new cookie and CSRF token).

   Every later sign-in asks for a code. Each code is accepted once, ±1 time step.
4. Remove `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` from the environment and recreate the container (`docker compose up -d`).

Lockout: 10 failed sign-ins lock the admin for 15 minutes. Admin sessions last `SESSION_TTL_ADMIN_HOURS` (8 h by default).

### 8.2 Further admins, lost authenticators: `scripts/admin.ts`

**Staff accounts (OPERATOR, AUDITOR, and RETAIL for the sellers of the sale mode) are managed in the console**, on the Team page (ADMIN; [API §17.7–§17.13](API.md#17-admin-keys-audit-log-and-console-users)): create an account with a temporary password shown once (it must be replaced at the first sign-in, then the second factor is enrolled), change a role between OPERATOR, AUDITOR and RETAIL, disable a departing account (its sessions end at once) and enable it again, lift a lockout, list and end sessions, reset a lost second factor. Every admin changes its own password from the foot of the sidebar (*Change password*, [API §12.5](API.md#125-post-apiadminauthpassword-extension-of-the-contract)).

**ADMIN accounts and the ADMIN role come from the shell only**, where the second factor is enrolled out of band (§8.1). The same commands are the fallback when no ADMIN can sign in (every change is audited as `system:cli:admin:<os user>`):

```sh
# a new ADMIN (or OPERATOR, AUDITOR); the password comes from the environment, never argv
docker compose exec -e ADMIN_PASSWORD='…' app node --import tsx scripts/admin.ts create --email ops@theorbes.com --role ADMIN
docker compose exec app node --import tsx scripts/admin.ts list                      # role, 2FA on/off, active/locked/disabled/temporary password
docker compose exec app node --import tsx scripts/admin.ts totp-setup --email ops@theorbes.com
docker compose exec -e ADMIN_TOTP_SECRET app node --import tsx scripts/admin.ts totp-enable --email ops@theorbes.com --code <code>   # secret read with read -rs (§8.1); ends that admin's sessions
docker compose exec app node --import tsx scripts/admin.ts reset-totp --email ops@theorbes.com --yes   # lost device
docker compose exec app node --import tsx scripts/admin.ts role --email ops@theorbes.com --role ADMIN  # the only way to grant ADMIN
docker compose exec app node --import tsx scripts/admin.ts disable --email ops@theorbes.com --yes      # sign-in refused, sessions end
docker compose exec app node --import tsx scripts/admin.ts enable --email ops@theorbes.com
```

- **The last active ADMIN** can be neither demoted nor disabled, from the console or the shell (`LAST_ADMIN`); create or promote another ADMIN first. Keep two.
- **A lost authenticator:** after an identity check, an ADMIN resets it from the console (Team page, *Reset two-factor*, typed confirmation; `POST /api/admin/admins/:id/totp/reset`) or with `reset-totp` above. The reset removes the enrolment and ends every session of that admin; they sign in with the password and enrol again. If no ADMIN with a working second factor is left, use the shell command.
- **Lockout as denial of service:** anyone who knows an admin's email can keep that admin locked out with wrong passwords (10 per 15 minutes suffice). Keep admin emails private and, ideally, put `/admin` and `/api/admin` behind an IP allow-list or VPN at the edge (SECURITY-MODEL §3.3).
- **Enrolling a second factor ends the sessions opened without it**, from the shell (every session of that admin) as in the console (every session but the one that enrolled): none is left with the password alone. Once enrolled, the console's *Change password* needs a session that passed the second factor when MFA is enforced.
- **A forgotten password** has no reset yet, neither in the console nor in the shell: disable the account and create a new one under another address (the old account and its history stay). Once signed in, anyone can change their own password (*Change password*).

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
- **Level.** `LOG_LEVEL` (default `info` in production). Accepted but risky settings (`ADMIN_REQUIRE_MFA=false`, `TRANSFER_ACCEPT_REQUIRE_PRODUCT=false`, or no `SCAN_RETENTION_DAYS`, in production) are logged as `risky configuration` warnings at every start.
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
| New CRITICAL anomaly (`VALID_SIGNATURE_UNREGISTERED`, `CODE_MISMATCH`) | SQL query of §7.5 step 5, polled every few minutes, or `GET /api/admin/anomalies?severity=CRITICAL&status=OPEN` (`GET /api/admin/anomalies/summary`: `open.CRITICAL`). In the console, the badge on ANOMALIES and the `(n)` of the tab title count the OPEN HIGH and CRITICAL findings | Page: possible key compromise |
| New `UNSOLD_PIECE_SCAN` anomaly (console: UNSOLD PIECE SCANNED): a piece not sold yet, scanned outside the console | `GET /api/admin/anomalies?type=UNSOLD_PIECE_SCAN&status=OPEN`, or `anomalies` rows with `type = 'UNSOLD_PIECE_SCAN' AND status = 'OPEN'` (country in `details`), daily | Ticket: stock possibly diverted (API §9.7, THREAT-MODEL W) |
| `verification flagged` (SUSPICIOUS ACTIVITY) | Log (warn) | Ticket / dashboard |
| `housekeeping job failed`, `health check: database unavailable` | Log (error; `job: scanStats` also holds back that pass's scan-history purge; `job: liveNetworks`, the erasure of the LIVE RELEASES' network fingerprints after 30 days) | Ticket |
| `live engine: a pass failed`, `live engine: a release could not advance`, `live engine: the lock could not be taken or kept` | Log (error), from the engine of the LIVE RELEASES (§11) | Page while a LIVE RELEASE is open (its turns stop being given; the console's LINE STALLED says so too), ticket otherwise |
| Audit chain broken | `GET /api/admin/audit/verify` (daily job) returns `ok: false` | Page |
| Spikes of `429` | Request logs | Dashboard (abuse or a misconfigured `TRUST_PROXY`) |

---

## 10. Backups and point-in-time recovery

Full guidance: [DATABASE §11](DATABASE.md#11-backup-restore-and-point-in-time-recovery). On the OVH VPS, `deploy/vps/scripts/backup.sh` and `restore.sh` implement the database and key-file rows below (age-encrypted, retention, OVH Object Storage): §15.8–15.9. In short:

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
| Housekeeping | Every 10 min per process (expired sessions, scan tokens, stale transfers, the daily scan statistics and the hourly activity counts the best time to open reads (`activity_hourly`, LIVE RELEASE+), then the scan-history purge, and the LIVE RELEASES' network fingerprints 30 days after their end) | Idempotent, so running it on every instance is harmless: two instances counting the same day, or the same hour, write the same counts. |
| The first boot's stock and orders (`OrderService.prepare`, LIVE RELEASE+) | At every start: the two locations and the four carriers created while their tables are empty (`stock.setup`, once), the pieces and sizes on sale linked to their SKUs, and the orders of the sales confirmed without one (`stock and orders ready` in the log when it did anything) | Idempotent: an instance that starts after another creates nothing again; two that start together insert the presets under `ON CONFLICT DO NOTHING`, and each sale's order once (its unique key). |
| The invoices' numbers (`services/invoices.ts`) | In sequence per kind and UTC year, under the transaction-scoped advisory lock `INVOICE_NUMBER` (DATABASE §8.3) and the unique key (kind, year, sequence) | Any number of instances: two orders paid at once never share a number. |
| The LIVE RELEASES' engine (`services/live-engine.ts`) | One pass every 250 ms over the releases in their live window, by **one process at a time**: the one that holds the session advisory lock `LIVE_ENGINE` (DATABASE §8.3) on a connection it keeps from its pool while it leads (`live engine: leading` in its log); the others try again every second, so a process that stops is replaced within one. Nothing is kept in memory: a restart, or the overlap of two containers during a deployment, changes nothing | Any number of instances. The leader keeps one of its 10 connections for itself: size `max_connections` with it. |
| The LIVE RELEASES' streams (`http/live-stream.ts`) | Server-Sent Events held by the process that serves them (`/api/v1/live/:id/stream`, `…/board/stream`, `/api/admin/live/:id/stream`): each process builds, once a second, the room of each release it streams, and fans it out from memory; at most two streams per account and per console user, per process | With N instances, each builds the frames its own streams need (database work per second grows with instances × releases, never with the audience), and the two-stream cap is per instance. A proxy in front must not buffer or compress them (§15.7). Measured on the VPS profile: **1 000 people in the room** within every target ([the load report](reports/live-load.md)); the console's audience forecast says when a release may draw more. |
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
  - **On the shared OVH VPS (§15), neither applies**: a release that migrated is never undone by changing the image (`scripts/deploy.sh` runs the migrations itself, and refuses an image that does not know them), and that server is never restored from a backup (`RESTORE_ALLOWED=false`). It is repaired forward: §15.7, §15.9.
  - A down step may also stop accounts that the older schema cannot represent ([DATABASE §9.1](DATABASE.md#91-layout)): rolling back past `0008` disables the sellers' (RETAIL) accounts, and past `0006` the staff accounts that have not yet replaced their temporary password (the forced change would be lost). Before such a rollback, look at the Team page for TEMPORARY PASSWORD rows; afterwards, create new accounts for those members rather than re-enabling these.
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
#             "activatedAt":"2026-10-01T10:55:37.987Z","retiredAt":null,"revokedAt":null,"compromisedAt":null}]}
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

The server starts on `pglite:memory`, loads the demo dataset through the real services (47 products, 8 accounts, scan histories and anomalies; about 15 s), then serves it; the clock replays the catalogue's history during the seed and follows real time afterwards. It prints the console sign-in once: `BOOTSTRAP_ADMIN_*` when set, otherwise `demo-admin@example.com` with a random password, plus the demo accounts' password and a claim code. Everything is lost on exit. `--demo` is refused in production and with any `DATABASE_URL` other than `pglite:memory`. `npm run demo` (`tsx src/server/index.ts --demo`) and `npm start -- --demo` are equivalent shortcuts.

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

---

## 15. OVH VPS deployment

The production decision: the backend and its database run on **one OVH VPS** (Ubuntu 26.04 LTS), and the website `theorbes.com` stays on **Vercel**, unchanged except for a redirect of `/verify` (§15.10). Everything lives in [`deploy/vps/`](../deploy/vps/) (quick start: [deploy/vps/README.md](../deploy/vps/README.md)). This chapter is the complete runbook; the general sections above still apply (configuration §3, keys §7, admins §8, monitoring §9).

```
 phone / browser ──HTTPS──▶ theorbes.com/verify (Vercel) ──307──▶ https://verify.theorbes.com/verify
                                                                       │
 ┌─────────────────────────────── OVH VPS (Ubuntu 26.04) ──────────────┼─────────────────────────────┐
 │ ufw + (optional) OVH Edge Network Firewall: 22, 80, 443/tcp, 443/udp ▼                             │
 │  caddy:2 ── ports 80/443 ── Let's Encrypt, HTTP→HTTPS, JSON access log, X-Forwarded-For = client  │
 │     │ network `edge` (internal, 172.30.80.0/28; Caddy fixed at 172.30.80.2 = the app's TRUST_PROXY)│
 │     ▼                                                                                              │
 │  app (orbes-genome:<commit>) :8080 · uid 1000 · read-only · no capabilities · GeoIP volume (ro)    │
 │     │ network `backend` (internal)                                                                 │
 │     ▼                                                                                              │
 │  postgres:17 (volume pgdata, never published)                                                      │
 │                                                                                                    │
 │  systemd timers: orbes-backup (nightly, age-encrypted → /var/backups/orbes [→ OVH Object Storage]) │
 │                  orbes-geoip  (weekly, DB-IP City Lite → volume geoip)                             │
 └────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Piece | Where | Notes |
|---|---|---|
| Stack definition | `deploy/vps/compose.yaml` | Services `caddy`, `app`, `postgres`; one-off tool `geoip-update` (profile `tools`). Compose project `orbes`, volumes `orbes_pgdata`, `orbes_keys`, `orbes_geoip`, `orbes_caddy_data`, `orbes_caddy_config`. Caddy publishes 80/443 on **IPv4 only** (§15.2). |
| Database roles | `deploy/vps/scripts/lib.sh` (`db_*`) | §6.2 applied: the app connects as **`POSTGRES_APP_USER`** (`orbes_app`: `SELECT`/`INSERT`/`UPDATE`/`DELETE` on the tables, sequence use, read-only on `kysely_migration*`; no superuser, no DDL, `MIGRATE_ON_START=false`). The superuser `POSTGRES_USER` owns the schema and is used only by the scripts: migrations (`deploy.sh`, `restore.sh`), backups and restores. A compromised app therefore cannot `SET session_replication_role` or `ALTER … DISABLE TRIGGER` to rewrite the append-only audit log, nor run `COPY … TO PROGRAM`. |
| TLS edge | `deploy/vps/Caddyfile`, `deploy/vps/caddy.d/` | Official `caddy:2` image. Switches in `.env`: `TLS_MODE`, `EDGE_MODE`, `ADMIN_ALLOWED_IPS`. Request bodies: 64 KB, except the console's five photograph uploads (F-04, P-R02, P-X01, a LIVE RELEASE's silhouette), 1 200 KB (§15.7). |
| Configuration | `deploy/vps/.env` (from `.env.example`) | Mode `0600`, owner `orbes`, git-ignored. Parsed by the scripts, never sourced. |
| Scripts | `deploy/vps/scripts/` | `bootstrap-ubuntu.sh`, `setup.sh`, `deploy.sh`, `backup.sh`, `restore.sh`, `geoip-update.sh`; each has `--help`. |
| Timers | `deploy/vps/systemd/` | Installed by `bootstrap-ubuntu.sh` (`--units-only` to refresh). |

### 15.1 Prerequisites

| Item | Recommendation |
|---|---|
| VPS | **≥ 2 vCPU, 4 GB RAM, 40 GB SSD/NVMe**, in an **EU region** (for example one of OVH's French data centres) for data-protection simplicity. The stack's limits (`.env`: app 768 MB, PostgreSQL 1 GB, Caddy 256 MB) leave room for the OS, Docker builds and the page cache. A 2 GB VPS works for a trial (the bootstrap adds swap below 2 GB). x86_64 and arm64 are both supported. |
| Image | **Ubuntu 26.04 LTS**, with your SSH public key added at order time (OVH's image then lets you in as `ubuntu`, with sudo). |
| Domain | Control of the DNS zone of `theorbes.com` (§15.2). |
| Accounts | An e-mail address for Let's Encrypt notices; optionally an OVH Public Cloud project for Object Storage (§15.8). |
| Offline storage | A password manager / vault **and** a sealed offline copy for: the backup decryption key (age identity), `KEY_ENCRYPTION_KEY`, `COOKIE_SECRET`, `IP_HASH_PEPPER`, the first admin's password. |
| Repository access | The VPS clones this repository. For a private repository use a read-only **deploy key** of the `orbes` user. |

### 15.2 DNS

1. Find out where the zone of `theorbes.com` is hosted: `dig +short NS theorbes.com`.
   - `ns1.vercel-dns.com` / `ns2.vercel-dns.com`: the zone is at **Vercel**. Vercel dashboard → *Domains* → `theorbes.com` → DNS records, or `vercel dns add theorbes.com verify A <VPS IPv4>`.
   - anything else (the registrar's, OVH's `dns*.ovh.net`, Cloudflare…): add the record at that provider.
2. Add **`verify` A `<VPS IPv4>`** (TTL 300 s while you set things up). Do not touch the apex or `www` records: they keep pointing at Vercel.
3. **AAAA: leave it out**, even though OVH VPSs have an IPv6 address. Caddy is published on IPv4 only (§15.3): through Docker's userland proxy every IPv6 client would appear with one internal IPv4 address, which merges their rate-limit buckets and IP pseudonyms and hides their location. Serving IPv6 needs IPv6 enabled in Docker for the `public` network first (then publish on `[::]` as well), and a new test of §13's rate-limit check over IPv6.
4. Check propagation before running `setup.sh` (Let's Encrypt validates through public DNS):
   ```bash
   dig +short verify.theorbes.com @1.1.1.1      # must print the VPS address
   dig +short verify.theorbes.com @8.8.8.8
   ```
   If ACME fails anyway, Caddy retries with back-off; `docker compose logs caddy | grep -i -E 'acme|certificate'` shows why.

### 15.3 OVH network firewall (optional)

`bootstrap-ubuntu.sh` configures **ufw** (deny incoming; allow the SSH port(s) sshd listens on, 80/tcp, 443/tcp, 443/udp). Two caveats:

- **Docker-published ports bypass ufw** (Docker inserts its own iptables rules). The stack publishes only Caddy's 80/443, which ufw allows anyway, so both views agree; never publish the app or PostgreSQL.
- **IPv4 only.** Caddy's ports are published on `0.0.0.0`, not on `[::]`: an IPv6 publish would go through Docker's userland proxy, and every IPv6 client would reach Caddy with one internal IPv4 address (one shared rate-limit bucket and IP pseudonym, no geolocation, and in Cloudflare mode a way around the origin lock, which admits private peers for the VPS's own checks). Hence no AAAA record (§15.2).
- For filtering **in front of** the VPS, OVH offers a stateless network firewall on the public IP (in the OVHcloud Control Panel, on the VPS's IP address: *Edge Network Firewall*). If you enable it, mirror ufw: allow TCP 22, 80, 443 and UDP 443 (and established TCP), deny the rest. Test SSH from a second session before relying on it.

### 15.4 First deployment, step by step

**1. Prepare the server (as `ubuntu`, once).**

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/<org>/orbes-index.git /opt/orbes/orbes-index     # or a deploy key URL
sudo /opt/orbes/orbes-index/deploy/vps/scripts/bootstrap-ubuntu.sh --dry-run       # prints every change
sudo /opt/orbes/orbes-index/deploy/vps/scripts/bootstrap-ubuntu.sh
```

What the bootstrap does (idempotent, rerun it any time; `--help` lists the options):

| Step | Detail |
|---|---|
| System | `apt-get update && upgrade`; `curl git jq openssl age rclone ufw fail2ban unattended-upgrades`. |
| Docker | Reads the release codename from `/etc/os-release` and the architecture from dpkg. If Docker's apt repository publishes that codename for that architecture (`download.docker.com/linux/ubuntu/dists/<codename>/stable/binary-<arch>/`), installs `docker-ce`, `docker-compose-plugin`, `docker-buildx-plugin` from it; otherwise Ubuntu's `docker.io`, `docker-compose-v2`, `docker-buildx`. `--docker-source docker|ubuntu` forces one. Refuses Compose < 2.24. Writes `/etc/docker/daemon.json` (json-file log rotation, `live-restore`) when absent. |
| Firewall | ufw as above. |
| Updates | unattended-upgrades daily (security origin); `--auto-reboot` reboots at 04:00 when a kernel update needs it (containers come back by themselves: `restart: unless-stopped`). |
| fail2ban | `sshd` jail on the systemd journal: 5 failures in 10 min → banned 1 h. |
| Clock | Keeps an active NTP client (chrony is Ubuntu's default since 25.10), else installs and enables systemd-timesyncd. TOTP, session expiry and audit timestamps assume an accurate clock: `timedatectl` must show `System clock synchronized: yes`. |
| Swap | 2 GB `/swapfile` when RAM < 2 GB and no swap exists. |
| Deploy user | `orbes` (no password, no sudo, member of `docker`, which is root-equivalent: protect this account); `/opt/orbes` (0750) and `/var/backups/orbes` (0700) owned by it; the checkout is chowned to it. |
| Timers | `orbes-backup.timer` (nightly ≈ 03:17 + up to 20 min) and `orbes-geoip.timer` (weekly, Monday ≈ 04:41 + up to 1 h; DB-IP publishes a new edition monthly and a run before it is out keeps the previous one), running the scripts as `orbes` from `--app-dir` (default `/opt/orbes/orbes-index`). |

**Optional SSH hardening:** `sudo …/bootstrap-ubuntu.sh --harden-ssh` writes `/etc/ssh/sshd_config.d/10-orbes-hardening.conf` (`PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `MaxAuthTries 4`; it sorts before cloud-init's `50-cloud-init.conf`, and sshd keeps the first value it reads). It refuses unless a non-root member of `sudo` has a valid non-empty `~/.ssh/authorized_keys` **and** working sudo (a `NOPASSWD` rule, as on OVH's `ubuntu` user, or a password), validates with `sshd -t` (and removes the file again if that fails), then reloads sshd. **Keep your session open and test a new login (`ssh ubuntu@<ip> sudo -v`) before closing it.**

**2. DNS** (§15.2), and wait until `verify.theorbes.com` resolves to the VPS.

**3. Configure and deploy (as `orbes`).**

```bash
sudo -iu orbes
cd /opt/orbes/orbes-index/deploy/vps
scripts/setup.sh --domain verify.theorbes.com --acme-email ops@theorbes.com --admin-email <first admin e-mail>
# optional: --age-recipient age1…  (a backup key you generated offline with age-keygen: recommended)
```

`setup.sh`:

1. creates `.env` from `.env.example` (mode 0600); an existing `.env` is kept and only **empty** secrets are filled in, so a rerun never rotates a secret. It refuses to generate `POSTGRES_PASSWORD` or `KEY_ENCRYPTION_KEY` when the matching volume already exists (put the escrowed values back instead);
2. generates `POSTGRES_PASSWORD` (the superuser/owner, scripts only) and `POSTGRES_APP_PASSWORD` (the app's DML-only role; re-applied to the role by every deploy) with `openssl rand -hex 24`, `COOKIE_SECRET` and `IP_HASH_PEPPER` (48 random bytes, base64url), `KEY_ENCRYPTION_KEY` (32 bytes, base64url) and `BOOTSTRAP_ADMIN_PASSWORD`. A `.env` from before the two roles existed: rerun `setup.sh` (it only fills in the missing `POSTGRES_APP_PASSWORD`), then `deploy.sh`;
3. backup encryption: uses `--age-recipient` if given, otherwise generates an age key pair **in memory**, prints the private key once and writes only the public key to `BACKUP_AGE_RECIPIENTS_FILE` (`/opt/orbes/backup-recipients.txt`);
4. prints the new secrets once, in an **escrow block**: store them offline now (password manager + sealed copy). The backups deliberately do not contain them;
5. runs `scripts/deploy.sh` (§15.7) and `scripts/geoip-update.sh` (§15.6, a failure only warns);
6. checks that the timers are installed.

The app is then live at `https://verify.theorbes.com/verify`, with its first signing key. Record the key's id, kid and fingerprint (`docker compose exec app npm run keys:list`) in the key register (§5.4).

### 15.5 First admin: TOTP enrolment

In production every admin must pass TOTP. Enrol the bootstrap admin **from the shell before the password is ever used in the console** (§8.1):

```bash
cd /opt/orbes/orbes-index/deploy/vps
docker compose exec app node --import tsx scripts/admin.ts totp-setup --email <first admin>
#   prints the secret and an otpauth:// URI once: hand them to the admin in person
read -rs ADMIN_TOTP_SECRET && export ADMIN_TOTP_SECRET   # paste the secret: nothing is echoed, nothing reaches the history
clear                                                    # the secret leaves the screen
docker compose exec -e ADMIN_TOTP_SECRET app node --import tsx scripts/admin.ts totp-enable --email <first admin> --code <current code>
unset ADMIN_TOTP_SECRET
```

Then remove `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` from `.env` and recreate the app with `docker compose up -d`. Sign in at `https://verify.theorbes.com/admin`. Optionally restrict the console to known networks: `ADMIN_ALLOWED_IPS="<office CIDR> <VPN CIDR>"` in `.env` (**space**-separated; a comma makes the configuration invalid), then `scripts/deploy.sh`: `/admin*` and `/api/admin*` answer 403 elsewhere. The sale mode (A-08) runs on the boutiques' phones, which open `/admin` too: with the allowlist on, add every boutique's fixed IP or CIDR, or leave it off while counter phones use mobile data or a shop Wi-Fi whose address changes, or the sale mode answers 403 at the counter (LAUNCH §4, §7). `deploy.sh` validates the Caddy configuration with the new values before changing anything; a bare `docker compose up -d caddy` does not, and an invalid value stops Caddy, which takes the whole site down.

### 15.6 GeoIP database (anomaly scoring without Cloudflare)

`GEO_MODE=mmdb` (the stack's default) locates scans from the client IP that Caddy forwards, with the DB-IP "IP to City Lite" file in the `geoip` volume (§3.4: data, licence and attribution, privacy, reload behaviour). The volume is mounted **read-only** in the app; only the updater writes to it.

```bash
scripts/geoip-update.sh                 # download, validate, install atomically (the weekly timer does this)
scripts/geoip-update.sh --check         # validate the installed file (no network)
scripts/geoip-update.sh --rollback      # back to the previous edition
scripts/geoip-update.sh --from-file dbip-city-lite-2026-10.mmdb   # air-gapped install, validated first
```

It runs `genome/scripts/geoip-update.ts` in the app image as the one-off service `geoip-update` (uid 1000, read-only root, the only container besides Caddy with outbound access), chowns a fresh volume to uid 1000 first, and keeps `<file>.previous`. The app picks a new file up within 10 minutes without a restart (`docker compose logs app | grep geoip`). A missing file only disables geolocation; verification is never affected.

### 15.7 Updates and rollback: `deploy.sh`

```bash
cd /opt/orbes/orbes-index && git pull            # or: git fetch --tags
cd deploy/vps && scripts/deploy.sh                # HEAD; or scripts/deploy.sh v1.2.0 / <commit> (= --ref …)
```

| Step | Detail |
|---|---|
| Source | `git archive <ref> genome` into a temporary build context: the checkout is never modified, and uncommitted changes are never deployed by accident (warned; `--worktree` builds the working tree as is, tagged `<commit>-dirty-<time>`). |
| Build | `docker build` → `orbes-genome:<commit12>` (an existing tag is reused). `BUILD_EXTRA_CA_FILE` in `.env` passes a proxy CA as the `extra_ca` BuildKit secret (§5.2); not needed on OVH. |
| Shell | Refuses to start while `ORBES_IMAGE_TAG` is exported in the shell, or `COMPOSE_PROJECT_NAME` with another value than the stack's (`orbes`): compose prefers the environment to `.env`, so on a shared host either would run another image, or touch another project's containers and volumes. `backup.sh` and `restore.sh` refuse the same. Run `unset ORBES_IMAGE_TAG COMPOSE_PROJECT_NAME` and start again. |
| Caddy | `caddy validate` of `Caddyfile` + `caddy.d/` with the values of `.env` (`TLS_MODE`, `EDGE_MODE`, `ADMIN_ALLOWED_IPS`…), in a throw-away `caddy:2` container: an invalid configuration stops the deployment before anything changes. |
| Schema | The migrations applied in the database (`kysely_migration`; PostgreSQL is started for it when it is down) must all be known to the image (`MIGRATIONS`, read from the image in a throw-away container). Otherwise: "this image cannot run on this schema: repair forward", exit 1, before the backup and with nothing stopped (below). A stop at this step says "nothing was changed", or "nothing else was changed" when PostgreSQL was started for the check (it is left running). |
| Backup | When the stack was running: `backup.sh --reason pre-deploy-<tag>` first (`--no-backup` skips it). |
| Database | `ORBES_IMAGE_TAG=<tag>` written to `.env`; PostgreSQL started; the app role ensured (created if missing, attributes and password re-applied); when the image changes, the running app is stopped first (old code never runs on a newer schema); pending migrations applied by a one-off container of the **new** image as the schema owner (`scripts/db.ts migrate`; the owner URL is passed through the environment, never on a command line); privileges granted again. |
| Roll out | `docker compose up -d`; waits for the app (healthcheck = `/api/v1/health`; the app itself refuses to start while a migration is pending) and Caddy; a crash loop fails fast. A changed `Caddyfile`/`caddy.d` recreates Caddy (config hash label). |
| Keys | Runs `npm run keys:generate` in the app when no key is ACTIVE (first deployment only; idempotent). |
| Smoke tests | Through Caddy on the VPS itself (`curl --resolve`, TLS verified): `/api/v1/health` → `"ok":true`, `/.well-known/orbes-keys.json` → an ACTIVE key, `/verify` → 200. |
| Rollback, or repair forward | A failure of the last three steps (health, Caddy, the signing key, the smoke tests) in a release that applied **no** migration redeploys the previous image tag and waits for health, once the previous image is known to run on the schema. A release that **did** (its migrations committed together, then something failed) is kept: the previous image cannot run on the new schema, so no rollback is attempted, `ORBES_IMAGE_TAG` stays on the new tag with the stack started on it, and the way to repair forward is printed (below). A migration that fails applies nothing (one transaction): the previous image then comes back as usual. The outcome is appended to `.state/deploys.log`. |

**The photograph uploads at the edge (F-04, lot 5; P-R02; P-X01).** The Caddyfile refuses any request body over 64 KB (the app's JSON limit is 16 KB). The console's photographs travel as the image itself, up to 1 MiB, on five routes only: `POST /api/admin/models/:id/image`, `POST /api/admin/products/:productId/photo` ([API §13.4, §14.12](API.md#134-models)) and, from the « Potentiel » deployment A, `POST /api/admin/models/:id/gallery` (a photograph of a model's lookbook gallery) and `POST /api/admin/circle/posts/:id/photos` (a photograph of a post of the owners' circle, [API §16.20](API.md#1620-the-circle-the-club-pages-posts-extension-of-the-contract)) and, from deployment D, `POST /api/admin/live/:id/silhouette` (the silhouette of a LIVE RELEASE). Two mutually exclusive matchers give exactly these paths, for `POST` only, `max_size 1200KB` (1 200 000 bytes: the app's 1 048 576 and room to spare), and every other request, a `DELETE` of the same paths and the order of a gallery or of a post's photographs (a `PATCH`) included, the 64 KB it had:

```caddyfile
@photo_upload {
	method POST
	path_regexp ^/api/admin/(models/[^/]+/(image|gallery)|products/[^/]+/photo|circle/posts/[^/]+/photos|live/[^/]+/silhouette)/?$
}
request_body @photo_upload {
	max_size 1200KB
}
@not_photo_upload {
	not {
		method POST
		path_regexp ^/api/admin/(models/[^/]+/(image|gallery)|products/[^/]+/photo|circle/posts/[^/]+/photos|live/[^/]+/silhouette)/?$
	}
}
request_body @not_photo_upload {
	max_size 64KB
}
```

The admin allowlist (`ADMIN_ALLOWED_IPS`) still applies to both, and the app refuses anything over 1 MiB (`413`), any other type (`415`) and any session-less or under-OPERATOR request (`401`, `403`) before reading the body. `genome/test/ops/vps-stack.test.ts` checks the two limits, that no `request_body` is left without a matcher, and that the pattern matches the app's upload routes (`MEDIA_UPLOAD_ROUTES`) and nothing else of the API. Each change of the shared VPS's edge goes out with a deployment announced to the other session first (lot 5; the « Potentiel » deployment A, [its runbook](launch/DEPLOY-POTENTIEL-2026-10.md)); `deploy.sh` validates the Caddyfile before anything changes (above) and recreates Caddy because its configuration changed. Check after the deployment: a photograph saved from the console's Catalogue (Photo, or a model's Lookbook page) and from a post of the Club's Circle is accepted, and a 100 KB body sent to `/api/v1/verify` still gets `413` from the edge:

```bash
head -c 102400 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data-binary @- "https://$APP_DOMAIN/api/v1/verify"
#   413
```

**The LIVE RELEASES' streams at the edge (deployment D).** The three routes that stream (`LIVE_STREAM_ROUTES` in `genome/src/server/http/live-stream.ts`: a signed-in viewer's room, `GET /api/v1/live/:id/stream`; the boutique board, `POST /api/v1/live/:id/board/stream`; the console's live board, `GET /api/admin/live/:id/stream`; [API §8.10, §10.12, §16.23](API.md#810-the-live-releases-get-apiv1live-and-the-boutique-board-extension-of-the-contract)) are Server-Sent Events: each event must reach the phone the moment the app writes it. Compression would hold the first bytes back until a block fills, so the Caddyfile serves them through two mutually exclusive matchers: `@live_stream` takes exactly these paths, uncompressed (`encode @not_live_stream zstd gzip`) and flushed at once (`flush_interval -1`) by their own `reverse_proxy`; every other request keeps the compression and the proxy it had. Both proxies import the same `app_upstream` snippet (the client IP contract, the retries across an app restart, the timeouts); no `handle` block is used, so the admin allowlist (`ADMIN_ALLOWED_IPS`) still covers the console's stream:

```caddyfile
@live_stream {
	path_regexp ^/api/(v1/live/[^/]+/(stream|board/stream)|admin/live/[^/]+/stream)/?$
}
@not_live_stream {
	not path_regexp ^/api/(v1/live/[^/]+/(stream|board/stream)|admin/live/[^/]+/stream)/?$
}

encode @not_live_stream zstd gzip

reverse_proxy @live_stream app:8080 {
	import app_upstream
	flush_interval -1
}

reverse_proxy @not_live_stream app:8080 {
	import app_upstream
}
```

The app writes `X-Accel-Buffering: no` on every stream and sends a comment line every 20 s, under Caddy's and the browsers' idle timeouts (`response_header_timeout` applies to the headers only, sent at once). `genome/test/ops/vps-stack.test.ts` checks the matcher pair, the single `encode`, the flush, and that the pattern matches exactly `LIVE_STREAM_ROUTES`, which in turn are exactly the routes the app registers ending in `/stream`. This change of the shared VPS's edge, with the silhouette's upload above, goes out with deployment D, proposed to the host's owner first ([its runbook](launch/DEPLOY-LIVE-RELEASE.md), §1.1). Check after the deployment: the board's stream answers `content-type: text/event-stream` without `content-encoding`, and its first event arrives at once (the runbook's §1.7).

**Repair forward: the decision of 2026-10-03 for the shared server.** This server is never restored from a backup (`restore.sh` refuses there, `RESTORE_ALLOWED=false`, §15.9), and a release that migrated is never undone by changing the image. This is a declared deviation from the rollback by restore that this runbook described until then (§12.2; COMPLIANCE §7, H3). The facts behind it:

- `scripts/db.ts migrate` applies all the pending migrations of a release in **one transaction**, under an advisory lock ([DATABASE §9.2](DATABASE.md#92-behaviour)). If one fails, none is applied, the schema stays as it was, and the automatic rollback to the previous image works.
- Once they have committed, an image that does not know them can no longer migrate: Kysely stops it with "previously executed migration … is missing". Before 2026-10-03, `deploy.sh` still tried to roll back in that case: it stopped the new app, wrote the old tag into `.env`, failed at the old image's migration step and left the site down. Its success message ("Manual rollback: `scripts/deploy.sh --image <previous>`") led to the same dead end, after a pre-deploy backup named after the old tag but holding the new schema.

What `deploy.sh` does now:

| Situation | What happens |
|---|---|
| A failure after the release's migrations committed (health, Caddy, the signing key, the smoke tests, the grants) | No rollback is attempted. `ORBES_IMAGE_TAG` stays on the new tag, the stack is started on it, and the message names the migrations and prints the way forward (below). `.state/deploys.log`: `deploy <tag> FAILED (…): kept, no rollback, repair forward`. |
| A failure after the migration step when that cannot be told: the applied migrations cannot be read (PostgreSQL down?) | Kept as above, never rolled back: the release may have migrated. |
| A failure, before or after the migration step, when the previous image does not know every migration of the database (e.g. the stack was down with `.env` still on an older tag), or the migrations it knows cannot be listed | Kept as above, never rolled back: the previous image may not run on this schema. The message says which it is. |
| A failure in a release without migrations, or whose migration failed, when the previous image knows every migration of the database | The automatic rollback to the previous image, as before. |
| Success, the release migrated | The message names the migrations and says that the previous image cannot run on this schema any more; it suggests no rollback (and `.state/previous-tag` is removed). |
| Success, but the applied migrations cannot be read afterwards | Whether the release migrated is unknown: the message says the schema could not be read and suggests no rollback (`.state/previous-tag` is removed); `.state/deploys.log`: `deploy <tag> OK (previous <tag>; schema not read)`. |
| Success, no migration, the previous image on the host and knowing every migration of the database | Unchanged: "Manual rollback: `scripts/deploy.sh --image <previous>`", also written to `.state/previous-tag`. This is the only case that writes the file. |
| Success, no migration, but the previous image does not know every migration of the database, or they cannot be listed; or no previous image (a first deployment, or the same image again) | No rollback is suggested and `.state/previous-tag` is removed: a hint left by an earlier deployment never survives a release after which it could not be followed. A release that is kept (above) removes it too. |
| `scripts/deploy.sh --image <tag>` (or a build of an older ref) whose image does not know every migration applied in the database | Refused before the pre-deploy backup and with nothing stopped: "this image cannot run on this schema: repair forward", with the migrations it does not know. No misleading backup is written. |

**The way forward**, printed by `deploy.sh` whenever it applies:

1. After a transient incident (network, a full disk, a service briefly down): fix it, then `scripts/deploy.sh --image <the new tag>` (the same image again: it knows the schema).
2. Otherwise: a corrective commit, deployed normally (`git pull && scripts/deploy.sh`).
3. Never `restore.sh` on the shared server. A restore, and the quarterly restore drill, run on a separate, disposable server (§15.9).

Rolling back to an image still on the host (`scripts/deploy.sh --image <tag>`, tags in `.state/deploys.log`, `docker images orbes-genome`) therefore works only while no migration has run since that image: the script checks it first.

**Old images.** Remove them by exact tag, keeping the current image and the previous one (the rollback target of a release without migration):

```bash
docker images orbes-genome                 # the tags on the host; the current one is ORBES_IMAGE_TAG in .env
docker image rm orbes-genome:<tag>         # one old tag at a time
```

Never run `docker image prune`, `docker system prune` or `docker volume prune` on the shared host. A bare `docker image prune` deletes the dangling images of the other stacks on the same Docker daemon, and does not even remove old `orbes-genome` tags. With `-a` or `--volumes`, and the stack stopped, they delete the rollback images, the database and the signing keys (COMPLIANCE §7, house rules).

**Before a deployment on the shared server** (lots with migrations above all, such as deployment 2 with migrations `0004`–`0013`; its step-by-step runbook, in French, with the expected output of each command: [DEPLOY-RECOMMANDATIONS-2026-10](launch/DEPLOY-RECOMMANDATIONS-2026-10.md); the « Potentiel » lot of 2026-10-03, deployment A with migrations `0014`–`0018` (done on 2026-10-04) and deployment B+C (stages B and C combined) with `0019` and `0020`, has its own: [DEPLOY-POTENTIEL-2026-10](launch/DEPLOY-POTENTIEL-2026-10.md); and so has the LIVE RELEASE, deployment D with migration `0021` and its change of the edge: [DEPLOY-LIVE-RELEASE](launch/DEPLOY-LIVE-RELEASE.md) (done on 2026-10-05); and LIVE RELEASE+, deployment E with migrations `0022` and `0023`, no change of the host: [DEPLOY-LIVE-RELEASE-PLUS](launch/DEPLOY-LIVE-RELEASE-PLUS.md); and NOCTURNE, deployment F with migration `0024`, no change of the host, after the owner's OK on the board of the 43 screens: [DEPLOY-NOCTURNE](launch/DEPLOY-NOCTURNE.md)):

1. Not between 03:00 and 05:30 UTC (the nightly backups of the host). Tell the host owner first.
2. Check `.env`: `RESTORE_ALLOWED=false` (add the line if it is missing; deployment 2 adds it), and nothing exported in the shell (`env | grep -E '^(ORBES_IMAGE_TAG|COMPOSE_PROJECT_NAME)='` prints nothing).
3. The pre-check, run and kept before and after the deployment:
   ```bash
   free -h
   docker stats --no-stream
   df -h /
   du -sh /var/backups/orbes
   ```
   Above the thresholds of §15.12 (75 % of `/`), talk to the host owner before deploying.
4. `umask 022`, then `git pull && scripts/deploy.sh`. After the deployment, the smoke tests of §13 and the next nightly `photos:` line (§15.12).

Operating system updates arrive through unattended-upgrades (`live-restore` keeps containers running across a Docker daemon restart). Rebuild regularly for `node:22-slim` security patches, even without code changes: `scripts/deploy.sh --rebuild` (same commit, `docker build --pull`, new tag `<commit>-r<time>`, so the previous image stays available for rollback).

### 15.8 Backups

**What and how** (`scripts/backup.sh`, nightly via `orbes-backup.timer`, and before every deploy):

Every run starts by logging a line `photos: <count>, <size> MB`, before the dump, printed even with `--quiet` and also with `--dry-run`: the photographs of the catalogue and of the pieces (F-04), of the lookbook's galleries (P-R02) and of the circle's posts (P-X01), stored in the database and so in every archive. It reads `photos: 0, 0.0 MB` before migration `0012` creates their table; when they cannot be read, a warning says `photos: unknown` and the backup goes on. The thresholds that watch it: §15.12. Then:

1. `pg_dump --format=custom` from the `postgres` container (first), checked with `pg_restore --list`;
2. a tar of the `keys` volume (the key files stay AES-GCM-encrypted under `KEY_ENCRYPTION_KEY`, which is **not** in the backup);
3. `manifest.json` (time, reason, image, schema migrations, key ids and status, SHA-256 of both parts);
4. one tar of the three, **encrypted with age** to every public key in `BACKUP_AGE_RECIPIENTS_FILE`, written to `/var/backups/orbes/daily/orbes-<UTC time>[-<reason>].tar.age` plus a `.sha256` file. The bytes on disk are re-read and compared with the bytes streamed, and the age header and recipient count are checked;
5. retention: the newest `BACKUP_KEEP_DAILY` (14) archives in `daily/`, and the first archive of each ISO week hard-linked into `weekly/` (newest `BACKUP_KEEP_WEEKLY`, 8). Scheduled archives (nightly) and event archives (`pre-deploy-*`, `pre-restore`, `post-rotation`, other `--reason` values) are counted separately, so a day with many deployments never pushes the nightly history out. Event archives come at no fixed pace, so they are also bounded by age: none is kept, in `daily/` or `weekly/` (a weekly copy whose first archive of the week was an event archive counts as one), beyond `BACKUP_KEEP_WEEKLY` × 7 + 7 days (63), the age of the oldest weekly copy. No archive is therefore kept longer than about two months, as the privacy policy says (`/legal/privacy`, "How long it is kept");
6. optional off-site copy with rclone (below).

The server holds only the public key: it **cannot decrypt its own backups**, and a stolen backup is useless without the offline identity. The plaintext dump exists only in a `0700` work directory under `/var/backups/orbes` while the backup runs (removed on exit, also on failure). `--verify-identity <file>` additionally decrypts the new archive and compares checksums (restore drills; do not leave the identity on the server). Check freshness with `cat .state/last-backup`, `systemctl list-timers 'orbes-*'` and `journalctl -u orbes-backup`.

**Off-site copy to OVH Object Storage (S3-compatible).**

1. In the OVHcloud Control Panel, open (or create) a **Public Cloud** project → *Object Storage* → create an **S3 API** object container (bucket), e.g. `orbes-backups`, in an EU region, **private**. If offered, enable **versioning and Object Lock** at creation: a compromised server then cannot destroy older backups.
2. *Users & Roles* (Object Storage users) → create a user with the Object Storage operator role, then generate its **S3 credentials** (access key + secret key). Prefer a user dedicated to backups.
3. The container's page shows its **S3 endpoint**; for the Standard storage class it has the form `https://s3.<region>.io.cloud.ovh.net` (`<region>` in lower case, as shown in the Control Panel). Use the value shown there.
4. As `orbes`, configure rclone (`rclone config`, or write `~/.config/rclone/rclone.conf`, mode 0600):
   ```ini
   [ovh-s3]
   type = s3
   provider = Other
   env_auth = false
   access_key_id = <access key>
   secret_access_key = <secret key>
   region = <region>
   endpoint = https://s3.<region>.io.cloud.ovh.net
   acl = private
   ```
   Check with `rclone lsd ovh-s3:` (the bucket is listed) and `rclone ls ovh-s3:orbes-backups`.
5. In `.env`: `BACKUP_RCLONE_DEST=ovh-s3:orbes-backups/verify`. The next backup copies the local archives missing remotely into `…/daily` and `…/weekly` (copy, never sync), checks the new one, and deletes remote copies older than the remote retention age (`--min-age`): `BACKUP_KEEP_DAILY` + 1 days in `daily/` (15 by default), `BACKUP_KEEP_WEEKLY` × 7 + 7 days in `weekly/` (63). Only archives **younger** than that age are copied (`--max-age`): event archives (`pre-deploy-*`…) stay locally up to 63 days (by count, then by age, item 5 above), so one older than 15 days would otherwise be sent again every night, then deleted again. With Object Lock, those deletions are refused until the lock expires (logged as a warning): set the bucket's retention accordingly.

### 15.9 Restore and the restore drill

**Never on the shared production server (owner decision of 2026-10-03).** Its `.env` holds `RESTORE_ALLOWED=false`, and `restore.sh` then refuses before doing anything, `--dry-run` included, with this decision and the way forward. Problems there are repaired forward (§15.7): `scripts/deploy.sh --image <current tag>` after a transient incident, otherwise a corrective commit. Restores, and the restore drill below, run only on a **separate, disposable server**, where `RESTORE_ALLOWED` keeps its default, `true` (`.env.example`). The value is read from the stack's own `.env` (`deploy/vps/.env`), and also from the file `ORBES_STACK_ENV_FILE` names when that variable is exported (the scripts' tests use it; never on the server): either one saying `false` refuses, so neither exporting `RESTORE_ALLOWED=true` in the shell nor pointing the scripts at a copy of `.env` lifts it, and any value other than `true` or `false` is refused. No script calls `restore.sh`, and `deploy.sh` never suggests it. This replaces the rollback by restore described until then (§12.2): a declared deviation, COMPLIANCE §7 (H3). The pre-deploy and nightly backups are still taken: they feed the drill, a move to another server (COMPLIANCE §7, H1), and the investigation of an incident.

`scripts/restore.sh --identity <age identity file> (--archive <file> | --latest) [--db-only | --keys-only] [--yes] [--dry-run]`:

1. checks the `.sha256` file, decrypts, verifies the manifest checksums, `pg_restore --list` and `tar -t` (`--dry-run` stops here and prints the manifest). `--latest` takes the newest archive **except** the `pre-restore` safety backups this script writes itself, so running the same restore twice never restores the state that was being replaced (restore those by `--archive` only);
2. asks you to **type the domain** (or `--yes`);
3. takes a safety backup of the current state when PostgreSQL is running;
4. stops the app; **recreates the `pgdata` volume**, creates the app role, and restores into the empty database as the owner (`--exit-on-error --single-transaction --no-privileges`; the append-only audit log makes restoring over existing data impossible by design), then grants the app role its DML rights; **empties the `keys` volume** and extracts the key files (owner 1000, `0700`/`0600`);
5. starts the stack if the image exists (otherwise run `scripts/deploy.sh`): migrations of that image first (an older archive), then waits for health, checks `/api/v1/health` through Caddy and lists the signing keys.

The restored stack needs the **same `KEY_ENCRYPTION_KEY`** as the backup (from escrow); with another one the key files cannot be decrypted (verification still works, issuance does not, §7.3).

**Restore drill (quarterly, on a separate, disposable VPS, never the production server):**

```bash
# New VPS: §15.4 step 1, then as orbes, BEFORE setup: put the escrowed secrets into .env
cd /opt/orbes/orbes-index/deploy/vps && cp .env.example .env && chmod 600 .env
#   edit .env: KEY_ENCRYPTION_KEY, COOKIE_SECRET, IP_HASH_PEPPER from escrow; APP_DOMAIN of the drill host
scripts/setup.sh --no-deploy --domain <drill host> --acme-email <e-mail> --age-recipient <your age public key>
rclone copy ovh-s3:orbes-backups/verify/daily /var/backups/orbes/daily --max-age 2d   # or scp an archive
install -m 600 /dev/stdin /dev/shm/orbes.agekey      # paste the identity, Ctrl-D (RAM only)
scripts/restore.sh --identity /dev/shm/orbes.agekey --latest --yes
scripts/deploy.sh --no-backup                         # builds and starts the app (no new key: one is ACTIVE)
shred -u /dev/shm/orbes.agekey
```

Then: `docker compose exec app npm run keys:list` shows the same key ids and fingerprints as the register; `npm run keys:generate` answers "already ACTIVE; nothing to do" (the restored key file decrypts and signs); a code issued before the backup verifies **AUTHENTIC** (`POST /api/v1/verify`); compare `GET /api/admin/audit/verify` with the last exported anchor (§10).

### 15.10 The Vercel redirect

`vercel.json` at the repository root contains **only** two redirects (checked by `genome/test/ops/vps-stack.test.ts`; `.vercelignore` keeps `genome/`, `docs/`, `deploy/`, `.github/` and `node_modules/` off the website):

```json
{ "redirects": [
  { "source": "/verify",        "destination": "https://verify.theorbes.com/verify",        "statusCode": 307 },
  { "source": "/verify/:path*", "destination": "https://verify.theorbes.com/verify/:path*", "statusCode": 307 } ] }
```

- `https://theorbes.com/verify` and everything below it answer **307** with `Location: https://verify.theorbes.com/verify…` (path kept). Every other URL of `theorbes.com`, including `/`, is served exactly as before.
- **307 (temporary)** on purpose: browsers do not cache it permanently, so the target can still change. Once the service's address is final, switching to `308` (permanent) is a one-line change.
- Printed material and QR codes may therefore point at either `https://theorbes.com/verify` (one extra hop) or `https://verify.theorbes.com/verify` (direct).
- After the Vercel deployment, check: `curl -sI https://theorbes.com/verify/x | grep -i -E '^(HTTP|location)'` → `307` and `location: https://verify.theorbes.com/verify/x`; and that a query string survives the hop (`curl -sI 'https://theorbes.com/verify?ref=qr'`).

### 15.11 Optional: Cloudflare in front

Not the default (§15 decision), but supported. Behind Cloudflare's proxy every request reaches the VPS from a Cloudflare address, so the stack must trust Cloudflare, and only Cloudflare:

1. Put only the `verify` record behind the proxy (orange cloud); `theorbes.com` itself stays on Vercel (DNS-only records). This requires the zone to be on Cloudflare.
2. Obtain the certificate before enabling the proxy (record DNS-only, run `setup.sh`), then enable the proxy with SSL/TLS mode **Full (strict)**. If a renewal later fails behind the proxy, use a Cloudflare Origin CA certificate or a DNS challenge (a Caddy build with the Cloudflare DNS module); `docker compose logs caddy` shows the reason.
3. In `.env`: `EDGE_MODE=cloudflare` (Caddy trusts the ranges of `caddy.d/edge-cloudflare.caddy`, reads the client IP from `CF-Connecting-IP`, and answers **403 to any public peer that is not Cloudflare**); keep `GEO_MODE=mmdb` (it now sees the real client IP) or set `GEO_MODE=cloudflare` to use Cloudflare's `cf-ipcountry`/coordinates headers. Then `scripts/deploy.sh`.
4. **Re-check the ranges** in `caddy.d/edge-cloudflare.caddy` against <https://www.cloudflare.com/ips/> when enabling the mode, and yearly.
5. Lock the origin at the network level too: since Docker-published ports bypass ufw, use OVH's Edge Network Firewall (§15.3) to allow 80/443 only from Cloudflare's ranges.

The app's `TRUST_PROXY` stays Caddy's address in both modes: Caddy always hands the app exactly one `X-Forwarded-For` entry, the client IP it determined.

### 15.12 Monitoring and routine checks

| What | How |
|---|---|
| Availability | An external uptime checker (any HTTP monitor) on `https://verify.theorbes.com/api/v1/health`, every 1–5 min, expecting `200` and `"ok":true` (a `503` means the database is unreachable). Alert after 2 failures. |
| Containers | `docker compose ps` (all `healthy`); `docker compose logs --since 1h app | grep '"level":50'` for errors; the alert list of §9.3 applies. |
| Disk | `df -h / /var/lib/docker /var/backups/orbes` weekly, or the uptime checker's agent; on the shared server, the thresholds below (75 %: talk to the host owner; alert at 80 %). Logs are capped (json-file 10 MB × 5 per container). Old images: by exact tag (§15.7), never `docker image prune`. |
| Backups | `cat deploy/vps/.state/last-backup` younger than 26 h; `journalctl -u orbes-backup --since yesterday`; the off-site bucket lists the latest archive. Restore drill quarterly (§15.9). |
| Certificates | Automatic: Caddy renews well before expiry (about a third of the lifetime remaining). `docker compose logs caddy | grep -i certificate` shows renewals; an uptime checker that reports certificate expiry is a cheap extra alarm. |
| GeoIP | `journalctl -u orbes-geoip`; `scripts/geoip-update.sh --check`. |
| Clock | `timedatectl` → synchronized. |
| Security updates | `/var/log/unattended-upgrades/`; `cat /var/run/reboot-required` after kernel updates (or `--auto-reboot`). |

**Key rotation and compromise:** the runbooks of §7.4 and §7.5 apply unchanged; run their commands from `deploy/vps` as `orbes` (`docker compose exec app npm run keys:rotate`, `docker compose exec app node --import tsx scripts/keys.ts revoke …`). Back up right after any rotation: `scripts/backup.sh --reason post-rotation`. On suspicion of a host compromise also rotate `POSTGRES_PASSWORD`, `COOKIE_SECRET` (§4.3) and the backup age key (new key pair; re-encrypting old archives is not needed, but they stay readable with the old identity).

#### Disk used by the photographs (F-04, P-R02, P-X01)

**The decision (2026-10-03): the photographs stay as they are**, 2 000 px at most on the longer side and 1 MB at most (the console's re-encoding, [API §13.4](API.md#134-models)), **and the disk is watched**, as follows. From the « Potentiel » deployment A there are more of them: up to 8 in each model's lookbook gallery (P-R02) and up to 4 in each post of the owners' circle (P-X01), each at most 1 MB and copied into every archive.

**Where they are.** In the database: the `bytea` column of `media_objects` ([DATABASE §5.26](DATABASE.md#526-media_objects)), inside the `orbes_pgdata` volume. They are therefore in every `pg_dump`, so in **every** backup archive, and a JPEG or WebP does not compress any further. With `P` the size of the photographs in use and `A` the number of archives kept in `/var/backups/orbes` (14 nightly + up to 14 event archives + the weekly copies that are no longer hard links to a daily one: about 20 to 35), the photographs take about **P × (1 + A)** of the disk: 300 MB of photographs with 30 archives is about 9.3 GB. On the shared server, the database and the archives are both on `/`.

**The nightly line.** Every run of `backup.sh` logs `photos: <count>, <size> MB` (MB = 1 048 576 bytes; §15.8):

```bash
journalctl -u orbes-backup --since yesterday | grep 'photos:'      # last night
journalctl -u orbes-backup | grep 'photos:' | tail -n 30           # the trend
```

**The queries** (from `deploy/vps`, as `orbes`): the photographs in use, the table on disk, the orphans (a photograph no model, gallery, circle post or piece uses: normally none, the service deletes it at once; a few left by an interrupted request are harmless, a growing number is a bug to report), and the largest ones:

```bash
docker compose exec -T postgres sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
-- P: the photographs, their count and size in MB (1 048 576 bytes), as the backup's photos: line
SELECT count(*) AS photos, round(coalesce(sum(octet_length(bytes)), 0) / 1048576.0, 1) AS mb FROM media_objects;
-- the table on disk, TOAST and indexes included
SELECT pg_size_pretty(pg_total_relation_size('media_objects')) AS on_disk;
-- orphans: used by no model, no gallery, no circle post and no piece (before migrations 0014 and 0016, drop their lines)
SELECT count(*) AS orphans, round(coalesce(sum(octet_length(m.bytes)), 0) / 1048576.0, 1) AS mb
  FROM media_objects m
 WHERE NOT EXISTS (SELECT 1 FROM models WHERE image_sha256 = m.sha256)
   AND NOT EXISTS (SELECT 1 FROM model_images WHERE sha256 = m.sha256)
   AND NOT EXISTS (SELECT 1 FROM circle_post_images WHERE sha256 = m.sha256)
   AND NOT EXISTS (SELECT 1 FROM products WHERE photo_sha256 = m.sha256);
-- the ten largest
SELECT sha256, mime, width, height, octet_length(bytes) AS bytes, created_at
  FROM media_objects ORDER BY octet_length(bytes) DESC LIMIT 10;
SQL
du -sh /var/backups/orbes; df -h /
```

**Thresholds, agreed with the host owner** (a full `/` also stops the other stacks of the shared server: their fate is shared):

| Threshold | Action |
|---|---|
| `/` above **75 %**, or the photographs above **300 MB** | Tell the host owner **before** acting, and choose one lever together: fewer local nightly archives (`BACKUP_KEEP_DAILY`); the photographs out of the frequent `pg_dump`, backed up once (they are content-addressed and never change; a code change); the off-site copy switched on (`BACKUP_RCLONE_DEST`, §15.8), then fewer local copies; smaller photographs (a code change). |
| `/` above **80 %** | Alert. The host owner adds a disk alert of its own on the host. |

Before and after each deployment, the pre-check of §15.7 (`free -h`, `docker stats --no-stream`, `df -h /`, `du -sh /var/backups/orbes`) keeps the before and after figures.

### 15.13 How this stack was validated

Last full run: 2026-10-01, in a sandbox (Docker 29.6, Compose 5.3, `caddy:2` = 2.11.4, `postgres:17`, `node:22-slim`; the VPS itself simulated by `ubuntu:26.04` = 26.04.1 "resolute" containers). Not exercised there: a real Let's Encrypt issuance (no public DNS), arm64 hardware, and `geoip-update.sh` downloading by itself (the sandbox containers have no direct internet; the same file was fetched on the host and installed with `--from-file`, which runs the same validation).

| Area | What was run | Result |
|---|---|---|
| Scripts | `shellcheck -x -S style` (0.11) on every script; `--help` on each | clean; exit 0 |
| Bootstrap | `bootstrap-ubuntu.sh --dry-run` in `ubuntu:26.04` | codename/arch detected (`resolute`/`amd64`); Docker's repository publishes `resolute` for amd64 and arm64 → `docker-ce` + plugins; an unknown codename (404) or no download tool → Ubuntu's `docker.io` 29.1 / `docker-compose-v2` 2.40 / `docker-buildx`; `--docker-source ubuntu` forces the fallback; extra sshd ports kept open in ufw and fail2ban; swap planned only with RAM < 2 GB |
| SSH hardening | `--harden-ssh` with no `authorized_keys`, an empty or invalid one, a locked password without `NOPASSWD` | refused each time (exit 1); accepted with a valid key and working sudo; the drop-in passes `sshd -t` and wins over `50-cloud-init.conf` (`sshd -T`: `permitrootlogin no`, `passwordauthentication no`) |
| systemd | `systemd-analyze verify` (systemd 259) on the rendered units; `systemd-analyze calendar` | clean; backup daily 03:17, GeoIP Mondays 04:41 |
| setup.sh | fresh `.env`, rerun, as root | secrets generated (KEK 43 chars), `.env` 0600; rerun keeps every secret; the age identity is printed once, matches the stored recipient and is written nowhere; root refused |
| Stack | `setup.sh --tls-internal` then `deploy.sh` (`APP_DOMAIN=verify.orbes.test`, `curl --resolve`) | build, migrations, first key (`keys:generate`), smoke tests (health, keys document, `/verify`) green in ~50 s; HTTP → HTTPS 308; HSTS/CSP from the app only, no `Server` header |
| Update + rollback | `deploy.sh` on a new commit (pre-deploy backup, off-site copy); `deploy.sh --image <crash-looping image>` | deployed; the broken release was detected (crash loop) and rolled back automatically to the previous tag, stack healthy, exit 1 |
| Verification | demo dataset (`db.ts seed`, one-off non-production run), codes from `export-demo-codes.ts`; a product issued through the admin API via Caddy (password + TOTP enrolled with `admin.ts`, CSRF) | `POST /api/v1/verify` through Caddy: AUTHENTIC, AUTHENTIC_REGISTERED, REVOKED as expected; the newly issued code AUTHENTIC |
| Client IP | `X-Forwarded-For` (single, chain), `X-Real-IP`, `Forwarded`, `CF-Connecting-IP`, `True-Client-IP`, `CF-IPCountry` sent by the client, in `EDGE_MODE=direct` and `cloudflare` | the stored IP pseudonym stayed the HMAC of the real peer address and the rate-limit bucket kept counting down; no country from the forged `8.8.8.8` although the loaded GeoIP file maps it to US; a second client got its own pseudonym |
| Edge | access log; 70 KB body; `ADMIN_ALLOWED_IPS`; `caddy validate` in acme/internal × direct/cloudflare | no query string, cookie, header or full IP in Caddy's log; 413; `/admin*` and `/api/admin*` 403 outside the list (forged XFF does not help), `/verify` unaffected; all valid |
| Backups | `backup.sh` (incl. `--verify-identity`, retention with `BACKUP_KEEP_DAILY=2`, rclone copy/check to a test remote, `--dry-run`) | archives written and re-read, full decryption check OK, pruning and weekly hard link as designed, remote copy checked |
| Restore | `docker compose down -v` (every volume deleted), archive fetched back from the remote, `restore.sh --identity … --yes` (after `--dry-run`, a wrong identity and a non-interactive run without `--yes`, all refused) | stack healthy in 20 s; row counts, key registry and key file (SHA-256, mode 0600, owner 1000) identical; a code issued before the backup AUTHENTIC, one issued after it UNKNOWN; `keys:generate` → "already ACTIVE"; a new product issued with the restored key verified AUTHENTIC; admin TOTP still valid; audit chain verified |
| Adversarial review (2026-10-01, same sandbox) | Isolated Caddy harness (the real `Caddyfile`, an echo upstream, a "public" `198.51.100.0/24` network): forged `X-Forwarded-For`/`X-Real-IP`/`Forwarded`/`CF-*`/`True-Client-IP`, duplicate XFF headers; 18 `/admin` path variants (`/ADMIN`, `//admin`, `/%61dmin`, `/x/../admin`, `/api//admin/…`, `%2f`, `;`, `%00`, `\`); Cloudflare mode with a trusted and an untrusted public peer; an upstream outage; `ADMIN_ALLOWED_IPS` with a comma | the upstream always receives exactly the peer address; every variant the app would route is 403 (the rest are 404 in the app: checked with Fastify's router); Cloudflare mode: 403 for the untrusted peer, `CF-Connecting-IP` honoured for the trusted one; **fixed**: the error log (`http.log.error`, a 502) carried the full IP, query string and headers: the runtime log is now filtered like the access log; **fixed**: a comma crash-looped Caddy (the whole site): `deploy.sh` now validates first |
| Least-privilege database (2026-10-01) | Stack redeployed with the two roles (`setup.sh`, `deploy.sh`); as the app role: `SET session_replication_role`, `COPY … TO PROGRAM`, `DELETE`/`TRUNCATE audit_logs`, `ALTER TABLE … DISABLE TRIGGER`, `CREATE TABLE` | all refused (with the former superuser connection, `SET session_replication_role = replica` let a `DELETE` empty `audit_logs` (rolled back) and `COPY … TO PROGRAM` ran a shell command in the database container); issuance, verification, TOTP login, key generation, audit verify all work under the app role |
| Full drill (2026-10-01) | backup (`--verify-identity`, off-site copy) → `down -v`, local archives, image and `.state` deleted → archive fetched back with rclone → `restore.sh --latest --yes` → `deploy.sh` (rebuild) → second `restore.sh` with the image present; `deploy.sh --image <crash-looping image>`; 5 backups with `BACKUP_KEEP_DAILY=2` | counts, key file (SHA-256, 0600, uid 1000) identical; pre-backup code AUTHENTIC, post-backup code UNKNOWN; TOTP login; audit chain verified; new issuance with the restored key AUTHENTIC; `keys:generate` "already ACTIVE"; `--latest` skipped the newer `pre-restore` safety archive; crash loop rolled back with migrations run as the owner each way; 2 nightly + 2 event archives kept; a scan from a GB address with a forged JP `X-Forwarded-For`/`CF-IPCountry` stored `GB 51.5/-0.1` and only the IP hash; Caddy log `81.2.69.0`; no password in any log, image history or config |

`genome/test/ops/vps-stack.test.ts` guards the static properties (vercel.json, compose isolation and hardening, TRUST_PROXY pinning, Caddyfile client-IP and log rules, scripts, timers) in CI. `genome/test/ops/vps-scripts.test.ts` runs `deploy.sh`, `backup.sh` and `restore.sh` themselves in CI, against a fake Docker host (`genome/test/ops/fake-host/`: `docker`, `curl`, `age`, `rclone` stand-ins that keep Kysely's refusal of an unknown migration and the app's refusal of a pending one): every branch of the repair-forward rule of §15.7 (a failure after the migrations in health, Caddy, the signing key, the smoke tests or the grants; a failure when the applied migrations cannot be read after the migration step, or, before or after it, when the previous image does not know them all or its migrations cannot be listed; a release without migration; a failed migration; success with and without migrations, when the schema cannot be read afterwards and when the previous image cannot run on the schema; the rollback hint `.state/previous-tag` removed by a kept release, its retry and a first deployment; `--image` of an image that cannot run on the schema, the stack up or down; an unreadable schema at the check; a first deployment), the shared-host guard of the three scripts, `RESTORE_ALLOWED` (from the stack's `.env` and from `ORBES_STACK_ENV_FILE`), the off-site ages, the age bound of event archives and the `photos:` line; the SQL of `lib.sh` and of §15.12 runs on the migrated schema (PGlite), `lib.sh`'s image probe (`IMAGE_MIGRATIONS_JS`) runs under Node, and, in CI (PostgreSQL 16 and its `psql`), the exact psql lines of `db_applied_migrations` and `db_photo_usage` (`\gset`, `\if`, `\else`) run in a real `psql` against an empty database, one at deployment 1's schema and one fully migrated (the production stack's `psql` is 17's, from `postgres:17`). The CI `image` job also runs that exact probe in the image it builds (`docker run --network none … orbes-genome:ci`), which must list every migration of the sources.
