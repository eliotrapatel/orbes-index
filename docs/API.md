# ORBES GENOME CODE™ — HTTP API

Status: v0.1. This document describes the implementation; where it and the code disagree, the code wins and this document is wrong.

Implementation:

- `genome/src/server/app.ts` (application, body parsing, plugin order)
- `genome/src/server/http/*.ts` (security headers, sessions, CSRF, roles, rate limits, device cookie, error mapping, request schemas)
- `genome/src/server/routes/**/*.ts` (endpoints)
- `genome/src/server/services/verification.ts` (`VerifyOutcome`, decision procedure) and `services/copy.ts` (public wording)
- Tests with real requests and responses: `genome/test/api/*.test.ts`
- Contract: `genome/PLATFORM-CONTRACTS.md` §3

Related documents: [DATABASE](DATABASE.md) · [CRYPTOGRAPHY](CRYPTOGRAPHY.md) · [ORBES-CODE-SPEC](ORBES-CODE-SPEC.md) · [SECURITY-MODEL](SECURITY-MODEL.md)

> **What a verification proves.** A successful result proves that ORBES issued and signed the scanned code, and reports what the ORBES registry knows about it (lifecycle status, ownership, warranty, scan history). It does **not** prove that the physical object carrying the code is genuine: a printed code can be copied. The public wording never claims otherwise.

---

## Contents

1. [Overview](#1-overview)
2. [Authentication, CSRF and roles](#2-authentication-csrf-and-roles)
3. [Rate limiting](#3-rate-limiting)
4. [Device cookie and request metadata](#4-device-cookie-and-request-metadata)
5. [Errors](#5-errors)
6. [Pagination](#6-pagination)
7. [Endpoint index](#7-endpoint-index)
8. [Public endpoints](#8-public-endpoints)
9. [Verification: `POST /api/v1/verify`](#9-verification-post-apiv1verify)
10. [Account endpoints](#10-account-endpoints)
11. [Ownership endpoints](#11-ownership-endpoints)
12. [Admin: authentication](#12-admin-authentication)
13. [Admin: dashboard and catalogue](#13-admin-dashboard-and-catalogue)
14. [Admin: products and lifecycle](#14-admin-products-and-lifecycle)
15. [Admin: codes and artifacts](#15-admin-codes-and-artifacts)
16. [Admin: registries, anomalies, revocations and cases](#16-admin-registries-anomalies-revocations-and-cases)
17. [Admin: keys, audit log and console users](#17-admin-keys-audit-log-and-console-users)
18. [Static web applications](#18-static-web-applications)
19. [Integration guide for resellers and third parties](#19-integration-guide-for-resellers-and-third-parties)

---

## 1. Overview

### 1.1 Base paths

The API is served from the deployment's public origin (`PUBLIC_ORIGIN`, e.g. `https://verify.theorbes.com`). `PUBLIC_ORIGIN` must be the **exact** origin users see in the address bar (scheme, host and port; no path, no trailing slash): it is compared byte for byte with the browser's `Origin` header (§2.2), so `https://theorbes.com` and `https://www.theorbes.com`, or an explicit `:443`, are different origins. Production requires `https://`.

| Prefix | Content |
|---|---|
| `/api/v1/…` | Public, customer account and ownership API |
| `/api/admin/…` | Staff console API |
| `/.well-known/orbes-keys.json` | Public signing keys (same body as `/api/v1/keys`) |
| `/`, `/verify`, `/admin`, `/legal`, `/legal/*`, `/assets/…` | Web applications (§18): the verification app, the console, the legal pages |

A production server answers only on an up-to-date database schema: it refuses to start with pending migrations unless started with `--migrate` (or `MIGRATE_ON_START=true`), or after `npm run db:migrate` ([DEPLOYMENT](DEPLOYMENT.md)). Development and test servers migrate on start.

### 1.2 Requests

- **JSON only.** Request bodies must be sent with `Content-Type: application/json` (a `charset` parameter is accepted). Any other content type, including `text/plain` and form encodings, is refused with `415 UNSUPPORTED_MEDIA_TYPE`. **One exception**: the photograph routes of the console (`POST /api/admin/models/:id/image` and `POST /api/admin/models/:id/gallery`, §13.4, and `POST /api/admin/products/:productId/photo`, §14.12) take the image itself, as `image/jpeg` or `image/webp`, and nothing else (`415`, "Send the image itself, as image/jpeg or image/webp (at most 1 MB)."); no other route accepts an image.
- **Body limit: 16 KB** (16 384 bytes). Larger bodies get `413 PAYLOAD_TOO_LARGE`. On the three photograph routes only, the limit is **1 MiB** (1 048 576 bytes).
- An empty body with `Content-Type: application/json` is treated as "no body". Routes without a body accept no body, an empty body or `{}`; any field is an unknown field.
- Invalid JSON, and JSON with `__proto__` or `constructor` keys, gets `400 INVALID_JSON`.
- Bodies are **strict**: unknown fields are rejected with `400 VALIDATION_FAILED` ("The request contains unknown fields: …"). Query strings tolerate unknown parameters but validate the values of known ones.
- Every string field is length-bounded. Free-text fields refuse control characters other than tab, line feed and carriage return. Admin forms may send `""` or `null` for an optional field; both mean "not given" unless stated otherwise.
- A trailing slash in the path is ignored. Path parameters are limited to 128 characters. URLs the router rejects (an over-long parameter, a broken percent-escape) answer `400 BAD_REQUEST` ("The request URL is invalid.") with the standard error shape and security headers; the URL is never echoed.
- The socket inactivity timeout and the time allowed to receive a complete request are both 30 seconds.
- Request ids are generated by the server; a client-supplied request id header is ignored.
- `GET` routes also answer `HEAD`, except the artifact download (§15.2). Unknown paths and unsupported methods answer `404 NOT_FOUND` (there is no `405`).

### 1.3 Responses

- JSON, UTF-8. Timestamps are ISO 8601 in UTC with milliseconds (`2026-10-01T08:15:21.929Z`). Calendar dates are `YYYY-MM-DD`, from year 0001: PostgreSQL has no year 0000, so a date or a date-time before `0001-01-01` (UTC) is `400 VALIDATION_FAILED`, never sent to the database. Identifiers are lower-case UUIDs. Products are identified by their canonical id (`O26-J-00184`).
- Wherever a path or body takes a product reference (`productId`), both the canonical id (case-insensitive) and the product's row UUID are accepted.
- API responses carry `Cache-Control: no-store` unless an endpoint states otherwise (the public keys, the categories, the contact of Client Services, the lookbook's lists and sheets of §8.8, cached 5 minutes, the releases of §8.9, cached a minute, and the photographs of §8.6, cached for a year as they never change).
- Security headers on every response include: the Content-Security-Policy `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, `Permissions-Policy: camera=(self)`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` (except the public key list), and in production `Strict-Transport-Security: max-age=63072000; includeSubDomains`. `X-Powered-By` is removed.
- No CORS headers are sent, except on the public key list (§8.2). Browser code on another origin can therefore only read the public keys.

---

## 2. Authentication, CSRF and roles

### 2.1 Cookies

| Cookie (development, test) | Production name | Set by | Purpose | Attributes |
|---|---|---|---|---|
| `orbes_session` | `__Host-orbes_session` | Account registration and login | Customer session | `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` in production, `Expires` = session expiry |
| `orbes_admin` | `__Host-orbes_admin` | Admin login, TOTP enrolment (new token) | Staff session; on `POST /api/v1/verify` it makes the scan a staff scan (§9.7) | same |
| `orbes_device` | `__Host-orbes_device` | `POST /api/v1/verify` | Pseudonymous device id for anomaly scoring (§4) | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, `Max-Age` 2 years, signed with `COOKIE_SECRET` |

- In production every cookie carries the `__Host-` prefix: browsers then accept it only with `Secure`, `Path=/` and no `Domain`, so a sibling subdomain or a plain-HTTP response can neither plant nor shadow it. An unprefixed `orbes_session` sent to a production server is ignored. The prefix needs HTTPS, hence the plain names in development and test.

- The session cookie holds a 32-byte random token (base64url). The server stores only its SHA-256.
- Sessions expire at an **absolute** time, without sliding renewal: `SESSION_TTL_ACCOUNT_HOURS` (default 720 h = 30 days, range 1–8760) and `SESSION_TTL_ADMIN_HOURS` (default 8 h, range 1–168).
- Every login issues a new token and deletes the session it replaces (session-fixation defence). So does the admin step-up to MFA: enrolling TOTP (§12.4) replaces the session by a new, MFA-passed one (new token, new CSRF token, same absolute expiry). At most 20 sessions per account or admin are kept; the oldest are deleted.
- An account cookie is never accepted as an admin session, and vice versa.
- When a request presents an expired or revoked session cookie, the response clears it.
- A session stops working as soon as its account is no longer `ACTIVE` or its admin is disabled; disabling an admin (§17.10) also deletes its sessions in the same transaction.
- A password change (§12.5) keeps the session that made it and deletes every other session of that admin.

### 2.2 CSRF protection

Applies to every **unsafe** request (any method other than `GET`, `HEAD`, `OPTIONS`) under the account, ownership, club (§10.9, §10.10) and admin routes:

1. **Origin rule.** The `Origin` header must equal `PUBLIC_ORIGIN` exactly (scheme, host and port). A request without `Origin` is accepted only with `Sec-Fetch-Site: same-origin`. `Origin: null`, look-alike hosts and `Sec-Fetch-Site: same-site` or `cross-site` are refused.
2. **Token rule.** When the request is authenticated by a session cookie, the header `x-csrf-token` must equal that session's CSRF token (compared in constant time). Tokens of other sessions are refused.

Failures answer `403 CSRF_FAILED`. Session-less mutations (account registration and login, the assisted account recovery of §10.8, a customer's report on a scan of §8.5, admin login, and logout without a session) apply the origin rule only. Public endpoints (`/api/v1/verify` and the `GET` endpoints of §8) need neither.

The CSRF token is returned by account registration and login (`csrfToken`), `GET /api/v1/account/session` (when signed in), `GET /api/v1/account/me`, admin login, `GET /api/admin/auth/me` and TOTP enrolment (`POST /api/admin/auth/totp/enable`, which issues a new session). It stays the same for the life of the session.

### 2.3 Admin roles

Roles are ranked **ADMIN > OPERATOR > AUDITOR > RETAIL = LOGISTICS**; a role may do everything a lower role may, with two exceptions: the **sale mode** (§16.18) names its roles, RETAIL, OPERATOR and ADMIN. Selling starts a warranty, a mutation, so the read-only AUDITOR does not sell, although it ranks above RETAIL. The **Logistics routes** (plan NEXT LOT §3.5, §16.33) name theirs too: `LOGISTICS_ACT` (LOGISTICS, OPERATOR, ADMIN) and `LOGISTICS_READ` (LOGISTICS, AUDITOR, OPERATOR, ADMIN).

| Role | May |
|---|---|
| RETAIL | A seller (A-08, migration 0008). The sale mode of a phone (§16.18: look a scanned piece up, start its warranty at a point of sale) and the list of points of sale it chooses from (`GET /api/admin/retailers`, §16.17). Manage its own session, password and second factor. **Nothing else**: no product, code, scan, owner, warranty list or dashboard, no download. |
| LOGISTICS | A person at the logistics agent (plan NEXT LOT §3.5.6.1, migration 0035), one login per person, with two-step verification as every console login. Tied on the Team page to the locations it works at (one or more, `admin_user_locations`): the Logistics routes that name it, for those locations only, every row of another location answering `404` as if it did not exist (never `403`, so other locations are not even confirmed to exist). Manage its own session, password and second factor. **Nothing else**: no points of sale, no sale mode, no owner, account, email, order page, release, setting, price or supplier order. |
| AUDITOR | Read every admin resource, with customers' emails masked (`j***@example.com`, §16.2), the list of points of sale included. Manage its own session, password and second factor. **Nothing it does changes the registry**: although ranked above RETAIL, it does not use the sale mode (`403 FORBIDDEN` on `/api/admin/sale/*`; the console shows it no Sale mode link). |
| OPERATOR | Additionally: every mutation not reserved to ADMIN (lifecycle transitions except to REVOKED and RETIRED, code re-issue, warranty activation, extension and voiding, service records, ownership confirmation, collections and models, created and edited (§13.3, §13.4), a model's lookbook, its place, address, story and specifications, and its gallery (§13.4; P-R02), its price and tier in the private salon (§13.4; P-X08), a model's reference photograph and the photograph of a piece, set and removed (§13.4, §14.12; F-04), the releases of the Club page, created, edited, published and cancelled, and their entries concluded, lapsed or offered to the waiting list (§16.19; P-R03; their early access, P-X02), the posts of the circle, created, edited, published and withdrawn, and their photographs (§16.20; P-X01), the words of the tiers' benefits (§16.21; P-X04), the requests of the private salon closed with a note (§16.22; P-X08), the LIVE RELEASES, created, edited, published and cancelled, their silhouette and their board's link, their live controls (pause, resume, extend, add pieces, free a hold, let a person in the line take their turn, host messages) (§16.23), the orders of every channel stepped (paid, shipped, delivered, cancelled, returned to stock), their terms, buyer and location entered and their piece picked from the stock, the atelier's stock counted and transferred, its minimums, the pieces to make started, finished and cancelled, and their work sheets (§16.24), anomaly triage) and **downloading code artifacts, print sheets (and their manifests) and certificate cards** (an artifact download is a `GET`, but it produces printable codes; a certificate card carries a claim code). Reads customers' emails in clear. |
| ADMIN | Additionally: issuance (the Generator, §14.2 and §14.11: one-offs such as samples, press pieces and replacements, ADMIN only since plan NEXT LOT §3.5.4.5, step 5.13; the stock's pieces come from the receptions, §16.33), categories, created, deactivated and activated again (§13.2), product revocation and retirement (transitions to REVOKED or RETIRED: both end the product's public validity, RETIRED is terminal) and reinstatement, code revocation, the revocation register, signing keys, console users (the console's Team page, §17.7–§17.13: list, create OPERATOR, AUDITOR, RETAIL and LOGISTICS accounts, change a role between OPERATOR, AUDITOR, RETAIL and LOGISTICS and a LOGISTICS login's locations, disable and enable, unlock, list and end sessions, reset a lost second factor), the register of points of sale (§16.17: create, rename, deactivate), a customer's one-time recovery code (§16.10), locking and unlocking a customer's account (§16.12) and the export of everything held about it (§16.13; a `GET`, but it hands over a customer's personal data), the draw of a release (§16.19; P-R03), a model discontinued and reinstated (§13.4; P-R06), a LIVE RELEASE ended now or an entry removed from it (§16.23), a returned order's piece archived (retired, §16.24), and the delays after which an order stands out as late, the stock locations and the carriers (§16.24). |

ADMIN accounts and the ADMIN role are given from the shell only (`scripts/admin.ts create --role ADMIN` and `role --role ADMIN`, [DEPLOYMENT §8.2](DEPLOYMENT.md#82-further-admins-lost-authenticators-scriptsadmints)), where the second factor is enrolled out of band (SECURITY-MODEL §3.3): no route grants ADMIN. An ADMIN cannot act on its own account through the Team routes (`409 SELF_ACTION`; the TOTP reset excepted), and no change may leave the console without an active ADMIN (`409 LAST_ADMIN`).

The default rule is AUDITOR for `GET`/`HEAD` and OPERATOR for other methods; the endpoint tables state every exception. RETAIL and LOGISTICS rank under that default, so they are refused everywhere except on the routes that declare them: for RETAIL, `/api/admin/sale/lookup` and `/api/admin/sale/activate` (which name their roles, `roles: RETAIL, OPERATOR, ADMIN`, so an AUDITOR is refused there) and `GET /api/admin/retailers` (`roles: RETAIL, AUDITOR, OPERATOR, ADMIN`, so that LOGISTICS, ranked with RETAIL, never reads them) (read only, a declared deviation: the sale screen lists the points of sale); for LOGISTICS, the Logistics routes that name it (§16.33); for both, their own session (`/api/admin/auth/logout`, `me`, `password`, `totp/setup`, `totp/enable`, `minRole: 'RETAIL'`; login takes no session). A role unknown to the server ranks 0 and is refused everywhere. Insufficient role: `403 FORBIDDEN` ("Your role does not allow this action."). No session: `401 UNAUTHORIZED`.

### 2.4 Admin MFA

When MFA is enforced, an admin session that has not passed TOTP may use **only** the `/api/admin/auth/*` routes (login, logout, me, password change, TOTP setup and enable); every other admin route answers `403 MFA_REQUIRED`. The password change is open to such a session only while the admin has no second factor (the temporary password is replaced before enrolment): once TOTP is enrolled, it too answers `403 MFA_REQUIRED` to a session that did not pass it, so a session opened with the password alone cannot replace the password of an enrolled admin and end the sessions that passed the factor. Enrolling ends every other session of the admin (§12.4). Enforcement is set by `ADMIN_REQUIRE_MFA` (default `true` in production, `false` otherwise); `ADMIN_REQUIRE_MFA=false` in production is accepted but logged as a warning at every start. A session passes MFA by logging in with a TOTP code, or by enrolling TOTP (§12.4), which replaces it by a new MFA-passed session. The `mfaRequired` and `mfaPassed` fields of the admin login and `me` responses report both facts.

**Temporary passwords.** A staff account created by an ADMIN (§17.8) signs in with a temporary password; its admin object then says `"passwordChangeRequired": true`. Until it has chosen its own password (§12.5), its session may use only logout, `me` and the password change: every other admin route, the TOTP routes included, answers `403 PASSWORD_CHANGE_REQUIRED`. This check runs before the MFA check, so a new staff member first replaces the password, then enrols a second factor when MFA is enforced.

### 2.5 Request pipeline

For every request, before the body is parsed: cookies are read, the client IP is pseudonymised, security headers are set, the rate limit of the route's group is applied, and then (account, ownership, club and admin routes) the session, CSRF, temporary-password, MFA and role checks run. Unauthenticated traffic is refused before any body work. The body is then parsed (≤ 16 KB, JSON; on the three photograph routes, the image itself, ≤ 1 MiB) and validated in the handler.

---

## 3. Rate limiting

Each route belongs to one **group**. All routes of a group draw from one per-client budget per 60-second window, so a client cannot spread guessing across, say, account login, registration and admin login.

| Group | Routes | Budget per minute (variable, default) |
|---|---|---|
| `verify` | `POST /api/v1/verify`, `POST /api/v1/reports`, `POST /api/v1/certificates/lookup` and `POST /api/v1/certificates/pdf` (the ownership certificate a link opens, §8.7), `POST /api/admin/sale/lookup` (the sale mode's judgement of a code, §16.18: never a faster way to judge codes than the public route) | `RATE_LIMIT_VERIFY_PER_MINUTE`, 60 |
| `auth` | `POST /api/v1/account/register`, `POST /api/v1/account/login`, `POST /api/v1/account/password`, `POST /api/v1/account/recover`, `POST /api/v1/ownership/register`, `POST /api/v1/ownership/transfers/accept`, `POST /api/v1/ownership/incidents/resolve`, `POST /api/admin/auth/login`, `POST /api/admin/auth/password`, `POST /api/admin/auth/totp/setup`, `POST /api/admin/auth/totp/enable` | `RATE_LIMIT_AUTH_PER_MINUTE`, 10 |
| `admin` | Every other `/api/admin/…` route | `RATE_LIMIT_ADMIN_PER_MINUTE`, 300 |
| `api` | Every other `/api/v1/…` route (the lookbook's, §8.8, the releases', §8.9, and the club's, §10.9 to §10.11, the circle's included), and `/.well-known/orbes-keys.json` | `RATE_LIMIT_API_PER_MINUTE`, 120 |
| `media` | `GET /api/v1/media/:sha256`, the photographs (§8.6; P-R02): a lookbook sheet shows up to nine, and the customers of a boutique share its address | 5 × the `api` budget (`MEDIA_RATE_FACTOR`, `http/rate-limit.ts`): 600 by default; no variable of its own |
| `live` | Every `/api/v1/live…` route, the LIVE RELEASES (§8.10, §10.12): two budgets at once, the network's first (wide enough for the collectors of a boutique who share its wifi during a release, each polling its room every 2 s while its stream is lost), then, once the session guard has found an account, the account's own (one account cannot spend its network's budget alone, whatever addresses it comes from; keyed by the peppered hash of its id) | Per network 10 × the `api` budget (`LIVE_NETWORK_RATE_FACTOR`): 1 200 by default; per account the `api` budget: 120; no variable of its own |

- Values accept integers 1–1 000 000; an unknown `RATE_LIMIT_*` variable is a configuration error. The `test` environment defaults to 10 000 per group.
- Clients are keyed by an HMAC of their IP address; IPv6 addresses are grouped per /64. The client IP honours `TRUST_PROXY`: list the addresses or ranges of your reverse proxies (e.g. `uniquelocal`, `10.0.0.0/8`, Cloudflare's published ranges). Without it, every client behind the proxy shares the proxy's budget. Production refuses `TRUST_PROXY=true` (the left-most `X-Forwarded-For` entry is written by the client, so limits and IP pseudonyms would be forgeable) and hop counts such as `1` (SECURITY-MODEL §4).
- Responses of rate-limited routes carry `x-ratelimit-limit`, `x-ratelimit-remaining` and `x-ratelimit-reset` (seconds). An exceeded budget answers `429 RATE_LIMITED` with `Retry-After` (seconds).
- The counters live in the server process. With several instances, each enforces its own budget; put a shared limiter at the edge for a global limit.
- Static web routes are not rate-limited by the application.
- Independently, claim-code attempts are limited per product (5 failures per rolling hour; §11.1), customer logins are throttled per account (10 wrong passwords in 15 minutes; §10.2, which a wrong current password of a password change also counts in, §10.7), recovery codes per account (5 failures per rolling hour; §10.8), and admin logins lock an admin after 10 consecutive failures (§12.1).

---

## 4. Device cookie and request metadata

`POST /api/v1/verify` issues an `orbes_device` cookie (`__Host-orbes_device` in production) when the client has none (or presents an invalid one): a random 128-bit id, signed with `COOKIE_SECRET`. A forged or truncated value is replaced, never trusted. The id is used only in anomaly scoring, as the source key of a scan that has no IP pseudonym: the rules count distinct sources — the IP pseudonym first, then this device id, then the session — because a client can drop its cookie at will.

What the server records about a verification request (see [DATABASE §5.16](DATABASE.md#516-scan_events)):

- `HMAC(IP_HASH_PEPPER, device id)`, `HMAC(IP_HASH_PEPPER, IP)` and, for a logged-in viewer, an HMAC of the session id. Raw IP addresses and device ids are never stored or logged. A staff scan (a request that carries a console session, §9.7) keeps only the IP pseudonym and names its console user instead.
- Country, and latitude/longitude rounded to 0.1° (about 10 km), only when supplied by the edge (`GEO_MODE=cloudflare`, which also gives a `region`) or a trusted proxy (`GEO_MODE=headers` with `TRUST_PROXY`), or looked up by the server in a local GeoIP database from `request.ip` (`GEO_MODE=mmdb`, DB-IP / MaxMind format at `GEO_MMDB_PATH`; no `region`; `TRUST_PROXY` required in production so that `request.ip` is the client's address, not the proxy's). The default `GEO_MODE=none` records no location.
- A coarse browser family such as `Safari/iOS`, never the full user-agent string.
- Optional decoder metrics sent by the client.

Request logs carry the method, the path without its query string and the request id; never the client IP, cookies, the CSRF header or `Set-Cookie` values.

---

## 5. Errors

### 5.1 Shape

Every error response has exactly this body, with no stack trace, SQL or internal status:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "displayName: At most 80 characters." } }
```

- `code` is stable and machine-readable (UPPER_SNAKE). Branch on it, not on `message`.
- `message` is written for end users. Validation messages name the field and the rule, never the submitted value.
- `401`, `403` and `5xx` responses carry `Cache-Control: no-store` (as do all API responses by default).
- While the server is shutting down (SIGTERM), requests that still arrive on open connections receive `503 SERVICE_UNAVAILABLE` in the same shape, with `Connection: close`; in-flight requests complete normally.

### 5.2 Error codes

Transport and framework:

| Code | HTTP | Meaning |
|---|---|---|
| `BAD_REQUEST` | 400 | Malformed URL, invalid `Content-Length` or another malformed request. |
| `INVALID_JSON` | 400 | The body is not valid JSON, or contains `__proto__` / `constructor` keys. |
| `VALIDATION_FAILED` | 400 | A field is missing, mistyped, out of range, unknown, or fails a business validation rule. |
| `NOT_FOUND` | 404 | Unknown route or method. |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 16 KB; on the photograph routes (§13.4, §14.12), over 1 MiB. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Body not sent as `application/json`; on the photograph routes, not sent as `image/jpeg` or `image/webp` (a JSON body included). |
| `RATE_LIMITED` | 429 | Rate limit exceeded (§3), too many claim-code attempts for a product, or a certificate request or batch of the same admin still in progress (§15.7, §14.11). |
| `INTERNAL_ERROR` | 500 | Unexpected failure. Details go to the server log only. |
| `SERVICE_UNAVAILABLE` | 503 | The server is shutting down; retry (another instance will answer). |

Authentication and authorisation:

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | No valid session for this scope. |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password. Identical for unknown emails (no account enumeration), and also the answer while a customer account is throttled after 10 wrong passwords in 15 minutes (§10.2). |
| `TOTP_REQUIRED` | 401 | Admin password correct, TOTP enrolled, no code sent. Not counted as a failure. |
| `INVALID_TOTP` | 401 | Wrong, expired or replayed TOTP code. |
| `CSRF_FAILED` | 403 | Origin or CSRF token check failed (§2.2). |
| `MFA_REQUIRED` | 403 | MFA enforced and the admin session has not passed TOTP (§2.4). |
| `PASSWORD_CHANGE_REQUIRED` | 403 | The admin signed in with a temporary password and must choose its own first (§2.4, §12.5). |
| `CURRENT_PASSWORD_INVALID` | 400 | (Password change, §10.7 and §12.5; PIECE FOUND, §11.6) the current password is wrong, or, for a customer, the account is throttled (§10.2). A 400, never a 401: the caller is signed in, and the web apps end the session on any 401. It counts as a failed sign-in: in the customer's login throttle (§10.2), in an admin's lockout (§12.1). |
| `FORBIDDEN` | 403 | Role too low; or a non-owner asking for a service history (also for an unknown product id, so ids cannot be enumerated); or an OPERATOR revoking or retiring a product; or an account that is not active. |
| `ACCOUNT_LOCKED` | 403 / 429 | 403: customer account LOCKED by ORBES Client Services (§16.12): after a correct password (§10.2), a correct recovery code (§10.8), or a password change, a transfer, a registration, a transfer's acceptance, a LOST / STOLEN declaration, the withdrawal of a loss, an ownership certificate's creation or a message to ORBES Client Services begun just before the lock (§10.7, §10.17, §11.1–§11.3, §11.5–§11.7). 429: admin locked for 15 minutes after 10 consecutive failures. |
| `RECOVERY_CODE_INVALID` | 400 | (§10.8) Unknown email, wrong, malformed, expired, used or replaced recovery code, or a code refused after 5 wrong guesses within the hour. One answer for all. |
| `ACCOUNT_NOT_FOUND` | 404 | (§16.10–16.13) No customer account with this id. |
| `ACCOUNT_NOT_ACTIVE` | 409 | (§16.10, §16.12) A recovery code is issued, and a lock applied, only for an ACTIVE account. |
| `ACCOUNT_ALREADY_LOCKED` | 409 | (§16.12) The account is already locked. |
| `ACCOUNT_NOT_LOCKED` | 409 | (§16.12) Unlocking an account that is not locked. |
| `EMAIL_TAKEN` | 409 | An account (or admin) with this email exists (case-insensitive). |
| `TOTP_CODE_INVALID` | 400 | The code sent to enable TOTP does not match the secret. |
| `TOTP_ALREADY_ENABLED` | 409 | TOTP is already enrolled for this admin. |
| `TOTP_NOT_ENABLED` | 409 | (TOTP reset) the admin has no second factor to remove. |
| `ADMIN_NOT_FOUND` | 404 | (Console users, §17.7–§17.13) no admin with this id. |
| `SELF_ACTION` | 409 | (Console users) an ADMIN cannot change the role of, disable, enable, unlock or end the sessions of its own account. |
| `LAST_ADMIN` | 409 | (Console users, `scripts/admin.ts`) the change would leave no active ADMIN: the last active ADMIN can be neither demoted nor disabled. |
| `TOTP_UNAVAILABLE` | 503 | The stored TOTP secret cannot be opened (key configuration changed or row tampered). Login fails closed. |

Points of sale and the sale mode (§16.17, §16.18):

| Code | HTTP | Meaning |
|---|---|---|
| `RETAILER_NOT_FOUND` | 404 | No point of sale with this id (warranty activation, sale activation, `PATCH /api/admin/retailers/:id`). |
| `RETAILER_INACTIVE` | 409 | The point of sale was deactivated: no warranty starts there any more. |
| `RETAILER_EXISTS` | 409 | A point of sale with this name already exists in this city (case-insensitive). |
| `SALE_TOKEN_INVALID` | 400 | Unknown or malformed sale token, one bound to another purpose (a registration token), or one earned by another console user's scan. |
| `SALE_TOKEN_USED` | 409 | The sale token was already used: scan the piece again. |
| `SALE_TOKEN_EXPIRED` | 410 | The sale token expired (10 minutes after the scan). |

Ownership:

| Code | HTTP | Meaning |
|---|---|---|
| `REGISTRATION_TOKEN_INVALID` | 400 | Unknown or malformed registration token, or one bound to another purpose or product. |
| `REGISTRATION_TOKEN_USED` | 409 | The token was already used. |
| `REGISTRATION_TOKEN_EXPIRED` | 410 | The token expired (15 minutes after the scan). Distinguishable from "unknown" for 24 hours after expiry. |
| `ALREADY_REGISTERED` | 409 | The product already has an owner. Also refuses a certificate card (§15.7): its claim code has been used. |
| `REGISTRATION_NOT_ALLOWED` | 409 | The product's status does not allow first registration. |
| `REGISTRATION_CONFLICT` | 409 | The product changed during registration; retry. |
| `CLAIM_CODE_REQUIRED` | 400 | The product ships with a claim code and none was sent. |
| `CLAIM_CODE_MALFORMED` | 400 | The claim code is not 12 Crockford base32 characters (not counted as an attempt). |
| `CLAIM_CODE_INVALID` | 403 | The claim code does not match (counted as an attempt). |
| `NOT_OWNER` | 403 | Only the current owner (or, for cancellation, the transfer's sender) can do this. |
| `TRANSFER_ALREADY_PENDING` | 409 | A transfer is already pending for this product. |
| `TRANSFER_NOT_ALLOWED` | 409 | The product's status does not allow a transfer. |
| `TRANSFERS_PAUSED` | 409 | (§11.2) New transfers out of the account are paused for 72 hours after an assisted recovery of its password (§10.8). The message gives the end of the pause. |
| `TRANSFER_NOT_FOUND` | 404 | No transfer matches the code. |
| `TRANSFER_PRODUCT_MISMATCH` | 409 | (§11.3, F-03) The transfer code is not the code of the piece scanned (`productId`). The message names no piece: *This transfer code is not for this piece. Check the code with the owner of this piece.* |
| `TRANSFER_SCAN_REQUIRED` | 400 | (§11.3, F-03) No `transferToken`: the recipient scans the piece, signed in, first (unless `TRANSFER_ACCEPT_REQUIRE_PRODUCT=false`). |
| `TRANSFER_TOKEN_INVALID` | 400 | (§11.3, F-03) Unknown or malformed transfer token, one bound to another purpose (a registration or sale token) or another piece, or one earned by another account's scan (or a scan made signed out). |
| `TRANSFER_TOKEN_USED` | 409 | (§11.3, F-03) The transfer token was already used: scan the piece again. |
| `TRANSFER_TOKEN_EXPIRED` | 410 | (§11.3, F-03) The transfer token expired (15 minutes after the scan). |
| `TRANSFER_EXPIRED` | 410 | The transfer code expired (7 days). |
| `TRANSFER_CANCELLED` | 410 | The sender cancelled the transfer. |
| `TRANSFER_ALREADY_ACCEPTED` | 409 | The transfer code was already used. |
| `CANNOT_ACCEPT_OWN_TRANSFER` | 409 | The recipient already owns the product. |
| `TRANSFER_STALE` | 409 | The sender no longer owns the product. |
| `NO_PENDING_TRANSFER` | 404 | Nothing to cancel. |
| `INCIDENT_NOT_ALLOWED` | 409 | (§11.5) The piece cannot be reported lost or stolen by its owner: it is revoked, retired or flagged by ORBES, or already reported (*This piece cannot be reported here. ORBES Client Services can assist you.*; the message names no status). |
| `NO_INCIDENT` | 409 | (§11.6) The piece is not reported lost: there is nothing to withdraw. |
| `INCIDENT_NOT_RESOLVABLE` | 409 | (§11.6) A STOLEN, or a LOST that ORBES Client Services recorded: only Client Services withdraw it, once they have checked the piece. |
| `CERTIFICATE_NOT_FOUND` | 404 | (§8.7, §11.7) The certificate link is unknown, malformed or withdrawn by its owner: one answer for all, so a withdrawn link says no more than one that never existed (*This certificate link is not valid: it may be incomplete, or withdrawn by its owner. Ask the owner of the piece for a new link.*). For `DELETE /api/v1/ownership/certificates/:id`: no open link of this account has this id. |
| `CERTIFICATE_NO_LONGER_VALID` | 409 | (§8.7) The PDF of a certificate that is no longer valid: expired, its piece transferred, or reported, revoked, flagged or retired since it was created. |
| `CERTIFICATE_NOT_ALLOWED` | 409 | (§11.7) A certificate of a piece that is LOST, STOLEN, REVOKED, COUNTERFEIT_FLAGGED or RETIRED (the message names no status). |
| `CERTIFICATE_LIMIT` | 409 | (§11.7) The piece already has 10 certificate links in use (valid, neither expired nor withdrawn). |
| `NO_OWNER` | 409 | (Admin) the product has no owner to confirm. |
| `ALREADY_VERIFIED` | 409 | (Admin) the ownership is already verified. |

Catalogue, products and lifecycle:

| Code | HTTP | Meaning |
|---|---|---|
| `PRODUCT_NOT_FOUND` | 404 | No product with this id. |
| `CATEGORY_NOT_FOUND` | 404 | No category with this letter. |
| `CATEGORY_CODE_TAKEN` | 409 | The category letter is in use. |
| `CATEGORY_INDEX_EXHAUSTED` | 409 | All 31 category indices are in use. |
| `CATEGORY_INACTIVE` | 409 | The category no longer accepts new products. |
| `COLLECTION_NOT_FOUND` | 404 | No collection with this id. |
| `COLLECTION_EXISTS` | 409 | A collection with this name exists. |
| `MODEL_NOT_FOUND` | 404 | No model with this id. |
| `MODEL_INACTIVE` | 409 | The model is no longer offered for new products (§13.4). |
| `MODEL_DISCONTINUED` | 409 | (§13.4, P-R06) The model is discontinued: an edit that would make it active (`active: true`) is refused; an ADMIN reinstates it instead. |
| `MODEL_ALREADY_DISCONTINUED` | 409 | (§13.4, P-R06) The model is discontinued already. |
| `MODEL_NOT_DISCONTINUED` | 409 | (§13.4, P-R06) The model is not discontinued: nothing to reinstate. |
| `PAIR_SAME_MODEL` | 409 | (§13.4, plan NEXT-NINE BP-34) A model picked for PAIRS WELL WITH is the model itself or one of its variants: *A model pairs with another model, not with itself or one of its variants.* |
| `SKU_PREFIX_TAKEN` | 409 | Another model uses this SKU prefix. |
| `SERIAL_TAKEN` | 409 | The explicit serial is already used for this year and category. |
| `SERIALS_EXHAUSTED` | 409 | No serial left (999 999) for this year and category. |
| `ISSUANCE_CONFLICT` | 409 | A concurrent change prevented issuance; retry. |
| `REFERENCE_NOT_FOUND` | 404 | A referenced record disappeared during issuance. |
| `TRANSITION_NOT_ALLOWED` | 409 | The lifecycle forbids this status change (§14.4). |
| `PREVIOUS_STATUS_UNKNOWN` | 409 | A return or reinstatement target cannot be derived from the status history. |
| `NOT_REVOKED` | 409 | Reinstatement of a product that is not revoked. |

Codes, artifacts, warranty and service:

| Code | HTTP | Meaning |
|---|---|---|
| `CODE_NOT_FOUND` | 404 | No code with this id. |
| `CODE_ALREADY_REVOKED` | 409 | The code is already revoked. |
| `CODE_NOT_ACTIVE` | 409 | Only the ACTIVE code of a product can be rendered. |
| `PRODUCT_NOT_PRINTABLE` | 409 | The product is RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST or STOLEN: no new prints (codes and certificate cards). |
| `CODE_INTEGRITY` | 409 | The stored code failed its end-to-end integrity check and is never rendered, nor drawn on a certificate card (§15.7). The message names the issue and the piece (a print sheet then says which code to leave out); what failed is logged, never returned. |
| `CLAIM_CODE_MISMATCH` | 422 | (Certificate cards, §15.7) a claim code does not match its product's hash, or is malformed. The message names the first such product, never the code. |
| `NO_CLAIM_SECRET` | 422 | (Certificate cards, §15.7) the product was issued without a claim code. |
| `NO_ACTIVE_CODE` | 409 | (Certificate cards, §15.7) the product has no ACTIVE code for its card to draw (revoked with no new one): re-issue its code first. The message names the products. (New claim code, §15.10) the same refusal in its own words: *This piece has no active code: re-issue its code first, then make a new claim code.* |
| `CLAIM_CODE_SITUATION_CHANGED` | 409 | (New claim code, §15.10) the piece changed since its page was read: sold, registered, or given a new claim code. *This piece changed meanwhile (sold, registered or given a new claim code). Reload its page and try again.* |
| `CLAIM_CODE_SOLD_IN_STORE` | 409 | (New claim code, §15.10) the piece was sold outside an order (the sale mode, a warranty started by hand): staff never see a code a buyer is owed (question 8 of the plan NEXT LOT, its answer (b) until the owner answers). |
| `CLAIM_CODE_UNAVAILABLE` | 409 | (§10.20) no new claim code waits for this order, or it can no longer be shown (already read, withdrawn, the piece registered, an order ended, a key that no longer opens it). *This claim code can no longer be shown. ORBES Client Services can assist you.* |
| `CLAIM_CARD_UNAVAILABLE` | 409 | (§10.20) the buyer's new card can no longer be saved: the code is not read, or no longer the piece's, the order ended, or the piece registered, not printable or without an ACTIVE ORBES CODE. *Your new card can no longer be saved here. ORBES Client Services can assist you.* |
| `ORDER_CHANGED` | 409 | (§16.24) a cancellation met a buyer's new claim code made since it was prepared (§15.10): nothing changed. *The order changed meanwhile. Try again.* |
| `PRODUCT_NOT_REISSUABLE` | 409 | A RETIRED or REVOKED product cannot receive a new code. |
| `NO_CODE` | 409 | The product has no code to replace. |
| `ISSUES_EXHAUSTED` | 409 | The product reached 255 code issues. |
| `WARRANTY_ALREADY_ACTIVATED` | 409 | The warranty already has a start date. |
| `WARRANTY_NOT_STARTED` | 409 | Extending a warranty that has not been activated. |
| `WARRANTY_VOID` | 409 | The warranty was voided. |
| `WARRANTY_ALREADY_VOID` | 409 | Voiding an already void warranty. |
| `WARRANTY_ACTIVATION_NOT_ALLOWED` | 409 | The product's status does not allow activation (or it is in a pre-sale service). |
| `SERVICE_NOT_FOUND` | 404 | No service record with this id. |
| `SERVICE_NOT_OPEN` | 409 | The service record is already closed. |

Keys, signing and anomalies:

| Code | HTTP | Meaning |
|---|---|---|
| `KEY_NOT_FOUND` | 404 | No key with this id. |
| `KEY_NOT_ACTIVE` | 409 | Only the ACTIVE key can be retired. |
| `KEY_ALREADY_REVOKED` | 409 | The key is revoked and the request does not move the compromise time earlier. |
| `KID_TAKEN` | 409 | The key label is in use. |
| `KEY_IDS_EXHAUSTED` | 409 | All 255 key ids are used. |
| `KEY_CONFLICT` | 409 | A concurrent key change happened; retry. |
| `KEY_REJECTED` | 500 | The key provider returned an unusable key (not a strict Ed25519 key, or a bad reference). |
| `KEY_PROVIDER_UNAVAILABLE` | 503 | The key provider failed to generate a key. |
| `NO_ACTIVE_KEY` | 503 | No ACTIVE signing key: issuance unavailable until a rotation. Verification is unaffected. |
| `SIGNING_UNAVAILABLE` | 503 | Signing failed, the active key belongs to another provider, or the active key kept changing during issuance. |
| `SIGNING_FAILED` | 503 | The provider's signature failed verify-after-sign and was refused. |
| `ANOMALY_NOT_FOUND` | 404 | No anomaly with this id. |
| `ANOMALY_ALREADY_OPEN` | 409 | Reopening would create a second open anomaly of the same type for the product. |

Reports and cases:

| Code | HTTP | Meaning |
|---|---|---|
| `REPORT_NOT_ALLOWED` | 409 | (§8.5) The scan is unknown, was authentic, is not a customer's verification, or is 24 hours old or older. One answer for all. |
| `REPORT_ALREADY_SENT` | 409 | (§8.5) This scan already carries a report. |
| `REPORT_NOT_FOUND` | 404 | (§16.9) No case with this id. |
| `REPORT_ALREADY_CLOSED` | 409 | (§16.9) The case is already closed. |

Photographs (F-04, §8.6, §13.4, §14.12) and the lookbook (P-R02, §8.8, §10.9, §13.4):

| Code | HTTP | Meaning |
|---|---|---|
| `LOOKBOOK_NOT_FOUND` | 404 | (§8.8, §10.9) No sheet at this address for this reader: a HIDDEN model, a RESERVED one (publicly; the club's route for an owner whose tier reaches the model's `privateMinTier`, P-X08), an unknown or malformed address. One answer for all (*This model is not in the ORBES collection.*). |
| `OWNERS_ONLY` | 403 | (§10.9) The signed-in account holds no piece now (an open ownership of a piece that is not REVOKED, COUNTERFEIT_FLAGGED or RETIRED): the club is for the owners of an ORBES piece. |
| `SLUG_TAKEN` | 409 | (§13.4) Another model already has this address in the lookbook. |
| `SLUG_LOCKED` | 409 | (§13.4) The model has been published in the lookbook: its address never changes (links to its sheet are out), nor goes. |
| `GALLERY_FULL` | 409 | (§13.4) The model's gallery already holds 8 photographs: remove one first. |
| `IMAGE_IS_COVER` | 409 | (§13.4) The photograph is the model's reference photograph, the cover of its sheet already. |
| `GALLERY_CHANGED` | 409 | (§13.4) The order sent does not name the photographs of the gallery, each once (one was added or removed meanwhile): reload it. |
| `GALLERY_IMAGE_NOT_FOUND` | 404 | (§13.4) The photograph is not in this model's gallery. |
| `IMAGE_INVALID` | 400 | The bytes are not a JPEG or a WebP (an SVG, a PNG, text…), do not match the declared type (a JPEG sent as `image/webp`), are damaged or truncated, use a kind of JPEG no browser draws (hierarchical, JPEG-LS), or the image is over 4 096 pixels on a side. The message says which. |
| `IMAGE_ANIMATED` | 400 | An animated WebP (its animation flag, or ANIM / ANMF chunks): a photograph is a still image. |
| `MEDIA_NOT_FOUND` | 404 | (§8.6) No stored photograph with this SHA-256: never uploaded, or removed and no longer used by any model, gallery or piece. |

THE PRIVATE SALON (P-X08, §10.9, §16.22):

| Code | HTTP | Meaning |
|---|---|---|
| `NOT_IN_SALON` | 404 | (§10.9) The model is PUBLIC: it is in THE COLLECTION, not offered in the private salon, and not requested (*This model is not offered in the private salon.*). |
| `SHOP_REQUEST_OPEN` | 409 | (§10.9) The account already has an OPEN request for this model (*You have already requested this piece: ORBES Client Services will contact you.*). One OPEN request per account and model (`shop_requests_one_open`); a closed one may be followed by another. |
| `SHOP_REQUEST_NOT_FOUND` | 404 | (§16.22) No request with this id. |
| `SHOP_REQUEST_CLOSED` | 409 | (§16.22) The request is closed already. |

The releases (P-R03, §8.9, §10.10, §16.19):

| Code | HTTP | Meaning |
|---|---|---|
| `DROP_NOT_FOUND` | 404 | No release at this address for this reader: unknown, malformed, or (outside the console) not published. One answer for all (*This release is not known to ORBES.*). |
| `DROP_ENTRY_NOT_FOUND` | 404 | (§16.19) No entry with this id in this release. |
| `DROP_CANCELLED` | 409 | The release has been cancelled: no entry, no change of its fields but its description, no draw. |
| `DROP_ALREADY_DRAWN` | 409 | The release has been drawn: its entries no longer change (no entry, no withdrawal), it is not drawn again and not cancelled. |
| `DROP_PUBLISHED` | 409 | (§16.19) The release is published: only its description changes. |
| `DROP_ALREADY_PUBLISHED` | 409 | (§16.19) The release is published already. |
| `DROP_WINDOW_PAST` | 409 | (§16.19) Its entries would already be closed at its publication: change its dates first. |
| `DROP_NOT_PUBLISHED` | 409 | (§16.19) A draft is not drawn. |
| `DROP_NOT_CLOSED` | 409 | (§16.19) Its entries are still open: the draw follows their close (`closesAt`). |
| `DROP_NOT_OPEN` | 409 | (§10.10) Its entries are not open: before `opensAt`, or after `closesAt`. |
| `DROP_NOT_DRAWN` | 409 | (§8.9, §16.19) The release has not been drawn yet: no list of its draw, no place to offer. |
| `DROP_ALREADY_ENTERED` | 409 | (§10.10) The account is entered already (one entry per account and release). |
| `DROP_NOT_ENTERED` | 409 | (§10.10) The account has no entry to withdraw (none, or withdrawn already). |
| `DROP_ENTRY_NOT_SELECTED` | 409 | (§16.19) Only an entry whose place is held (`SELECTED`) is concluded or lapses. |
| `DROP_PLACE_HELD` | 409 | (§16.19) The place is held until its `respondBy` (said in the message, UTC): it lapses only after that time. |
| `DROP_FULL` | 409 | (§10.10, §16.19) Every piece of the release is held or sold (`SELECTED` and `CONFIRMED` reach `quantity`): no place to reserve directly (P-X02) nor to offer. |
| `DROP_WAITLIST_EMPTY` | 409 | (§16.19) No entry is left on the waiting list. |
| `DROP_ALREADY_RESERVED` | 409 | (§10.10, P-X02) The account already holds an entry or a direct reservation in this release (one per account and release): a reservation is not entered again, nor reserved twice. |
| `DROP_EARLY_ACCESS_NOT_OPEN` | 409 | (§10.10, P-X02) The early access of the account's tier has not begun (BP-19 T3: PALLADIUM's, then PLATINE's): *Direct reservations for this release open on YYYY-MM-DD HH:MM UTC.*, that tier's time. |
| `DROP_EARLY_ACCESS_CLOSED` | 409 | (§10.10, P-X02) Direct reservations are closed from `opensAt` on (the places left go to the draw), or the release offers none (`earlyAccessHours` 0, or published at or after its opening). |
| `DROP_TIER_REQUIRED` | 403 | (§10.10, P-X02) The account's tier now is below PLATINE: *Only PLATINE and PALLADIUM owners reserve a place directly: from 5 pieces held.* |
| `DROP_SEED_UNAVAILABLE` | 503 | (§16.19) The seed of the draw cannot be opened with this server's key, or does not match its commitment (`seedHash`): the draw does not run, nothing is written. The key the seeds are sealed with comes from `KEY_ENCRYPTION_KEY` (from `COOKIE_SECRET` without one): changing it leaves the seeds of the releases not drawn yet unreadable ([DEPLOYMENT](DEPLOYMENT.md)); such a release is cancelled and created again. |
| `DROP_LIVE` | 409 | (§16.19) The release is a LIVE RELEASE (§8.10): it has no draw and no waiting list. Its own routes are §16.23; the draw's public routes (§8.9, §10.10) answer `404 DROP_NOT_FOUND` for it. |
| `DROP_SIZE_REQUIRED` | 400 | (§10.10, §16.19; plan NEXT LOT §3.6.F) A draw with sizes takes an entry, a reservation or an offer to its waiting list in one of its sizes: *Choose your size.* (the console's offer: *Choose the size whose place to offer.*) |
| `DROP_SIZE_UNKNOWN` | 404 | (§10.10, §16.19; plan NEXT LOT §3.6.F) The size is not one of the draw's sizes with pieces, or the draw has no sizes: *This size is not offered in this release.* |
| `DROP_SIZE_FIXED` | 409 | (§10.10; plan NEXT LOT §3.6.F) A place reserved directly keeps the size it was reserved in: *A place reserved directly keeps its size.* |
| `DROP_SIZE_FULL` | 409 | (§10.10; plan NEXT LOT §3.6.F) Every piece of the size is held or sold, or guaranteed to an entry waiting in it: *Every piece in size 17 has been reserved.*, the size named; the app shows the sentence as it is. |
| `DROP_GUARANTEE_SIZE_FULL` | 409 | (§10.10; plan NEXT LOT §3.6.F) The size chosen can no longer serve the pieces of the house's guarantee shown to the account: *Your guaranteed place cannot be given in this size: choose another size.* (a guarantee not shown leaves an ordinary entry). |
| `DROP_SIZES_REQUIRED` | 409 | (§16.19; plan NEXT LOT §3.6.F) A `DRAFT` created before this lot, without sizes, is not published: *Give the release its sizes and their pieces before publishing it.* |

The LIVE RELEASES (§8.10, §10.12, §16.23). A LIVE RELEASE not announced (or a draft, a cancelled one, a DRAW, an unknown or malformed id, a board link missing, wrong, replaced or revoked) answers `404 DROP_NOT_FOUND` above; one cancelled, to an action, `409 DROP_CANCELLED`.

| Code | HTTP | Meaning |
|---|---|---|
| `LIVE_NOT_ELIGIBLE` | 403 | (§10.12) The account does not meet the release's rules now (its tier, a piece of the models or the collection it names, the releases taken part in, a segment; combined by AND or OR): *This release is for owners from PLATINE.*, the rules in words, then, when the release counts the releases taken part in, *You have taken part in 1 release.*; an account that lacks only the segment reads *This release is for selected collectors.*; a model the release is about named `this model`, and its collection `this model’s collection`, until its name is revealed. Also for a state or a stream asked by an account outside the rule that holds no entry. |
| `LIVE_REMOVED` | 403 | (§10.12) The account's entry was removed: it reads its state, but no stream. |
| `LIVE_STREAMS_LIMIT` | 429 | (§10.12, §16.23) The account (or the console user) already follows the release on two screens on this server: the page polls its state instead. |
| `LIVE_ROOM_NOT_OPEN` | 409 | (§10.12) The room opens later: *The room of this release opens on YYYY-MM-DD HH:MM UTC.* |
| `LIVE_OVER` | 409 | (§10.12) The release is over: ended, or past the end of its sales. |
| `LIVE_ALREADY_ENTERED` | 409 | (§10.12) The account has an entry already (one per account and release; only an entry that left the room before T0 enters again). |
| `LIVE_NOT_ENTERED` | 409 | (§10.12) The account has no entry in the release. |
| `LIVE_NOT_IN_LINE` | 409 | (§10.12) The entry is no longer in the room or the line. |
| `LIVE_SIZE_UNKNOWN` | 400 | (§10.12, §16.23) Not one of the release's sizes. |
| `LIVE_SIZE_SOLD_OUT` | 409 | (§10.12) No piece in this size: no stock, more pieces than its stock, or, after T0, every piece of the size confirmed. |
| `LIVE_QUANTITY_INVALID` | 400 | (§10.12) A quantity outside 1 to the release's `perAccount`. |
| `LIVE_SIZE_LOCKED` | 409 | (§10.12) From T0 on, the size no longer changes. |
| `LIVE_NOT_YOUR_TURN` | 409 | (§10.12) The entry is not in its turn. |
| `LIVE_TURN_CHANGED` | 409 | (§10.12) The secret sent is not the turn's: *Refresh the page.* |
| `LIVE_TURN_PASSED` | 409 | (§10.12) The turn's deadline has passed. |
| `LIVE_HOLD_TOO_SHORT` | 409 | (§10.12) No press, or one less than 1.4 s earlier on the server's clock: *Press and hold the seal until the ring is full.* |
| `LIVE_PAUSED` | 409 | (§10.12, §16.23) The release is paused: no press, no secure, no LET IN. |
| `LIVE_NOT_SECURED` | 409 | (§10.12) No piece is held for the account. |
| `LIVE_HOLD_ENDED` | 409 | (§10.12) The hold's deadline has passed. |
| `LIVE_INTEREST_CLOSED` | 409 | (§10.12) From T0 on, the room replaces I'LL BE THERE. |
| `LIVE_NOT_INTERESTED` | 409 | (§10.12) No I'LL BE THERE to withdraw. |
| `LIVE_ADDON_UNKNOWN` | 400 | (§10.12) Not one of the release's add-ons, or more than six. |
| `LIVE_ANNOUNCED` | 409 | (§16.23) The release is announced: its settings no longer change; ADD PIECES raises a size's stock. |
| `LIVE_AFTER_ROOM` | 409 | (§16.23, plan LIVE RELEASE+) An after-room is set, published and cancelled with its release, and has no board link nor feasibility of its own: *This is the after-room of a release: it is set, published and cancelled with that release.* |
| `LIVE_QUESTION_NOT_ASKED` | 403 | (§10.16) The question after a release is not asked of this account: *This question is for the collectors who took part in this release without a piece, or who said they would be there.* |
| `LIVE_QUESTION_CLOSED` | 409 | (§10.16) The question after a release is not open: before the release's final end (its after-room's, when one opened), a week after it, or turned off. |
| `LIVE_NOT_ANNOUNCED` | 409 | (§16.23) Not announced yet: ADD PIECES and the host messages come from the announcement on (the sizes are a setting until then). |
| `LIVE_ROOM_OPEN` | 409 | (§16.23) The room is open: the release is no longer cancelled, an ADMIN ends it with END NOW. |
| `LIVE_CIRCLE_POSTED` | 409 | (§16.23) The release's post of the circle already waits for its announcement. |
| `LIVE_NO_CIRCLE_POST` | 409 | (§16.23) No post of the circle waits for the release's announcement. |
| `LIVE_NOT_STARTED` | 409 | (§16.23) T0 has not come: no pause, no LET IN. |
| `LIVE_ENDED` | 409 | (§16.23) The release has ended: no control any more. |
| `LIVE_ALREADY_PAUSED` | 409 | (§16.23) The release is paused already. |
| `LIVE_NOT_PAUSED` | 409 | (§16.23) The release is not paused. |
| `LIVE_NO_FREE_PIECE` | 409 | (§16.23) LET IN: no free piece of the entry's size for its quantity. |
| `LIVE_ENTRY_NOT_FOUND` | 404 | (§16.23) No entry with this id in this release. |
| `LIVE_ENTRY_NOT_QUEUED` | 409 | (§16.23) LET IN: only an entry waiting in the line. |
| `LIVE_ENTRY_NOT_SECURED` | 409 | (§16.23) FREE: only a held piece. |
| `LIVE_ENTRY_CLOSED` | 409 | (§16.23) REMOVE: the entry is no longer in the release. |
| `LIVE_NO_BOARD_LINK` | 409 | (§16.23) The release has no board link to revoke. |

The circle (P-X01, §10.11, §16.20):

| Code | HTTP | Meaning |
|---|---|---|
| `CIRCLE_POST_NOT_FOUND` | 404 | No post at this address for this reader: below the reader's tier, not published (or withdrawn), unknown or malformed; in the console, unknown. One answer for all (*This post is not in the circle.*). |
| `CIRCLE_NOT_INVITATION` | 409 | (§10.11) Only an invitation takes an answer. |
| `CIRCLE_EVENT_PAST` | 409 | (§10.11) The event has begun (`eventAt`): answers are closed. |
| `CIRCLE_FULL` | 409 | (§10.11) Every place of the invitation is taken: the YES reach its `capacity` (counted under the post's row lock). |
| `CIRCLE_NOT_POLL` | 409 | (§10.11) Only a poll takes a vote. |
| `CIRCLE_ALREADY_VOTED` | 409 | (§10.11) The account has voted in this poll already: a vote is final. |
| `CIRCLE_ALREADY_PUBLISHED` | 409 | (§16.20) The post is in the circle already. |
| `CIRCLE_NOT_PUBLISHED` | 409 | (§16.20) The post is not in the circle: nothing to withdraw. |
| `CIRCLE_POLL_VOTED` | 409 | (§16.20) Votes have been cast: the options of this poll no longer change. |
| `CIRCLE_CAPACITY_BELOW` | 409 | (§16.20) The capacity would go under the places already answered YES (said in the message). |
| `CIRCLE_PHOTOS_FULL` | 409 | (§16.20) The post already holds 4 photographs: remove one first. |
| `CIRCLE_PHOTOS_CHANGED` | 409 | (§16.20) The order sent does not name the post's photographs, each once (one was added or removed meanwhile): reload them. |
| `CIRCLE_PHOTO_NOT_FOUND` | 404 | (§16.20) The photograph is not this post's. |

The orders, the stock, the invoices, the segments and Shopify (plan LIVE RELEASE+, §10.13, §10.14, §16.24 to §16.27; the atelier's errors, `ORDER_PIECE_TO_MAKE`, `PIECE_OTHER_SKU`, `PIECE_NOT_IN_STOCK`, `PIECE_TAKEN`, `BENCH_ITEM_NOT_FOUND`, `BENCH_STEP_NOT_ALLOWED`, `BENCH_FOR_ORDER`, `BENCH_NOT_OPEN` and `PRODUCT_NOT_RESERVED`, are gone with it and Link a piece, plan NEXT LOT step 5.13):

| Code | HTTP | Meaning |
|---|---|---|
| `ORDER_NOT_FOUND` | 404 | No order with this id; for a customer, any order but the session's own (§10.14). |
| `ORDER_TRANSITION_NOT_ALLOWED` | 409 | Not one of the order's steps from where it stands (`ORDER_TRANSITIONS`; the move in `detail`): *This order cannot move to that step.* |
| `ORDER_PRICE_MISSING` | 409 | PAID before the order's price is entered: *Enter the order’s price before it is paid: its invoice is issued then.* |
| `ORDER_PAID` | 409 | The price of an order paid no longer changes. |
| `ORDER_TERMS_FIXED` | 409 | A LIVE RELEASE order's size and price are its release's. |
| `ORDER_SIZE_FIXED` | 409 | (§16.24; plan NEXT LOT §3.6.F, §3.6.G) The order's size is the one its draw entry or its salon request chose: *The size of this order is the one chosen at its entry or request.* An exchange goes through an order case. A salon request made with NOT SURE YET leaves the size to Client Services. |
| `ORDER_NOT_READY` | 409 | SHIPPED before the piece is in stock at the order's location. |
| `ORDER_PIECE_NOT_LINKED` | 409 | SHIPPED, or a return, before the piece that fulfils the order is bound to it (by the packing scan, §16.33). |
| `ORDER_PIECE_LINKED` | 409 | A piece is already linked to this order: transfer the piece instead. |
| `ORDER_CLOSED` | 409 | The order can no longer change (cancelled, returned, or no longer waiting for this piece). |
| `ORDER_RETURN_NOT_RESTOCKABLE` | 409 | The piece's record (in service, lost, stolen, flagged) does not let it go back to stock: settle it, or archive the piece. |
| `ORDER_RETURN_CHANGED` | 409 | The piece changed during the return: try again. |
| `CERTIFICATE_NOT_AVAILABLE` | 409 | (§10.14) The ownership certificate of the order is not available: its piece is not registered to the account. |
| `INVOICE_NOT_FOUND` | 404 | No invoice or credit note with this id; for a customer, none of this kind for the order. |
| `STOCK_NOT_READY` | 503 | No default stock location yet (the first boot's setup has not run). |
| `STOCK_NOT_AVAILABLE` | 409 | A transfer or a count corrected would take pieces the orders reserve: *Only N pieces are available there: the others are reserved by orders.* Or a piece the ledger counts, picked for an order holding a piece to make, while none is available at the order's location: transfer it there first. |
| `STOCK_LOCATION_NOT_FOUND` | 404 | No stock location with this id. |
| `STOCK_LOCATION_NAME_TAKEN` | 409 | Another location has this name, whatever the case. |
| `SUPPLIER_NOT_FOUND` | 404 | No supplier with this id (plan NEXT LOT §3.5, §16.33). |
| `SUPPLIER_NAME_TAKEN` | 409 | 'Another supplier has this name.', whatever the case (§16.33). |
| `SUPPLIER_ORDER_NOT_FOUND` | 404 | No supplier order with this id (§16.33). |
| `SUPPLIER_ORDER_NOT_DRAFT` | 409 | 'A sent order no longer changes: cancel the rest, or start another order.' (§16.33). |
| `SUPPLIER_ORDER_NOT_SENT` | 409 | 'This supplier order is not sent yet.': a draft is discarded, never cancelled nor invoiced (§16.33). |
| `SUPPLIER_ORDER_CONFIRMED` | 409 | 'The supplier has already confirmed this order.' (§16.33). |
| `SUPPLIER_ORDER_PARTLY_RECEIVED` | 409 | 'Pieces of this order have already come in.': an order whose pieces came in before the supplier confirmed it is not confirmed afterwards (§16.33). |
| `SUPPLIER_ORDER_CLOSED` | 409 | 'This supplier order expects nothing more.': RECEIVED or CANCELLED (§16.33). |
| `SUPPLIER_ORDER_INCOMPLETE` | 422 | 'Before it is sent, an order needs at least one line, a unit price on each, its currency and its expected delivery date.' (§16.33). |
| `SKU_NO_SUPPLIER` | 409 | *Set the supplier of MONOLITHE · BLUE · 52 on its model's page first.*: the size has no active supplier (its own, its model's, its main model's) (§16.33). |
| `RECEPTION_OPEN` | 409 | 'A reception of this order is already waiting for ORBES.' (§16.33). |
| `SUPPLIER_INVOICE_MISSING` | 409 | 'Enter the supplier’s invoice first.' (§16.33). |
| `SUPPLIER_INVOICE_PAID` | 409 | 'This invoice is paid: it no longer changes.' (§16.33). |
| `SUPPLIER_RETURN_NOT_FOUND` | 404 | No pieces sent back to a supplier with this id (§16.33). |
| `SUPPLIER_RETURN_SETTLED` | 409 | 'The supplier’s answer is already noted.' (§16.33). |
| `SUPPLIER_RETURN_SENT` | 409 | 'These pieces are already sent back.' (§16.33). |
| `RECEPTION_NOT_FOUND` | 404 | No reception with this id, or one of a location outside a LOGISTICS login's (§16.33). |
| `RECEPTION_EMPTY` | 422 | 'Count at least one piece.' (§16.33). |
| `RECEPTION_NOTE_REQUIRED` | 422 | 'Say in a note why more pieces than expected, or a piece not on the order, came in.': a line with more pieces received OK than its order line expects, or a size not on the order, without its note (§16.33). |
| `RECEPTION_CONFIRMED` | 409 | 'This reception is confirmed: it no longer changes.' (§16.33). |
| `RECEPTION_SENT_BACK` | 409 | 'This reception is sent back: the agent counts it again first.' (§16.33). |
| `RECEPTION_NOT_CONFIRMED` | 409 | 'ORBES has not confirmed this reception yet.': no card before the confirmation (§16.33). |
| `RECEPTION_MATERIAL_MISSING` | 409 | *Set the material of MONOLITHE · BLUE in the Catalogue before confirming.*: a model of the reception (or its main model) has no material (§16.33). |
| `RECEPTION_ISSUING` | 409 | 'The identities are still being issued: print the cards once they are all issued.' (§16.33). |
| `CARDS_ATTACHED` | 409 | 'These cards are attached: a lost card needs a new claim code from ORBES.' (§16.33). |
| `CORRECTION_NOT_FOUND` | 404 | No stock correction with this id, or one of a location outside a LOGISTICS login's (§16.33). |
| `CORRECTION_NOT_PENDING` | 409 | 'This correction has already been decided.' (§16.33). |
| `STOCK_NOT_BACKED` | 409 | *Only 2 pieces of MONOLITHE · BLUE · 52 exist to back this count: count a piece in first.*: a count up through Logistics beyond the ORBES identities that back the size's count, every location together (§16.33). |
| `PIECE_NOT_COUNTABLE` | 409 | *O26-J-00184 cannot be counted in: it is registered, in an order, retired, or already in stock.*, or *O26-J-00184 is not a piece of MONOLITHE · BLUE · 52.* (§16.33). |
| `CARDS_NONE_TO_PRINT` | 409 | 'No card of this run can be printed: each is attached, replaced or registered.' (§16.33). |
| `ORDER_ADDRESS_MISSING` | 409 | 'This order has no delivery address yet.': Start packing (and Ship) on a parcel whose first order has no buyer's name and address (§16.33; the country joins the check with the delivery address, step 6.7). |
| `PACKING_NOT_READY` | 409 | 'This parcel is not ready: every order in it must be paid and hold its piece.' (§16.33). |
| `PACKING_NOT_STARTED` | 409 | 'Start packing first.': a scan, a photo or Packed with no shipment being packed (§16.33). |
| `PACKING_PACKED` | 409 | 'The parcel is packed: it no longer changes.': a photo replaced, or a card scanned, after Packed (§16.33). |
| `PACKING_SCAN_NOT_ORBES` | 422 | 'This card did not verify as an ORBES code. Put it aside and tell ORBES.': the card's code is not AUTHENTIC as /verify judges it (§16.33). |
| `PACKING_SCAN_OTHER_PIECE` | 409 | *This card is MONOLITHE · GOLD · 54. This order needs MONOLITHE · BLUE · 52: take a piece of that model, variant and size.* (§16.33). |
| `PACKING_SCAN_NOT_IN_STOCK` | 409 | *O26-J-00184 is not a piece in stock (it is registered, shipped, in another order, retired, or not counted in). Put it aside and tell ORBES.* (§16.33). |
| `PACKING_SCAN_DONE` | 409 | 'Every piece of this parcel is already scanned.' (§16.33). |
| `PACKING_INCOMPLETE` | 422 | 'Tick every line, scan every card and add the photo before it is packed.' (§16.33). |
| `PACKING_PHOTO_INVALID` | 422 | 'The photo could not be read: take it again.': bytes that are no JPEG or WebP of their declared type, or over 1 MiB (§16.33). |
| `ORDER_NOT_PACKED` | 409 | 'Pack the parcel and check it before it ships.': Ship on a parcel not PACKED (§16.33); and the SHIPPED gate (plan NEXT LOT §3.5.6.7, step 5.12): an order ships only through its parcel's Ship, its shipment PACKED with every card scanned, so a `SHIPPED` step of `POST /api/admin/orders/:id/transition` always answers it (§16.24). |
| `SHIPMENT_NOT_FOUND` | 404 | No packing photo of this shipment (none, erased, or of a location outside a LOGISTICS login's) (§16.33). |
| `ORDER_CASE_NOT_FOUND` | 404 | No order case with this id, or one of a location outside a LOGISTICS login's (§16.34). |
| `ORDER_CASE_OPEN` | 409 | 'A request is already open for this order.': an order (or an order of the parcel) has an order case not ended (§16.34). |
| `ORDER_CASE_NOT_RECEIVED` | 409 | 'The agent records the parcel before you decide.' (§16.34; a LOST parcel is decided from OPEN). |
| `ORDER_CASE_RECEIVED` | 409 | 'The parcel of this request is already recorded.' (§16.34). |
| `ORDER_CASE_NOT_RECEIVABLE` | 409 | 'A lost parcel does not come back: ORBES decides it as it stands.' (§16.34). |
| `ORDER_CASE_CLOSED` | 409 | 'This request is already decided or cancelled.' (§16.34). |
| `EXCHANGE_SIZE_NOT_IN_STOCK` | 409 | 'This size is no longer in stock. Choose another.': an exchange's size with nothing available at the order's location (§16.34). |
| `CARRIER_NOT_FOUND` | 404 | No carrier with this id, or one set aside (for a shipment). |
| `CARRIER_NAME_TAKEN` | 409 | Another carrier has this name, whatever the case. |
| `SKU_NOT_FOUND` | 404 | No SKU with this id. |
| `SIZE_NOT_DECLARED` | 400 | (plan NEXT LOT §3.3, §13.4) A size named for a model with its size type is not one of its declared sizes: *Size 53 is not one of MONOLITHE’s sizes (50, 52, 54). Add it on the model’s page, in the Catalogue.* (a variant named *MONOLITHE · BLUE*; a size of none, *ONE SIZE is not one of …*). |
| `SIZE_SET_ASIDE` | 409 | (§13.4) The size is set aside: nothing new offers it, nor takes a minimum: *Size 58 of MONOLITHE is set aside. Reinstate it on the model’s page to offer it again.* |
| `SIZE_TYPE_REQUIRED` | 409 | (§13.4) Sizes are ticked only on a ring, a bracelet or a necklace: *Give the model its size type first.* |
| `SIZE_LAST_OFFERED` | 409 | (§13.4) *A model keeps at least one size offered.* |
| `SIZE_TYPE_GIVEN` | 409 | (§13.4) The size kind is set alone only on a model with no size type: *This model has its size type: change it in Size type.* |
| `CODE_EXISTS` | 409 | An internal guard on an invariant, not expected through the API: a piece a reception issues has no code until its first one is signed, once. |
| `SEGMENT_NOT_FOUND` | 404 | No segment with this id. |
| `SEGMENT_NAME_TAKEN` | 409 | A segment already has this name. |
| `SEGMENT_IN_USE` | 409 | The segment is the access rule of a release or the audience of a post of the circle: choose another there first. |
| `SHOPIFY_PRODUCT_TAKEN` | 409 | Another model is already linked to this Shopify product. |
| `SHOPIFY_VARIANT_TAKEN` | 409 | Another size already has this Shopify variant id. |

MESSAGES (plan NEXT-NINE, CS-01; §10.17, §16.28):

| Code | HTTP | Meaning |
|---|---|---|
| `MESSAGE_CONTEXT_INVALID` | 422 | What the message would concern cannot be attached: a piece the account does not own now, another account's order, a release not published, a model its lookbook does not reach, an unknown or staff scan, an unknown kind: *This cannot be attached to your message.* |
| `MESSAGE_CONTEXT_EXPIRED` | 422 | The scan is 24 hours old or more (`REPORT_WINDOW_MS`): *This scan is more than 24 hours old. Scan the piece again to write about it, or write from MESSAGES.* |
| `MESSAGE_LIMIT` | 429 | The account wrote 10 messages within the rolling hour (`MESSAGE_RATE`): *You have written several messages within the hour. Please write again later.* |
| `CONVERSATION_NOT_FOUND` | 404 | No conversation with this id. Staff never open one: an answer needs a conversation the client opened. |
| `CONVERSATION_CLOSED` | 409 | (§16.28) The conversation is already closed. |

THE PROGRAM (plan NEXT-NINE, BP-19 T2; §16.21):

| Code | HTTP | Meaning |
|---|---|---|
| `PROGRAM_EARLY_ACCESS` | 422 | PLATINE's early access by default would start before PALLADIUM's: *PALLADIUM’s early access starts no later than PLATINE’s.* |
| `ORDER_SHIPPING_FREE` | 409 | (§16.24, BP-19 T4) A fee on the service the order's tier makes free: *This order’s shipping is free with its tier: no fee is added to it.* |
| `ORDER_SHIPPING_WITH` | 409 | (§16.24) The order travels with another, whose shipping it carries: *This order travels with another: its shipping is that order’s.* |
| `ORDER_GIFT_SIZE_MISSING` | 409 | (§16.24, BP-19 T5) MARK PAID on an order whose welcome gift's size is still to be chosen: *Choose the welcome gift’s size before marking it paid.* |
| `ORDER_CREDIT_NONE` | 409 | (§16.24) No credit usable now (none, expired, waiting below its tier), or none taken off the order to remove. |
| `ORDER_CREDIT_CURRENCY` | 409 | (§16.24) The credit is in another currency than the order. |
| `ORDER_CREDIT_CHANNEL` | 409 | (§16.24) The credit is not taken off this kind of order (a channel THE PROGRAM leaves out, a welcome gift). |
| `ORDER_CREDIT_EXCEEDS` | 409 | (§16.24) More than the credit left, or than the piece's price with what is already taken off it. |

The yearly care (plan NEXT-NINE, BP-19 T6; §10.18, §16.29):

| Code | HTTP | Meaning |
|---|---|---|
| `CARE_NOT_INCLUDED` | 403 | The account's tier now includes no yearly care (TITANE, no tier, or an allowance of 0 in THE PROGRAM): *Your tier does not include the yearly care.* |
| `CARE_USED` | 409 | The year's allowance is used for other pieces: *Your yearly care for this year has been used for another piece.* |
| `CARE_ALREADY_REQUESTED` | 409 | The piece has a request this year that is not cancelled (by this account or the one before): *The yearly care of this piece has already been requested this year.* |
| `CARE_UNAVAILABLE` | 409 | The piece is not REGISTERED, OWNED or TRANSFERRED (lost, stolen, in service…) or its transfer is pending: *The yearly care cannot be requested for this piece just now.* |
| `CARE_REQUEST_NOT_FOUND` | 404 | No request with this id, or another account's, or (its label) a PDF already erased. |
| `CARE_STEP` | 409 | The request is not at the step this action follows: *This yearly care is not at that step.* |
| `CARE_OPEN` | 409 | (§11.2) A transfer of a piece whose yearly care is REQUESTED or LABEL_SENT (RECEIVED and RETURNING are refused as SERVICED, `TRANSFER_NOT_ALLOWED`): *This piece's yearly care is under way: cancel the request or wait until it returns.* |
| `FILE_NOT_PDF` | 415 | (§16.29) The label is not sent as itself, as `application/pdf`, or its bytes do not begin with `%PDF-`: *Send the label itself, as a PDF.* |
| `FILE_TOO_LARGE` | 413 | (§16.29) The label is over 2 MiB: *The label is limited to 2 MB.* |

The house's guarantee (plan NEXT-NINE, IN-01; §8.9, §10.10, §10.12, §16.30):

| Code | HTTP | Meaning |
|---|---|---|
| `GUARANTEE_NOT_FOUND` | 404 | No guarantee with this id. |
| `GUARANTEE_RELEASE_OVER` | 409 | The chosen release is drawn, ended or cancelled: *This release is over or cancelled: it cannot be guaranteed.* |
| `GUARANTEE_RELEASE_OPENS_LATE` | 409 | The chosen release (or the one a guarantee is set aside for, at a change) opens after its last day: *This release opens after the guarantee’s validity: choose a later date.* |
| `GUARANTEE_RELEASE_CLOSED` | 409 | The chosen release is past its `closesAt` (*Entries to this release are closed: it cannot be guaranteed.*), or is an after-room: *An after-room is never covered by a guarantee.* |
| `GUARANTEE_EXCEEDS_RELEASE` | 409 | More pieces than the release has left: *This release has 50 pieces; 49 are already held or guaranteed.* (the pieces held or sold and those guaranteed by the house, against a draw's `quantity` or a LIVE RELEASE's stock of every size). |
| `GUARANTEE_ALREADY` | 409 | The client already holds a guarantee set aside for this release, or a place in it (a draw's entry `SELECTED` or `CONFIRMED`; a LIVE entry at its turn, secured or confirmed): *This client already holds a guarantee or a place in this release.* |
| `GUARANTEE_IN_USE` | 409 | Its pieces changed while the client is entered with it: *The client has entered with this guarantee: its pieces no longer change.* |
| `GUARANTEE_USED` | 409 | A change or a revocation of a guarantee used at a draw, a reservation or a LIVE turn: *This guarantee has been used.* |
| `GUARANTEE_CLOSED` | 409 | A change or a revocation of a guarantee expired or revoked: *This guarantee is no longer active.* |
| `GUARANTEE_BUSY` | 409 | The guarantee changed under the request several times running (a release published, drawn or ended at that moment): *This guarantee is changing: try again.* |
| `DROP_GUARANTEES_EXCEED` | 409 | (§16.19, §16.23) A release's pieces set below those the house guarantees for it: *2 pieces of this release are guaranteed by the house.* |
| `LIVE_GUARANTEE_SIZE_FULL` | 409 | (§10.12) A guaranteed entry, its guarantee shown to the client, in a size whose stock, less the pieces confirmed and those of the other guaranteed entries, cannot give its pieces: *Your guaranteed place cannot be given in this size: choose another size.* |

---

## 6. Pagination

Paginated lists take `?page=` (1-based, default 1) and `?pageSize=` (default 50, maximum 200) and answer:

```json
{ "items": [ … ], "page": 1, "pageSize": 50, "total": 128 }
```

Parsing is lenient: a missing, non-numeric, zero or negative value falls back to the default, and a larger `pageSize` is clamped to 200, so a bad parameter never causes an error. A page beyond the end returns `items: []`.

Small admin lists (categories, collections, models, keys) are not paginated and answer `{ "items": [ … ] }`.

---

## 7. Endpoint index

Auth: **—** none; **Account** `orbes_session`; **RETAIL / AUDITOR / OPERATOR / ADMIN** `orbes_admin` with at least that role (§2.3); **RETAIL, OPERATOR, ADMIN** exactly those roles (the sale mode: not AUDITOR). "CSRF" means the rules of §2.2 apply.

| Method | Path | Auth | CSRF | Rate group | § |
|---|---|---|---|---|---|
| GET | `/api/v1/health` | — | — | api | 8.1 |
| GET | `/api/v1/keys` | — | — | api | 8.2 |
| GET | `/.well-known/orbes-keys.json` | — | — | api | 8.2 |
| GET | `/api/v1/categories` | — | — | api | 8.3 |
| GET | `/api/v1/client-services` | — | — | api | 8.4 |
| GET | `/api/v1/media/:sha256` | — | — | media | 8.6 |
| GET | `/api/v1/lookbook` | — | — | api | 8.8 |
| GET | `/api/v1/lookbook/:slug` | — | — | api | 8.8 |
| GET | `/api/v1/drops` | — | — | api | 8.9 |
| GET | `/api/v1/drops/:id` | — | — | api | 8.9 |
| GET | `/api/v1/drops/:id/entries` | — | — | api | 8.9 |
| GET | `/api/v1/live` | — | — | live | 8.10 |
| GET | `/api/v1/live/next` | — | — | live | 8.10 |
| GET | `/api/v1/live/clock` | — | — | live | 8.10 |
| GET | `/api/v1/live/:id` | — | — | live | 8.10 |
| GET | `/api/v1/live/:id/calendar.ics` | — | — | live | 8.10 |
| POST | `/api/v1/live/:id/board` | — (the board link's secret) | origin only | live | 8.10 |
| POST | `/api/v1/live/:id/board/stream` | — (the board link's secret) | origin only | live | 8.10 |
| GET | `/api/v1/releases/past` | — | — | api | 8.11 |
| GET | `/api/v1/the-club` | — | — | api | 8.12 |
| GET | `/api/v1/releases/rules` | — | — | api | 8.13 |
| POST | `/api/v1/verify` | — (account cookie optional; a console cookie makes it a staff scan, §9.7) | — | verify | 9 |
| POST | `/api/v1/reports` | — (account cookie optional) | origin only | verify | 8.5 |
| POST | `/api/v1/certificates/lookup` | — | — | verify | 8.7 |
| POST | `/api/v1/certificates/pdf` | — | — | verify | 8.7 |
| POST | `/api/v1/account/register` | — | origin only | auth | 10.1 |
| POST | `/api/v1/account/login` | — | origin only | auth | 10.2 |
| POST | `/api/v1/account/logout` | Account (optional) | yes | api | 10.3 |
| POST | `/api/v1/account/password` | Account | yes | auth | 10.7 |
| POST | `/api/v1/account/recover` | — | origin only | auth | 10.8 |
| GET | `/api/v1/account/session` | Account (optional) | — | api | 10.4 |
| GET | `/api/v1/account/me` | Account | — | api | 10.4 |
| GET | `/api/v1/account/products` | Account | — | api | 10.5 |
| GET | `/api/v1/account/orders` | Account | — | api | 10.13 |
| GET | `/api/v1/account/orders/:id/invoice.pdf` | Account | — | api | 10.14 |
| GET | `/api/v1/account/orders/:id/credit-note.pdf` | Account | — | api | 10.14 |
| GET | `/api/v1/account/orders/:id/certificate.pdf` | Account | — | api | 10.14 |
| GET | `/api/v1/account/orders/:id/care-guide` | Account | — | api | 10.14 |
| POST | `/api/v1/account/orders/:id/claim-code` | Account | yes | api | 10.20 |
| POST | `/api/v1/account/orders/:id/claim-card.pdf` | Account | yes | api | 10.20 |
| POST | `/api/v1/account/orders/:id/register` | Account | yes | auth | 10.20 |
| GET | `/api/v1/account/participation` | Account | — | api | 10.15 |
| GET | `/api/v1/account/questions` | Account | — | api | 10.16 |
| GET | `/api/v1/account/products/:productId/care` | Account | — | api | 10.18 |
| POST | `/api/v1/account/products/:productId/care` | Account | yes | api | 10.18 |
| POST | `/api/v1/account/care/:id/cancel` | Account | yes | api | 10.18 |
| GET | `/api/v1/account/care/:id/label.pdf` | Account | — | api | 10.18 |
| GET | `/api/v1/account/sizes` | Account | — | api | 10.19 |
| PUT | `/api/v1/account/sizes` | Account | yes | api | 10.19 |
| GET | `/api/v1/account/messages` | Account | — | api | 10.17 |
| POST | `/api/v1/account/messages` | Account | yes | api | 10.17 |
| POST | `/api/v1/account/messages/read` | Account | yes | api | 10.17 |
| GET | `/api/v1/account/messages/unread` | Account | — | api | 10.17 |
| GET | `/api/v1/products/:productId/service-history` | Account (current owner) | — | api | 10.6 |
| POST | `/api/v1/ownership/register` | Account | yes | auth | 11.1 |
| POST | `/api/v1/ownership/transfers` | Account (current owner) | yes | api | 11.2 |
| POST | `/api/v1/ownership/transfers/accept` | Account | yes | auth | 11.3 |
| POST | `/api/v1/ownership/transfers/cancel` | Account (sender) | yes | api | 11.4 |
| POST | `/api/v1/ownership/incidents` | Account (current owner) | yes | api | 11.5 |
| POST | `/api/v1/ownership/incidents/resolve` | Account (current owner) + the account's password | yes | auth | 11.6 |
| POST | `/api/v1/ownership/certificates` | Account (current owner) | yes | api | 11.7 |
| GET | `/api/v1/ownership/certificates` | Account | — | api | 11.7 |
| DELETE | `/api/v1/ownership/certificates/:id` | Account (the link's owner) | yes | api | 11.7 |
| GET | `/api/v1/club/lookbook` | Account (an owner of a piece) | — | api | 10.9 |
| GET | `/api/v1/club/lookbook/:slug` | Account (an owner of a piece; a RESERVED sheet from its tier) | — | api | 10.9 |
| POST | `/api/v1/club/lookbook/:slug/request` | Account (an owner, from the model's tier) | yes | api | 10.9 |
| GET | `/api/v1/club/status` | Account | — | api | 10.10 |
| POST | `/api/v1/club/drops/:id/enter` | Account | yes | api | 10.10 |
| POST | `/api/v1/club/drops/:id/withdraw` | Account | yes | api | 10.10 |
| POST | `/api/v1/club/drops/:id/reserve` | Account (PLATINE or PALLADIUM now) | yes | api | 10.10 |
| GET | `/api/v1/club/circle` | Account (an owner of a piece) | — | api | 10.11 |
| GET | `/api/v1/club/circle/:id` | Account (an owner, from the post's tier) | — | api | 10.11 |
| POST | `/api/v1/club/circle/:id/rsvp` | Account (an owner, from the post's tier) | yes | api | 10.11 |
| POST | `/api/v1/club/circle/:id/vote` | Account (an owner, from the post's tier) | yes | api | 10.11 |
| GET | `/api/v1/live/mine` | Account | — | live | 10.12 |
| GET | `/api/v1/live/:id/after-room` | Account (a guest of the release's after-room, from its T0) | — | live | 10.12 |
| GET | `/api/v1/live/:id/state` | Account (the release's rule, or an entry) | — | live | 10.12 |
| GET | `/api/v1/live/:id/stream` | Account (the release's rule, or an entry) | — | live | 10.12 |
| PUT | `/api/v1/live/:id/interest` | Account (the release's rule) | yes | live | 10.12 |
| DELETE | `/api/v1/live/:id/interest` | Account | yes | live | 10.12 |
| POST | `/api/v1/live/:id/enter` | Account (the release's rule) | yes | live | 10.12 |
| POST | `/api/v1/live/:id/size` | Account | yes | live | 10.12 |
| POST | `/api/v1/live/:id/leave` | Account | yes | live | 10.12 |
| POST | `/api/v1/live/:id/press` | Account (its turn) | yes | live | 10.12 |
| POST | `/api/v1/live/:id/secure` | Account (its turn, the release's rule) | yes | live | 10.12 |
| PUT | `/api/v1/live/:id/addons` | Account (a piece held) | yes | live | 10.12 |
| POST | `/api/v1/live/:id/confirm` | Account (a piece held) | yes | live | 10.12 |
| POST | `/api/v1/live/:id/release` | Account (a piece held) | yes | live | 10.12 |
| GET | `/api/v1/live/:id/question` | Account | — | live | 10.16 |
| PUT | `/api/v1/live/:id/answer` | Account (asked the question, while it is open) | yes | live | 10.16 |
| POST | `/api/admin/auth/login` | — | origin only | auth | 12.1 |
| POST | `/api/admin/auth/logout` | RETAIL (optional) | yes | admin | 12.2 |
| GET | `/api/admin/auth/me` | RETAIL | — | admin | 12.3 |
| POST | `/api/admin/auth/password` | RETAIL | yes | auth | 12.5 |
| POST | `/api/admin/auth/totp/setup` | RETAIL | yes | auth | 12.4 |
| POST | `/api/admin/auth/totp/enable` | RETAIL | yes | auth | 12.4 |
| GET | `/api/admin/dashboard` | AUDITOR | — | admin | 13.1 |
| GET | `/api/admin/system/status` | AUDITOR | — | admin | 13.5 |
| GET | `/api/admin/categories` | AUDITOR | — | admin | 13.2 |
| POST | `/api/admin/categories` | **ADMIN** | yes | admin | 13.2 |
| POST | `/api/admin/categories/:code/active` | **ADMIN** | yes | admin | 13.2 |
| GET | `/api/admin/collections` | AUDITOR | — | admin | 13.3 |
| POST | `/api/admin/collections` | OPERATOR | yes | admin | 13.3 |
| PATCH | `/api/admin/collections/:id` | OPERATOR | yes | admin | 13.3 |
| GET | `/api/admin/models` | AUDITOR | — | admin | 13.4 |
| POST | `/api/admin/models` | OPERATOR | yes | admin | 13.4 |
| GET | `/api/admin/models/:id` | AUDITOR | — | admin | 13.4 |
| PATCH | `/api/admin/models/:id` | OPERATOR | yes | admin | 13.4 |
| POST | `/api/admin/models/:id/variants` | OPERATOR | yes | admin | 13.4 |
| POST | `/api/admin/models/:id/image` | OPERATOR | yes | admin | 13.4 |
| DELETE | `/api/admin/models/:id/image` | OPERATOR | yes | admin | 13.4 |
| POST | `/api/admin/models/:id/gallery` | OPERATOR | yes | admin | 13.4 |
| PATCH | `/api/admin/models/:id/gallery` | OPERATOR | yes | admin | 13.4 |
| DELETE | `/api/admin/models/:id/gallery/:sha256` | OPERATOR | yes | admin | 13.4 |
| POST | `/api/admin/models/:id/discontinue` | **ADMIN** | yes | admin | 13.4 |
| POST | `/api/admin/models/:id/reinstate` | **ADMIN** | yes | admin | 13.4 |
| GET | `/api/admin/models/:id/sizes` | AUDITOR | — | admin | 13.4 |
| PUT | `/api/admin/models/:id/sizes` | OPERATOR | yes | admin | 13.4 |
| PUT | `/api/admin/models/:id/supplier` | OPERATOR (never LOGISTICS) | yes | admin | 16.33 |
| GET | `/api/admin/suppliers` | AUDITOR (never LOGISTICS) | — | admin | 16.33 |
| POST | `/api/admin/suppliers` | OPERATOR | yes | admin | 16.33 |
| PATCH | `/api/admin/suppliers/:id` | OPERATOR | yes | admin | 16.33 |
| GET | `/api/admin/supplier-orders` | AUDITOR (never LOGISTICS) | — | admin | 16.33 |
| GET | `/api/admin/supplier-orders/proposal` | AUDITOR (never LOGISTICS) | — | admin | 16.33 |
| POST | `/api/admin/supplier-orders/draft-lines` | OPERATOR | yes | admin | 16.33 |
| GET | `/api/admin/supplier-orders/:id` | AUDITOR (never LOGISTICS) | — | admin | 16.33 |
| PATCH | `/api/admin/supplier-orders/:id` | OPERATOR | yes | admin | 16.33 |
| DELETE | `/api/admin/supplier-orders/:id` | OPERATOR | yes | admin | 16.33 |
| POST | `/api/admin/supplier-orders/:id/send` | OPERATOR | yes | admin | 16.33 |
| POST | `/api/admin/supplier-orders/:id/supplier-confirmed` | OPERATOR | yes | admin | 16.33 |
| POST | `/api/admin/supplier-orders/:id/cancel-rest` | OPERATOR | yes | admin | 16.33 |
| GET | `/api/admin/supplier-orders/:id/pdf` | AUDITOR (never LOGISTICS) | — | admin | 16.33 |
| PUT | `/api/admin/supplier-orders/:id/invoice` | OPERATOR | yes | admin | 16.33 |
| POST | `/api/admin/supplier-orders/:id/invoice/paid` | OPERATOR | yes | admin | 16.33 |
| POST | `/api/admin/supplier-returns/:id/settle` | OPERATOR | yes | admin | 16.33 |
| GET | `/api/admin/logistics/stock` | LOGISTICS, AUDITOR, OPERATOR, ADMIN | — | admin | 16.33 |
| GET | `/api/admin/logistics/corrections` | LOGISTICS, AUDITOR, OPERATOR, ADMIN | — | admin | 16.33 |
| POST | `/api/admin/logistics/corrections` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.33 |
| POST | `/api/admin/logistics/corrections/:id/approve` | OPERATOR | yes | admin | 16.33 |
| POST | `/api/admin/logistics/corrections/:id/decline` | OPERATOR | yes | admin | 16.33 |
| POST | `/api/admin/logistics/transfers` | OPERATOR | yes | admin | 16.33 |
| PUT | `/api/admin/logistics/minimums` | OPERATOR | yes | admin | 16.33 |
| POST | `/api/admin/logistics/count-in` | OPERATOR | yes | admin | 16.33 |
| GET | `/api/admin/logistics/receptions` | LOGISTICS, AUDITOR, OPERATOR, ADMIN | — | admin | 16.33 |
| GET | `/api/admin/logistics/receptions/supplier-order` | LOGISTICS, OPERATOR, ADMIN | — | admin | 16.33 |
| GET | `/api/admin/logistics/receptions/lines/:supplierOrderId` | LOGISTICS, OPERATOR, ADMIN | — | admin | 16.33 |
| GET | `/api/admin/logistics/receptions/:id` | LOGISTICS, AUDITOR, OPERATOR, ADMIN | — | admin | 16.33 |
| POST | `/api/admin/logistics/receptions` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.33 |
| PUT | `/api/admin/logistics/receptions/:id` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.33 |
| POST | `/api/admin/logistics/receptions/:id/send-back` | OPERATOR | yes | admin | 16.33 |
| POST | `/api/admin/logistics/receptions/:id/confirm` | OPERATOR | yes | admin | 16.33 |
| POST | `/api/admin/logistics/receptions/:id/cards` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.33 |
| POST | `/api/admin/logistics/receptions/:id/cards-attached` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.33 |
| POST | `/api/admin/logistics/supplier-returns/:id/sent` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.33 |
| GET | `/api/admin/logistics/orders` | LOGISTICS, AUDITOR, OPERATOR, ADMIN | — | admin | 16.33 |
| GET | `/api/admin/logistics/orders/:id` | LOGISTICS, AUDITOR, OPERATOR, ADMIN | — | admin | 16.33 |
| POST | `/api/admin/logistics/orders/:id/packing` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.33 |
| POST | `/api/admin/logistics/orders/:id/packing/scan` | LOGISTICS, OPERATOR, ADMIN | yes | verify | 16.33 |
| PUT | `/api/admin/logistics/orders/:id/packing/photo` | LOGISTICS, OPERATOR, ADMIN | yes | media | 16.33 |
| POST | `/api/admin/logistics/orders/:id/packing/check` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.33 |
| POST | `/api/admin/logistics/orders/:id/ship` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.33 |
| POST | `/api/admin/logistics/orders/:id/delivered` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.33 |
| GET | `/api/admin/logistics/shipments/:id/photo` | LOGISTICS, AUDITOR, OPERATOR, ADMIN | — | admin | 16.33 |
| POST | `/api/admin/logistics/orders/:id/order-case` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.34 |
| GET | `/api/admin/logistics/order-cases` | LOGISTICS, AUDITOR, OPERATOR, ADMIN | — | admin | 16.34 |
| POST | `/api/admin/logistics/order-cases/:id/received` | LOGISTICS, OPERATOR, ADMIN | yes | admin | 16.34 |
| POST | `/api/admin/orders/:id/case` | OPERATOR | yes | admin | 16.34 |
| GET | `/api/admin/order-cases/:id` | AUDITOR | — | admin | 16.34 |
| POST | `/api/admin/order-cases/:id/decide` | OPERATOR (LOST and ARCHIVED: ADMIN) | yes | admin | 16.34 |
| POST | `/api/admin/order-cases/:id/cancel` | OPERATOR | yes | admin | 16.34 |
| POST | `/api/admin/models/:id/sizes/:skuId/remove` | OPERATOR | yes | admin | 13.4 |
| POST | `/api/admin/models/:id/sizes/:skuId/reinstate` | OPERATOR | yes | admin | 13.4 |
| PUT | `/api/admin/models/:id/pairs` | OPERATOR | yes | admin | 13.4 |
| GET | `/api/admin/products` | AUDITOR | — | admin | 14.1 |
| POST | `/api/admin/products` | **ADMIN** | yes | admin | 14.2 |
| POST | `/api/admin/products/batch` | **ADMIN** | yes | admin | 14.11 |
| GET | `/api/admin/products/:productId` | AUDITOR | — | admin | 14.3 |
| POST | `/api/admin/products/:productId/transitions` | OPERATOR (**ADMIN** for `to: REVOKED` or `RETIRED`) | yes | admin | 14.4 |
| POST | `/api/admin/products/:productId/reinstate` | **ADMIN** | yes | admin | 14.5 |
| POST | `/api/admin/products/:productId/codes/reissue` | OPERATOR | yes | admin | 15.1 |
| POST | `/api/admin/products/:productId/claim-code` | OPERATOR | yes | admin | 15.10 |
| POST | `/api/admin/products/:productId/warranty/activate` | OPERATOR | yes | admin | 14.6 |
| POST | `/api/admin/products/:productId/warranty/extend` | OPERATOR | yes | admin | 14.7 |
| POST | `/api/admin/products/:productId/warranty/void` | OPERATOR | yes | admin | 14.7 |
| POST | `/api/admin/products/:productId/services` | OPERATOR | yes | admin | 14.8 |
| POST | `/api/admin/services/:id/complete` | OPERATOR | yes | admin | 14.9 |
| POST | `/api/admin/products/:productId/ownership/confirm` | OPERATOR | yes | admin | 14.10 |
| POST | `/api/admin/products/:productId/photo` | OPERATOR | yes | admin | 14.12 |
| DELETE | `/api/admin/products/:productId/photo` | OPERATOR | yes | admin | 14.12 |
| GET | `/api/admin/codes/:codeId/artifact.:format` | **OPERATOR** | — | admin | 15.2 |
| POST | `/api/admin/codes/print-sheet` | OPERATOR | yes | admin | 15.3 |
| POST | `/api/admin/codes/print-sheet/manifest` | OPERATOR | yes | admin | 15.8 |
| POST | `/api/admin/certificates` | **OPERATOR** | yes | admin | 15.7 |
| POST | `/api/admin/codes/:codeId/revoke` | **ADMIN** | yes | admin | 15.4 |
| GET | `/api/admin/codes` | AUDITOR | — | admin | 15.5 |
| GET | `/api/admin/codes/ids` | AUDITOR | — | admin | 15.9 |
| GET | `/api/admin/genomes` | AUDITOR | — | admin | 15.6 |
| GET | `/api/admin/scans` | AUDITOR | — | admin | 16.1 |
| GET | `/api/admin/owners` | AUDITOR | — | admin | 16.2 |
| GET | `/api/admin/owners/:id` | AUDITOR | — | admin | 16.11 |
| POST | `/api/admin/owners/:id/recovery-code` | **ADMIN** | yes | admin | 16.10 |
| POST | `/api/admin/owners/:id/lock` | **ADMIN** | yes | admin | 16.12 |
| POST | `/api/admin/owners/:id/unlock` | **ADMIN** | yes | admin | 16.12 |
| GET | `/api/admin/owners/:id/export` | **ADMIN** | — | admin | 16.13 |
| GET | `/api/admin/warranties` | AUDITOR | — | admin | 16.3 |
| GET | `/api/admin/anomalies` | AUDITOR | — | admin | 16.4 |
| GET | `/api/admin/anomalies/summary` | AUDITOR | — | admin | 16.14 |
| GET | `/api/admin/anomalies/:id/context` | AUDITOR | — | admin | 16.15 |
| GET | `/api/admin/analytics` | AUDITOR | — | admin | 16.16 |
| GET | `/api/admin/analytics/circle` | AUDITOR | — | admin | 16.16 |
| GET | `/api/admin/analytics/best-time` | AUDITOR | — | admin | 16.16 |
| GET | `/api/admin/growth` | AUDITOR | — | admin | 16.31 |
| GET | `/api/admin/growth/collectors` | AUDITOR | — | admin | 16.31 |
| GET | `/api/admin/growth/releases` | AUDITOR | — | admin | 16.31 |
| PATCH | `/api/admin/anomalies/:id` | OPERATOR | yes | admin | 16.5 |
| GET | `/api/admin/reports` | AUDITOR | — | admin | 16.8 |
| PATCH | `/api/admin/reports/:id` | OPERATOR | yes | admin | 16.9 |
| GET | `/api/admin/revocations` | AUDITOR | — | admin | 16.6 |
| POST | `/api/admin/revocations` | **ADMIN** | yes | admin | 16.7 |
| GET | `/api/admin/retailers` | RETAIL, AUDITOR, OPERATOR, ADMIN (never LOGISTICS) | — | admin | 16.17 |
| POST | `/api/admin/retailers` | **ADMIN** | yes | admin | 16.17 |
| PATCH | `/api/admin/retailers/:id` | **ADMIN** | yes | admin | 16.17 |
| POST | `/api/admin/sale/lookup` | RETAIL, OPERATOR, ADMIN | yes | verify | 16.18 |
| POST | `/api/admin/sale/activate` | RETAIL, OPERATOR, ADMIN | yes | admin | 16.18 |
| GET | `/api/admin/drops` | AUDITOR | — | admin | 16.19 |
| POST | `/api/admin/drops` | OPERATOR | yes | admin | 16.19 |
| GET | `/api/admin/drops/:id` | AUDITOR | — | admin | 16.19 |
| PATCH | `/api/admin/drops/:id` | OPERATOR | yes | admin | 16.19 |
| POST | `/api/admin/drops/:id/publish` | OPERATOR | yes | admin | 16.19 |
| POST | `/api/admin/drops/:id/cancel` | OPERATOR | yes | admin | 16.19 |
| POST | `/api/admin/drops/:id/draw` | **ADMIN** | yes | admin | 16.19 |
| GET | `/api/admin/drops/:id/entries` | AUDITOR | — | admin | 16.19 |
| POST | `/api/admin/drops/:id/entries/:entryId/confirm` | OPERATOR | yes | admin | 16.19 |
| POST | `/api/admin/drops/:id/entries/:entryId/lapse` | OPERATOR | yes | admin | 16.19 |
| POST | `/api/admin/drops/:id/offer-next` | OPERATOR | yes | admin | 16.19 |
| POST | `/api/admin/drops/:id/test-runs` | **ADMIN** | yes | admin | 16.32 |
| GET | `/api/admin/drops/:id/test-runs/current` | AUDITOR | — | admin | 16.32 |
| GET | `/api/admin/drops/:id/test-runs` | AUDITOR | — | admin | 16.32 |
| GET | `/api/admin/test-runs/active` | AUDITOR | — | admin | 16.32 |
| POST | `/api/admin/test-runs/:id/add` | **ADMIN** | yes | admin | 16.32 |
| POST | `/api/admin/test-runs/:id/stop` | **ADMIN** | yes | admin | 16.32 |
| POST | `/api/admin/test-runs/:id/entrants/:accountId/confirm` | **ADMIN** | yes | admin | 16.32 |
| POST | `/api/admin/test-runs/:id/entrants/:accountId/release` | **ADMIN** | yes | admin | 16.32 |
| POST | `/api/admin/test-runs/:id/end` | **ADMIN** | yes | admin | 16.32 |
| GET | `/api/admin/circle/posts` | AUDITOR | — | admin | 16.20 |
| POST | `/api/admin/circle/posts` | OPERATOR | yes | admin | 16.20 |
| GET | `/api/admin/circle/posts/:id` | AUDITOR | — | admin | 16.20 |
| PATCH | `/api/admin/circle/posts/:id` | OPERATOR | yes | admin | 16.20 |
| POST | `/api/admin/circle/posts/:id/publish` | OPERATOR | yes | admin | 16.20 |
| POST | `/api/admin/circle/posts/:id/unpublish` | OPERATOR | yes | admin | 16.20 |
| GET | `/api/admin/circle/posts/:id/answers` | AUDITOR | — | admin | 16.20 |
| POST | `/api/admin/circle/posts/:id/photos` | OPERATOR | yes | admin | 16.20 |
| PATCH | `/api/admin/circle/posts/:id/photos` | OPERATOR | yes | admin | 16.20 |
| DELETE | `/api/admin/circle/posts/:id/photos/:sha256` | OPERATOR | yes | admin | 16.20 |
| GET | `/api/admin/club/tiers` | AUDITOR | — | admin | 16.21 |
| PATCH | `/api/admin/club/tiers/:tier` | OPERATOR | yes | admin | 16.21 |
| GET | `/api/admin/club/program` | AUDITOR | — | admin | 16.21 |
| PUT | `/api/admin/club/program` | **ADMIN** | yes | admin | 16.21 |
| GET | `/api/admin/club/requests` | AUDITOR | — | admin | 16.22 |
| POST | `/api/admin/club/requests/:id/close` | OPERATOR | yes | admin | 16.22 |
| GET | `/api/admin/messages` | AUDITOR | — | admin | 16.28 |
| GET | `/api/admin/messages/summary` | AUDITOR | — | admin | 16.28 |
| GET | `/api/admin/messages/:id` | AUDITOR | — | admin | 16.28 |
| POST | `/api/admin/messages/:id/answer` | OPERATOR | yes | admin | 16.28 |
| POST | `/api/admin/messages/:id/take` | OPERATOR | yes | admin | 16.28 |
| POST | `/api/admin/messages/:id/assign` | ADMIN | yes | admin | 16.28 |
| POST | `/api/admin/messages/:id/close` | OPERATOR | yes | admin | 16.28 |
| GET | `/api/admin/care` | AUDITOR | — | admin | 16.29 |
| GET | `/api/admin/care/:id` | AUDITOR | — | admin | 16.29 |
| POST | `/api/admin/care/:id/label` | OPERATOR | yes | admin | 16.29 |
| POST | `/api/admin/care/:id/receive` | OPERATOR | yes | admin | 16.29 |
| POST | `/api/admin/care/:id/return` | OPERATOR | yes | admin | 16.29 |
| POST | `/api/admin/care/:id/complete` | OPERATOR | yes | admin | 16.29 |
| POST | `/api/admin/care/:id/cancel` | OPERATOR | yes | admin | 16.29 |
| POST | `/api/admin/owners/:id/guarantees` | OPERATOR | yes | admin | 16.30 |
| PATCH | `/api/admin/guarantees/:id` | OPERATOR | yes | admin | 16.30 |
| POST | `/api/admin/guarantees/:id/revoke` | OPERATOR | yes | admin | 16.30 |
| GET | `/api/admin/drops/:id/guarantees` | AUDITOR | — | admin | 16.30 |
| GET | `/api/admin/settings/guarantees` | AUDITOR | — | admin | 16.30 |
| PUT | `/api/admin/settings/guarantees` | **ADMIN** | yes | admin | 16.30 |
| GET | `/api/admin/live` | AUDITOR | — | admin | 16.23 |
| POST | `/api/admin/live` | OPERATOR | yes | admin | 16.23 |
| GET | `/api/admin/live/:id` | AUDITOR | — | admin | 16.23 |
| PATCH | `/api/admin/live/:id` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/publish` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/circle-post` | OPERATOR | yes | admin | 16.23 |
| DELETE | `/api/admin/live/:id/circle-post` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/cancel` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/silhouette` | OPERATOR | yes | admin | 16.23 |
| DELETE | `/api/admin/live/:id/silhouette` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/board-link` | OPERATOR | yes | admin | 16.23 |
| DELETE | `/api/admin/live/:id/board-link` | OPERATOR | yes | admin | 16.23 |
| GET | `/api/admin/live/:id/board` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/stream` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/entries` | AUDITOR | — | admin | 16.23 |
| POST | `/api/admin/live/:id/pause` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/resume` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/extend` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/stock` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/messages` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/end` | **ADMIN** | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/entries/:entryId/free` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/entries/:entryId/let-in` | OPERATOR | yes | admin | 16.23 |
| POST | `/api/admin/live/:id/entries/:entryId/remove` | **ADMIN** | yes | admin | 16.23 |
| GET | `/api/admin/live/:id/plan` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/forecast` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/radar` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/bots` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/report` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/report.csv` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/collectors` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/comparison` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/size-mix` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/feasibility` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/live/:id/best-time` | AUDITOR | — | admin | 16.23 |
| GET | `/api/admin/orders` | AUDITOR | — | admin | 16.24 |
| GET | `/api/admin/orders.csv` | AUDITOR | — | admin | 16.24 |
| GET | `/api/admin/orders/alerts` | AUDITOR | — | admin | 16.24 |
| PUT | `/api/admin/orders/alerts` | **ADMIN** | yes | admin | 16.24 |
| GET | `/api/admin/orders/shipping-rates` | AUDITOR | — | admin | 16.24 |
| PUT | `/api/admin/orders/shipping-rates` | **ADMIN** | yes | admin | 16.24 |
| GET | `/api/admin/orders/:id` | AUDITOR | — | admin | 16.24 |
| POST | `/api/admin/orders/:id/transition` | OPERATOR | yes | admin | 16.24 |
| POST | `/api/admin/orders/:id/location` | OPERATOR | yes | admin | 16.24 |
| POST | `/api/admin/orders/:id/credit` | OPERATOR | yes | admin | 16.24 |
| DELETE | `/api/admin/orders/:id/credit` | OPERATOR | yes | admin | 16.24 |
| PATCH | `/api/admin/orders/:id/terms` | OPERATOR | yes | admin | 16.24 |
| PUT | `/api/admin/orders/:id/buyer` | OPERATOR | yes | admin | 16.24 |
| GET | `/api/admin/locations` | AUDITOR | — | admin | 16.24 |
| POST | `/api/admin/locations` | **ADMIN** | yes | admin | 16.24 |
| PATCH | `/api/admin/locations/:id` | **ADMIN** | yes | admin | 16.24 |
| GET | `/api/admin/carriers` | AUDITOR | — | admin | 16.24 |
| POST | `/api/admin/carriers` | **ADMIN** | yes | admin | 16.24 |
| PATCH | `/api/admin/carriers/:id` | **ADMIN** | yes | admin | 16.24 |
| GET | `/api/admin/invoices` | AUDITOR | — | admin | 16.25 |
| GET | `/api/admin/invoices.csv` | AUDITOR | — | admin | 16.25 |
| GET | `/api/admin/invoices/:id/pdf` | AUDITOR | — | admin | 16.25 |
| GET | `/api/admin/segments` | AUDITOR | — | admin | 16.26 |
| GET | `/api/admin/segments/names` | AUDITOR | — | admin | 16.26 |
| GET | `/api/admin/segments/options` | AUDITOR | — | admin | 16.26 |
| POST | `/api/admin/segments/count` | OPERATOR | yes | admin | 16.26 |
| POST | `/api/admin/segments` | OPERATOR | yes | admin | 16.26 |
| GET | `/api/admin/segments/:id` | AUDITOR | — | admin | 16.26 |
| PATCH | `/api/admin/segments/:id` | OPERATOR | yes | admin | 16.26 |
| DELETE | `/api/admin/segments/:id` | OPERATOR | yes | admin | 16.26 |
| GET | `/api/admin/segments/:id/members.csv` | AUDITOR | — | admin | 16.26 |
| GET | `/api/admin/shopify/products.csv` | AUDITOR | — | admin | 16.27 |
| GET | `/api/admin/models/:id/shopify` | AUDITOR | — | admin | 16.27 |
| PUT | `/api/admin/models/:id/shopify` | OPERATOR | yes | admin | 16.27 |
| GET | `/api/admin/shopify/orders.csv` | AUDITOR | — | admin | 16.27 |
| GET | `/api/admin/keys` | AUDITOR | — | admin | 17.1 |
| POST | `/api/admin/keys/rotate` | **ADMIN** | yes | admin | 17.2 |
| POST | `/api/admin/keys/:keyId/retire` | **ADMIN** | yes | admin | 17.3 |
| POST | `/api/admin/keys/:keyId/revoke` | **ADMIN** | yes | admin | 17.4 |
| GET | `/api/admin/audit` | AUDITOR | — | admin | 17.5 |
| GET | `/api/admin/audit/verify` | AUDITOR | — | admin | 17.6 |
| GET | `/api/admin/admins` | **ADMIN** | — | admin | 17.7 |
| POST | `/api/admin/admins` | **ADMIN** | yes | admin | 17.8 |
| PATCH | `/api/admin/admins/:id/role` | **ADMIN** | yes | admin | 17.9 |
| POST | `/api/admin/admins/:id/disable` | **ADMIN** | yes | admin | 17.10 |
| POST | `/api/admin/admins/:id/enable` | **ADMIN** | yes | admin | 17.10 |
| POST | `/api/admin/admins/:id/unlock` | **ADMIN** | yes | admin | 17.11 |
| GET | `/api/admin/admins/:id/sessions` | **ADMIN** | — | admin | 17.12 |
| DELETE | `/api/admin/admins/:id/sessions` | **ADMIN** | yes | admin | 17.12 |
| POST | `/api/admin/admins/:id/totp/reset` | **ADMIN** | yes | admin | 17.13 |

Extensions of the platform contract: `GET /api/v1/account/session`, `GET /api/v1/client-services`, the photographs (`GET /api/v1/media/:sha256`, `/api/admin/models/:id/image`, `/api/admin/products/:productId/photo`; F-04), the lookbook (`GET /api/v1/lookbook` and `/:slug`, the club's `GET /api/v1/club/lookbook` and `/:slug`, `GET /api/admin/models/:id`, the lookbook's fields of `PATCH /api/admin/models/:id`, `/api/admin/models/:id/gallery`; P-R02, and `product.lookbook` of a verification), the releases (`GET /api/v1/drops`, `/:id` and `/:id/entries`, the club's `GET /api/v1/club/status` and `POST /api/v1/club/drops/:id/enter` and `/withdraw`, every `/api/admin/drops` route, the lock's `dropEntriesWithdrawn` and the export's `dropEntries`; P-R03), the early access (`earlyAccessHours`, `earlyAccessOpensAt`, `earlyAccessOpen` and `reserved` of the releases, `POST /api/v1/club/drops/:id/reserve`; P-X02), the circle (`/api/v1/club/circle` and its routes, every `/api/admin/circle/posts` route, `GET /api/admin/analytics/circle`, the export's `circleAnswers` and `circleVotes`; P-X01), the tiers (`benefits` and `next` of `GET /api/v1/club/status`, `/api/admin/club/tiers`, the owner's sheet's `tier`; P-X04), the ceremony's flag of the verify app (client side only; P-D01), ORBES Care (`careSubscribeUrl` of `GET /api/v1/client-services` and `care` of `GET /api/v1/account/products`; P-M02), a model discontinued (`POST /api/admin/models/:id/discontinue` and `/reinstate`, `discontinuedAt` of a model, `discontinuedYear` of a verification's `product`, of a lookbook sheet and of a certificate's `piece`; P-R06), a model's variants and a draw's price (`POST /api/admin/models/:id/variants`, a model's `variantOf`, `variantLabel`, `variantSwatch` and `variants`, the lookbook's `variant` and `variants`, the `modelVariant` of a verification's `product`, of a piece and of an order, the `variant` of a release's model, a draw's `priceMinor` and `currency`; plan NOCTURNE), THE PRIVATE SALON (`priceLabel` and `minTier` of the club's cards, its `opensAt` (plan NOCTURNE), `salon` of its sheets, `POST /api/v1/club/lookbook/:slug/request`, `priceLabel` and `privateMinTier` of a model, `/api/admin/club/requests` and its `close`, the lock's `shopRequestsClosed` and the export's `shopRequests`; P-X08), the LIVE RELEASES (every `/api/v1/live` and `/api/admin/live` route, the lock's `liveEntriesRemoved` and `liveInterestWithdrawn`, the export's `liveEntries` and `liveInterest`; plan of 2026-10-04), the account's orders and their documents (`GET /api/v1/account/orders` and its `/invoice.pdf`, `/credit-note.pdf`, `/certificate.pdf` and `/care-guide`, the export's `invoices` of each order; plan LIVE RELEASE+), NEW CLAIM CODE (`POST /api/admin/products/:productId/claim-code`, the product page's and the order page's `claimCode`, an account order's `claimCode`, `POST /api/v1/account/orders/:id/claim-code`, `/claim-card.pdf` and `/register`, the export's `claimCodes`; plan NEXT LOT §3.4), the invoices of the console (`/api/admin/invoices`, `.csv`, `/:id/pdf`) and a return (an order case since plan NEXT LOT step 5.11e: `POST /api/admin/orders/:id/case`), THE RELEASES' PAST and the account's part in the releases (`GET /api/v1/releases/past`, `GET /api/v1/account/participation`, the final state of a LIVE RELEASE's page once over; plan LIVE RELEASE+), the segments (every `/api/admin/segments` route, a post's `segmentId`) and a LIVE RELEASE's rules of taking part and of a segment, how they combine, and its surprise (the settings' `minParticipations`, `accessSegmentId`, `accessCombine`, `surpriseEnabled`, `surpriseText`; a card's `surprise`, the state's `access.participations`), the question after and the stock and timing of a LIVE RELEASE (`GET /api/v1/live/:id/question`, `PUT /api/v1/live/:id/answer`, `GET /api/v1/account/questions`, the export's `releaseAnswers`, the settings' `questionEnabled`, `questionText`, `questionAnswers` and `stockLocationId`, `GET /api/admin/live/size-mix`, `/api/admin/live/:id/feasibility`, `/api/admin/live/:id/best-time` and `GET /api/admin/analytics/best-time`; plan LIVE RELEASE+), MESSAGES (every `/api/v1/account/messages` and `/api/admin/messages` route, the owner's sheet's `messages`, the export's `messages`, a salon request's `modelId`; plan NEXT-NINE, CS-01), THE PROGRAM and the shipping rates (`/api/admin/club/program`, `/api/admin/orders/shipping-rates`; plan NEXT-NINE, BP-19 T2), the welcome gift and the credit (`/api/admin/orders/:id/credit`, an order's `gift`, `giftOf` and `credit`, an account order's `withOrder`, `giftTier` and `creditMinor`; BP-19 T5), the yearly care (`/api/v1/account/products/:productId/care`, `/api/v1/account/care/:id/cancel` and `/label.pdf`, every `/api/admin/care` route, a Messages row's and a conversation's `care`, the export's `careRequests`; BP-19 T6), YOUR SIZES (`/api/v1/account/sizes`, `/api/admin/models/:id/sizes`, a LIVE state's `savedSize`, the salon's `sizes`, `suggestedSize` and request `size`, a GIFT order's `giftOf.savedSize`, the export's `sizes`; plan NEXT-NINE, AC-01), THE RELEASES OF THIS MODEL and PAIRS WELL WITH (a lookbook sheet's `releases` and `pairs`, `PUT /api/admin/models/:id/pairs`, a model's `pairs` and `pairsFallback`; plan NEXT-NINE, CO-01 and BP-34), GROWTH (every `/api/admin/growth` route, the owner's sheet's `lifetimeValue`; plan NEXT-NINE, BP-29), the client sheet and Shopify readiness (the owner's sheet's `orders`, `releases`, `answers`, `interest`, `segments` and `notes`; a model's `basePriceMinor`, `baseCurrency`, `careGuide` and `shopify`; every `/api/admin/shopify` route and `/api/admin/models/:id/shopify`; plan LIVE RELEASE+), `POST /api/v1/reports`, `POST /api/v1/account/password`, `POST /api/v1/account/recover`, `POST /api/v1/ownership/incidents/resolve` and the `incidentResolvable` and `incidentReportable` of `GET /api/v1/account/products`, the ownership certificates (`/api/v1/ownership/certificates`, `/api/v1/certificates/lookup` and `/pdf`, F-06), the owners' search (`?email=`, `?ref=`), `/api/admin/owners/:id` with its `recovery-code`, `lock`, `unlock` and `export`, `/api/admin/reports`, the catalogue's edits (`POST /api/admin/categories/:code/active`, `PATCH /api/admin/collections/:id`, `PATCH /api/admin/models/:id`), `/api/admin/auth/password`, `/api/admin/auth/totp/setup`, `/api/admin/auth/totp/enable`, `/api/admin/products/batch`, `/api/admin/codes/print-sheet`, `/api/admin/codes/print-sheet/manifest`, `/api/admin/codes/ids`, the filters of `GET /api/admin/codes` and the `productionBatch` filter of `GET /api/admin/products`, the `scanId` and the `from` / `to` window of `GET /api/admin/scans`, the `type`, `productId`, `sort` and `id` of `GET /api/admin/anomalies`, `/api/admin/anomalies/summary`, `/api/admin/anomalies/:id/context`, `/api/admin/analytics`, `/api/admin/certificates`, `/api/admin/products/:productId/warranty/extend`, every `/api/admin/admins` route, and the points of sale and sale mode routes (`/api/admin/retailers`, `/api/admin/sale/*`). There is no HTTP endpoint for creating ADMIN users or granting the ADMIN role (the first ADMIN is bootstrapped from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`; further ADMINs with `scripts/admin.ts create` or `role`, see [DEPLOYMENT](DEPLOYMENT.md)) or cancelling service records; those operations exist only in the services and command-line tools. A customer changes their password with §10.7, or recovers it through ORBES Client Services with §10.8; a console user changes their own with §12.5.

---

## 8. Public endpoints

### 8.1 `GET /api/v1/health`

Liveness plus a database round trip (2-second timeout).

| Status | Body |
|---|---|
| 200 | `{ "ok": true, "version": "0.1.0" }` |
| 503 | `{ "ok": false, "version": "0.1.0" }` (the reason goes to the server log only) |

`version` is the package version (`"unknown"` when it cannot be read).

### 8.2 `GET /api/v1/keys` and `GET /.well-known/orbes-keys.json`

The public Ed25519 keys, for third-party verifiers. Both paths return the same body. Every key is listed, whatever its status, ordered by `keyId`. No private material, provider or provider reference is ever included.

Headers: `Cache-Control: public, max-age=300`, `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`. The server caches the list for up to 30 seconds, so a key change made on another instance can take that long to appear.

```json
{
  "keys": [
    {
      "keyId": 1,
      "kid": "orbes-k001-20261001-ecc8",
      "alg": "Ed25519",
      "publicKey": "Em52oGgfCA-C4HaBsDo_2xhItRLmVz3h6Ialrg0xyXA",
      "status": "ACTIVE",
      "activatedAt": "2026-10-01T08:13:21.929Z",
      "retiredAt": null,
      "revokedAt": null,
      "compromisedAt": null
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `keyId` | integer 1–255 | The value carried in byte 1 of every code payload. |
| `kid` | string | Human-readable label. |
| `alg` | `"Ed25519"` | |
| `publicKey` | string | base64url (no padding) of the 32-byte public key. |
| `status` | `"ACTIVE"` \| `"RETIRED"` \| `"REVOKED"` | ACTIVE signs new codes; RETIRED only verifies; REVOKED: see §19.4. |
| `activatedAt`, `retiredAt`, `revokedAt` | ISO timestamp or `null` | |
| `compromisedAt` | ISO timestamp or `null` | REVOKED keys only, when a compromise time was given. The trust cut-off: codes recorded strictly before `compromisedAt` (or, when it is `null`, before `revokedAt`) keep verifying; anything else the key signed is refused. Published so offline verifiers can apply the cut-off (§19.3). The revocation reason is never published. |

### 8.3 `GET /api/v1/categories`

Active categories. `Cache-Control: public, max-age=60`. The body is an array (not wrapped):

```json
[ { "code": "J", "index": 1, "name": "Jewelry" } ]
```

`index` is the immutable 5-bit category index packed into product identities (1–31); `code` is the letter used in canonical product ids.

### 8.4 `GET /api/v1/client-services`

How ORBES Client Services is reached, as the brand configured it (`CLIENT_SERVICES_EMAIL`, `CLIENT_SERVICES_PHONE`, `CLIENT_SERVICES_HOURS`; [DEPLOYMENT §3.1](DEPLOYMENT.md#31-variables)). Public, no session, rate group `api`. `Cache-Control: public, max-age=300`, so a change of the details reaches browsers within 5 minutes of a restart.

```json
{ "email": "clientservices@theorbes.com", "phone": "+33 1 23 45 67 89", "hours": "Monday to Saturday, 10:00–19:00 (Paris)" }
```

| Field | Type | Notes |
|---|---|---|
| `email` | string, optional | A plain mailbox (letters, digits and `. _ + -`), safe to put in a `mailto:` link as it is. |
| `phone` | string, optional | International format as configured: `+`, then 7–15 digits with single spaces, dots or hyphens between them. |
| `hours` | string, optional | One line of plain text, at most 120 characters. Only ever served beside an email or a phone. |
| `careSubscribeUrl` | string, optional | (P-M02) Where SUBSCRIBE of ORBES Care leads, from the CARE tab of MY PIECES: an `https://` address without credentials and without spaces, at most 2 048 characters (`CARE_SUBSCRIBE_URL`, checked at startup, [DEPLOYMENT §3.1](DEPLOYMENT.md#31-variables)). Present only when it is set; the same 5-minute cache. |

Each field is present only when configured. With nothing configured the body is `{}` (200): the verification app shows no email under FORGOTTEN PASSWORD?, and no SUBSCRIBE (the CARE tab reads *Subscriptions open soon.*).

**What the verification app does with it** (plan NEXT-NINE, CS-01). The endpoint is unchanged; the collector app reads it **only** for FORGOTTEN PASSWORD's email and ORBES Care's SUBSCRIBE. Everywhere else the app sends the customer to ORBES Client Services, it shows the button **WRITE TO ORBES CLIENT SERVICES** (§10.17: a message to the console, answered in the account's MESSAGES; nothing is emailed), and never an email address, a phone number or the hours: on every caution and void result (UNUSUAL ACTIVITY DETECTED, UNREADABLE CODE, REVOKED, UNKNOWN ORBES CODE, INVALID SIGNATURE) under the help line, in the WARRANTY tab of an authentic result whose warranty is `VOID`, on a piece and in MY PIECES (its orders and its releases), on a draw's page, on the LIVE RELEASE's CONFIRMED and YOUR ENTRY IS REMOVED screens, and on a model of THE PRIVATE SALON once requested. The phone and the hours are no longer shown in the collector app.

- Under **FORGOTTEN PASSWORD?** in the OWNERSHIP panel, wherever it offers a sign-in (§10.8), the one place of the collector app where the email remains, for someone who also lost their recovery code: the text link **CONTACT ORBES CLIENT SERVICES**, a `mailto:` link whose subject is `ORBES — FORGOTTEN PASSWORD` and whose body leaves two empty lines for the customer, then `REFERENCE: {ref}`, the short scan reference on screen (CRLF-separated and percent-encoded, RFC 6068). Client Services first checks the customer's identity and then gives a one-time recovery code. Without an email set, nothing.
- The app reads it once, in parallel with its first verification; it never holds a result back for more than 1 s (`CONTACT_WAIT_MS`, `genome/src/web/verify/main.ts`), and the read itself gives up after 4 s (`CONTACT_TIMEOUT_MS`, `api.ts`). A read that fails gives `{}` and is tried again with the next.
- The app checks the email against the same rules as the server before building the link; anything else is dropped.

**The legal pages** (`/legal`) read it as before: the legal notice and the privacy policy show the email, the phone (a `tel:` link) and the hours (`genome/src/web/legal/main.ts` `fillContacts`), since French law requires a publisher's contact and the GDPR the controller's.

**ORBES Care** (P-M02). In the CARE tab of a piece's page in MY PIECES (§10.5), the app checks `careSubscribeUrl` again before it becomes a link (`shared/client-services.ts` `careSubscribeHref`: `https:` only, a host, no credentials, no space or control character, at most 2 048 characters; anything else reads as absent). SUBSCRIBE is then a link to it (the hairline button, plan NOCTURNE C35), opened in a new tab with `rel="noopener noreferrer"` (the page reached gets neither a referrer nor `window.opener`); nothing about the account or the piece is added to the address. Absent: *Subscriptions open soon.*, with nothing to press. No subscription and no payment exist in this system: the subscription, once open, is taken out on a third-party page (Whop), under that page's terms. Nothing is sent to the server when the customer uses it: the email goes from the customer's own mail application.

### 8.5 `POST /api/v1/reports`

Where the customer saw or bought the piece of a result that was **not authentic**, attached to that scan (C-02). It opens a case in the console's Cases queue (§16.8). No session is needed; a signed-in customer is recorded as the reporting account. Rate group `verify` (the same budget as the scan it follows). Unsafe and session-less, so the origin check of §2.2 applies (a cross-site form gets `403 CSRF_FAILED`); no CSRF token.

```json
{ "scanId": "5a864af8-0d6b-4c1e-9f2a-3b7c1d2e4f5a", "channel": "ONLINE", "where": "a marketplace listing", "note": "Offered at a third of the boutique price." }
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `scanId` | uuid | yes | The `scanId` of the verification (§9.2). |
| `channel` | string | yes | `BOUTIQUE`, `ONLINE`, `PRIVATE` (a private sale) or `OTHER`. |
| `where` | string | no | ≤ 200 characters after trimming: the boutique, the website, the city. `""`, blank text or `null` = not given. |
| `note` | string | no | ≤ 500 characters after trimming. `""`, blank text or `null` = not given. |

Control characters (other than tab and line breaks) and unknown fields are refused (`400 VALIDATION_FAILED`).

**201** `{ "ok": true }`. The report is accepted only for a scan that:

- is a customer's verification (`event_type` VERIFY) whose result was **not authentic**: `SUSPICIOUS_ACTIVITY`, `REVOKED`, `UNKNOWN`, `INVALID_SIGNATURE` or `MALFORMED_CODE`;
- is **less than 24 hours old** (`REPORT_WINDOW_MS`, `services/scan-reports.ts`);
- carries **no report yet**: one report per scan.

Otherwise `409 REPORT_NOT_ALLOWED` (unknown scans, authentic results and old scans answer alike) or `409 REPORT_ALREADY_SENT`. A **staff scan** (§9.7: the browser was signed in to the console, so the scan is `ADMIN_TEST`) takes no report either: the same `409 REPORT_NOT_ALLOWED`, with a message that says why, since scanning again from that browser would only record another staff scan (*This browser is signed in to the ORBES console, so this scan was recorded as a staff test and takes no report. Sign out of the console, or use another browser, to report as a customer.*). Only the browser that scanned holds the scan's random id, so this tells no one else anything.

The place and the note are the customer's own words: **personal data**. They are stored with the scan (`scan_reports`, [DATABASE §5.22](DATABASE.md#522-scan_reports)), shown only to an admin session, never copied into the audit log, and deleted with the scan by the scan-history purge ([DATABASE §10](DATABASE.md#10-housekeeping-and-retention), SECURITY-MODEL §3.6). The audit entry `scan.report` names the scan alone (`targetType` `scan`, `targetId` the scan id, empty details); its actor is the signed-in account, else `system` `public` with the IP pseudonym.

**What the verification app does with it.** Under the contact of ORBES Client Services (and under the certificate-card section when there is one), every result that was not authentic asks **WHERE DID YOU SEE OR BUY THIS PIECE?**, optional, unless it is a staff scan (`staffScan`, §9.2), which takes no report: one sentence, then the four answers BOUTIQUE, ONLINE, PRIVATE SALE and OTHER (pressed like the sign-in switch); once one is chosen, PLACE (OPTIONAL), NOTE (OPTIONAL, its hint asking the customer to leave out their name and contact details) and SEND ANSWER, a text link (the result's hairline button stays SCAN AGAIN). Sent, the section reads THANK YOU and the reference the answer is kept with; a refusal is shown as the server wrote it, and nothing typed is lost (`genome/src/web/verify/views/report.ts`).

### 8.6 `GET /api/v1/media/:sha256`

A photograph that an authentic result names (§9.2 `product.imageUrl`, F-04), as do the owner's list of pieces (§10.5), the lookbook (§8.8, §10.9; P-R02) and the circle (§10.11; P-X01): a model's reference photograph, a photograph of a model's gallery or a photograph of a circle post, uploaded in the console (§13.4, §16.20); and the photograph of one piece taken at issuance before plan NOCTURNE (§14.12), which only the console names (decision 9: no answer a collector receives names it). Public, no session, rate group `media` (§3: five times the `api` budget, since a lookbook sheet shows up to nine); `HEAD` too. A photograph of a model RESERVED for owners (THE PRIVATE SALON, P-X08), or of a circle post, is public all the same: unlisted, not confidential.

`:sha256` is the lower-case hexadecimal SHA-256 of the image's bytes (upper case is accepted and read as lower case): the URL names its content, so the answer never changes.

**200** — the image itself, `Content-Type: image/jpeg` or `image/webp`, with:

| Header | Value |
|---|---|
| `Cache-Control` | `public, max-age=31536000, immutable`: a browser keeps it for a year and never asks again. |
| `ETag` | `"<sha256>"`. A request with `If-None-Match` naming it answers **304** with no body, once the image is known to exist. |
| `X-Content-Type-Options` | `nosniff`, with the Content-Security-Policy of every response (§1.3). |

What is served is what was stored: a JPEG or a WebP of at most 1 MiB and 4 096 px a side, with its EXIF and XMP removed when it was uploaded (§13.4). An image that no model, no gallery, no circle post and no piece uses any more (replaced or removed) is deleted and answers 404.

Errors: `400 VALIDATION_FAILED` (not 64 hexadecimal characters), `404 MEDIA_NOT_FOUND`, both `Cache-Control: no-store`.

### 8.7 `POST /api/v1/certificates/lookup` and `POST /api/v1/certificates/pdf` (extension of the contract)

The **ownership certificate** (F-06): what a buyer at a distance, a resale platform or an insurer reads when the owner of a piece shares a link created in MY PIECES (§11.7). No session, no CSRF token (they only read); rate group `verify`, like a scan. Implementation: `services/ownership-certificates.ts`, `render/certificate.ts` (`renderOwnershipCertificatePdf`).

**The link** is `{PUBLIC_ORIGIN}/verify/c#{token}`: the token rides in the **fragment**, which a browser never sends, so it is never in a request line nor in the reverse proxy's access log (a path such as `/verify/c/{token}` would be written there). The verify app takes it from `location.hash` and sends it in the body:

```json
{ "token": "7Q2MZXKW4R8T1V0G3H5J6K9N2P4S6T8V0W2X4Y6Z8A1B3C5D7E9G" }
```

| Field | Type | Rules |
|---|---|---|
| `token` | string | 1–128 characters. The 32 random bytes of the link, written as 52 Crockford base32 characters; read in any spelling (lower case, hyphens and spaces ignored, `I`/`L` as `1`, `O` as `0`), as the PDF letters it in groups of four. A string that cannot be a token answers like an unknown one (404). |

**`lookup`, 200**, computed **live** at each request:

```json
{
  "status": "VALID",
  "checkedAt": "2026-10-03T12:34:56.000Z",
  "certificate": { "issuedAt": "2026-10-03T09:00:00.000Z", "expiresAt": "2027-01-01T09:00:00.000Z" },
  "piece": {
    "productId": "O26-J-00184",
    "category": { "code": "J", "name": "Jewelry" },
    "collection": "ORBIT",
    "model": "MONOLITHE",
    "modelVariant": "Steel",
    "type": "RING",
    "variant": null,
    "material": "925 STERLING SILVER",
    "createdYear": 2026,
    "genome": { "id": "O26-J-00184", "version": 1, "fingerprint": "G1-E1DC-BE52", "glyphs": [0, 11, 10, 13, 15, 0, 0, 13], "pattern": "…" },
    "discontinuedYear": null
  },
  "ownership": { "verified": true, "since": "2026-10-01" },
  "warranty": { "status": "ACTIVE", "startDate": "2026-09-20", "endDate": "2028-09-20" },
  "incidentReported": false
}
```

- **`VALID`**: the piece (the fields of a result's product lines and its GENOME; `modelVariant`, its model's label among its variants, plan NEXT LOT §3.1, read live from the model, or `null` for a model without one, while `variant` stays the piece's own Size field; and `discontinuedYear`: the UTC year its model was discontinued, P-R06, read live, or `null`; a reinstated model says it no more), the ownership (`verified`: by its claim code or by ORBES Client Services; `since`: the **day** it began, UTC), the warranty (as in §10.5), and `incidentReported: false`, no loss or theft reported. `checkedAt` is the moment of the reading.
- **`NO_LONGER_VALID`** (`{ "status": "NO_LONGER_VALID", "checkedAt": … }`, nothing else): the link has expired; or the piece **changed hands** (the ownership period the certificate was created in has ended: a transfer, or a change by ORBES Client Services); or the piece has been **LOST, STOLEN, REVOKED, COUNTERFEIT_FLAGGED or RETIRED since the certificate was created** (read from the status history: a piece found again, or reinstated, does not bring an earlier certificate back; its owner creates a new one). RETIRED, the terminal status, ends a certificate too.
- **`404 CERTIFICATE_NOT_FOUND`** for an unknown token, a malformed one and a link **withdrawn** (by its owner, or with the account's lock or assisted recovery, §11.7): one code and one message, so a withdrawn link says no more than one that never existed.
- **Never** a name, an email, an account, the ownership period's or the certificate's own id, nor the word AUTHENTIC: a certificate attests what the registry records, not the object it is shown with (BRAND §4.6). A scan of the piece's ORBES CODE, and the transfer bound to it (§11.3), remain what checks the object itself.

**`pdf`, 200**: the certificate as one A4 page, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="ORBES-ownership-certificate-{productId}-{YYYY-MM-DD}.pdf"` (the day of the reading), `Cache-Control: no-store`; never stored. Pure vector, no font: the lettering of the certificate card (stroked capitals), the GENOME in its orbit on an ivory plate, the monogram, the rows of the record (THE PIECE, with a DISCONTINUED row, the year, under CREATED once its model is discontinued, P-R06; THE RECORD), THIS CERTIFICATE (`VALID ON {day} · {hh:mm} UTC`, issued, valid until), what it does not attest, and **CHECK IT LIVE**: its link lettered (the address, then the token in groups of four) and as a link annotation, so whoever holds the page, printed or not, can check that it still holds. The lettering has capitals only, so the address prints as `VERIFY.THEORBES.COM/VERIFY/C#7Q2M-ZXKW-…`, and typed as printed it opens: the server answers any spelling of `/verify/c` but its own with `301` to `/verify/c` (§18; the browser keeps the fragment across the redirect, and the server never sees it), and the token is read in any case, with its hyphens. Deterministic for one record and one moment. `409 CERTIFICATE_NO_LONGER_VALID` when the certificate no longer holds (no PDF of it then); the same 404.

Lookups are not audited (they would flood the log); creation and withdrawal are (§11.7).

Errors: `400 VALIDATION_FAILED` (no `token`, not a string, over 128 characters, unknown field), `404 CERTIFICATE_NOT_FOUND`, `409 CERTIFICATE_NO_LONGER_VALID` (`pdf`), `429 RATE_LIMITED`.

**In the verify app:** `/verify/c#…` (§18) shows OWNERSHIP CERTIFICATE, its state (VALID, NO LONGER VALID, NOT FOUND) and one sentence; when valid, the piece in its écrin (the GENOME plate of MY PIECES), its lines (the last, *DISCONTINUED · 2027*, once its model is discontinued, P-R06), THE RECORD (OWNERSHIP, SINCE, WARRANTY, FROM, UNTIL, LOSS OR THEFT · NONE REPORTED), THIS CERTIFICATE (CHECKED, in the reader's time; ISSUED; VALID UNTIL), *A certificate names no owner…*, then DOWNLOAD PDF (the page's hairline button) and SCAN ORBES CODE (BRAND §5).

### 8.8 `GET /api/v1/lookbook` and `GET /api/v1/lookbook/:slug` (extension of the contract)

The **lookbook** of the models (P-R02): THE COLLECTION of the verification app, the models ORBES shows, each with a sheet of its photographs, its story, its specifications and its care. Public, no session; rate group `api`; `HEAD` too. Nothing in them depends on a session (an owner's reserved models are the club's, §10.9): `Cache-Control: public, max-age=300`, so a change in the console shows within 5 minutes. Implementation: `services/lookbook.ts`.

A model is in the lookbook as the console set it (§13.4): **HIDDEN** (the default: every existing model, until the console shows it), **PUBLIC** (listed here) or **RESERVED** (THE PRIVATE SALON, P-X08: listed for the owners of a piece whose tier reaches the model's `privateMinTier`, with its price, §10.9: unlisted, not confidential, its photographs stay public, §8.6).

**`GET /api/v1/lookbook`, 200**: the PUBLIC models, by collection (by name; the models without one last), then by name; never a story (the lists stay small: the verification app refuses an answer over 256 000 characters). A model and its **variants** (plan NOCTURNE, N1: §13.4) are **one entry**, where the first of them comes, led by the main model (or, when it is not shown here, by its first variant shown), its `variants` the dots.

```json
{ "models": [ { "slug": "monolithe", "name": "MONOLITHE", "type": "BRACELET", "category": { "code": "J", "name": "Jewelry" }, "collection": "ORBITAL", "imageUrl": "/api/v1/media/9f2c4e…",
  "variant": { "label": "Steel", "swatch": "#9D9B96" },
  "variants": [
    { "slug": "monolithe", "name": "MONOLITHE", "type": "BRACELET", "label": "Steel", "swatch": "#9D9B96", "imageUrl": "/api/v1/media/9f2c4e…", "publishedAt": "2026-08-31T09:20:00.000Z" },
    { "slug": "monolithe-gold", "name": "MONOLITHE", "type": "BRACELET", "label": "Gold", "swatch": "#B88A3A", "imageUrl": "/api/v1/media/4b1a…", "publishedAt": "2026-08-31T09:00:00.000Z" }
  ],
  "publishedAt": "2026-08-31T09:20:00.000Z",
  "sizes": ["16", "17", "18"] } ] }
```

| Field | Notes |
|---|---|
| `slug` | The address of its sheet: lower-case letters and digits, words joined by single hyphens, at most 80 characters. |
| `collection` | The model's collection, or `null`. |
| `imageUrl` | The model's reference photograph (its cover), else the first photograph of its gallery, or `null`. |
| `variant` | (N1) The model's own dot among its variants: its `label` (« Steel ») and its `swatch` (`#RRGGBB`); `null` for a model without one. |
| `variants` | (N1) The dots: each model of its group shown in this list, the main model first, then its variants in the order they were added, each with the address of its sheet, its name, type, label, colour and photograph, and (N3) `publishedAt`, when it first left HIDDEN; empty for a model shown alone (a hidden variant is no dot). |
| `publishedAt` | (N3) When the entry was last added to the collection: the latest `publishedAt` (§13.4) of its models in this list. NOW (the verify app's `/verify`) leads with the newest entry when no release is announced. |
| `sizes` | (N3, addition 8) The sizes of its models in this list, from their SKUs (§16.22): each size label once whatever its case, ordered as a client reads them (`16`, `17`, `18`; S, M, L as written); a SKU in one size names none; empty without a size. Their offered sizes only (plan NEXT LOT §3.3): a size set aside is no longer shown. |

**`GET /api/v1/lookbook/:slug`, 200**: a PUBLIC model's sheet (`:slug` read in any case).

```json
{
  "slug": "monolithe",
  "lookbook": "PUBLIC",
  "name": "MONOLITHE",
  "type": "RING",
  "category": { "code": "J", "name": "Jewelry" },
  "collection": "ORBIT",
  "coverUrl": "/api/v1/media/9f2c4e…",
  "gallery": [ { "url": "/api/v1/media/4b1a…", "alt": "The ring on its side, the stone up" } ],
  "story": "The first ring of ORBES.\n\nCast in Paris.\nPolished by hand.",
  "specs": [ { "label": "Metal", "value": "925 sterling silver" } ],
  "care": "Polish with a soft dry cloth.",
  "discontinuedYear": null,
  "variant": null,
  "variants": [],
  "sizes": [],
  "releases": [ { "id": "6f1c…", "kind": "LIVE", "opensAt": "2026-10-05T03:00:00.000Z", "variant": "Steel" }, { "id": "a2d9…", "kind": "DRAW", "opensAt": "2026-09-14T10:00:00.000Z", "variant": "Gold" } ]
}
```

| Field | Notes |
|---|---|
| `coverUrl` | The model's reference photograph (§13.4), shown first; `null` without one. |
| `gallery` | Up to 8 photographs, in their order; the cover is never repeated there. `alt` `null`: the verification app says what every photograph of the model says (*The MONOLITHE RING model, photographed by ORBES*). |
| `story` | Plain paragraphs, a blank line between two, a single line break kept inside one; no Markdown (shown as typed); `null` without one. |
| `specs` | The `Label: value` lines of the model, in their order (a label holds no figure: it is set in the display face). |
| `care` | The model's care instructions; `null`: the general care text of the CARE tab. |
| `discontinuedYear` | (P-R06) The UTC year an ADMIN discontinued the model (§13.4), said *DISCONTINUED · 2027* on the sheet's line; `null` while it is not. |
| `variant` | (N1) The model's own dot (`label`, `swatch`), or `null`. |
| `variants` | (N1) The dots of its group the reader may see, the main model first; the model whose address was asked `selected` (a variant's own address opens the sheet with that variant selected). Each with what the sheet switches with its dot: `slug`, `label`, `swatch`, `lookbook`, `name`, `type`, `collection`, `coverUrl`, `gallery`, `story` (N6: its own, a variant's copied from its main model at its creation), `specs`, `care`, `discontinuedYear`, and a RESERVED one's `salon` (§10.9: its price and tier, and through the club the account's own request); empty for a model alone. |
| `sizes` | (N3, addition 8) The sizes of the models of its group the reader may see, from their SKUs, as a list's `sizes`. |
| `pairs` | (plan NEXT-NINE, BP-34) PAIRS WELL WITH, the sheet's very last section, the same whichever dot's address is asked: the models picked on its main model (§13.4), in their order, each the reader may see (PUBLIC; RESERVED only through the club, from its tier, §10.9), never discontinued nor without an address; when none of them shows, up to **3** models of the main model's collection by the same rule, one per variant group (its main model, else its first variant shown), never the sheet's own group, the latest published first, then by name; none for a model without a collection. Each item is exactly `{ "slug", "name", "type", "variant", "imageUrl", "reserved" }`: the address of its sheet, its name and type, its label among its variants only when the model shown is itself a variant (`"Blue"`: MONOLITHE IN BLUE), its reference photograph else the first of its gallery (`null` without either), and `reserved` for a model of THE PRIVATE SALON. Never a price. `[]`: no section. |
| `releases` | (plan NEXT-NINE, CO-01) THE RELEASES OF THIS MODEL: the past releases of the model's **whole group** (the main model and every variant, those the reader may not see included; the same whichever dot's address is asked), by THE RELEASES' PAST's rule (§8.11: a draw once drawn; a LIVE RELEASE once over, announced before its end, no turn or hold left to run; never a draft, a cancelled release nor an after-room), and a LIVE RELEASE only once its name was revealed by its end. The newest opening first, then by id; every one, no limit. Each item is **exactly** `{ "id", "kind", "opensAt", "variant" }`: its page's id, `LIVE` or `DRAW`, its opening, and its model's label among its variants (`"Blue"`; `null` for a model alone). No title, no quantity, no end figure, no mark of the reader's part. `[]` for a model never released. |

A PUBLIC sheet carries no `salon` (§10.9). A HIDDEN or RESERVED model, an unknown or malformed address: one **`404 LOOKBOOK_NOT_FOUND`** (*This model is not in the ORBES collection.*), `no-store`, so a model shown later is seen at once. Errors: `400 BAD_REQUEST` (an address over 128 characters, §1.2), `404 LOOKBOOK_NOT_FOUND`, `429 RATE_LIMITED`.

**In the verify app:** `/verify/lookbook`, THE COLLECTION (§18; BRAND §5; plan NOCTURNE, C5), the rail's COLLECTION: grouped by collection, each entry (a model and its variants) at the column's full width on its photograph, faded into the ground, its words lifted onto it, its variant dots (`variants`: a dot switches the photograph and SEE THE MODEL) and *You own N* for an owner, then SEE THE MODEL to `/verify/lookbook/<slug>`, the sheet (C6): the photograph whole, the collection, the name and type (then *DISCONTINUED · 2027* once the model is discontinued), SIZES (`sizes`), the dots, *You own N*, its next release as a plate row (§8.9, §8.10: its day and hour, no countdown), THE STORY, the gallery at the column's width, SPECIFICATIONS, CARE, then THE RELEASES OF THIS MODEL (CO-01, only when `releases` is not empty: one row per release, its opening date on the phone's calendar, *LIVE RELEASE · IN STEEL* or *DRAW* for a model alone, opening its page `/verify/releases/<id>`; the six newest, then *SHOW ALL 9 RELEASES* unfolds the rest in place), and last PAIRS WELL WITH (BP-34, only when `pairs` is not empty: one row of cards that scrolls sideways, each the model's photograph, *MONOLITHE IN BLUE* and *BRACELET · THE PRIVATE SALON*, opening its sheet in the same history entry; no price); a dot switches the whole sheet and the address follows it, and leaves THE RELEASES OF THIS MODEL and PAIRS WELL WITH as they are. Every photograph loads lazily. NOW (its hero when nothing is announced, and its section THE COLLECTION) and the rail link to THE COLLECTION; an authentic result whose model is PUBLIC links to its sheet (`product.lookbook`, §9.2).

### 8.9 `GET /api/v1/drops`, `GET /api/v1/drops/:id` and `GET /api/v1/drops/:id/entries` (extension of the contract)

The **releases** (P-R03; *drops* in the code, `services/drops.ts`): a model ORBES releases in a limited number of pieces. ORBES accounts enter its draw while its entries are open (§10.10); after their close an ADMIN runs the draw once (§16.19), which ranks the entries by tier, then by seniority, then in the order of a seed committed when the release was created; ORBES Client Services then concludes each sale with the entries selected, outside the service. Public, no session; rate group `api`; `HEAD` too. The answers are the same for everyone and carry `Cache-Control: public, max-age=60`, so an opening, a close or a draw shows within a minute (the verification app asks with `cache: 'no-store'` and reads the server's answer at once).

These routes know the releases with a draw only (`mode` DRAW): a LIVE RELEASE, lived live and without a draw, has its own (§8.10), and answers `404 DROP_NOT_FOUND` here.

A release's **state** follows from its times: `UPCOMING` (published, before `opensAt`), `OPEN` (`opensAt` ≤ now < `closesAt`), `CLOSED` (after `closesAt`, not drawn yet), `DRAWN`, `CANCELLED` (cancelled before its draw). A draft (`DRAFT`, §16.19) is never here.

**`GET /api/v1/drops`, 200**: the published releases still to come or under way (THE RELEASES' LIVE tab: `UPCOMING`, `OPEN`, `CLOSED`), the latest opening first, at most 50. Once drawn, a release is in THE RELEASES' PAST (§8.11), its page (no end figure, below) and its ranked entries here; a cancelled one is in neither list (plan LIVE RELEASE+, choice 5), its page still answers, `CANCELLED`.

```json
{
  "drops": [
    {
      "id": "1f0c6c52-…",
      "title": "MONOLITHE, the first fifty",
      "state": "OPEN",
      "model": { "name": "MONOLITHE", "type": "RING", "collection": "ORBIT", "imageUrl": "/api/v1/media/9f2c4e…", "lookbook": "monolithe", "variant": null },
      "quantity": 50,
      "opensAt": "2026-10-12T10:00:00.000Z",
      "closesAt": "2026-10-14T10:00:00.000Z",
      "earlyAccessHours": 48,
      "earlyAccessOpensAt": "2026-10-10T10:00:00.000Z",
      "earlyAccessOpen": false,
      "priceMinor": 420000,
      "currency": "EUR"
    }
  ]
}
```

| Field | Notes |
|---|---|
| `model.imageUrl` | The model's reference photograph (§8.6), or `null`. |
| `model.lookbook` | The slug of the model's sheet (§8.8) when the model is PUBLIC in the lookbook, else `null`. |
| `model.variant` | (plan NOCTURNE, N1) The model's label among its variants (« Blue »: the release names MONOLITHE in blue), or `null`. |
| `priceMinor`, `currency` | (plan NOCTURNE, addition 5) The price of a piece in minor units of `currency` (EUR, GBP, USD or CHF), as the console set it (§16.19); `null` for both when ORBES gave none. The order of an entry Client Services confirms takes it (§10.14). |
| `quantity` | The pieces released: the places of the release, held by the direct reservations of its early access first, then drawn. |
| `earlyAccessHours` | (P-X02) PALLADIUM's hours of **early access** before `opensAt`, 0 to 336, as the console published it (THE PROGRAM's 4 unless it set another, plan NEXT-NINE, BP-19 T3; 0: none). |
| `earlyAccessPlatineHours` | (BP-19 T3) PLATINE's, 0 to 336, never more than PALLADIUM's (THE PROGRAM's 2 unless set; a release published before the windows by tier reads PALLADIUM's). |
| `earlyAccessOpensAt` | (P-X02) When PALLADIUM owners may reserve a place directly, the first: `opensAt` less `earlyAccessHours`, or the release's publication when that came later (nothing of a release opens before it is published); `null` without an early access (0 hours, or a release published at or after `opensAt`). The early access ends at `opensAt`. |
| `earlyAccessPlatineOpensAt` | (BP-19 T3) When PLATINE owners may: `opensAt` less `earlyAccessPlatineHours`, clamped the same way; `null` without one for PLATINE. |
| `earlyAccessOpen` | (P-X02) Whether direct reservations are open now, from PALLADIUM's time (`earlyAccessOpensAt` ≤ now < `opensAt`, the release neither cancelled nor drawn), by the server's clock; cached 60 seconds like `state`. The state of a release in its early access stays `UPCOMING`. |
| `earlyAccessPlatineOpen` | (BP-19 T3) Whether PLATINE's are open now. |

**`GET /api/v1/drops/:id`, 200**: a release's page: the card above, and

| Field | Notes |
|---|---|
| `description` | Plain paragraphs, a blank line between two; `null` without one. |
| `purchaseWindowHours` | How long a place drawn is held for its entry: 1 to 336 hours, 48 unless the console set another. |
| `publishedAt`, `cancelledAt`, `drawnAt` | Times; `null` when not (yet) so. |
| `seedHash` | The SHA-256 of the release's seed, 64 hexadecimal characters: its **commitment**, drawn when the release was created, shown from its publication on. |
| `seed` | The seed, 32 bytes as 64 hexadecimal characters, **once drawn**; `null` before. No route gives it before the draw, the console's included (§16.19). |
| `reserved` | (P-X02) The places reserved directly during the early access that are held or sold now (entries `SELECTED` or `CONFIRMED` with a tier and no rank, §10.10): before the draw, `quantity` less `reserved` is what the draw will give; at `quantity`, every piece is reserved (/verify says EVERY PIECE RESERVED). A reservation that lapses (§16.19) gives its place back. `0` once drawn. |
| `full` | (plan NEXT-NINE, IN-01) Before the draw, whether every piece is taken as RESERVE counts it (`409 DROP_FULL`, §10.10): the places held or sold and the pieces the house still guarantees to its holders (§16.30, unused). `reserved` leaves those out, so a release can be full while it reads `2 OF 3`: /verify then says EVERY PIECE RESERVED and offers no RESERVE A PLACE, except to the holder of a guarantee shown and set aside for this release, who reserves with it. Names no account and no guarantee. `false` once drawn or cancelled. |
| `guaranteed` | (plan NEXT-NINE, IN-01) **Once drawn**, the places guaranteed by the house (§16.30): `[{ "id", "pieces", "size" }]` (`size` `{ "id", "label" }`, plan NEXT LOT §3.6.F, `null` in a draw without sizes), each entry that used a guarantee in this release, by its id (the one its account reads in MY PIECES), with the pieces it holds; `[]` before the draw. They were selected first and are listed apart, **without a rank**, never among the ranked entries below. No account marker of any kind: an account reads YOURS on its own only from its entry's `guaranteed` (§10.10), which a guarantee not shown to the client leaves `false`. |

| `sizes` | (plan NEXT LOT §3.6.F) A draw's sizes, in order: `[{ "id", "label", "pieces", "reserved", "full" }]`. Each size's `pieces` are public (the draw is per size, and anyone checking the list needs them); `reserved`, the pieces reserved directly in it during the early access, held or sold (a reservation, or a house's guarantee used before the opening); `full`, before the draw, every piece of the size held or sold or guaranteed to an entry waiting in it (as RESERVE refuses `409 DROP_SIZE_FULL`), `false` once drawn or cancelled. `[]` for a draw without sizes: one published before this lot keeps one pool and today's rule. `quantity` is their sum. |

Once drawn, the release is over and its page carries **no end figure** (plan LIVE RELEASE+, choice 5 and decision 30): not how many entries took part, nor how many places were reserved directly (`reserved` is `0`). The draw's verifiable record stays: the seed, and its ranked entries below.

A draft, an unknown or a malformed id: one **`404 DROP_NOT_FOUND`** (*This release is not known to ORBES.*), `no-store`. Errors: `400 BAD_REQUEST` (an address over 128 characters, §1.2), `404 DROP_NOT_FOUND`, `429 RATE_LIMITED`.

**`GET /api/v1/drops/:id/entries`, 200**: once drawn, the entries the draw ranked, by rank, paginated (§6): `{ "items": [ { "id": "7c2e90d1-…", "tier": 2, "seniority": 1, "rank": 1, "size": { "id": "…", "label": "17" } } ], "page": 1, "pageSize": 50, "total": 132 }` (`size`, plan NEXT LOT §3.6.F: the size the entry was drawn in, `null` in a draw without sizes). `id` is the entry's id, the one its account reads in MY PIECES (§10.10), **never its account**; `tier` (0: no piece, 1 TITANE, 2 PLATINE, 3 PALLADIUM) and `seniority` (full years) are those read at the draw. Only the entries the draw ranked are listed: a direct reservation of the early access (P-X02) never appears here, it was not drawn. Before the draw: `409 DROP_NOT_DRAWN`. Errors: `404 DROP_NOT_FOUND`, `409 DROP_NOT_DRAWN`, `429 RATE_LIMITED`.

**The rule of the draw** (`drawOrder`; TERMS-FACTS R65): the entries still `ENTERED` at the draw, by `tier` descending, then `seniority` descending, then `sha256(seed ‖ id)` ascending in hexadecimal, where `seed` is the 32 bytes of the seed and `id` the entry's id in lower-case ASCII (its 36 characters); two equal keys, by `id`. The first ranks, as many as there are places left (`quantity` less the entries already `SELECTED` or `CONFIRMED`: the direct reservations of PLATINE and PALLADIUM owners during the early access, P-X02), are selected, the others are on the waiting list. With the seed published, anyone can check that `sha256(seed)` is `seedHash` and rank the entries again.

**A draw with sizes** (plan NEXT LOT §3.6.F; `services/drops.ts` `draw`): each entry is in the size it chose. The entries are ranked once, by the rule above, all sizes together; then, in that order, an entry is `SELECTED` while its size has a piece left (its `pieces` less the pieces held or sold in it, the direct reservations of PLATINE and PALLADIUM owners, and less the pieces of the guaranteed places selected first in it), else `WAITLISTED` on the waiting list of its size; each keeps its rank. From the page anyone recomputes every status: the seed, the ranked entries with their sizes, each size's `pieces` and `reserved`, and `guaranteed` with their sizes. One piece per entry stays (a guaranteed place keeps its pieces, all in its size). A draw published before this lot, without sizes, draws exactly as before.

**In the verify app:** `/verify/releases`, THE RELEASES (§18; BRAND §5; plan NOCTURNE, C7), the rail's RELEASES (its dot while a release is live, announced or open), its tab LIVE (§8.11): the releases still to come or under way, each on its model's photograph, faded, its state, its title, its model, its price (`priceMinor`, plan NOCTURNE, addition 5), its pieces and the time that matters now (in UTC, kept on one line), and SEE THE RELEASE, a text link to `/verify/releases/<id>`, a release's page: its model (SEE THE MODEL when it is PUBLIC in the lookbook), its pieces, its dates in UTC and on the phone's own clock, how long a place is held, the rule of the draw word for word, the fingerprint of the seed; once drawn, the seed, checked on the phone (`crypto.subtle`: *Checked on this phone: the SHA-256 of the seed is the fingerprint published with the release.*), and the entries by rank, 100 at a time (SHOW MORE), the reader's own marked YOURS, the page never saying how many took part (no end figure, plan LIVE RELEASE+ choice 5); drawn, the release is over: its page says THIS RELEASE IS OVER in place of its state and, signed in, the account's part in it (YOU TOOK PART, YOU SECURED A PIECE, §10.15), and no longer counts the places reserved directly. Its entry (§10.10) is offered there. THE RELEASES is reached by the rail, and a draw open, soon open or in its early access leads NOW (under a LIVE RELEASE as a plate card, else as its hero: plan NOCTURNE, C1, C42). The word is DRAW, never lottery (BRAND §4.5).

**A draw with sizes in the verify app** (plan NEXT LOT §3.6.F; `releases-model.ts` `drawSizes`, `drawPick`, `drawSizeChoices`): THE RELEASE adds a **SIZES** row, one line per size (*SIZE 16 · 3 PIECES*, then *· 1 RESERVED DIRECTLY* from the early access on and *· FULL* once every piece of the size is held before the draw; none for one size); YOUR ENTRY gives **YOUR SIZE** over the draw's sizes (NOCTURNE's size buttons), right above the actions it serves, preselected by the entry's size, then the one YOUR SIZES suggests (`GET /api/v1/club/drops/:id/entry` `savedSize`, with *SIZE 17 · FROM YOUR SIZES* and *Check it is right for this model before you confirm.*), then the only size; ENTER THE DRAW waits for a size; a size tapped changes an ENTERED entry's at once while entries are open (`POST …/size`); during the early access a size whose pieces are all reserved is greyed out (*Size 17, every piece reserved*), while entries are open it stays open with *Every piece in size 17 has been reserved. You may still enter: the draw ranks a waiting list in each size.*; each label says the size (*ENTERED · SIZE 17*, *PLACE HELD · SIZE 17*, *WAITING LIST · SIZE 17*…) and the sentences of ENTERED, PLACE HELD, PLACE RESERVED and WAITING LIST name it; THE DRAW reads its own rule (*Each entry is in the size it chose. …*); the list's line ends with the size (*12 · PLATINE · 2 YEARS · SIZE 17*), and GUARANTEED BY THE HOUSE's too; MY PIECES' entries end their label line with the size; HOW RELEASES WORK's IN A DRAW adds *In a release with sizes, each size is filled in that order.* A draw without sizes reads as before. The draw's card in THE RELEASES is unchanged.

**The house's guarantee** (plan NEXT-NINE, IN-01; TERMS-FACTS R150): a client ORBES granted a guaranteed place (§16.30) enters the draw like any account (or reserves during its tier's early access); at the draw its entry is **selected first**, for the pieces its guarantee covers (1 to 5, the place's `pieces`), outside the ranking, and the places left for the ranking are `quantity` less the pieces held (reservations included) and those guaranteed. The ranking itself is unchanged: the entries with a guarantee are not in it, so the seed, `seedHash` and the ranked list still check as above. A draw's page says it in its rule: *Places guaranteed by ORBES are selected first, for the pieces they cover, and listed apart without a rank.*; once drawn, THE ENTRIES opens with **GUARANTEED BY THE HOUSE** (*Set aside before the draw: selected first, without a rank, and left out of the ranking below.*), one line per place, *GUARANTEED · 2 PIECES*, YOURS on the reader's own only when its guarantee is shown to it. A guarantee not shown leaves no mark for its holder: its entry reads as an ordinary one (no box, no YOURS, `guaranteed: false`), and the place is listed among GUARANTEED BY THE HOUSE like the others.

**The early access in the verify app** (P-X02): during it, a release reads **EARLY ACCESS** in place of its state, followed by **EVERY PIECE RESERVED** once `reserved` reaches `quantity`; under the state of a release that has one, the line *PALLADIUM: FROM … · PLATINE: FROM … · EVERYONE: FROM …* (UTC; plan NEXT-NINE, BP-19 T3), or *PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …* when the two tiers' times are one; its page adds the rows EARLY ACCESS (each tier's hours: *PALLADIUM 4 HOURS · PLATINE 2 HOURS*) and RESERVED DIRECTLY (`2 OF 50 PIECES`), a paragraph on the early access (*PALLADIUM owners, then PLATINE owners, reserve a place directly…*), and, for a PLATINE or PALLADIUM account while its tier's direct reservations are open, **RESERVE A PLACE**, the page's one button (§10.10); a PLATINE account during PALLADIUM's hours reads *PALLADIUM owners are reserving their places now. As a PLATINE owner, you may reserve a place from …*, any other account *PALLADIUM owners are reserving their places now. Entries open to everyone on …*. The draw's rule says *as many as there are pieces left after the direct reservations of PLATINE and PALLADIUM owners*.

---

### 8.10 The LIVE RELEASES: `GET /api/v1/live` and the boutique board (extension of the contract)

The **LIVE RELEASES** (plan of 2026-10-04; `routes/live.ts`, `services/live-room.ts`, `services/live.ts`, migration `0021`): a release of `drops` whose `mode` is `LIVE`, lived live and without a draw. Announced from `announceAt` (its publication when none), it opens a **room** `roomOpensMinutes` before `opensAt` (T0); at T0 the room becomes the **line**, by tier first (unless `tierPriority` is off), then in the order of `sha256(seed ‖ entry id)` from a seed sealed at its creation and **never revealed**; each account in turn holds the seal to secure a piece, then presses PAY, which confirms a reservation ORBES Client Services concludes outside the service. The account's actions are §10.12, the console's §16.23. Rate group `live` (§3). Every route below is public, without a session; the reads of the list, the banner, a page and its `.ics` are the same for everyone and carry `Cache-Control: public, max-age=15` (`LIVE_PUBLIC_CACHE_CONTROL`), so a stage or a count shows within 15 seconds, never before its time.

**What the public never sees.** Before its announcement, a draft, a cancelled release, a draw (`mode` DRAW), an unknown or malformed id: one **`404 DROP_NOT_FOUND`**, on every route of this section and of §10.12. The **staged reveals** (`liveStages`): the silhouette from `silhouetteAt`, the name from `nameAt` (the release's title, the model's name, type and collection, the description), the photograph and the lookbook's link from `photoAt`; a stage left unset is at the announcement, none comes before the one it follows, all are revealed at the room's opening at the latest. **No answer carries a stage before its time**: not the list, a page, the banner, the `.ics`, the board, nor the rule of access wherever it is said (a model the rule names that is the release's own reads `this model`, and a collection that is that model's own `this model’s collection`, until its name is revealed, `403 LIVE_NOT_ELIGIBLE` included; the circle's post never names either). The room's snapshots and an account's entry name no stage at all. **After its end** (sold out, closed or ended by ORBES), a release leaves the list and the banner for THE RELEASES' PAST (§8.11); once it is over (the end recorded and no turn or hold left to run to its deadline, as the room's `over`) its page answers in its **final state** (plan LIVE RELEASE+, decision 30, which lifts the LIVE plan's choice 32): `{ "id", "kind": "LIVE", "phase": "ENDED", "title", "name", "variant", "type", "collection", "description", "silhouetteUrl", "imageUrl", "lookbook", "opensAt", "quantityLine" }`, what was announced, each part from its stage as it stood at the end (one ended before its name or its photograph never reveals them, even once their time has passed, nor does the rule of access; one ended before its announcement stays the 404 of an unknown release), the quantity line as announced (decision 29), and **never an end figure**: no sizes or stock, no count, no reason of the end, no interest, no price (until then the page is whole, its `phase` `ENDED`, so a turn may still be secured and a hold confirmed). Its `.ics` answers 404. There is **no public view of a room** (the spectator mode was declined): its state and its stream are an account's (§10.12), the board's by its secret link only.

**`GET /api/v1/live`, 200**: THE RELEASES' LIVE tab, its LIVE RELEASES: those announced and not ended, the next opening first, at most 50: `{ "releases": [ <card>, … ] }`. A **card**:

```json
{
  "id": "5b1d…",
  "kind": "LIVE",
  "phase": "ANNOUNCED",
  "revealed": { "silhouette": true, "name": false, "photo": false },
  "stages": { "silhouetteAt": "2026-11-02T10:00:00.000Z", "nameAt": "2026-11-05T10:00:00.000Z", "photoAt": "2026-11-07T10:00:00.000Z" },
  "reveals": [ { "stage": "NAME", "at": "2026-11-05T10:00:00.000Z" }, { "stage": "PHOTO", "at": "2026-11-07T10:00:00.000Z" } ],
  "title": null, "name": null, "type": null, "collection": null,
  "silhouetteUrl": "/api/v1/media/9f2c…",
  "imageUrl": null, "lookbook": null,
  "announcedAt": "2026-11-01T10:00:00.000Z",
  "roomOpensAt": "2026-11-08T17:55:00.000Z",
  "opensAt": "2026-11-08T18:00:00.000Z",
  "closesAt": "2026-11-08T19:00:00.000Z",
  "priceMinor": 480000, "currency": "EUR",
  "quantityLine": "25 PIECES", "perAccount": 1,
  "access": { "minTier": 2, "text": "owners from PLATINE" },
  "surprise": true,
  "interest": 428
}
```

`phase`: `ANNOUNCED`, `ROOM` (from `roomOpensAt`) or `LIVE` (from `opensAt`, T0). `revealed` and `stages` say which stage shows and when; `reveals` lists the stages still to come that will show something (the silhouette only when one was uploaded, the photograph only when the model has one), with their times, never what they show. `title`, `name`, `type`, `collection` and `variant` (plan NOCTURNE, N1: the model's label among its variants, « Blue », or `null`) from the name's stage, `silhouetteUrl` from the silhouette's (null without an upload: the seal stands in), `imageUrl` and `lookbook` (the `<slug>` of the model's sheet when it is PUBLIC, §8.8) from the photograph's; `null` before. The verification app offers SEE THE MODEL, a text link to `/verify/lookbook/<slug>`, under the price on the page announced and under the model's line in the room until T0. The price is in minor units of `currency` (EUR, GBP, USD or CHF) and shows from the announcement (choice 37). `quantityLine` is the quantity as the console wrote it (choice 36); `perAccount` the pieces one account may take (1 to 5). `access.minTier` is the lowest tier allowed (0 any ORBES account, 1 TITANE … 3 PALLADIUM), `access.text` the rules in words, as an announcement says them after « FOR » (`every ORBES account`, `owners`, `owners from PLATINE`, `owners of MONOLITHE`, `owners of the SATURN collection`; plan LIVE RELEASE+: `collectors who have taken part in 3 releases`, `selected collectors` for a segment, whose name is never said; with OR the rules joined by `or`, `owners from PLATINE or collectors who have taken part in 3 releases`; with AND one collector who meets them all, `selected owners from PLATINE who have taken part in 3 releases`). `surprise` (plan LIVE RELEASE+, choice 3): a surprise in every box, the page's vault label A SURPRISE IN EVERY BOX; what it is is never sent (an after-room's: the release's it follows). `interest` is the public count of I'LL BE THERE (§10.12), never who.

**`GET /api/v1/live/:id`, 200**: a release's page: the card, and `description` (from the name's stage), `sizes` (`[{ "id", "label", "stock" }]`, in order), `addons` (`[{ "id", "label", "line", "priceMinor" }]`, the options offered with a piece held, their price per piece), `roomOpensMinutes`, `turnSeconds`, `payMinutes` and `tierPriority` (the rule of the line). Once ended: `{ id, kind: "LIVE", phase: "ENDED" }`.

**`GET /api/v1/live/next`, 200**: the banner of /verify and MY PIECES: `{ "release": null }`, or the release live now, else the one whose room is open, else the next announced: `{ "release": { "id", "phase", "name", "variant", "nameAt", "roomOpensAt", "opensAt", "closesAt" } }`, `name` and `variant` (N1) from its stage (`null` before; the banner reads it again at `nameAt`). It carries no time of the server: an answer kept 15 seconds would carry one 15 seconds old.

**`GET /api/v1/live/clock`, 200**: `{ "now": "2026-11-08T17:54:03.412Z" }`, `no-store`: the server's time, for the page's clock sync (three round trips, the offset of the shortest kept), which every countdown counts on.

**`GET /api/v1/live/:id/calendar.ics`, 200**: ADD TO CALENDAR, `text/calendar; charset=utf-8`, an attachment: one event from the room's opening to the end of the sales, an alarm 10 minutes before (`LIVE_CALENDAR_ALARM_MINUTES`), the page's address, `LIVE RELEASE · <name> · ORBES` once the name is revealed (`LIVE RELEASE · ORBES` before), no personal data; lines folded at 75 octets (RFC 5545). 404 once ended.

**The boutique board** (choice 31): a screen in a boutique or at an event, reached only through a **secret link** the console issues (§16.23): `/verify/releases/<id>/board#<secret>`, the secret (32 random bytes, base64url, 43 characters) in the fragment, which no browser sends. The page sends it in the body:

- **`POST /api/v1/live/:id/board`** `{ "token": "<secret>" }`, **200** `{ "now", "id", "phase", "paused", "over", "roomOpensAt", "opensAt", "closesAt", "quantity", "quantityLine", "left", "release": { "revealed", "name", "silhouetteUrl", "imageUrl" } }`: the countdown, the door (its phase), the pieces left overall, the piece by stage; **never a person, the room's count, the line, a size or a host message**.
- **`POST /api/v1/live/:id/board/stream`**, the same body: the same, live (Server-Sent Events, as in §10.12): a `board` event when it changes, a comment every 20 s; once the release is over, its last board, then the end.

Only the SHA-256 of the secret is stored (`drops.board_token_hash`): a missing, malformed, wrong, replaced or revoked secret, a release not announced, or one ended with no turn or hold left, answer one `404 DROP_NOT_FOUND`; a board stream open on a link since replaced or revoked ends at the next pulse. Both answers carry `X-Robots-Tag: noindex, nofollow`, as does the page itself (§18). Same-origin rule for these POSTs (§2.2, `403 CSRF_FAILED` from another origin); no session.

Errors of this section: `400 VALIDATION_FAILED` (a body that is not `{ token }`), `403 CSRF_FAILED`, `404 DROP_NOT_FOUND`, `429 RATE_LIMITED`.

### 8.11 THE RELEASES' PAST: `GET /api/v1/releases/past` (extension of the contract)

**THE RELEASES' PAST** (plan LIVE RELEASE+, choice 5 and decisions 28 to 30; `services/past-releases.ts`): every release ended, public, the newest opening first, LIVE RELEASES and draws together. Ended: a LIVE RELEASE once over (sold out, closed, or ended by ORBES: its end recorded and no turn or hold left to run to its deadline, as the room's `over`), the moment its page answers in its final state (§8.10), and announced before its end (one ended before its announcement was never announced, and stays the 404 of an unknown release); a draw once drawn (before its draw it stays in §8.9's list). **Never** a draft, a cancelled release, nor an after-room (decision 28: hidden, even after the release). Public, no session; rate group `api`; the same for everyone, `Cache-Control: public, max-age=60`.

**`GET /api/v1/releases/past?page=&pageSize=`, 200**, paginated (§6): `{ "items": [ <card>, … ], "page": 1, "pageSize": 12, "total": 31 }`. A card says what was announced and nothing of the end (choice 5: **no end figure**):

```json
{
  "id": "5b1d…",
  "kind": "LIVE",
  "title": "NOCTURNE — LIVE",
  "model": { "name": "NOCTURNE", "type": "RING", "collection": "ORBIT", "variant": null },
  "imageUrl": "/api/v1/media/9f3a…",
  "opensAt": "2026-10-11T17:00:00.000Z",
  "quantityLine": "25 PIECES"
}
```

| Field | Notes |
|---|---|
| `kind` | `LIVE` or `DRAW`. |
| `title`, `model` | The release's title and its model's name, type, collection and label among its variants (plan NOCTURNE, N1: `variant`, « Blue », or `null`); a LIVE RELEASE's from its name's stage (§8.10) as it stood at its end, `null` when it ended before it, even once the time set for its name has passed. |
| `imageUrl` | The model's photograph (§8.6); a LIVE RELEASE's from its photograph's stage, as it stood at its end; `null` without one. |
| `opensAt` | The opening: a LIVE RELEASE's T0, a draw's opening of its entries. |
| `quantityLine` | The quantity as announced: a LIVE RELEASE's line (« 25 PIECES »), even after pieces were added live (decision 29); a draw's pieces (« 3 PIECES »). |

No count of entries, of pieces confirmed or left, no reason of the end, no interest, no price, no seed. A card opens the release's page (§8.9, §8.10) in its final state.

**In the verify app:** THE RELEASES has two tabs (§18), keyboard and screen-reader tabs (`role="tablist"`, the arrow keys, Home and End): **LIVE**, the releases to come and under way (§8.9, §8.10), shown first; **PAST**, these cards, 12 at a time (SHOW MORE), each its photograph, LIVE RELEASE or DRAW, its name (a LIVE RELEASE's model, a draw's title), its opening date on the phone's calendar and its quantity line, and SEE THE RELEASE. Signed in, *You have taken part in N releases.* at the top and **YOU SECURED A PIECE** or **YOU TOOK PART** on each release concerned (§10.15). The tab shown is kept with the page's place in the history: back from a release opened from PAST returns to PAST. A LIVE RELEASE's page over is its final state in the vault: its piece, its name and line, SEE THE MODEL, **THIS RELEASE IS OVER**, its date and quantity line, the account's part, its description, and THE RELEASES; never how it ended, nor the reservation's page (a guest of its after-room keeps the second door until it closes).

Errors: `429 RATE_LIMITED`.

### 8.12 THE CLUB: `GET /api/v1/the-club` (extension of the contract)

Plan NEXT-NINE, BP-19 T9 (`routes/public.ts`, `services/club.ts` `theClub`). The tiers and what each gives, the same for everyone: no session, no account named, `Cache-Control: public, max-age=60`.

```json
{
  "tiers": [
    { "name": "TITANE", "level": 1, "pieces": 1, "lines": ["The owners’ circle: its notes, its invitations and its polls.", "Priority in the draw of each release, before the accounts that hold no piece."] },
    { "name": "PLATINE", "level": 2, "pieces": 5, "lines": ["Early access to each draw: a place reserved directly 2 hours before entries open to everyone, unless its page says otherwise.", "Free shipping on every order.", "…"] },
    { "name": "PALLADIUM", "level": 3, "pieces": 10, "lines": ["…", "Special commissions, made for you by the ORBES atelier.", "A yearly visit to the ORBES atelier."] }
  ],
  "tierThresholds": [1, 5, 10],
  "creditCurrency": "EUR",
  "gifts": [ { "tier": "PALLADIUM", "model": "ORBITAL CHARM", "imageUrl": "/api/v1/media/4b1a…" } ]
}
```

`pieces`: the pieces held now each tier starts from (`CLUB_TIER_THRESHOLDS`, a constant of the code); `lines`: what the tier adds, THE PROGRAM's lines first (§16.21, `programLines`: its early access, shipping, yearly care, the priority with Client Services on the tier it starts from, its welcome gift while its model is active, its credit, the experiences of the circle on the tier each invites from), then the tier's words (§16.21, the Tiers tab; PLATINE's are none by default); `creditCurrency`: the one currency the credit applies to (THE PROGRAM's `creditCurrency`); `gifts`: each tier's welcome gift while its model is active, its name and its reference photograph (`null` without one).

In the verify app: **THE CLUB** (`/verify/club`), linked from the footer (above the legal pages, in the app) and from the account sheet (a row under MY PIECES): the figures of the lead and of each tier read from here, never typed into the app's words; a plate per tier (its name, FROM n PIECES, its lines, its gift's photograph); HOW THE TIERS WORK (*The credit applies to orders in euros.* from `creditCurrency`); then *YOUR TIER: PLATINE · 6 PIECES HELD* (the account sheet), *YOUR FIRST PIECE OPENS TITANE* (MY PIECES) or *SIGN IN TO SEE YOUR TIER* (MY PIECES' sign-in). The page has no link to HOW RELEASES WORK.

### 8.13 HOW RELEASES WORK: `GET /api/v1/releases/rules` (extension of the contract)

Plan NEXT-NINE, FT-01 (`routes/public.ts`, `services/release-rules.ts` `releaseRules`). The figures the page that explains every release states, read where the server applies them: the same for everyone, no session, no account named, nothing written, rate group `api`, `Cache-Control: public, max-age=60`.

```json
{
  "tiers": [
    { "name": "TITANE", "level": 1, "pieces": 1 },
    { "name": "PLATINE", "level": 2, "pieces": 5 },
    { "name": "PALLADIUM", "level": 3, "pieces": 10 }
  ],
  "earlyAccess": { "PALLADIUM": 240, "PLATINE": 120 },
  "placeHeldHours": 48,
  "salonFromTier": "TITANE"
}
```

| Field | Notes |
|---|---|
| `tiers` | Each tier from the pieces held now it starts from (`CLUB_TIER_THRESHOLDS`, a constant of the code, as §8.12). |
| `earlyAccess` | A new draw's early access by default, PALLADIUM's and PLATINE's, in minutes before entries open to everyone: THE PROGRAM's windows (§16.21, 4 and 2 hours by default; `0`: none). Each draw may set its own, which its page gives (§8.9). |
| `placeHeldHours` | How long a place drawn is held by default (`PURCHASE_WINDOW_HOURS.default`); a draw may set its own (§8.9 `purchaseWindowHours`). |
| `salonFromTier` | The lowest tier THE PRIVATE SALON may offer a model from (a model's tier, §10.9). |

In the verify app: **HOW RELEASES WORK** (`/verify/releases/how`), in NOCTURNE's chrome without a photograph: THE WAYS TO TAKE PART (DRAW, EARLY ACCESS, LIVE RELEASE, THE PRIVATE SALON), HOW THE ORDER IS SET (THE TIERS with *TITANE · FROM 1 PIECE*, IN A DRAW, IN A LIVE RELEASE) and WHAT THE HOUSE NEVER DOES (NO PAID PRIORITY, NO AUCTIONS, A FIXED QUANTITY, ONE COLLECTOR, ONE ACCOUNT, A RETURNED PIECE). Every figure comes from here, never typed into the app's words: a window of whole hours reads *4 hours*, another *90 minutes*. It is linked under the lead of THE RELEASES, as the last line of a draw's page and of a LIVE RELEASE's pages before and after the room, and first in the room's foot (in a new tab while the collector holds an entry); never from THE CLUB nor the boutique board.

Errors: `429 RATE_LIMITED`.

## 9. Verification: `POST /api/v1/verify`

Submits a decoded ORBES CODE and returns the public verification outcome. No session is required and no CSRF token is needed. If the request carries a valid `orbes_session` cookie, the server uses it only to recognise the current owner and, for a reader who is not the owner of a piece whose transfer is pending, to give the scan's transfer token (`transfer`, §9.2, F-03). If it carries a console session (`orbes_admin`) the console would let in, the scan is a **staff scan** (§9.7): recorded as `ADMIN_TEST` under that console user, outside `UNSOLD_PIECE_SCAN` and the history rules (the code's own findings of steps 6–7 are still recorded), without a registration or transfer token. Rate group `verify` (60 per minute per client by default). Each processed request is recorded as a scan event and feeds anomaly scoring (a staff scan only reads it).

### 9.1 Request

```json
{
  "code": "EQE0EAC4AQLpT1JCUyqLkjwPZXi7qfTtj7sDHYDbBvb180Y-gGxCR8S59ckMwz8N_WpUxZkcIysLTviHYWaeM39ev6EHSi5IT8oF9w7lOA",
  "genome": {
    "glyphs": [14, 1, 13, 12, 11, 14, 5, 2],
    "confidence": [0.94, 0.91, 0.88, 0.97, 0.9, 0.93, 0.86, 0.95]
  },
  "client": { "rsErrors": 0, "rsErasures": 0, "moduleSizePx": 6.5, "decodeMs": 42, "source": "camera" }
}
```

(The `code` above is the public sample vector `docs/vectors/code01-sample.json`, product `O26-J-00184`, signed with a sample key that is never valid in production.)

| Field | Type | Required | Rules |
|---|---|---|---|
| `code` | string | yes | Any string of at most 1024 characters. A well-formed code is base64url without padding (`A–Z a–z 0–9 - _` only) of the 79-byte framed code data (payload ‖ signature ‖ CRC-16): exactly 106 characters. |
| `genome` | object | no | The genome as read by the client's decoder, for the cross-check. |
| `genome.glyphs` | array of 8 | yes, if `genome` | Each an integer 0–15, or `null` for an unread glyph. |
| `genome.confidence` | array of 8 numbers | no | Each 0–1. When absent, every non-null glyph counts with confidence 1. |
| `client` | object | no | Informational decoder metrics; stored, never used for the decision. |
| `client.rsErrors`, `client.rsErasures` | integer | no | 0–255 |
| `client.moduleSizePx` | number | no | 0–10 000 |
| `client.decodeMs` | number | no | 0–600 000 |
| `client.source` | `"camera"` \| `"upload"` | no | |

Any string `code` of at most 1024 characters reaches the verification service (contract step 1). One that cannot be decoded — empty, characters outside base64url, more than 200 characters, wrong length, CRC or payload fields — is processed, **recorded** as a scan and answered `200` with state `MALFORMED_CODE`. Only requests outside the schema — a missing or non-string `code`, a `code` over 1024 characters, a wrong genome array, out-of-range client metrics, unknown fields — are refused with `400 VALIDATION_FAILED` **and are not recorded**.

### 9.2 Response

Every processed verification answers **HTTP 200**, whatever the state. The body is built field by field from an allow-list; it never contains risk scores, thresholds, internal reasons, raw product statuses, owner identities or retailer data.

| Field | Type | Present |
|---|---|---|
| `state` | string | Always. One of the 9 states (§9.3). |
| `scanId` | uuid | Always. The recorded scan event; on a result that is not authentic, the customer's report is attached to it (§8.5). |
| `verifiedAt` | ISO timestamp | Always. |
| `title` | string | Always. Brand copy (§9.3), upper case. |
| `message` | string | Always. Brand copy (§9.3). |
| `notice` | `"UNUSUAL_ACTIVITY"` | Only with `AUTHENTIC_OWNERSHIP_VERIFIED`, when the current owner's product shows a risk score at or above the threshold. |
| `verification` | object | When the code matched the registry and its key was trusted, and the state is an `AUTHENTIC*` state, `SUSPICIOUS_ACTIVITY` or `REVOKED`. |
| `verification.signature` | `"VALID"` | |
| `verification.keyId` | integer | Key named by the code. |
| `verification.codeVersion` | string | `"CODE-01"` |
| `verification.genomeVersion` | string | `"GENOME-01"` |
| `verification.issuedAt` | date | UTC date the code was issued (from the payload). |
| `verification.issue` | integer | Code issue (1 = original, +1 per re-issue). |
| `verification.assurance` | `"CODE"` \| `"CODE_ONLY"` \| `"CODE_AND_HARDWARE"` | `CODE` for the default policy. `CODE_ONLY` when the product's policy requires hardware evidence (secure NFC, secure element, tamper-evident seal) that was not verified; hardware authenticators are not implemented, so such products always get `CODE_ONLY`. |
| `verification.hardwareProofRequired` | `true` | Only with `CODE_ONLY`. |
| `genome` | object | When the signature was valid and the signed identity is registered, and the state is an `AUTHENTIC*` state, `SUSPICIOUS_ACTIVITY` or `REVOKED`. |
| `genome.id` | string | Canonical product id (the genome id equals the product id). |
| `genome.version` | string | `"GENOME-01"` |
| `genome.fingerprint` | string | e.g. `"G1-E1DC-BE52"` |
| `genome.glyphs` | integer[8] | Glyph indices 0–15, recomputed from the signed identity. |
| `genome.ids` | string[8] | Glyph names, e.g. `"QUARTER_ORB_SW"`. |
| `product` | object | `AUTHENTIC*` states only. |
| `product.productId` | string | Canonical id. |
| `product.category` | `{ code, name }` | |
| `product.collection` | string | Only when the product row itself names a collection (see note below). |
| `product.model`, `product.type` | string | e.g. `MONOLITHE`, `RING`. |
| `product.modelVariant` | string | (plan NOCTURNE, N1) The model's label among its variants (« Blue »: the piece is a MONOLITHE in blue), when the model has one (§13.4). |
| `product.variant` | string | The piece's free-text field set at issuance, its size (SIZE in the verification app and the console since NOCTURNE N1, formerly VARIANT; a value written before as it is), when set. |
| `product.material` | string | |
| `product.createdYear` | integer | Year of the identity. |
| `product.productionDate` | date | When set. |
| `product.care` | string | The model's care instructions, when set. |
| `product.imageUrl` | string | The model's reference photograph (F-04), or its variant's, when the model has one: `/api/v1/media/<sha256>`, a path of this origin (§8.6). Never the piece's own photograph (plan NOCTURNE, decision 9: the model is the reference for a piece; one taken at issuance before stays the console's, §14.12). |
| `product.lookbook` | string | (P-R02) The slug of its model's sheet in the lookbook (§8.8), when the model is PUBLIC there: the sheet is `/verify/lookbook/<slug>`. Never for a HIDDEN or RESERVED model. The verification app offers SEE THE MODEL, a text link under the product lines. |
| `product.discontinuedYear` | integer | (P-R06) The UTC year an ADMIN discontinued its model (§13.4), present only while the model is discontinued, on `AUTHENTIC*` states only. The piece verifies as before; the verification app says *DISCONTINUED · 2027*, the last of the product lines, and the PRODUCT tab a DISCONTINUED row. |
| `warranty` | object | `AUTHENTIC*` states only. |
| `warranty.status` | `"NOT_STARTED"` \| `"ACTIVE"` \| `"EXPIRED"` \| `"VOID"` | Computed at the request's UTC date. |
| `warranty.startDate`, `warranty.endDate` | date | When the warranty is activated. |
| `ownership` | object | `AUTHENTIC*` states only. |
| `ownership.registered` | boolean | The product has a current owner. |
| `ownership.you` | boolean | The logged-in viewer is that owner. |
| `ownership.transferPending` | `true` | Only when registered and an unexpired transfer is pending. |
| `registration` | object | `AUTHENTIC_FIRST_REGISTRATION`; and `SUSPICIOUS_ACTIVITY` when only the scan history made the scan suspicious, the product has no owner, is open for registration and ships with a claim code (then `claimCodeRequired` is always `true`; §9.4 step 10). **Never on a staff scan** (§9.7, `staffScan`). |
| `registration.token` | string | Single-use registration token (base64url, 43 characters) for `POST /api/v1/ownership/register`. |
| `registration.expiresAt` | ISO timestamp | 15 minutes after the scan. |
| `registration.claimCodeRequired` | boolean | The product ships with a claim code that must be supplied at registration. |
| `transfer` | object | (F-03) `AUTHENTIC_*` states, when the request carries the session of an account that is **not the owner** of a piece **whose transfer is pending** (`ownership.transferPending`): in practice `AUTHENTIC_REGISTERED`; and `SUSPICIOUS_ACTIVITY` when only the scan history made the scan suspicious, read the same way (the registration's exception, §9.4 step 10: the transfer code the owner gave proves the handover). **Never on a staff scan** (§9.7), never signed out, never for the owner, never on another result that is not authentic (a piece reported lost or stolen, a revoked one, a code or genome finding). On `SUSPICIOUS_ACTIVITY`, which carries no `product`, the piece is the one `genome.id` names. |
| `transfer.token` | string | Single-use transfer token (base64url, 43 characters, purpose `TRANSFER_ACCEPT`) for `POST /api/v1/ownership/transfers/accept` (§11.3): it ties the acceptance to this scan of this piece by this account. Only its SHA-256 is stored, next to the scan, which names the account. |
| `transfer.expiresAt` | ISO timestamp | 15 minutes after the scan. |
| `staffScan` | `true` | Only on a **staff scan** (§9.7): the request carried a console session, so the scan was recorded as `ADMIN_TEST`. It then has no `registration` and takes no report (§8.5). Only the browser that holds the console cookie ever receives it. |

Note on `product.collection`: the product's own collection, else its model's — the same rule as `product_overview` and the owner's product list.

Note on the photographs (F-04): `product.imageUrl` comes with the `product` block, so on the four `AUTHENTIC*` states only. A result that is not authentic (`UNKNOWN`, `INVALID_SIGNATURE`, `SUSPICIOUS_ACTIVITY`, `REVOKED`, `MALFORMED_CODE`) never names a photograph: an image would say something of a piece the result cannot vouch for. **No answer a collector receives names a piece's own photograph** (plan NOCTURNE, decision 9: the model is the reference for a piece): not a result, not MY PIECES (§10.5), not an order; the console keeps it (§14.12, §15). **What the verification app does with it**: on an authentic result, under the GENOME (C9), and at the head of a piece's page (C4), the model's photograph runs the column's width, contained (never cropped), with its caption THE MODEL and an alternative text that names the model and its variant, never the piece (*The MONOLITHE BRACELET model in steel, photographed by ORBES*), then one sentence: *Photographed by ORBES. Compare it with the piece in your hands.* A photograph that cannot be loaded takes its section with it (`genome/src/web/verify/views/result.ts`, `modelPhoto`). The app takes a photograph only from this origin's `/api/v1/media/` path.

### 9.3 States and public wording

The wording comes from `services/copy.ts`, the single source of these sentences (the verify app displays `title` and `message` and keeps no copy of its own, the owner's unusual-activity variant included). It states what the system established and never claims that the object is genuine. Customer vocabulary: the object is a "piece", never a "product".

| `state` | `title` | `message` |
|---|---|---|
| `AUTHENTIC` | `AUTHENTIC` | This ORBES identity was issued and signed by ORBES and is registered to an active piece. |
| `AUTHENTIC_FIRST_REGISTRATION` | `AUTHENTIC — FIRST REGISTRATION` | This ORBES identity was issued and signed by ORBES and has not yet been registered. You may register it to your ORBES account. |
| `AUTHENTIC_REGISTERED` | `AUTHENTIC — REGISTERED` | This ORBES identity was issued and signed by ORBES and is registered to its owner. |
| `AUTHENTIC_OWNERSHIP_VERIFIED` | `AUTHENTIC — OWNERSHIP VERIFIED` | This ORBES identity was issued and signed by ORBES and is registered to your account. |
| `AUTHENTIC_OWNERSHIP_VERIFIED` with `notice: "UNUSUAL_ACTIVITY"` | `AUTHENTIC — OWNERSHIP VERIFIED` | This ORBES identity is registered to your account. Unusual activity has been recorded for it; ORBES Client Services can assist you. |
| `SUSPICIOUS_ACTIVITY` | `UNUSUAL ACTIVITY DETECTED` | The activity recorded for this ORBES identity requires review. Please contact ORBES Client Services before relying on it. |
| `REVOKED` | `REVOKED` | This ORBES identity is no longer valid. Please contact ORBES Client Services. |
| `UNKNOWN` | `UNKNOWN ORBES CODE` | This code is not registered with ORBES. Please contact ORBES Client Services. |
| `INVALID_SIGNATURE` | `INVALID SIGNATURE` | The signature of this code could not be verified against a valid ORBES key. |
| `MALFORMED_CODE` | `UNREADABLE CODE` | This code could not be read. Please scan it again in even light, holding the camera steady. |

(The dashes in the titles are em dashes, U+2014.)

### 9.4 Decision procedure

The first step that decides the state ends the decision; the scan event, authentication record and anomaly findings are written in every case (a staff scan records only the findings of steps 6–7, §9.7). Order: parse → key lookup → signature → revoked-key trust → genome-version support → registry → genome cross-check → statuses → anomalies → ownership → authenticators (normative: `genome/PLATFORM-CONTRACTS.md` §2.4).

| Step | Condition | Result |
|---|---|---|
| 1 | Strict structural parse fails: base64url (≤ 200 characters), then the code version's profile (high nibble of byte 0, `CODE_PROFILES`; CODE-01 today): length (79 bytes), CRC-16, strict payload decoding (reserved values such as genome version / key id / issue 0, field ranges). A version outside 1–8, or an unknown version whose envelope is broken, is `MALFORMED:VERSION`. | `MALFORMED_CODE` |
| 1 | The frame is intact (≥ 67 bytes, CRC-16 over everything before it) but names a code version 2–8 this server has no profile for: the server is outdated (or the version nibble was edited). Nothing else can be checked; logged as a warning, no anomaly (reason `UNSUPPORTED_CODE_VERSION`). | `UNKNOWN` |
| 2 | The key id named by the code is not in the key registry. | `INVALID_SIGNATURE` |
| 3 | The Ed25519 signature over `"ORBES-CODE/v1" ‖ 0x00 ‖ payload` does not verify (strict: small-order and non-canonical keys and non-canonical signatures are rejected). Every payload field is signed, the genome version included, so an edited version fails here. | `INVALID_SIGNATURE` |
| 4 | The key is REVOKED and there is no registry record of this code (product + issue) created before its compromise time (or revocation time when no compromise time is set) — whether the identity is registered or not. ACTIVE and RETIRED keys are always trusted. | `INVALID_SIGNATURE` |
| 5 | Validly signed, but the genome version is not supported by this server (the server is outdated; logged as a warning, no anomaly). | `UNKNOWN` |
| 6 | The signed identity is not a registered product, or the product has no code with this issue number. | `UNKNOWN` (CRITICAL anomaly `VALID_SIGNATURE_UNREGISTERED`) |
| 6 | The registered code's payload hash differs from the scanned payload's. | `SUSPICIOUS_ACTIVITY` (CRITICAL anomaly `CODE_MISMATCH`) |
| 7 | Genome cross-check: at least 6 glyphs with confidence ≥ 0.5 were provided and 2 or more of them differ from the genome recomputed from the signed identity. Fewer than 6 is inconclusive and never flagged. | `SUSPICIOUS_ACTIVITY` (anomaly `GENOME_MISMATCH`) |
| 8 | Code status SUPERSEDED or REVOKED; or product status REVOKED, COUNTERFEIT_FLAGGED or RETIRED. | `REVOKED` |
| 8 | Product status LOST or STOLEN. | `SUSPICIOUS_ACTIVITY` |
| 9 | A public scan of a piece ORBES has not sold yet (product status ISSUED, or SERVICED in a pre-sale service entered from ISSUED) of a code that passed steps 1–6 records the MEDIUM anomaly `UNSOLD_PIECE_SCAN` with the scan's country, once per piece and per UTC day, with weight 0 (§9.7). | unchanged |
| 9 | Anomaly scoring over the code's recent scan history, this scan included (impossible travel, scan velocity, source diversity, geographic dispersion, lost/stolen and post-revocation scans; a staff scan only reads the history, §9.7). It runs for every code that passed steps 1–6. When the state is still undecided and the risk score is at or above the configured threshold: | `SUSPICIOUS_ACTIVITY`; for the logged-in current owner, `AUTHENTIC_OWNERSHIP_VERIFIED` with `notice` |
| 10 | Still undecided: the viewer is the current owner → `AUTHENTIC_OWNERSHIP_VERIFIED`; another account owns it → `AUTHENTIC_REGISTERED`; no owner and product status ACTIVATED, RESOLD or SERVICED (not a pre-sale service entered from ISSUED) → `AUTHENTIC_FIRST_REGISTRATION` with a registration token (none on a staff scan, §9.7); otherwise `AUTHENTIC`. **Exception:** `SUSPICIOUS_ACTIVITY` from step 9 alone (no status, genome or code finding) on a product with no owner, open for registration as above and shipped with a claim code still carries a registration token with `claimCodeRequired: true` (not on a staff scan), so copies scanned by strangers cannot lock out the buyer holding the certificate claim code. **Transfer token (F-03):** when the state is an `AUTHENTIC*` one, another account owns the piece, its transfer is pending and the request carries the session of an account that is not that owner (not on a staff scan), the scan also mints a 15-minute `TRANSFER_ACCEPT` token (`transfer`, §9.2), which the acceptance of that transfer uses up (§11.3). **The same exception** as the registration's: `SUSPICIOUS_ACTIVITY` from step 9 alone still mints it under these conditions (reason `TRANSFER_WITH_TRANSFER_CODE`), so strangers scanning copies of a code shown in a listing cannot lock out the recipient holding the transfer code; the state shown does not change. | as stated |
| 11 | Authenticator policy: may set `assurance: "CODE_ONLY"` and `hardwareProofRequired`. Never changes the state. | — |
| 12 | The authentication record and the final scan state are persisted and the outcome returned. | — |

### 9.5 Examples

The responses below were captured from a development instance (in-memory database, test keys). Identifiers, dates, hashes and tokens are illustrative.

**`AUTHENTIC`** — an issued product, not yet sold, scanned with a genome reading:

```json
{
  "state": "AUTHENTIC",
  "scanId": "0c60c3b6-1e77-4b80-a64e-fe1240da84f9",
  "verifiedAt": "2026-10-01T08:13:21.929Z",
  "title": "AUTHENTIC",
  "message": "This ORBES identity was issued and signed by ORBES and is registered to an active piece.",
  "verification": {
    "signature": "VALID",
    "keyId": 1,
    "codeVersion": "CODE-01",
    "genomeVersion": "GENOME-01",
    "issuedAt": "2026-10-01",
    "issue": 1,
    "assurance": "CODE"
  },
  "genome": {
    "id": "O26-J-00001",
    "version": "GENOME-01",
    "fingerprint": "G1-213C-1C35",
    "glyphs": [2, 1, 3, 12, 1, 12, 3, 5],
    "ids": ["SMALL_ORBIT", "RING_POINT", "POINT", "QUARTER_ORB_NE", "RING_POINT", "QUARTER_ORB_NE", "POINT", "HALF_ARC_E"]
  },
  "product": {
    "productId": "O26-J-00001",
    "category": { "code": "J", "name": "Jewelry" },
    "model": "MONOLITHE",
    "type": "RING",
    "variant": "Size 52",
    "material": "925 STERLING SILVER",
    "createdYear": 2026,
    "productionDate": "2026-01-15",
    "care": "Polish with a soft dry cloth."
  },
  "warranty": { "status": "NOT_STARTED" },
  "ownership": { "registered": false, "you": false }
}
```

**`AUTHENTIC_FIRST_REGISTRATION`** — a sold product (warranty activated) without an owner; it ships with a claim code:

```json
{
  "state": "AUTHENTIC_FIRST_REGISTRATION",
  "scanId": "8c6e5c62-60f4-44eb-86fc-4c8dd41e07d9",
  "verifiedAt": "2026-10-01T08:13:21.929Z",
  "title": "AUTHENTIC — FIRST REGISTRATION",
  "message": "This ORBES identity was issued and signed by ORBES and has not yet been registered. You may register it to your ORBES account.",
  "verification": {
    "signature": "VALID", "keyId": 1, "codeVersion": "CODE-01", "genomeVersion": "GENOME-01",
    "issuedAt": "2026-10-01", "issue": 1, "assurance": "CODE"
  },
  "genome": {
    "id": "O26-J-00002",
    "version": "GENOME-01",
    "fingerprint": "G1-B24A-EBA2",
    "glyphs": [11, 2, 4, 10, 14, 11, 10, 2],
    "ids": ["ARC_PAIR_NWSE", "SMALL_ORBIT", "HALF_ARC_N", "ARC_PAIR_EW", "QUARTER_ORB_SW", "ARC_PAIR_NWSE", "ARC_PAIR_EW", "SMALL_ORBIT"]
  },
  "product": {
    "productId": "O26-J-00002",
    "category": { "code": "J", "name": "Jewelry" },
    "model": "MONOLITHE",
    "type": "RING",
    "material": "925 STERLING SILVER",
    "createdYear": 2026,
    "care": "Polish with a soft dry cloth."
  },
  "warranty": { "status": "ACTIVE", "startDate": "2026-10-01", "endDate": "2028-10-01" },
  "ownership": { "registered": false, "you": false },
  "registration": {
    "token": "rBSMWPS6jopabvjgFoZS96FbEGuRFy2LmnzQA696NtA",
    "expiresAt": "2026-10-01T08:28:21.929Z",
    "claimCodeRequired": true
  }
}
```

**`AUTHENTIC_REGISTERED`** — an owned product scanned by someone else; here the owner has offered it for transfer. `verification`, `genome`, `product` and `warranty` have the same shape as above and are abbreviated:

```json
{
  "state": "AUTHENTIC_REGISTERED",
  "scanId": "71e45f51-a8ca-4463-86fe-dc3f2a653454",
  "verifiedAt": "2026-10-01T08:13:21.929Z",
  "title": "AUTHENTIC — REGISTERED",
  "message": "This ORBES identity was issued and signed by ORBES and is registered to its owner.",
  "verification": { "signature": "VALID", "keyId": 1, "codeVersion": "CODE-01", "genomeVersion": "GENOME-01", "issuedAt": "2026-10-01", "issue": 1, "assurance": "CODE" },
  "genome": { "id": "O26-J-00002", "version": "GENOME-01", "fingerprint": "G1-B24A-EBA2", "glyphs": ["…"], "ids": ["…"] },
  "product": { "productId": "O26-J-00002", "…": "…" },
  "warranty": { "status": "ACTIVE", "startDate": "2026-10-01", "endDate": "2028-10-01" },
  "ownership": { "registered": true, "you": false, "transferPending": true }
}
```

**`AUTHENTIC_OWNERSHIP_VERIFIED`** — the logged-in owner scans their own product (abbreviated as above):

```json
{
  "state": "AUTHENTIC_OWNERSHIP_VERIFIED",
  "scanId": "8d9fe2a6-b243-42b9-8bea-9e7dbc2ba45f",
  "verifiedAt": "2026-10-01T08:13:21.929Z",
  "title": "AUTHENTIC — OWNERSHIP VERIFIED",
  "message": "This ORBES identity was issued and signed by ORBES and is registered to your account.",
  "verification": { "…": "…" },
  "genome": { "…": "…" },
  "product": { "…": "…" },
  "warranty": { "status": "ACTIVE", "startDate": "2026-10-01", "endDate": "2028-10-01" },
  "ownership": { "registered": true, "you": true }
}
```

**`AUTHENTIC_OWNERSHIP_VERIFIED` with notice** — the owner scans while the product's risk score is above the threshold (here: scans from France and Japan one minute apart, impossible travel). The owner keeps the authentic state; other viewers get `SUSPICIOUS_ACTIVITY`:

```json
{
  "state": "AUTHENTIC_OWNERSHIP_VERIFIED",
  "scanId": "8330adc4-1482-406f-8e4e-0830b36bb757",
  "verifiedAt": "2026-10-01T08:14:21.929Z",
  "title": "AUTHENTIC — OWNERSHIP VERIFIED",
  "message": "This ORBES identity is registered to your account. Unusual activity has been recorded for it; ORBES Client Services can assist you.",
  "notice": "UNUSUAL_ACTIVITY",
  "verification": { "…": "…" },
  "genome": { "…": "…" },
  "product": { "…": "…" },
  "warranty": { "…": "…" },
  "ownership": { "registered": true, "you": true }
}
```

**`SUSPICIOUS_ACTIVITY`** — a genome reading that contradicts the signed identity (the same shape results from risk scoring or a LOST/STOLEN product). No `product`, `warranty` or `ownership`:

```json
{
  "state": "SUSPICIOUS_ACTIVITY",
  "scanId": "54d574d2-7ccd-4e30-bad2-e083112b6e5e",
  "verifiedAt": "2026-10-01T08:15:21.929Z",
  "title": "UNUSUAL ACTIVITY DETECTED",
  "message": "The activity recorded for this ORBES identity requires review. Please contact ORBES Client Services before relying on it.",
  "verification": {
    "signature": "VALID", "keyId": 1, "codeVersion": "CODE-01", "genomeVersion": "GENOME-01",
    "issuedAt": "2026-10-01", "issue": 1, "assurance": "CODE"
  },
  "genome": {
    "id": "O26-J-00004",
    "version": "GENOME-01",
    "fingerprint": "G1-3F31-7172",
    "glyphs": [3, 15, 3, 1, 7, 1, 7, 2],
    "ids": ["POINT", "QUARTER_ORB_NW", "POINT", "RING_POINT", "HALF_ARC_W", "RING_POINT", "HALF_ARC_W", "SMALL_ORBIT"]
  }
}
```

When `SUSPICIOUS_ACTIVITY` results from a payload-hash mismatch (step 6), `genome` is present but `verification` is absent. When it results from the scan history alone on an unregistered product shipped with a claim code (step 10's exception), the body also carries `registration` with `"claimCodeRequired": true`. The verification app shows it under the help line as **DO YOU HOLD THE CERTIFICATE CARD?**: sign-in or account creation, then the CLAIM CODE field, which is required (§11.1); still no product lines, tabs or other product data. After registering, *VIEW AS OWNER* verifies again and the owner sees `AUTHENTIC_OWNERSHIP_VERIFIED`, with the `UNUSUAL_ACTIVITY` notice and its sentence while the scan history still scores above the threshold (step 9).

**`REVOKED`** — the original code of a product whose code was re-issued (status SUPERSEDED); revoked codes and revoked, retired or counterfeit-flagged products answer the same way:

```json
{
  "state": "REVOKED",
  "scanId": "af394902-c155-4415-8109-d2ec1586fe70",
  "verifiedAt": "2026-10-01T08:15:21.929Z",
  "title": "REVOKED",
  "message": "This ORBES identity is no longer valid. Please contact ORBES Client Services.",
  "verification": {
    "signature": "VALID", "keyId": 1, "codeVersion": "CODE-01", "genomeVersion": "GENOME-01",
    "issuedAt": "2026-10-01", "issue": 1, "assurance": "CODE"
  },
  "genome": {
    "id": "O26-J-00005",
    "version": "GENOME-01",
    "fingerprint": "G1-CE56-AFAA",
    "glyphs": [12, 14, 5, 6, 10, 15, 10, 10],
    "ids": ["QUARTER_ORB_NE", "QUARTER_ORB_SW", "HALF_ARC_E", "HALF_ARC_S", "ARC_PAIR_EW", "QUARTER_ORB_NW", "ARC_PAIR_EW", "ARC_PAIR_EW"]
  }
}
```

**`UNKNOWN`** — a correctly signed identity that is not in the registry:

```json
{
  "state": "UNKNOWN",
  "scanId": "92d17134-21c7-423b-9740-27b24fb5c9e8",
  "verifiedAt": "2026-10-01T08:15:21.929Z",
  "title": "UNKNOWN ORBES CODE",
  "message": "This code is not registered with ORBES. Please contact ORBES Client Services."
}
```

**`INVALID_SIGNATURE`** — unknown key, bad signature, or a key revoked before the code was recorded:

```json
{
  "state": "INVALID_SIGNATURE",
  "scanId": "e5d1f11d-e346-4b7b-a7cb-73fe4810313f",
  "verifiedAt": "2026-10-01T08:15:21.929Z",
  "title": "INVALID SIGNATURE",
  "message": "The signature of this code could not be verified against a valid ORBES key."
}
```

**`MALFORMED_CODE`** — well-formed base64url that is not a valid code (here 79 bytes failing the CRC):

```json
{
  "state": "MALFORMED_CODE",
  "scanId": "3832bf94-7424-45f4-a00f-8dc418714edf",
  "verifiedAt": "2026-10-01T08:15:21.929Z",
  "title": "UNREADABLE CODE",
  "message": "This code could not be read. Please scan it again in even light, holding the camera steady."
}
```

### 9.6 Errors

`400 VALIDATION_FAILED`, `400 INVALID_JSON`, `413`, `415`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR`. A verification outcome is never an error.

### 9.7 Pieces not sold yet, and staff scans (S-07)

**A piece ORBES has not sold yet.** Its product status is ISSUED (in stock), or SERVICED in a pre-sale service entered from ISSUED (`isPreSaleService`, §14.4), and its warranty has not started. Until a sale it answers `AUTHENTIC` like any piece in force, and the customer still sees exactly that: same state, title, message and fields (the verify app's OWNERSHIP tab says **NOT YET DELIVERED**: *This piece has not yet been delivered by ORBES or an authorised retailer. Registration opens once it has been.*, BRAND §4.4). A piece is sold when ORBES or an authorised retailer starts its warranty (the sale mode on a seller's phone, §16.18, or the console, §14.6); before that, a scan of it outside a console session is the earliest sign of diverted stock (theft in stock or in transport, labels taken), before the first copy is sold. Each one records the internal anomaly **`UNSOLD_PIECE_SCAN`** (§16.4), named *Unsold piece scanned* in the console (set in its capitals, **UNSOLD PIECE SCANNED**):

- when the code passed steps 1–6 (a trusted registered code, whatever steps 7–9 then decide), the request carries no console session and the piece's warranty has not started (a started warranty is a sale, whatever the status says; and no warranty starts during a pre-sale service, §14.6);
- severity MEDIUM, **weight 0**: it never raises the risk score of step 9, so the state shown never changes because of it; the authentication record of every such scan lists the reason `ANOMALY:UNSOLD_PIECE_SCAN`, which the console's Verification events reads as **ANOMALY: UNSOLD PIECE SCANNED** (§16.1);
- **once per piece and per UTC day**: the first such scan of the day opens the finding or adds one occurrence to the open one, later scans that day add nothing (concurrent scans included), and a finding of that type already seen for the piece that UTC day, whatever its status, is not raised again before the next day (one last seen the day before and closed today is raised again by today's first scan); `occurrences` therefore counts days;
- `details`: `country` (ISO alpha-2 of the scan, `null` when unknown), `productStatus` (`ISSUED` or `SERVICED`), `preSaleService: true` for a pre-sale service, `scanEventId` of the day's first scan.

**Staff scans.** A request whose `orbes_admin` cookie is a session the console itself would let in (alive, of an enabled console user with a known role, its password the user's own, past the second factor when `ADMIN_REQUIRE_MFA` holds) is a staff scan, whoever else the browser is signed in as:

- one scan event of type `ADMIN_TEST` naming the console user (`scan_events.admin_id`, shown as *by email* in the console's verification events, §16.1), with the IP pseudonym, coarse location and browser family but **no device, session or account pseudonym**;
- **no `UNSOLD_PIECE_SCAN`** and no history finding: the scan takes no part in step 9, the code's public history is scored as it stands, so the state is the one a customer would see now, and ADMIN_TEST scans never count in any later scoring;
- the findings of steps 6–7 are **still recorded**, with `staffScan: true` in their `details`: `VALID_SIGNATURE_UNREGISTERED`, `CODE_MISMATCH` and `GENOME_MISMATCH` describe the code, not who scanned it. A forged but validly signed code most likely reaches ORBES when Client Services checks a suspicious piece a customer brought in, from a browser signed in to the console: that scan pages on a possible key compromise (§16.4) as any other would;
- **no registration token**, also under step 10's exception, and **no transfer token** (F-03; the scan event names no account): a console user's test is never a buyer's scan. The state stays the one a customer would see (`AUTHENTIC_FIRST_REGISTRATION` included); the verify app's OWNERSHIP tab then says **STAFF SCAN**: *This browser is signed in to the ORBES console, so this scan was recorded as a staff test and registration is not offered.* On a piece registered to someone else whose transfer is pending, it says STAFF SCAN under RECEIVING THIS PIECE too (*… receiving this piece is not offered. To receive a piece of your own, scan it in a browser that is not signed in to the console.*), never VERIFY AGAIN, which would only repeat the staff scan.
- the response carries **`staffScan: true`** (§9.2), which the verify app reads to show STAFF SCAN rather than a registration, and to leave out **WHERE DID YOU SEE OR BUY THIS PIECE?** on a result that was not authentic: a staff scan takes **no report** (`POST /api/v1/reports` answers `409 REPORT_NOT_ALLOWED` with its own message, §8.5). A customer's words belong to a customer's scan. Nothing leaks: the flag reaches only the browser that holds the console cookie.

A member of the team who buys a piece therefore scans and registers it from a browser that is not signed in to the console. The admin cookie is `SameSite=Strict`: a cross-site request never carries it, so no other site can make a visitor's scan count as a staff scan, and a console session that the guard would refuse (temporary password, second factor missing when required, disabled account) leaves the scan public.

---

## 10. Account endpoints

Customer accounts use the `orbes_session` cookie (`__Host-orbes_session` in production; §2.1).

### 10.1 `POST /api/v1/account/register`

Creates an account and logs it in. Session-less: the origin rule applies, no CSRF token. Rate group `auth`.

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | 3–254 characters after trimming; must look like an email address. Unique, case-insensitive. |
| `password` | string | yes | At most 1 024 characters. At least 12 characters after Unicode NFKC normalisation, at most 1 024 bytes in UTF-8, at least 3 distinct characters, not only whitespace, not equal to the email. |
| `displayName` | string \| null | no | At most 80 characters; no control characters, `<` or `>`. `""` means none. |
| `country` | string \| null | no | ISO 3166-1 alpha-2 code, any case (`fr` is stored as `FR`). `""` means none. Stored on the account; never shown to other people. |

**201** — sets `orbes_session`:

```json
{ "account": { "email": "ada@example.com", "displayName": "Ada" }, "csrfToken": "Bz6HODVO1RCbUYkv9Bd7gziEOWGaxiMaojVcmTH06KQ" }
```

Errors: `400 VALIDATION_FAILED`, `403 CSRF_FAILED`, `409 EMAIL_TAKEN`, `429 RATE_LIMITED`.

`409 EMAIL_TAKEN` tells a caller that an account exists for an email. This enumeration is an accepted trade-off: without an email channel (no verification or reset mail exists yet; a forgotten password goes through ORBES Client Services, §10.8) registration cannot answer "check your inbox" for both cases. The `auth` rate limit bounds how fast it can be probed (SECURITY-MODEL §3).

### 10.2 `POST /api/v1/account/login`

Body `{ "email": string (3–254), "password": string (1–1024) }`. Session-less (origin rule). Rate group `auth`. A new session is issued; a session cookie already presented is replaced.

**200** — sets `orbes_session`; same body as registration.

Errors: `400 VALIDATION_FAILED`, `401 INVALID_CREDENTIALS` (identical for unknown emails and wrong passwords), `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `429 RATE_LIMITED`.

**Locked account.** An account LOCKED by ORBES Client Services (§16.12) answers `403 ACCOUNT_LOCKED` (*This account is locked. ORBES Client Services can assist you.*) once the password is right, and no session is opened; a wrong password still answers `401 INVALID_CREDENTIALS`, so the lock is never revealed to someone who does not hold the password. The account is read again under its row lock in the transaction that opens the session, so a sign-in whose password check was under way when the lock took effect is refused too, rather than opening a session that would work again after an unlock. The same re-read refuses (`401 INVALID_CREDENTIALS`) a sign-in whose password was replaced meanwhile by an assisted recovery (§10.8) or a password change (§10.7): the old password opens no session once the new one is stored. Concurrent sign-ins of one account take that lock in turn.

**Per-account throttle.** After 10 wrong passwords for one account within 15 minutes (counted from the first failure of the window), further logins to that account are refused for the rest of the window **without checking the password**, with the same `401 INVALID_CREDENTIALS` and the same response time as a wrong password: the answer reveals neither the throttle nor whether the account exists. A successful login resets the counter; failures spread over more than 15 minutes start a new window. This complements the per-IP `auth` budget (§3), which a distributed guesser can spread across addresses.

### 10.3 `POST /api/v1/account/logout`

No body. Works with or without a session: with one, the CSRF rules apply and the session is deleted; without one, only the origin rule applies. The cookie is cleared in both cases.

**200** `{ "ok": true }`. Errors: `403 CSRF_FAILED`.

### 10.4 `GET /api/v1/account/session` and `GET /api/v1/account/me`

`GET /api/v1/account/session` is the session probe for pages that only need to know whether someone is signed in (the verify app uses it): it never answers 401.

- Signed out (no cookie, or an expired or revoked one, which is cleared): **200** `{ "account": null }`.
- Signed in: **200** `{ "account": { "email": string, "displayName": string | null }, "csrfToken": string }`.

`GET /api/v1/account/me` returns the same signed-in body and **401 UNAUTHORIZED** when signed out.

### 10.5 `GET /api/v1/account/products`

The caller's current products, newest acquisition first.

**200**:

```json
{
  "products": [
    {
      "productId": "O26-J-00002",
      "category": { "code": "J", "name": "Jewelry" },
      "collection": "ORBIT",
      "model": "MONOLITHE",
      "modelVariant": null,
      "type": "RING",
      "variant": null,
      "material": "925 STERLING SILVER",
      "createdYear": 2026,
      "acquiredVia": "FIRST_REGISTRATION",
      "verified": true,
      "since": "2026-10-01T08:13:21.929Z",
      "transfer": { "pending": false },
      "incident": null,
      "incidentResolvable": false,
      "incidentReportable": true,
      "inService": false,
      "certificateAllowed": true,
      "genome": {
        "id": "O26-J-00002",
        "version": 1,
        "fingerprint": "G1-B24A-EBA2",
        "glyphs": [11, 2, 4, 10, 14, 11, 10, 2],
        "pattern": "ARC_PAIR_NWSE·SMALL_ORBIT·HALF_ARC_N·ARC_PAIR_EW·QUARTER_ORB_SW·ARC_PAIR_NWSE·ARC_PAIR_EW·SMALL_ORBIT"
      },
      "warranty": { "status": "ACTIVE", "startDate": "2026-10-01", "endDate": "2028-10-01" },
      "imageUrl": "/api/v1/media/9f2c4e…",
      "lookbook": "monolithe",
      "care": "Polish with a soft dry cloth.",
      "origin": {
        "release": { "id": "5b1d…", "mode": "DRAW", "at": "2026-09-14T18:01:00.000Z" },
        "order": { "reference": "OR-7C21A9F0", "channel": "DRAW", "status": "DELIVERED", "at": "2026-09-22T12:00:00.000Z" }
      }
    }
  ]
}
```

| Field | Notes |
|---|---|
| `collection` | The product's collection, or else its model's; `null` when neither has one. |
| `modelVariant` | (plan NOCTURNE, N1) The model's label among its variants (« Blue »: the piece is a MONOLITHE in blue), or `null`. |
| `variant` | The piece's free-text field set at issuance, its size (SIZE since NOCTURNE N1; a value written before as it is), or `null`. |
| `imageUrl` | The model's reference photograph (F-04, §8.6), or its variant's, or `null`: MY PIECES shows it whole across the column under each piece, and a piece's page captions it THE MODEL as an authentic result does, with its alternative text (BRAND §5). Never the piece's own photograph (plan NOCTURNE, decision 9; §9.2). Not on an ownership certificate (§8.7), which attests a record, not an object. |
| `lookbook` | (plan NOCTURNE, N3, N6) The `<slug>` of its model's lookbook sheet (§8.8) when the model is PUBLIC there, or RESERVED (THE PRIVATE SALON, §10.9) and the account's tier reaches its `privateMinTier`, as its sheet is answered; else `null` (a result never names a RESERVED model, §9.2): NOW, THE COLLECTION and THE PRIVATE SALON count the account's pieces of a model and its variants by it (*You own two: steel and gold*). |
| `care` | (P-M02) The model's care instructions as they are now (read live), or `null`: the CARE tab of a piece's page then shows the general care text of /verify (`DEFAULT_CARE`). The ownership certificate (§8.7) does not show it. |
| `origin` | (plan NOCTURNE, addition 2) Where the piece comes from: the latest order **of this account** that the piece fulfils (§10.13; lot E's `orders.product_id`), never another account's (a piece received from another owner has none of theirs), with `order` its `reference`, its `channel`, its `status` and when it reached that step (`at`), and `release` the release it was sold in (`mode` `DRAW` or `LIVE`, `at` when a draw was drawn, its close until then, or a LIVE RELEASE's T0), `null` for the private salon. `null` for a piece without an order (a boutique sale). The verify app says it on the piece's page: WHERE IT COMES FROM, *THE DRAW OF 14 SEPTEMBER* (its page) and *ORDER OR-7C21A9F0 · DELIVERED ON 22 SEP 2026* (the tab ORDERS of MY PIECES, the order in view). |
| `acquiredVia` | `FIRST_REGISTRATION` or `TRANSFER`. |
| `verified` | Ownership proven by claim code or confirmed by client services. |
| `transfer` | `{ "pending": true, "expiresAt": … }` while an unexpired transfer offer is pending. |
| `incident` | `"LOST"` or `"STOLEN"` while the product is reported (by its owner, §11.5, or by ORBES Client Services), else `null`. |
| `incidentResolvable` | Extension (F-01). `true` for a `LOST` the owner reported themselves, which they may withdraw (§11.6); `false` otherwise: a `STOLEN`, or a `LOST` recorded by ORBES Client Services, is theirs to withdraw. Read from the status history (the move to `LOST` was made by this account). |
| `incidentReportable` | Extension (F-01). `true` when the owner may report the piece lost or stolen (§11.5); `false` while it is reported, and for a piece revoked, retired or flagged by ORBES, where the report answers `409 INCIDENT_NOT_ALLOWED`: MY PIECES then shows no REPORT LOST / STOLEN and points to ORBES Client Services, with their contact. It names no status. |
| `inService` | The product is currently in after-sales service. |
| `certificateAllowed` | Extension (F-06). `true` when the owner may create a link to an ownership certificate of the piece (§11.7); `false` while it is reported lost or stolen, or revoked or retired, where the creation answers `409 CERTIFICATE_NOT_ALLOWED`: MY PIECES then leaves OWNERSHIP CERTIFICATE out. It names no status. |
| `genome.version` | Integer here (1), unlike the `"GENOME-01"` label of the verification response. |

Errors: `401 UNAUTHORIZED`.

In the verify app, this list is **MY PIECES** (`/verify/pieces`, F-01; plan NOCTURNE, C3), its tab PIECES: each piece on its model's photograph, its name and id, its type, material and size (`variant`, addition 1), REGISTERED TO YOU since its date (or its state), and SEE THE PIECE, its page (`/verify/pieces/<productId>`, C4): THE MODEL's photograph, its lines with SIZE, SEE THE MODEL (`lookbook`), its state, WHERE IT COMES FROM (`origin`), its GENOME in orbit, in ivory, the ORBES monogram at its centre (drawn from `glyphs`, checked against `fingerprint`; the glyph ids are `pattern` split at `·`), then the tabs OWNERSHIP (since when, how it was acquired, whether the ownership is verified, a pending transfer, which CANCEL TRANSFER withdraws, §11.4, REPORT LOST / STOLEN or PIECE FOUND, §11.5–§11.6, and OWNERSHIP CERTIFICATE, the links of §11.7 with the open ones listed, F-06), WARRANTY, SERVICE (§10.6) and CARE (P-M02: CARING FOR THIS PIECE, the model's `care` or the general care text, then ORBES CARE, its three lines, and SUBSCRIBE when `careSubscribeUrl` is published, §8.4, else *Subscriptions open soon.*). The page reads the open certificate links with the pieces (`GET /api/v1/ownership/certificates`); when they cannot be read, the pieces still show and each says so, with TRY AGAIN, and keeps saying so after a link is created (the list is read again then; a creation never stands for the whole list, whose other links could not be withdrawn). After a report, a withdrawal or a cancelled transfer, the page reads the list again and shows the piece as the server now holds it; a piece the account does not hold (passed on, an address that is none) gives way to MY PIECES. Signed out, the page offers the sign-in first: an owner whose piece is lost or stolen reaches it without scanning the piece. NOW links to it (its YOUR PIECES, signed in; under the scan, signed out: plan NOCTURNE, N3), and so does the signed-in account line of a result's OWNERSHIP tab.

### 10.6 `GET /api/v1/products/:productId/service-history`

Owner-only view of the after-sales history. Staff notes and technician names are not included.

**200**:

```json
{
  "productId": "O26-J-00002",
  "services": [
    { "id": "6f0d…", "type": "POLISH", "status": "COMPLETED", "location": "Paris atelier",
      "openedAt": "2026-10-01T09:00:00.000Z", "closedAt": "2026-10-03T16:30:00.000Z" }
  ]
}
```

Errors: `400 VALIDATION_FAILED` (malformed product id), `401 UNAUTHORIZED`, `403 FORBIDDEN` (not the current owner), `404 PRODUCT_NOT_FOUND`.

In the verify app, the SERVICE tab of a piece's page in MY PIECES (§10.5) reads it when it is first opened: under SERVICE HISTORY, each service by its dates (or IN PROGRESS SINCE …, or CANCELLED …) and its place, then its type (C35).

### 10.7 `POST /api/v1/account/password`

The signed-in customer changes their password (C-04). Body `{ "currentPassword": string (1–1024), "newPassword": string (1–1024) }`; unknown fields are refused. Account session and CSRF rules. Rate group `auth`.

- `newPassword` follows the rules of registration (§10.1: at least 12 characters after NFKC normalisation, not equal to the email…). It is checked first, so a weak choice (`400 VALIDATION_FAILED`) costs no attempt.
- A wrong current password answers **`400 CURRENT_PASSWORD_INVALID`**, never a 401 (the verify app and the console end the session on any 401), and counts in the account's login throttle (§10.2), audited `account.login_failed` with `details.via: "password_change"`: whoever holds a session cannot guess the password faster than a login could. While the account is throttled, the current password is not checked, with the same answer.
- On success the new password is stored, **every other session of the account ends** and this one is kept. Audited `account.password_change`.
- **Nothing that happened during the check is undone.** The two scrypt evaluations (the current password, then the new one) run before the write, which then reads the account again under its row lock: if ORBES Client Services locked it meanwhile, the answer is `403 ACCOUNT_LOCKED` (§16.12); if this session has ended (an assisted recovery, §10.8, or a lock ended every session), `401 UNAUTHORIZED`; if the password is no longer the one that was checked (a recovery or another change committed first), `400 CURRENT_PASSWORD_INVALID`. In each case nothing is written: a change under way can neither undo a recovery nor outlive a lock.

**200** `{ "ok": true }`. Errors: `400 VALIDATION_FAILED`, `400 CURRENT_PASSWORD_INVALID`, `401 UNAUTHORIZED`, `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `429 RATE_LIMITED`.

In the verify app, signed in: CHANGE PASSWORD in the account sheet (plan NOCTURNE, C2 and C39), opened by the header's account button, beside SIGN OUT (it left the OWNERSHIP panel for MY PIECES with F-01, then MY PIECES for the sheet with NOCTURNE; the panel's account line leads to MY PIECES). A wrong current password is said on its field, and the page stays signed in.

### 10.8 `POST /api/v1/account/recover`

Assisted recovery of a forgotten password (C-04). There is no email channel: the customer contacts ORBES Client Services, who check their identity and, as an ADMIN, issue a one-time recovery code in the console (§16.10); the customer enters it here with a new password. Session-less: the origin rule applies, no CSRF token. Rate group `auth`.

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | 3–254 characters; the account's email, any case. |
| `recoveryCode` | string | yes | 1–32 characters. 12 Crockford base32 characters in any accepted spelling, as a claim code (§11.1: case, hyphens and spaces ignored, `I`/`L` read as `1` and `O` as `0`); display form `XXXX-XXXX-XXXX`. |
| `newPassword` | string | yes | The rules of registration (§10.1), checked first: a weak choice costs no attempt. |

Example request:

```json
{ "email": "ada@example.com", "recoveryCode": "7KQ2-MWX9-D4RT", "newPassword": "a brand new passphrase" }
```

**200**:

```json
{ "ok": true, "transfersPausedUntil": "2026-10-05T09:00:00.000Z" }
```

No session is opened and no cookie is set: the customer then signs in with the new password (§10.2). In **one transaction**:

1. the new password is stored and the account's login throttle is cleared;
2. **every session of the account ends**, including any held by whoever had taken it over;
3. its **pending transfers are cancelled** (audited `ownership.transfer.cancel` with `details.reason: "account_recovery"`), so a transfer code handed out meanwhile no longer completes (`410 TRANSFER_CANCELLED`);
4. its **open links to ownership certificates are withdrawn** (§11.7; audited `ownership.certificate.revoke` with `details.reason: "account_recovery"`): a link created by whoever held the account answers `404 CERTIFICATE_NOT_FOUND` (§8.7) like one its owner withdrew, and the owner creates new ones once signed in. A creation already on its way when the recovery commits gets no link: it reads its session again under the account's share lock, finds it ended and answers `401 UNAUTHORIZED` (§11.7);
5. **new transfers out of the account are paused for 72 hours** (`transfersPausedUntil`; §11.2 then answers `409 TRANSFERS_PAUSED`), against a takeover of the account by social engineering of Client Services; transfers offered *to* the account are not affected;
6. the code is marked used. Audited `account.recover` with the account as target and the code's id, the sessions, transfers and certificate links ended (`certificatesRevoked`) and the end of the pause; never the code or the email.

A request with the old password that was already under way when the recovery committed gets nothing either: a sign-in (§10.2) re-reads the account's password under its row lock before it opens the session, and a password change (§10.7) before it writes, so neither opens a session nor writes back the old password, nor sets one of its own.

**One answer for every refusal.** An unknown email, a wrong, malformed, expired (30 minutes), used or replaced code, a deleted account, and an account over its attempt limit all answer `400 RECOVERY_CODE_INVALID` with the same message and one scrypt evaluation: the answer reveals neither whether the email has an account nor why the code failed.

**Attempt limit.** At most **5 wrong guesses at the open code per rolling hour**. Every refused attempt is recorded in the audit log, committed before the answer, as `account.recover_failed` with its reason for staff: `NO_OPEN_CODE` (no code is open), `EXPIRED`, or `MISMATCH` (a wrong guess at the open code, which also names the code, `details.recoveryCodeId`, and the attempt number). Only the `MISMATCH` entries of the open code count: an attempt while no code is open, or once it has expired, guesses nothing, so it costs the same scrypt but spends no budget, and a code freshly issued by Client Services always starts with all 5 guesses. Such attempts have no limit of their own per account (the `auth` rate group bounds each client): their scrypt runs after the attempt's transaction has committed, as a throttled attempt's does, so a burst of them naming one email holds neither the account's row lock (which a sign-in, §10.2, and a transfer, §11.2, take too) nor a database connection while it hashes. The budget is per code rather than per account (a declared deviation from the brief's "5 failures per hour per account"): counting every refused attempt would let whoever knows the email keep each new code refused before the customer types it. Attempts on one account are serialised by its row lock, so the limit holds exactly across instances. After the fifth wrong guess, the code is refused without being checked, the right one included (`account.recover_throttled`, naming the code), until the oldest of those guesses is an hour old, which outlasts its 30 minutes: the code is spent, and the owner's record in the console reads *Recovery attempts throttled until …* (`recoveryCodeThrottledUntil`, §16.2). Client Services then issues a new code. The residual risk (accepted, SECURITY-MODEL §3.3): someone who knows the customer's email and hammers the form within the 30 minutes after a code is issued can spend that code's guesses before the customer uses it; each new code needs a new attempt, inside its own 30 minutes, and each is recorded on the account.

A LOCKED account answers `403 ACCOUNT_LOCKED` once the code is right, and the code is not used. The lock itself revokes the open code (§16.12), so this answer comes only when the lock lands between the check of the code and its use; a code issued before a lock then fails like a replaced one, also after the unlock, and Client Services issues a new one if the customer needs it.

Errors: `400 VALIDATION_FAILED`, `400 RECOVERY_CODE_INVALID`, `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `429 RATE_LIMITED`.

In the verify app, signed out: FORGOTTEN PASSWORD? under the sign-in form of the OWNERSHIP panel leads to ORBES Client Services (the contact of §8.4: an email titled *ORBES — FORGOTTEN PASSWORD* that quotes the reference of the scan on screen, the phone and the hours), then I HAVE A RECOVERY CODE to the form (email, recovery code, new password). After a recovery the sign-in form comes back with the email filled in, and says what the recovery did and until when transfers are paused.

### 10.9 The club and THE PRIVATE SALON: `GET /api/v1/club/lookbook`, `GET /api/v1/club/lookbook/:slug` and `POST /api/v1/club/lookbook/:slug/request` (extension of the contract)

The owners' club (the « Potentiel » plan of 2026-10-03; `routes/club.ts`, `services/club.ts`, `services/salon.ts`): what a signed-in account holds now decides what it reads there. P-R02 opened the lookbook's **RESERVED** models (§8.8) to the owners of a piece; P-X08 makes them **THE PRIVATE SALON**: each RESERVED model is shown from the tier its `privateMinTier` names (1 TITANE, the default; 2 PLATINE; 3 PALLADIUM; the tiers of §10.10), with the price the console set (`priceLabel`, §13.4), and an owner requests it from its sheet; ORBES Client Services then contacts the account and concludes the sale, outside the service. No payment is taken and no email is sent. Account session required (`401 UNAUTHORIZED` without one); the club's mutations are POSTs only, under the CSRF rules (§2.2). Rate group `api`. Every answer depends on the account: `Cache-Control: no-store`, errors included.

An **owner** is an account that holds at least one piece now: an ownership still open (`ownership.ended_at IS NULL`) of a piece that is not REVOKED, COUNTERFEIT_FLAGGED or RETIRED (those never end an ownership, so they are left out of the count; the ownership table is only read here). The count, and the tier it gives (`services/club.ts` `tierOf`), are read again at each request: the access goes with the pieces. Any other account: **`403 OWNERS_ONLY`** (*This is reserved for the owners of an ORBES piece.*).

- **`GET /api/v1/club/lookbook`, 200**: `{ "models": [ … ], "opensAt": … }`, THE PRIVATE SALON's cards: only the RESERVED models whose `privateMinTier` the account's tier reaches, as the cards of §8.8 (never a story), each with two more fields:

  ```json
  { "models": [ { "slug": "eclipse", "name": "ECLIPSE", "type": "RING", "category": { "code": "J", "name": "Jewelry" }, "collection": "ORBIT", "imageUrl": "/api/v1/media/4b1a…", "priceLabel": "€ 4 800", "minTier": 1 } ], "opensAt": null }
  ```

  | Field | Notes |
  |---|---|
  | `priceLabel` | The price as the salon shows it, 1 to 60 characters (« € 4 800 », « Price on request »), or `null`: no price shown. An indicative price: the sale is concluded by ORBES Client Services. |
  | `minTier` | The lowest tier the model is shown to: 1 TITANE, 2 PLATINE, 3 PALLADIUM. |

  `opensAt` (plan NOCTURNE, screen 5: the salon locked below its tier, with what opens it): when the account's tier reaches no model (`models` empty), the lowest tier above it from which a RESERVED model with an address is shown, `{ "level": 2, "name": "PLATINE", "pieces": 5 }` (`pieces`: the pieces held that tier starts from, §10.10); `null` when the account's tier reaches a model, or when no model is shown above it. It never names a model (terms, article 12): /verify says *It opens at PLATINE, from 5 pieces registered to your ORBES account.* in the teaser's plate.

- **`GET /api/v1/club/lookbook/:slug`, 200**: a sheet of §8.8, PUBLIC or RESERVED (`"lookbook": "RESERVED"` for a reserved one). A RESERVED sheet is answered only from its tier up: above the account's tier it is **`404 LOOKBOOK_NOT_FOUND`**, the same answer as a model not shown. A RESERVED sheet carries `salon`; a PUBLIC one has none:

  ```json
  { "slug": "eclipse", "lookbook": "RESERVED", "name": "ECLIPSE", "…": "…", "discontinuedYear": null,
    "salon": { "priceLabel": "€ 4 800", "minTier": 1, "request": { "id": "6f1c…", "status": "OPEN", "createdAt": "2026-10-04T10:02:11.000Z" } } }
  ```

  `salon.request` is the account's OPEN request for the model, or `null`; with its `size` (plan NEXT-NINE, AC-01: the size asked, or `null`). A RESERVED sheet's `salon` (and each RESERVED dot's) also carries `sizes`, the model's own sizes from its SKUs (ONE SIZE left out), in the order a client reads them, and `suggestedSize`, the one of them the account's saved size matches (§10.19), or `null` (no size kind, no saved size, no single match). The app shows its size picker, YOUR SIZE with NOT SURE YET, from two sizes; the suggestion is preselected with *SIZE 52 · FROM YOUR SIZES* and *Check it is right for this model before you confirm.*, and is sent only by REQUEST THIS PIECE. A HIDDEN or unknown model: `404 LOOKBOOK_NOT_FOUND`. Its `releases` (plan NEXT-NINE, CO-01, §8.8) are the public sheet's, the same for every account: the past releases of the model's whole group, each exactly `{id, kind, opensAt, variant}`. Its `pairs` (plan NEXT-NINE, BP-34, §8.8) are read for the account's tier: a model of THE PRIVATE SALON picked, or of its collection, shows from its `privateMinTier`, with `"reserved": true`.

- **`POST /api/v1/club/lookbook/:slug/request`, 201**: **REQUEST THIS PIECE**, a RESERVED model whose tier the account reaches now. Body (it may be omitted):

  ```json
  { "note": "A call after six, please.", "size": "54" }
  ```

  | Field | Rules |
  |---|---|
  | `note` | Optional: the account's words for ORBES Client Services, at most 500 characters once trimmed, line breaks kept, no control character. Blank text or `null` means no note. |
  | `size` | Optional (plan NEXT-NINE, AC-01): the size asked, one of the model's sizes whatever its case, kept as the model's SKU names it; another is `400 VALIDATION_FAILED` *Choose one of this model’s sizes.* Its offered sizes only (plan NEXT LOT §3.3): a size set aside is neither listed in the sheet's `salon.sizes` nor accepted; a request made before in it keeps it, and its ACCEPTED order takes that size's SKU. Blank, `null` or left out: none (NOT SURE YET, or a model of one size). It never changes once requested (`shop_requests_immutable_identity`). |

  Answer: `{ "request": { "id": "6f1c…", "status": "OPEN", "createdAt": "2026-10-04T10:02:11.000Z", "size": "54", "modelId": "73c6…" } }`. One OPEN request per account and model (`shop_requests_one_open`): a second answers **`409 SHOP_REQUEST_OPEN`** (*You have already requested this piece: ORBES Client Services will contact you.*); once the console has closed it (§16.22), the account may request the model again. The account's row is read `FOR SHARE` in the request's transaction, so a lock under way (§16.12) finishes first and closes it; an account that is not ACTIVE is refused (`403 FORBIDDEN`). Audited `shop.request` (actor the account, target the `shop_request`, details `{ modelId, sized }`, `sized` whether a size was asked): neither the note nor the size is copied into the audit log. Nothing else happens: no email, no payment, no reservation of a piece; a request obliges neither the account nor ORBES.

RESERVED means **unlisted, not confidential**: the sheet is not listed for the public, but its photographs stay public at `/api/v1/media/…` (§8.6), like every other. A circle post's link to a RESERVED model (§10.11) is shown only to a member whose tier reaches it.

Errors: `400 VALIDATION_FAILED` (a note over 500 characters, not text, with a control character, a size the model does not have, an unknown field), `401 UNAUTHORIZED`, `403 OWNERS_ONLY`, `403 FORBIDDEN` (an account not ACTIVE), `404 LOOKBOOK_NOT_FOUND`, `404 NOT_IN_SALON` (*This model is not offered in the private salon.*, a PUBLIC model), `409 SHOP_REQUEST_OPEN`, `429 RATE_LIMITED`.

**In the verify app:** THE COLLECTION (§8.8) asks for the salon once the session is known and signed in; an owner sees **THE PRIVATE SALON** (*Pieces offered to the owners of an ORBES piece, by tier, on request.*), each card with its price in the reading face, and the sheets read `RING · THE PRIVATE SALON`. A sheet of the salon then shows THE PRIVATE SALON: PRICE and OFFERED FROM rows, *Offered to the owners of an ORBES piece, on request. ORBES Client Services contacts you to conclude the sale: nothing is paid here.*, the field A NOTE FOR ORBES CLIENT SERVICES (*Optional: a size, a finish, the best time to call.*) and **REQUEST THIS PIECE**, the sheet's one hairline button; once requested, REQUESTED and *ORBES Client Services will contact you.*, with their contact when configured (an email titled `ORBES — ECLIPSE — REQUEST` whose body names the model and the request's id). Any other answer to the list shows no section and says nothing. A sheet the public route answers 404 is asked of the club, signed in.

### 10.10 The club's releases and tiers: `GET /api/v1/club/status`, `POST /api/v1/club/drops/:id/enter`, `…/withdraw` and `…/reserve`, `GET …/entry` and `POST …/size` (extension of the contract)

P-R03, P-X02 and P-X04 (`routes/club.ts`, `services/club.ts`, `services/drops.ts`). A signed-in account (`401 UNAUTHORIZED` otherwise); the three mutations are POSTs, held to the CSRF rules of §2.2; every answer `no-store`; rate group `api`. **Any ORBES account** enters a release, whether or not it holds a piece: one that holds none is drawn after the tiers (tier 0). During a release's early access (§8.9), a PLATINE or PALLADIUM account **reserves** a place directly.

**`GET /api/v1/club/status`, 200**: the account's standing now, the benefits of its tier and the next tier (P-X04), and its entries in the published releases, the latest opening first (at most 50). Open to any signed-in account, owner or not; `/api/v1/account/me` (§10.4) does not change.

Plan NEXT-NINE, BP-19 T10: `program`, what THE PROGRAM gives the account's tier now (`effectiveProgramLines`: the early access, the shipping and the care of its own tier, the priority from the tier it starts from, the welcome gift and the credit of its own tier only, the experiences it is invited to; `[]` without a tier), before the tiers' words (`benefits`, which keeps its meaning); `next.program`, what the next tier's program adds. `inUse`, its benefits in use: `credit` the credit left (its grants usable now, the tier held and not expired, in one currency; PALLADIUM's first) and the earliest expiry, or `null`; `care` the yearly care of the year (UTC), `{ year, used, allowance }` (`allowance` a number or `"ALL"`), `null` when its tier gives none; `gifts` a PENDING welcome gift only while its tier is held and has an active gift model (the condition the next order's gift follows), WITH_ORDER with the reference of the order it travels with until it is DELIVERED; `creditChannels` THE PROGRAM's *Credit usable on* (`DRAW`, `LIVE`, `SALON`, in that order; §16.21). In the verify app: YOUR TIER's IN USE (*CREDIT € 50 · UNTIL 6 OCT 2027*, *YEARLY CARE 0 OF 1 PIECE IN 2026* or *EVERY PIECE · 2 IN 2026*, *WELCOME GIFT WITH YOUR NEXT ORDER* or *WITH ORDER OR-…*; the credit's note, naming the orders `creditChannels` names: *ORBES Client Services takes it off the invoice of a piece from a draw, a LIVE RELEASE or THE PRIVATE SALON.*), shown only when a row exists, then the program's lines and the tiers' words; NEXT's program's lines and words.

```json
{
  "tier": { "level": 2, "name": "PLATINE" },
  "pieces": 6,
  "seniority": 1,
  "benefits": [
    "The owners’ circle: its notes, its invitations and its polls.",
    "Priority in the draw of each release, before the accounts that hold no piece."
  ],
  "program": [
    "Early access to each draw: a place reserved directly 2 hours before entries open to everyone, unless its page says otherwise.",
    "Free shipping on every order.",
    "The yearly care of 1 piece a year by the ORBES atelier, asked for from the piece, with a prepaid label both ways.",
    "Priority with ORBES Client Services: your messages are read first.",
    "A credit of € 50, valid 12 months, on a piece from a draw, a LIVE RELEASE or THE PRIVATE SALON.",
    "The members’ evening, once a year, by invitation in THE CIRCLE."
  ],
  "inUse": {
    "credit": { "balanceMinor": 5000, "currency": "EUR", "expiresAt": "2027-10-06T09:00:00.000Z" },
    "care": { "year": 2026, "used": 0, "allowance": 1 },
    "gifts": [ { "tier": "PLATINE", "model": "ORBITAL CHARM", "state": "PENDING", "orderReference": null } ],
    "creditChannels": ["DRAW", "LIVE", "SALON"]
  },
  "next": {
    "level": 3,
    "name": "PALLADIUM",
    "pieces": 10,
    "missing": 4,
    "benefits": ["Special commissions, made for you by the ORBES atelier.", "A yearly visit to the ORBES atelier."],
    "program": ["Early access to each draw: a place reserved directly 4 hours before entries open to everyone, unless its page says otherwise.", "…"]
  },
  "tierThresholds": [1, 5, 10],
  "entries": [
    {
      "id": "7c2e90d1-…",
      "dropId": "1f0c6c52-…",
      "title": "MONOLITHE, the first fifty",
      "state": "DRAWN",
      "status": "SELECTED",
      "enteredAt": "2026-10-12T10:04:11.000Z",
      "rank": 4,
      "respondBy": "2026-10-16T10:05:00.000Z",
      "reserved": false,
      "opensAt": "2026-10-12T10:00:00.000Z",
      "closesAt": "2026-10-14T10:00:00.000Z",
      "drawnAt": "2026-10-14T10:05:00.000Z"
    }
  ]
}
```

| Field | Notes |
|---|---|
| `tier` | `level`, 0 to 3, and its `name` (`null` for 0): TITANE from 1 piece held now, PLATINE from 5, PALLADIUM from 10 (`CLUB_TIER_THRESHOLDS`, a constant of the code, never a setting; plan NEXT-NINE, BP-19 T1, for every account at once). A piece counts while its ownership is open and it is not REVOKED, COUNTERFEIT_FLAGGED or RETIRED, as for §10.9. |
| `pieces` | The pieces counted. |
| `seniority` | The full years (UTC) since the account's first ownership began, past or present; 0 without one. |
| `benefits` | (P-X04) The benefits of the account's tier and of the tiers below it, one line each, the lowest tier first; `[]` without a tier. Each tier's words are ORBES's, set from the console's Club (§16.21), its words by default otherwise (`CLUB_TIER_DEFAULT_BENEFITS`). |
| `next` | (P-X04) The next tier: its `level` and `name`, the `pieces` held it starts from (the threshold), how many more the account needs (`missing`, at least 1) and what that tier adds (`benefits`, its own lines only); `null` at PALLADIUM, the highest. An account without a tier reads TITANE here. |
| `tierThresholds` | (plan NEXT-NINE, BP-19 T1) The pieces held now each tier starts from, TITANE first: `[1, 5, 10]` (`CLUB_TIER_THRESHOLDS`). YOUR TIER draws one dot per piece up to the last, PALLADIUM's (10 dots). |
| `entries[].id` | The entry's id: the one the draw's list publishes (§8.9). |
| `entries[].state` | The release's state (§8.9). |
| `entries[].status` | `ENTERED`; `WITHDRAWN`; `SELECTED`, a place held until `respondBy`; `WAITLISTED`, on the waiting list at `rank`; `CONFIRMED`, the sale concluded by ORBES Client Services; `LAPSED`, the place held was not taken up in time. |
| `entries[].enteredAt` | When the account first entered: an entry again keeps its row, its id and this time. |
| `entries[].reserved` | (P-X02) `true` for a place reserved directly during the early access (an entry `SELECTED` at once, with a tier and no rank): it was not drawn and never appears in the draw's list (§8.9). |
| `entries[].size` | (plan NEXT LOT §3.6.F) The size the entry chose, `{ "id", "label" }`, kept once withdrawn (the app preselects it when the account enters again); `null` in a draw without sizes. |
| `entries[].guaranteed`, `entries[].pieces` | (plan NEXT-NINE, IN-01) `true` when the entry uses the house's guarantee **and** that guarantee is shown to the client, with the pieces it covers; `false` and `1` otherwise, a guarantee not shown included. A reservation with a guarantee is `reserved: true` too. |
| `guarantees` | (IN-01) The house's guarantees shown to the client, still waiting, set aside or entered, the soonest validity first: `[{ "id", "scope": "RELEASE" \| "MODEL" \| "COLLECTION", "target", "pieces", "validUntil", "release": { "id", "mode", "title" } \| null }]`, `target` the model's or the collection's name, or the release's title (`null` before a LIVE RELEASE's name stage), `release` the release it is set aside for (`null` while it waits for the next one). Never its note, never a guarantee not shown, used, expired or revoked. |

The tier and the seniority are those of now. An entry's own `tier` and `seniority` are written by the draw, which reads them again at its own time (TERMS-FACTS R65), or, for a direct reservation, at the moment of its request (P-X02).

**`GET /api/v1/club/drops/:id/entry`** (plan NEXT LOT §3.6.F): **200** `{ "entry": { … } | null, "savedSize": { "id", "label" } | null }`: the account's entry in a published draw, as in the status (`null` when it has none), and the size YOUR SIZES suggests among the draw's sizes with pieces (AC-01: the saved size of the model's kind, matched by a size's fit or its label, when exactly one matches); `404 DROP_NOT_FOUND` for an unknown, malformed or unpublished draw (a LIVE RELEASE too). The app preselects, in this order, the entry's size, the suggested one, the only size.

**`POST /api/v1/club/drops/:id/enter`** (no body, `{}`, or `{ "sizeId" }`): enters an `OPEN` release; a withdrawn entry becomes `ENTERED` again, the same row and id (never a new one). Plan NEXT LOT §3.6.F: a draw with sizes takes `sizeId`, a UUID, one of its sizes with pieces (`400 DROP_SIZE_REQUIRED` without it, `404 DROP_SIZE_UNKNOWN` otherwise, a draw without sizes too), asked again after a withdrawal; a size every piece of which is reserved stays open to entries (the draw ranks a waiting list in each size). With the house's guarantee shown to the account, its size must still serve the guarantee's pieces (`409 DROP_GUARANTEE_SIZE_FULL`); one not shown leaves an ordinary entry. **200** `{ "entry": { … } }`, the entry as in the status. Audited `drop.enter` (the account as actor, the release as target, `{ entryId }`, `sizeId` in a draw with sizes, and `again: true` for an entry again).

**`POST /api/v1/club/drops/:id/size`** (plan NEXT LOT §3.6.F; `{ "sizeId" }`, required): the account's `ENTERED` entry takes another of the draw's sizes with pieces, while its entries are open (`409 DROP_NOT_OPEN` before and after; `409 DROP_CANCELLED`, `409 DROP_ALREADY_DRAWN`); a place reserved directly keeps its size (`409 DROP_SIZE_FIXED`); no entry, or one withdrawn: `409 DROP_NOT_ENTERED`; a draw without sizes: `404 DROP_SIZE_UNKNOWN`. Its guarantee is checked again in the new size, as at ENTER. The same size again changes nothing. **200** `{ "entry": { … } }`. Audited `drop.size` `{ entryId, sizeId, before }` (and the guarantee bound or unbound). Refused: a release unknown, malformed or not published (`404 DROP_NOT_FOUND`), cancelled (`409 DROP_CANCELLED`), drawn (`409 DROP_ALREADY_DRAWN`), not open (`409 DROP_NOT_OPEN`: before `opensAt`, after `closesAt`), an account entered already (`409 DROP_ALREADY_ENTERED`), an account holding a place it reserved directly (`409 DROP_ALREADY_RESERVED`, P-X02).

**`POST /api/v1/club/drops/:id/withdraw`** (no body, or `{}`): the account's `ENTERED` entry becomes `WITHDRAWN`, until the draw, even once the entries are closed. **200** `{ "entry": { … } }`. Audited `drop.withdraw` (`{ entryId }`). Refused: `404 DROP_NOT_FOUND`, `409 DROP_ALREADY_DRAWN`, `409 DROP_CANCELLED`, `409 DROP_NOT_ENTERED` (no entry, or withdrawn already, and a direct reservation, which its account never withdraws: ORBES Client Services concludes it or lets it lapse, §16.19).

**`POST /api/v1/club/drops/:id/reserve`** (P-X02; no body, `{}`, or `{ "sizeId" }`): during the release's early access, a place held at once; plan NEXT LOT §3.6.F: in a draw with sizes, in one of its sizes (`400 DROP_SIZE_REQUIRED`, `404 DROP_SIZE_UNKNOWN`), refused once the pieces held or sold in that size and those of its guaranteed entries waiting leave none (`409 DROP_SIZE_FULL`, the size named), on top of the release's own count; the place keeps its size, and `drop.reserve` carries `sizeId`. The account's tier is read **at the moment of its request** (`tierOf`, in the transaction): PLATINE or PALLADIUM (`EARLY_ACCESS_MIN_TIER`, 2), each **from its tier's time** (plan NEXT-NINE, BP-19 T3: PALLADIUM from `earlyAccessOpensAt`, PLATINE from `earlyAccessPlatineOpensAt`; a PLATINE account before its own time is answered `409 DROP_EARLY_ACCESS_NOT_OPEN` with that time). Its entry is created `SELECTED`, the place held `purchaseWindowHours` from now (`respondBy`), with the tier and seniority of that moment and no rank. First come, first served: the account's row is read under a share lock, then the release's row **for update**, so two requests count the places one after the other, within `quantity` (the entries `SELECTED` and `CONFIRMED`). **200** `{ "entry": { … } }`, the entry as in the status, `"reserved": true`. Audited `drop.reserve` (the account as actor, the release as target, `{ entryId, tier, respondBy }`, never an email). Refused:

| Code | When |
|---|---|
| `403 ACCOUNT_LOCKED` | The account is locked (§16.12). |
| `404 DROP_NOT_FOUND` | Unknown, malformed or not published. |
| `409 DROP_CANCELLED`, `409 DROP_ALREADY_DRAWN` | Cancelled, or drawn. |
| `409 DROP_EARLY_ACCESS_NOT_OPEN` | Before its early access: *Direct reservations for this release open on YYYY-MM-DD HH:MM UTC.* |
| `409 DROP_EARLY_ACCESS_CLOSED` | From `opensAt` on (*Direct reservations for this release are closed: the places left go to the draw.*), or a release without one (*This release offers no direct reservation: its places go to the draw.*). |
| `403 DROP_TIER_REQUIRED` | A tier below PLATINE now: *Only PLATINE and PALLADIUM owners reserve a place directly: from 5 pieces held.* |
| `409 DROP_ALREADY_RESERVED` | The account already holds an entry in this release (one entry or reservation per account and release). |
| `409 DROP_FULL` | The places held or sold reach `quantity`: every piece is reserved. |
| `400 DROP_SIZE_REQUIRED`, `404 DROP_SIZE_UNKNOWN`, `409 DROP_SIZE_FULL` | (plan NEXT LOT §3.6.F) No size given in a draw with sizes, a size not offered, a size whose pieces are all reserved: *Every piece in size 17 has been reserved.* |

The three mutations read the account's row under a share lock, then the release's: a lock of the account (§16.12) under way finishes first (`403 ACCOUNT_LOCKED` when it lands meanwhile; the lock withdraws the account's open entries), and so does a draw, which takes the release's row for update: an entry it ranked no longer changes. No email is sent (TERMS-FACTS N1): the account follows its entries here.

Errors: `400 VALIDATION_FAILED` (a body with other fields, a `sizeId` that is not a UUID), `400 DROP_SIZE_REQUIRED`, `401 UNAUTHORIZED`, `403 CSRF_FAILED`, `403 ACCOUNT_LOCKED`, `403 DROP_TIER_REQUIRED`, `404 DROP_NOT_FOUND`, `404 DROP_SIZE_UNKNOWN`, `409` as above, `429 RATE_LIMITED`.

**In the verify app:** a release's page (§8.9) offers ENTER THE DRAW, its one button, to a signed-in account while entries are open, then WITHDRAW, a text link, until the draw; signed out, the sign-in and CREATE ACCOUNT of MY PIECES, under *Enter the draw with your ORBES account: sign in, or create one. Any account may enter, one entry per person.* The entry's status is said in a sentence: a place held reads *Your place is held until … — ORBES Client Services will contact you.*, with the contact of ORBES Client Services (an email the reader writes, ready with the release and the entry's id). MY PIECES lists YOUR RELEASES in its tab RELEASES (plan NOCTURNE, C31), each entry with its id and its status; THE RELEASES is the rail's. During an early access (P-X02), a PLATINE or PALLADIUM account reads RESERVE A PLACE in place of ENTER THE DRAW, and its reservation then reads PLACE RESERVED and *You reserved a place directly. It is held until … — ORBES Client Services will contact you.*; another account reads *PLATINE and PALLADIUM owners are reserving their places now. Entries open to everyone on …*. THE CIRCLE (`.circle__early`) recalls the privilege under EARLY ACCESS, and so does MY PIECES (`.pieces__early`) for an account without a tier (from TITANE up, its YOUR TIER says it). In the account sheet (plan NOCTURNE, decision 10; before it, at the head of MY PIECES), **YOUR TIER** (P-X04, `web/verify/tier-model.ts`): the tier's name and its pieces, the `benefits`, and *NEXT: <TIER>* with what `next` adds; THE CLUB, for an account without a tier (BRAND §5).

**The house's guarantee** (plan NEXT-NINE, IN-01; §16.30): ENTER binds the account's guarantee set aside for the release, if any, to its entry (`drop.enter` carries `guaranteeId`); WITHDRAW, and a lock, unbind it (the guarantee stays set aside for the release). RESERVE A PLACE with a guarantee holds the place at once with its pieces (`DROP_FULL` counts the pieces held and guaranteed) and uses the guarantee. In the verify app: the account sheet lists **THE HOUSE'S GUARANTEE** under YOUR TIER, one block per guarantee shown (*A guaranteed place at the next release of MONOLITHE.*, its RELEASE once set aside, PIECES, VALID UNTIL, and *Granted by ORBES. Personal and used once: it cannot be transferred.*); a draw's YOUR ENTRY says it in a box (*ORBES guarantees you a place in this release. Enter the draw: you are selected first, for 2 pieces.*, then *You are entered with the house’s guarantee…*); MY PIECES labels the entry THE HOUSE'S GUARANTEE. Nothing of a guarantee not shown reaches the app.

### 10.11 The circle: `GET /api/v1/club/circle`, `GET /api/v1/club/circle/:id`, `POST …/rsvp` and `POST …/vote` (extension of the contract)

The **owners' circle** (P-X01; `routes/club.ts`, `services/circle.ts`): what ORBES publishes for the owners of a piece, by tier. A post is a **NOTE** (text and photographs), an **INVITATION** (an event, answered YES or NO within its places) or a **POLL** (2 to 6 options, one vote per account). The club's rules hold (§10.9): an account session (`401 UNAUTHORIZED` without one), the POSTs under the CSRF rules and the same-origin check of §2.2, every answer `no-store`, rate group `api`. The reader must hold a piece **now**, counted as the club counts them (`tierOf`, read again at every request: the circle goes with the last piece): otherwise **`403 OWNERS_ONLY`**. Each post is read from its `minTier` up (1 TITANE, every owner; 2 PLATINE and PALLADIUM; 3 PALLADIUM): below it, withdrawn (unpublished), unknown or malformed, one **`404 CIRCLE_POST_NOT_FOUND`** (*This post is not in the circle.*).

**`GET /api/v1/club/circle?page&pageSize&visit`, 200**: the feed, the posts published for the reader's tier, the latest first, paginated (§6, but **20 by default and 50 at most**, `CIRCLE_FEED_PAGE`), **without their bodies** (the verify client refuses an answer over 256 000 characters).

```json
{
  "items": [
    {
      "id": "3d0b6f0e-…",
      "kind": "INVITATION",
      "title": "An evening at the atelier",
      "minTier": 2,
      "publishedAt": "2026-10-05T09:00:00.000Z",
      "cover": { "url": "/api/v1/media/4b1a…", "alt": null },
      "eventAt": "2026-11-12T18:30:00.000Z",
      "eventPlace": "ORBES atelier, Paris",
      "answer": "YES",
      "voted": false,
      "invitation": { "capacity": 12, "placesLeft": 3, "open": true }
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 7
}
```

`cover`: the post's first photograph (`alt` `null`: the post's default), or `null`. `eventAt` and `eventPlace`: an invitation's event, `null` for another kind. `answer`: the reader's answer to an invitation (`YES`, `NO`, or `null`). `voted`: whether the reader voted in a poll. `invitation` (plan NOCTURNE, addition 6): an invitation's `capacity` (`null`: no limit), `placesLeft` (the places not answered YES, `null` without a limit) and `open` (answers are taken until `eventAt`), as the post gives them, so its card in the feed and on NOW answers YES / NO by `…/rsvp` and its rules; `null` for another kind. The **first page** adds one to the day's count of visits (`circle_daily_visits`, UTC day), which records no account, no address and no device; a count that fails is logged and the feed still answers. With `visit=0` it adds none: NOW reads the feed for its next invitation, which is no visit to the circle.

**`GET /api/v1/club/circle/:id`, 200**: a post (`CirclePostView`): the card above, and

| Field | Notes |
|---|---|
| `body` | Plain paragraphs, a blank line between two (at most 6 000 characters); `null` without one. |
| `photos` | Its photographs, in their order, at most 4: `{ url, alt }` (§8.6). |
| `invitation` | For an INVITATION: `eventAt`, `place` (or `null`), `capacity` (the places answered YES at most, 1 to 10 000; `null`: no limit), `placesLeft` (`null` without a limit) and `open` (answers are taken until the event begins: `eventAt`); `null` for another kind. |
| `poll` | For a POLL: `options` (2 to 6 lines), `vote` (the index of the reader's vote, from 0, or `null`) and `results`, **only once the reader has voted**: `{ counts: [ … ], total }`, the votes of each option; `null` before. `null` for another kind. |
| `links.drop` | A release the post links, `{ id, title }`, shown only once it is published (its page, §8.9); else `null`. |
| `links.model` | A model of the lookbook the post links, `{ slug, name, type }`, shown while it is PUBLIC, or RESERVED from a tier the reader reaches (THE PRIVATE SALON, P-X08: its sheet is 404 below, §10.9); else `null`. |
| `links.external` | An address on another site, `{ url, host }`: an `https` address whose host is one of `CIRCLE_LINK_HOSTS` (a constant of the code: `theorbes.com`, `youtube.com`, `vimeo.com` and their subdomains), and the host as /verify shows it beside the link (a leading `www.` dropped); else `null`. |

**`POST /api/v1/club/circle/:id/rsvp`** `{ "answer": "YES" | "NO" }`: the reader's answer to an invitation, one per account, changed in place until the event begins. Under the post's row lock (`FOR UPDATE`), the YES of every account are counted, so a YES never passes the capacity. **200** — the post, as above. The same answer again writes nothing; any other is audited **`circle.rsvp`** (the account as actor, the post as target, `{ answer, previous? }`, `previous` when it replaced one). Refused: `409 CIRCLE_NOT_INVITATION` (another kind), `409 CIRCLE_EVENT_PAST` (from `eventAt` on: *This event has begun: answers are closed.*), `409 CIRCLE_FULL` (a YES when the YES reach `capacity`; a NO is always taken), `403 ACCOUNT_LOCKED` (a locked account), `403 FORBIDDEN` (an account no longer active).

**`POST /api/v1/club/circle/:id/vote`** `{ "option": 0…5 }`: a vote in a poll, by the index of one of its options, **final**. Under the post's share lock (`FOR SHARE`), so a change of its options waits, then is refused (§16.20). **200** — the post, its `results` now shown. Refused: `400 VALIDATION_FAILED` (not an option of this poll), `409 CIRCLE_NOT_POLL` (another kind), `409 CIRCLE_ALREADY_VOTED` (*You have voted in this poll already: a vote is final.*), `403 ACCOUNT_LOCKED`, `403 FORBIDDEN`. **A vote is never audited**: the audit log is permanent, and a vote is an opinion; neither is a visit. An answer to an invitation is.

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 CSRF_FAILED`, `403 OWNERS_ONLY`, `403 ACCOUNT_LOCKED`, `403 FORBIDDEN`, `404 CIRCLE_POST_NOT_FOUND`, `409` as above, `429 RATE_LIMITED`.

The answers and votes of an account are kept with it (no purge), listed in its export (§16.13); its lock (§16.12) leaves them as they are. The circle's photographs are served by §8.6, like every other: **unlisted, not confidential**.

**In the verify app** (`web/verify/circle-model.ts`, `views/circle.ts`; BRAND §5): `/verify/circle`, **THE CIRCLE**, the rail's CIRCLE (plan NOCTURNE, C8): the feed, each post on its first photograph, faded (else on the margin; an invitation without one on a plate card), with its kind, its title, its day, an invitation's event (UTC), its places left and YES · NO answered from the card (`invitation`, plan NOCTURNE, addition 6; NOW shows the next one the same way), *YOU ANSWERED YES* once answers close or *YOU VOTED*, and one text link, READ THE NOTE, SEE THE INVITATION or SEE THE POLL, to `/verify/circle/<id>`; SHOW MORE for the next page. A post: its photographs, its paragraphs, THE INVITATION (WHEN, WHERE, PLACES) and YOUR ANSWER, YES · NO; THE POLL, its options and VOTE, then its results with YOUR VOTE; TO SEE: SEE THE RELEASE, SEE THE MODEL, OPEN THE LINK with its host beside it (a new tab, `rel="noopener noreferrer"`). Signed out: the sign-in; signed in without a piece: *The circle is reserved for the owners of an ORBES piece. It opens once a piece is registered to your ORBES account.*

---

### 10.12 The LIVE RELEASES: the account's room, line, turn and reservation (extension of the contract)

The customer's side of a LIVE RELEASE (§8.10; `routes/live.ts`, `services/live.ts`): an account session (`401` without one), and for every mutation the CSRF token and the same-origin rule (§2.2); `Cache-Control: no-store`; rate group `live`, which counts the account's network and, once the session is found, the account itself (§3). Every route answers `404 DROP_NOT_FOUND` for a release not announced, as §8.10 does, and refuses a LOCKED account (`403 FORBIDDEN`, its row read under a share lock first). Each action takes the release's row, then the entry's, and reads the clock once it holds them: a turn or a hold whose time has passed is refused even before the engine marks it.

**Who may enter.** A release names its rule (`access`, §8.10): a lowest tier (`live_min_tier`), and, when it names models or a collection (`live_access_models`, `access_collection_id`), a piece of one of them held now (a piece's own collection first, its model's otherwise; a piece revoked, flagged or retired does not count). Plan LIVE RELEASE+ adds two rules and how they combine: **taking part** (`min_participations`, choice 4): at least N releases taken part in, the release itself never counted — a place in the line of a LIVE RELEASE whose T0 has passed (whatever became of the entry, never `REMOVED`; an after-room's entry counts as its release), or a draw's entry not withdrawn when it was drawn (and a place reserved directly during its early access), each release once, a cancelled one never; a **segment** (`access_segment_id`, choice 27): its members now (§16.26); and **`access_combine`**, `AND` (every rule, the default) or `OR` (any one, the tier and the pieces included). It is read again at I'LL BE THERE, at ENTER and at SECURE: an account outside it is refused with **`403 LIVE_NOT_ELIGIBLE`** and the rules in words (*This release is for owners from PLATINE.*; *This release is for collectors who have taken part in 2 releases. You have taken part in 1 release.*; *This release is for selected collectors.* for one that lacks only the segment). The state's `access` says `{ allowed, tier, missing (TIER, PIECE, PARTICIPATION, SEGMENT or null), participations (null when the release does not count them) }`.

**An entry's statuses** (`live_entries.status`, DATABASE §5.39): `WAITING` (in the room, before T0), `QUEUED` (in the line, with its `position`), `TURN` (its turn: the seal to hold), `SECURED` (a piece held: the add-ons and PAY), `CONFIRMED` (PAY pressed: a reservation), `MISSED` (a turn not taken in time), `EXPIRED` (a hold not confirmed in time, or freed by the console), `RELEASED` (the piece given back), `LEFT` (left by its account), `REMOVED` (by the console, or by a lock of the account), `ENDED` (the release ended before its turn). The entry the routes answer with:

```json
{
  "id": "0c9f…", "dropId": "5b1d…", "status": "SECURED",
  "size": { "id": "2a41…", "label": "52" }, "quantity": 1, "tier": 2,
  "position": 3, "ahead": null, "joinedAt": "…",
  "turn": { "at": "…", "expiresAt": "…", "token": null },
  "hold": { "securedAt": "…", "expiresAt": "2026-11-08T18:06:12.000Z" },
  "confirmedAt": null, "endedAt": null, "letIn": false,
  "addons": [ { "id": "77e0…", "label": "ENGRAVING", "priceMinor": 25000 } ],
  "currency": "EUR", "priceMinor": 480000, "totalMinor": 505000
}
```

`ahead` (while `QUEUED`): the entries of its size before it in the line (0: it is next). The deadlines are as they stand now (a pause in progress moves them). `turn.token`, the **turn's secret**, is in its own account's answers only, and only while the entry is `TURN`: HMAC-SHA-256 of the entry and the turn's start under a key derived from `KEY_ENCRYPTION_KEY` (from `COOKIE_SECRET` without one), its SHA-256 alone stored. `totalMinor` is `quantity × (price + the add-ons)`, each add-on at the price it had when chosen.

| Route | Body | What it does | Refusals |
|---|---|---|---|
| `PUT /api/v1/live/:id/interest` | `{ "sizeId" }` | I'LL BE THERE, in this size, from the announcement to T0: one per account and release, its size changed in place. **200** `{ "interest": { "dropId", "size", "since" } }`. Audited `drop.live.interest` | `403 LIVE_NOT_ELIGIBLE`, `400 LIVE_SIZE_UNKNOWN`, `409 LIVE_SIZE_SOLD_OUT` (a size without stock), `409 LIVE_INTEREST_CLOSED` (from T0), `409 DROP_CANCELLED` |
| `DELETE /api/v1/live/:id/interest` | none, or `{}` | Withdrawn (the row deleted), before T0. **200** `{ "interest": null }`. Audited `drop.live.interest.withdraw` | `409 LIVE_NOT_INTERESTED`, `409 LIVE_INTEREST_CLOSED` |
| `POST /api/v1/live/:id/enter` | `{ "sizeId", "quantity"? }` | ENTER, from the room's opening to the end of the sales, with a size that has stock and 1 to `perAccount` pieces (1 by default, at most the size's stock): before T0 the room (`WAITING`), after T0 the line, behind (`QUEUED`, never in a size whose pieces are all confirmed). One entry per account and release; an entry that left the room before T0 enters again, the same row. The entry keeps the account's tier, the country of the request (two letters, from the location of §4) and a keyed hash of its network (HMAC-SHA-256 of its /24 or /48 with `IP_HASH_PEPPER`, never the address; erased 30 days after the end), for the console's bot radar. **200** `{ "entry" }`. Audited `drop.live.enter` | `403 LIVE_NOT_ELIGIBLE`, `409 LIVE_ROOM_NOT_OPEN` (said with its time, UTC), `409 LIVE_OVER`, `409 LIVE_ALREADY_ENTERED`, `400 LIVE_SIZE_UNKNOWN`, `400 LIVE_QUANTITY_INVALID`, `409 LIVE_SIZE_SOLD_OUT`, `409 DROP_CANCELLED` |
| `POST /api/v1/live/:id/size` | `{ "sizeId", "quantity"? }` | CHANGE SIZE (and quantity) while `WAITING`, before T0 only. **200** `{ "entry" }`. Audited `drop.live.size` | `409 LIVE_SIZE_LOCKED` (from T0: the size never changes after), `409 LIVE_NOT_ENTERED`, `409 LIVE_NOT_IN_LINE`, the size refusals of ENTER |
| `POST /api/v1/live/:id/leave` | none, or `{}` | LEAVE: `WAITING`, `QUEUED` or `TURN` → `LEFT` (a turn given back: the piece goes to the next at once). Never back in the line after T0. **200** `{ "entry" }`. Audited `drop.live.leave` | `409 LIVE_NOT_ENTERED`, `409 LIVE_NOT_IN_LINE`, `409 LIVE_TURN_PASSED` (a turn already run out is MISSED, not LEFT) |
| `POST /api/v1/live/:id/press` | `{ "token" }` | The seal pressed: its time on the server's clock (`press_started_at`); a new press replaces the last (letting go resets the ring). No state changes: not audited. **200** `{ "entry" }` | `409 LIVE_NOT_YOUR_TURN`, `409 LIVE_TURN_CHANGED` (a secret that is not this turn's), `409 LIVE_PAUSED`, `409 LIVE_TURN_PASSED` |
| `POST /api/v1/live/:id/secure` | `{ "token" }` | SECURE: the seal held. Needs the turn's secret, a press at least **1.4 s** earlier on the server's clock (`LIVE_GESTURE_MIN_MS`; the page's ring asks 1.5 s), the turn running, the release not paused, and the rule still met. `SECURED`: the piece held for the pay window of the entry's tier (`payMinutes`, 5 minutes by default); the gesture's length kept (`gesture_ms`). **200** `{ "entry" }`. Audited `drop.live.secure` with the gesture's length | `409 LIVE_HOLD_TOO_SHORT`, `403 LIVE_NOT_ELIGIBLE`, the refusals of PRESS |
| `PUT /api/v1/live/:id/addons` | `{ "addonIds": [] }` | The add-ons of the release chosen for the piece held (each once, at most 6), replacing the previous choice, each at its price now. **200** `{ "entry" }`. Audited `drop.live.addons` | `400 LIVE_ADDON_UNKNOWN`, `409 LIVE_NOT_SECURED`, `409 LIVE_HOLD_ENDED` |
| `POST /api/v1/live/:id/confirm` | none, or `{}` | PAY, a **placeholder**: the piece `CONFIRMED`, a reservation ORBES Client Services concludes outside the service (nothing is paid; §16.23). The last piece confirmed ends the release, SOLD_OUT. **200** `{ "entry" }`. Audited `drop.live.confirm` | `409 LIVE_NOT_SECURED`, `409 LIVE_HOLD_ENDED` |
| `POST /api/v1/live/:id/release` | none, or `{}` | RELEASE MY PLACE: the piece given back (`RELEASED`, its add-ons dropped); the next in line for that size gets a turn at once. **200** `{ "entry" }`. Audited `drop.live.release` | `409 LIVE_NOT_SECURED`, `409 LIVE_HOLD_ENDED` |

**The room, its state and its stream.** Only an account the rule lets in now, or one that holds an entry in the release, reads them (`403 LIVE_NOT_ELIGIBLE` otherwise, with the rule; a `REMOVED` entry reads its state, but its stream is refused, `403 LIVE_REMOVED`):

- **`GET /api/v1/live/:id/state`**, **200** `{ "now", "room", "access", "entry", "interest", "guarantee", "savedSize" }`: the page's fallback, polled every 2 s while its stream is lost. `savedSize` (plan NEXT-NINE, AC-01): `{ "id", "label" }`, the release's size the account's saved size matches (§10.19) among its sizes with stock, only while the account holds neither an entry nor an interest in the release; `null` otherwise. It is read, never written: the app preselects it (*SIZE 17 · FROM YOUR SIZES*; READY CHECK's SIZE *17 · TO CONFIRM*, not ready) until the collector taps a size or presses I'LL BE THERE, ENTER THE ROOM or ENTER THE LINE. `access`: `{ "allowed", "tier", "missing" }` (`TIER` or `PIECE` when not allowed). `entry` and `interest`: the account's own, or `null`. An entry (here, in the stream's `you` events and in MY PIECES) carries `afterRoom` (plan LIVE RELEASE+, choice 2): `{ "opensAt", "closesAt" }` on an entry the release's sell-out ENDED while in its line, from the sell-out until the after-room ends (when its second door appears, when it closes; the stream's last event brings it, no read follows); `null` otherwise.
- **`GET /api/v1/live/:id/after-room`**, **200**: the after-room of release `:id` (a child LIVE RELEASE its sell-out opened for the entries still WAITING or QUEUED then, in their order in the line), for one of those guests from its T0: its page as `GET /api/v1/live/:id` writes a release's (only `{ "id", "kind", "phase": "ENDED" }` once over), with `"afterRoom": { "parentId" }`; never kept (`no-store`). Its own id then takes the routes above (state, stream, enter, press, secure, add-ons, confirm, release), each answering **404 `DROP_NOT_FOUND`** to anyone else and before its T0; a guest enters straight into its line at its remembered place. It is on no public surface: not in the list, the banner, its own `GET /api/v1/live/:id` or `.ics`, a board, nor the circle (decision 28). **401** without a session; **404** for anyone else, before its T0, and for a release without one opened.
- **`GET /api/v1/live/:id/stream`**: Server-Sent Events (`text/event-stream`, `retry:` first: 2 000 ms plus up to 3 000 ms drawn per connection, so a room dropped at once reconnects spread out). Once a second, the hub of the process builds the room of the release once and sends it to every viewer when it changed: an event `room`, `{ "now", "id", "phase", "paused", "over", "endedReason", "roomOpensAt", "opensAt", "closesAt", "inRoom", "line", "quantity", "quantityLine", "left", "held", "sizes": [{ "id", "label", "stock", "left", "held" }], "message": { "text", "at" } }` (`phase`: `ANNOUNCED`, `ROOM`, `LIVE` or `ENDED`; `inRoom`: the people in the release, waiting, in the line, in a turn or holding a piece; `line`: those `QUEUED`; `left`: the pieces free now; `held`: those in a turn or held, which may return; `message`: the latest host message, or `null`). And the account's own **`you`** event, `{ "now", "entry" }`, when its entry changed (the stream's first one also carries `savedSize`, as the state does: plan NEXT-NINE, AC-01), with the turn's secret while it is its turn, written before the room in the same chunk (a page that stops at a room `over` has read its final entry). `over`: the end recorded by the engine (its waiting and queued entries ENDED in the same transaction) with no turn or hold left; `phase` follows the clock and may say `ENDED` a moment before. Every event of a pulse carries the same `now`. A comment line every 20 s keeps a quiet stream open. **At most 2 streams per account** on a process (`429 LIVE_STREAMS_LIMIT` for a third: the page then polls its state). Once the release is over, its last room is sent and the stream ends; asked for again, it answers `204`. A stream also ends when its session ends (signed out, revoked, the account locked: read again at every pulse), when its entry is removed, when the release is cancelled, and when the server shuts down; a client that does not read is dropped. The database work per second grows with the releases followed, never with the people following them (`http/live-stream.ts`, the load report: [reports/live-load.md](reports/live-load.md)).

**`GET /api/v1/live/mine`**, **200** `{ "entries": [ { "release": { "id", "phase", "endedReason", "title", "name", "imageUrl", "opensAt", "closesAt", "afterRoomOf" }, "entry" } ] }` (`afterRoomOf`: an after-room's, the release it follows, through which its page is read; `null` otherwise): MY PIECES, the account's latest 50 entries, each with its release, each part of it from its stage; an entry and its outcome stay here after the release has left THE RELEASES. The reference MY PIECES and the CONFIRMED page show is `LR-` and the entry id's first 8 hexadecimal characters, in capitals.

**The end** (choice 26), three ways: `SOLD_OUT` at the last confirmation (every piece confirmed); `CLOSED` at `closesAt`; `ENDED` by an ADMIN (§16.23). From then no turn is given; `WAITING` and `QUEUED` entries become `ENDED` at once, and `TURN` ones too for `ENDED`; at `CLOSED`, a turn in progress may still be secured until its deadline, and in every case a hold may still be confirmed until its own. The release is over once no turn and no hold is left.

**The house's guarantee** (plan NEXT-NINE, IN-01; §16.30): an account with a guarantee set aside for the release meets its rule of access whatever its tier and pieces (`access.allowed` true), until the guarantee is used, expired or revoked. ENTER binds the guarantee to its entry, which may take up to the guarantee's pieces (or `perAccount`, the higher), in a size that can give them (`409 LIVE_GUARANTEE_SIZE_FULL` otherwise, at ENTER and CHANGE SIZE, for a guarantee shown to the client; for one not shown, the entry is an ordinary one, within `perAccount`, and the guarantee stays set aside). A grant or a carry binds an entry already waiting only when its size can give its pieces; otherwise CHANGE SIZE checks again. At T0 the guaranteed entries come **first in their size**, before the tiers and the seed's order (`drop.live.queue` counts them, `guaranteed`); one entering after T0 is first in its size too, ahead of the line (`ahead` counts the guaranteed entries before it), while its `position` stays the one it was given. The turn given uses the guarantee (`guarantee.use`); LEAVE, a removal or a lock before it unbind it. At the end (sold out, closed, ended) or a cancellation, a guarantee not used is released: a RELEASE guarantee, or one past its validity, expires; a MODEL or COLLECTION guarantee waits for the next release in its scope (`guarantee.carry`). `GET /api/v1/live/:id/state` carries `guarantee`, `{ "pieces" }` while one shown to the client is set aside for the release, else `null`; an entry's `guaranteed` says it as §10.10 does. The page adds *Places guaranteed by ORBES come first in their size.* to its rule, *ORBES guarantees you a place in this release. Be in the room at the opening: you are first in line in your size.* under I'LL BE THERE, and *You are first in line in your size, for up to 2 pieces.* in the room; for a guarantee not shown, nothing.

Errors of this section: those in the table, `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 CSRF_FAILED`, `403 FORBIDDEN` (a LOCKED account), `404 DROP_NOT_FOUND`, `429 RATE_LIMITED`.

### 10.13 `GET /api/v1/account/orders` (extension of the contract)

MY PIECES' orders (plan LIVE RELEASE+ of 2026-10-04, choice 6; `routes/account.ts`, `OrderService.forAccount` in `services/orders.ts`): the signed-in account's own orders, one per piece sold to it through any channel (a LIVE RELEASE's entry confirmed, a draw's entry confirmed, a private salon's request accepted; §16.24), the latest first (`reserved_at` descending, the pieces of one sale in their order), at most 100. An account session (`401` without one); `Cache-Control: no-store`; rate group `api`. The account is the session's, never a parameter: no route reads another account's orders.

**200**:

```json
{
  "orders": [
    {
      "id": "28e04256-…", "reference": "OR-28E04256", "channel": "LIVE",
      "release": "MONOLITHE — LIVE", "model": "MONOLITHE", "modelVariant": null,
      "size": { "label": "52" }, "priceMinor": 480000, "currency": "EUR",
      "addons": [ { "label": "ENGRAVING", "priceMinor": 25000 } ],
      "shipping": { "service": "STANDARD", "minor": 0, "benefit": 2, "withOrder": null },
      "status": "SHIPPED",
      "reservedAt": "2026-10-02T18:00:12.000Z", "paidAt": "2026-10-05T09:12:40.000Z", "shippedAt": "2026-10-05T15:30:02.000Z",
      "deliveredAt": null, "cancelledAt": null, "returnedAt": null,
      "shipment": { "carrier": "Colissimo", "trackingNumber": "6A12345678901", "trackingUrl": "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901" },
      "documents": {
        "invoice": { "number": "INV-2026-000001", "issuedAt": "2026-10-05T09:12:40.000Z" }, "creditNote": null,
        "careGuide": true, "certificate": false
      },
      "imageUrl": "/api/v1/media/9f2c4e…",
      "claimCode": null
    }
  ]
}
```

- `status`: `RESERVED`, `PAID`, `SHIPPED`, `DELIVERED`, `CANCELLED` or `RETURNED`; each step's time, `null` while not reached (a `CANCELLED` order keeps the `paidAt` it had; a `RETURNED` one its `shippedAt`, and its `deliveredAt` when it was delivered).
- `release`: the title of the release it was sold in; `null` for the private salon.
- `modelVariant` (plan NOCTURNE, N1): the model's label among its variants (« Blue »: the order names MONOLITHE in blue), or `null`.
- `size`: `null` while ORBES Client Services has not entered a draw's or a salon's size; `{ "label": null }` for one size. `priceMinor` and `currency` likewise `null` until entered, but for a draw that has its price (plan NOCTURNE, addition 5, §8.9): its orders take it when they are created. `addons`: as sold, each at its price per piece.
- `shipment`: from `SHIPPED` on, the carrier's name, the tracking number as entered, and its link (the carrier's pattern with the number, spaces left out); `null` before.
- `shipping` (plan NEXT-NINE, BP-19 T4): its `service` (`STANDARD`, `EXPRESS`), its fee `minor` in its currency, the tier that made it free (`benefit` 2 PLATINE, 3 PALLADIUM, `null` otherwise), and `withOrder`, the reference of the order it travels with (which carries the fee), or `null`; `null` without shipping (an order of before, or below PLATINE without a fee or rate). MY PIECES shows a SHIPPING row (*FREE · PLATINE*, *FREE EXPRESS · PALLADIUM*, *€ 20*, *EXPRESS · € 40*, *WITH ORDER OR-…*), none without shipping, and the TOTAL whenever add-ons or a fee exist.
- `withOrder` (plan NEXT-NINE, BP-19): the reference of the order it travels with (a welcome gift's, a LIVE entry's further pieces), or `null`. `giftTier` (BP-19 T5): a welcome gift's tier (`PLATINE`, `PALLADIUM`), `null` for any other order; MY PIECES reads it *WELCOME GIFT · PLATINE*, its PRICE *WELCOME GIFT*, and while it is reserved or paid *Your welcome gift travels with order OR-….* `creditMinor` (BP-19 T5): the credit taken off it, in its currency (0 for none); MY PIECES shows a CREDIT row (*− € 50*) and the TOTAL less it.
- `reference`: `OR-` and the id's first 8 hexadecimal characters, in capitals, as the console shows it.
- `claimCode` (plan NEXT LOT §3.4, §10.20): `{ "status": "WAITING", "madeAt": "…" }` while a new claim code ORBES Client Services made for the order's piece waits for this account's one reading: the row still the piece's code, the order open, the piece unregistered and printable (a code a LOST piece hides shows again once it is back). `null` otherwise, and once it is read. Never the code.
- `imageUrl` (plan NOCTURNE, addition 3): the cover photograph of the order's model, or of its variant (itself a model), as §10.5 names it, or `null`; never a piece's own photograph (decision 9).
- `documents` (§10.14): its `invoice` once paid and the `creditNote` that cancels it once cancelled after it was paid or returned (each its number and time of issue, §16.25), `null` before; `careGuide` while the piece is on its way or kept (neither cancelled nor returned); `certificate` once the piece that fulfils it is registered to the account, while a certificate may be created for it (not lost, stolen, revoked, flagged nor retired).

Never in it: where the order is served from, what it holds (a piece in stock or to make, the piece linked), the surprise, the buyer's name and address and the engraving's words (entered by Client Services; in the right-of-access export, §16.13), the value declared for the insurance, the notes of its history, nor who handled it.

In the verify app: the tab **ORDERS** of MY PIECES (plan NOCTURNE, C24, C32), with their count: per order its model's photograph (`imageUrl`), where it was sold (the release, or THE PRIVATE SALON and the model), the model, RESERVED · PAID · SHIPPED · DELIVERED with their dates on the phone's calendar (one step reached in full, several by their day and month; or the steps reached, then CANCELLED or RETURNED), what its step means, SIZE, PRICE, each add-on (+ its price) and the TOTAL (TO BE CONFIRMED until entered, left out once cancelled; a draw's price from its creation when the draw has one), and once shipped the CARRIER, the TRACKING NUMBER and TRACK THE SHIPMENT, the carrier's page in a new tab (an `https` link only); its DOCUMENTS (§10.14); its reference.

Errors: `401 UNAUTHORIZED`, `429 RATE_LIMITED`.

### 10.14 An order's documents (extension of the contract)

The documents of one of the account's orders in MY PIECES (plan LIVE RELEASE+, choice 21, M6; `routes/account.ts`; `InvoiceService.accountDocument`, `OwnershipCertificateService.orderCertificatePdf`, `OrderService.careGuide`). An account session (`401` without one), `Cache-Control: no-store`, rate group `api`; the order is one of the account's own, another account's answering as an unknown one. Reads, not audited.

| Method | Path | Answer |
|---|---|---|
| GET | `/api/v1/account/orders/:id/invoice.pdf` | The order's invoice (§16.25) as a PDF attachment, `ORBES-invoice-INV-2026-000001.pdf`; `404 INVOICE_NOT_FOUND` when it has none |
| GET | `/api/v1/account/orders/:id/credit-note.pdf` | Its credit note, `ORBES-credit-note-CN-2026-000001.pdf`; `404 INVOICE_NOT_FOUND` when it has none |
| GET | `/api/v1/account/orders/:id/certificate.pdf` | Its **ownership certificate**: a new document, never the claim card — the page of a certificate link's (§8.7) with the record of the piece read now, naming the order instead of a live address and carrying no link, `ORBES-ownership-certificate-O26-J-00184-2026-10-05.pdf`. Only once the piece that fulfils the order is registered to the account (the ownership still open), while the order is `PAID`, `SHIPPED` or `DELIVERED`, and while a certificate may be created for the piece: `409 CERTIFICATE_NOT_AVAILABLE` otherwise (before its registration, after a return or a cancellation, even if the account later bought the piece again through another order); `404 ORDER_NOT_FOUND` for another account's order |
| GET | `/api/v1/account/orders/:id/care-guide` | `{ "careGuide": { "model": "MONOLITHE", "text": "…" } }`: the model's care guide, else its care instructions (the CARE text of a scan), else `null` (the app then shows the house's general care text); `404 ORDER_NOT_FOUND` for another account's order |

In the verify app: **DOCUMENTS** under each order's terms and shipment, rows (C24) — INVOICE and CREDIT NOTE with their numbers and OWNERSHIP CERTIFICATE, each over PDF, lead on (›) and save their PDFs; CARE GUIDE, over what it is, opens the guide under its row (+ / −, `aria-expanded`) and closes it; a document that cannot be read says so under them.

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `404 INVOICE_NOT_FOUND`, `404 ORDER_NOT_FOUND`, `409 CERTIFICATE_NOT_AVAILABLE`, `429 RATE_LIMITED`.

### 10.15 `GET /api/v1/account/participation` (extension of the contract)

The releases the signed-in account took part in (plan LIVE RELEASE+, choice 5), for THE RELEASES' PAST and a past release's page (§8.11). Account session; rate group `api`; never kept by a cache (`no-store`); always the session's own account.

**200** `{ "count": 3, "releases": [ { "id": "5b1d…", "secured": true }, { "id": "8a1d…", "secured": false } ] }`, by id. Taking part is computed as the access rule computes it (`services/participation.ts`, §16.26): a place in the line of a LIVE RELEASE whose T0 has passed, whatever became of the entry but `REMOVED`, an after-room's entry counting as the release it follows; a draw's entry not withdrawn when the draw ran, or a place reserved directly during its early access; each release once, never a cancelled one. `count` is how many (*You have taken part in N releases.*). `secured`: a piece secured there, a LIVE entry `CONFIRMED` (its after-room's included) or a draw's entry `CONFIRMED` by ORBES Client Services (YOU SECURED A PIECE; else YOU TOOK PART).

Errors: `401 UNAUTHORIZED`, `429 RATE_LIMITED`.

### 10.16 The question after a LIVE RELEASE (extension of the contract)

One question after a LIVE RELEASE (plan LIVE RELEASE+ of 2026-10-04, choice 11, G4; `routes/live.ts`, `routes/account.ts`, `services/question.ts`; `release_answers` of migration 0023): on by default, its words the console's (§16.23) or the default ones, **WHAT WOULD YOU HAVE WANTED?** with **ANOTHER SIZE · ANOTHER FINISH · ANOTHER PRICE BAND**. It is asked from the release's final end for **7 days**: its recorded end (`ended_at`), or, when its after-room opened at the sell-out, the after-room's own end (its `ended_at`, else its `closes_at` once passed), so that its guests are asked once their second door has shut, never before. Of two kinds of collector only:

- `TOOK_PART`, on the release's end page: an account that took part in it (a place in its line, whatever became of the entry, never `REMOVED`: §10.15) and secured no piece there (no entry `CONFIRMED`, its after-room's included), with no turn or hold still running in it (`TURN`, `SECURED`: a CLOSED end lets one run to its deadline);
- `INTEREST`, in MY PIECES: an account that said I'LL BE THERE and never had a place in its line (it did not come, or left the room before T0).

An after-room asks none (its release's line was asked), nor a draw. One tap answers it and another changes it while it is open; `release_answers` keeps one answer per account and release (its position, from 1, and the time of its latest change). Account session on each route (`401` without one); never kept by a cache (`no-store`); the account is always the session's.

| Method | Path | Answer |
|---|---|---|
| GET | `/api/v1/live/:id/question` | `{ "question": … }` for the release's end page, or `{ "question": null }` when it is not asked of the account, or not open; rate group `live`. `404 DROP_NOT_FOUND` for anything but a published LIVE RELEASE (an after-room, a draft or a cancelled one answer as an unknown release) |
| PUT | `/api/v1/live/:id/answer` | `{ "answer": 2 }` (with the CSRF token): the answer chosen, changeable while the question is open; answers `{ "question": … }` as it stands. Audited `drop.live.answer` with the release as target and `{ answer, before? }` (positions only); the same answer again changes nothing. `403 LIVE_QUESTION_NOT_ASKED` for an account it is not asked of, `409 LIVE_QUESTION_CLOSED` before the end, after the week or turned off, `400 VALIDATION_FAILED` for a position outside its answers |
| GET | `/api/v1/account/questions` | `{ "questions": [ … ] }`: MY PIECES' questions, those open of kind `INTEREST`, the latest end first; rate group `api` |

A question:

```json
{
  "dropId": "5b1d…", "name": "MONOLITHE", "opensAt": "2026-11-02T18:00:00.000Z",
  "text": "WHAT WOULD YOU HAVE WANTED?", "answers": ["ANOTHER SIZE", "ANOTHER FINISH", "ANOTHER PRICE BAND"],
  "answer": null, "closesAt": "2026-11-09T19:02:11.000Z", "asked": "TOOK_PART"
}
```

`name` is the model's once its stage revealed it (`null` for a release ended before its name), `opensAt` its T0: MY PIECES names the release by them. `answer` is the position chosen, or `null`. `closesAt` is the end plus 7 days.

In the verify app: **ONE QUESTION** under the account's part on a LIVE RELEASE's final page (§8.11) in the vault (not asked yet of an account that took part without a piece, read again each minute while the page stays open, up to 3 hours: an after-room may still run), and on the page of an entry the release's end ENDED with no second door (CLOSED, or SOLD OUT without an after-room), as it opens there; and **AFTER THE RELEASES** in MY PIECES, one per release, in the ivory: the question, its answers one under the other pressed like the sign-in's switch (`aria-pressed`, a group named by the question), and until when the answer may change, on the phone's calendar. The console counts the answers on the release's page (§16.23); a segment reads them (`ANSWER`, §16.26).

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 CSRF_FAILED`, `403 FORBIDDEN` (a LOCKED account), `403 LIVE_QUESTION_NOT_ASKED`, `404 DROP_NOT_FOUND`, `409 LIVE_QUESTION_CLOSED`, `429 RATE_LIMITED`.

### 10.17 MESSAGES: `GET` and `POST /api/v1/account/messages`, `POST /api/v1/account/messages/read`, `GET /api/v1/account/messages/unread` (extension of the contract)

Plan NEXT-NINE, CS-01 (`genome/src/server/routes/messages.ts`, `services/messages.ts`). The collector writes to ORBES Client Services from the app (WRITE TO ORBES CLIENT SERVICES, or from MESSAGES); Client Services answer from the console (§16.28); the answers are read in the account, under MESSAGES. **Nothing is emailed**, messages carry **no files**, and only people write here: the house writes nothing on its own. An account session is required (`401` signed out: the app asks the visitor to sign in or create an account first); every POST needs the CSRF token and a same-origin request (§2.2); rate group `api`; answers are `Cache-Control: no-store`.

One conversation per collector. Staff are **never named** to the collector (the answers come `from: "ORBES_CLIENT_SERVICES"`), and the collector never sees a status.

- **`GET /api/v1/account/messages`** → `{ "messages": [{ "id", "from": "YOU" | "ORBES_CLIENT_SERVICES", "body", "at", "concerning": { "kind", "label", "path" } | null }], "unread": boolean }`, oldest first. `concerning` is set on the collector's own messages written with a context: its `kind`, the `label` the server wrote when it was sent (`MONOLITHE · O26-J-00184`, `ORDER OR-3F9A21C4 · MONOLITHE`, `MONOLITHE IN STEEL · CONFIRMED · REFERENCE LR-8K2M4Q`, `REF 5A864AF8 · INVALID SIGNATURE`, `ECLIPSE · PRIVATE SALON REQUEST`; a model with a variant's label is named with it, the main model of its group included, `MONOLITHE IN STEEL · O26-J-00184`, as the app names it before sending; a release by its title) and its `path` in the app: PIECE `/verify/pieces/<productId>`, ORDER `/verify/pieces?order=<orderId>` (MY PIECES' ORDERS), RELEASE `/verify/releases/<dropId>`, MODEL `/verify/lookbook/<slug>`, SCAN `null` (no page of its own). `unread`: an answer is newer than what the collector read.
- **`POST /api/v1/account/messages`** with `{ "body": string, "context"?: { "kind", "id", "about"? } | null }` → **201** `{ "message" }` (the shape above). `body`: plain text, line breaks kept, 1 to **2 000** characters once trimmed (`MESSAGE_LIMITS.collector`): *Write your message.*, *Your message is limited to 2,000 characters.* (`400 VALIDATION_FAILED`, in these words). `context.id` by kind: PIECE the piece's `productId` (O26-J-00184, or its row id), ORDER the `orderId`, RELEASE the `dropId`, MODEL the `modelId` (never the slug), SCAN the `scanId` of the result; `about: "WARRANTY"` for a SCAN only (the warranty tab). The server checks it now and writes its label: a piece the account **owns now**; an **order of the account**; a **published** release, with the account's own entry (`· PLACE HELD`, `· PLACE RESERVED`, `· CONCLUDED`, `· CONFIRMED · REFERENCE LR-…`, `· REMOVED`; PLACE RESERVED as the release page says it, `reserved`: a direct reservation, or a guarantee used before the release opened; a guarantee used at the draw reads PLACE HELD, so that a guarantee not shown leaves no mark); a scan **at most 24 hours old** (not a staff scan; `· WARRANTY NO LONGER VALID` for the warranty tab); a model the account's **lookbook reaches** (PUBLIC, or RESERVED from its tier up), with its open or latest request of the private salon. Otherwise `422 MESSAGE_CONTEXT_INVALID` or `422 MESSAGE_CONTEXT_EXPIRED`. Then, in one transaction: the account read `FOR SHARE` (`403 ACCOUNT_LOCKED` when LOCKED), at most **10 messages per rolling hour** (`429 MESSAGE_LIMIT`), the conversation created or locked `FOR UPDATE`, the message; the conversation is TO_ANSWER, its waiting time kept when it was waiting already; a CLOSED conversation reopens. Audited `message.write` with the account as actor and `{ conversationId, messageId, context, reopened }` (the kind of the context only): never the words.
- **`POST /api/v1/account/messages/read`** with `{ "upTo": ISO date-time }` → **204**: the conversation read up to that time (the latest message on screen; never later than now, never earlier than before). The account's MESSAGES view sends it when it opens.
- **`GET /api/v1/account/messages/unread`** → `{ "unread": boolean }`: NOW's line (*ORBES Client Services has answered you.*, READ) and the account sheet's NEW. Read once per page, with no polling.

Messages are kept with the account, included in its export (§16.13), and never deleted (the database refuses it). The scan retention (DATABASE §10) clears a message's scan id with its scan and keeps its REF.

In the verify app: the button **WRITE TO ORBES CLIENT SERVICES** (a hairline button; the house's full-width hairline button on the ivory CONFIRMED screen) opens the write sheet: CONCERNING and its label, YOUR MESSAGE (2 000 characters), the hint *Please leave out passwords and card numbers.*, SEND and CANCEL; then MESSAGE SENT and SEE MESSAGES. Signed out, the sheet asks the visitor to sign in or create an account, and keeps the context once signed in. MESSAGES is the first row of the account sheet (NEW while unread): the conversation oldest first, each message with its author line (`YOU · 6 OCT 2026 · 14:02`, `ORBES CLIENT SERVICES · …`), CONCERNING and a link to its place, the body as written, then YOUR REPLY and SEND.

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 CSRF_FAILED`, `403 ACCOUNT_LOCKED`, `422 MESSAGE_CONTEXT_INVALID`, `422 MESSAGE_CONTEXT_EXPIRED`, `429 MESSAGE_LIMIT`, `429 RATE_LIMITED`.

### 10.18 The yearly care: `GET` and `POST /api/v1/account/products/:productId/care`, `POST /api/v1/account/care/:id/cancel`, `GET /api/v1/account/care/:id/label.pdf` (extension of the contract)

Plan NEXT-NINE, BP-19 T6 (`genome/src/server/routes/account.ts`, `services/care.ts`; DATABASE §5.68). The yearly care a tier includes, asked for from the piece, with a prepaid label both ways: PLATINE **1 piece a year**, PALLADIUM **every piece** (THE PROGRAM's `carePiecesPlatine` and `carePiecesPalladium`, §16.21), nothing below PLATINE. The year is the **calendar year in UTC**; the tier is the one the account holds **now** (§10.10), read at the request. An account session is required (`401`); every POST needs the CSRF token and a same-origin request; answers are `Cache-Control: no-store`. **Nothing is written in MESSAGES** at any step, and nothing is emailed: the label is shown in the piece's SERVICE tab only.

- **`GET /api/v1/account/products/:productId/care`** (a piece the account holds now; `404 PRODUCT_NOT_FOUND` otherwise) → `{ "year": 2026, "tier": "PLATINE" | "PALLADIUM" | "TITANE" | null, "allowance": 1 | "ALL" | 0, "used": 0, "request": { … } | null, "reason": "AVAILABLE" | "NOT_INCLUDED" | "USED" | "PIECE_DONE" | "UNAVAILABLE", "addressHint": { "name", "address" } | null }`. `used`: the account's requests of the year not cancelled. `request`: the piece's request, an open one first (of any year), else the account's latest of the year: `{ id, status, year, requestedAt, returnName, returnAddress, label: { carrier: { id, name }, tracking, trackingUrl, at, pdf } | null, receivedAt, return: { carrier, tracking, trackingUrl, at } | null, doneAt, cancelledAt }` (`label.pdf`: whether the PDF can still be downloaded). `addressHint`: the buyer name and address of the account's latest order that has an address, to prefill the request's own form; its own account's only, `null` without one.
- **`POST /api/v1/account/products/:productId/care`** with `{ "name": string, "address": string }` → **201**, the same shape, `addressHint` included. The name (1 to 200 characters) and the address (1 to 1 000, line breaks kept) the piece returns to, trimmed; empty: `400 VALIDATION_FAILED` *Enter the name and the address the piece returns to.* In one transaction: the account `FOR UPDATE` (`403 ACCOUNT_LOCKED` unless ACTIVE), the piece held now, its status REGISTERED, OWNED or TRANSFERRED (a piece received by transfer included) and no transfer pending (`409 CARE_UNAVAILABLE`), a tier with an allowance (`403 CARE_NOT_INCLUDED`), once per piece and year (`409 CARE_ALREADY_REQUESTED`), within the allowance (`409 CARE_USED`). The name and the address are stored with the request, shown to Client Services and included in the account's export (§16.13); never in the audit log (`care.request` holds `{ requestId, productId, year, tier }`). To change them, the collector cancels and asks again.
- **`POST /api/v1/account/care/:id/cancel`** → **200**, the piece's care as `GET` reads it, `addressHint` included (so the form opens prefilled again after a cancel): the account's own request while REQUESTED only (`409 CARE_STEP` after; `404 CARE_REQUEST_NOT_FOUND` for another account's). The year's allowance is given back. Audited `care.cancel`.
- **`GET /api/v1/account/care/:id/label.pdf`** → the prepaid label (`application/pdf`, `attachment`, `no-store`), for its own account only; `404 CARE_REQUEST_NOT_FOUND` for any other, and once the PDF is erased (30 days after the request ends, DATABASE §10).
- **The other way round**, while the piece's request is REQUESTED or LABEL_SENT, the piece cannot be offered for transfer (§11.2): `409 CARE_OPEN` *This piece's yearly care is under way: cancel the request or wait until it returns.* The request names its owner and the address it returns to; once it is cancelled or the piece is back (RECEIVED and RETURNING keep the piece SERVICED, which refuses a transfer), the transfer can be offered.

In the verify app: **YEARLY CARE**, in a piece's SERVICE tab above SERVICE HISTORY, shown only when the account's tier has an allowance above 0 (or a request of the piece is still open): what the tier includes and REQUEST YEARLY CARE, then the request's own form (RETURN ADDRESS, NAME, ADDRESS, prefilled from the last order with *From your last order. Check it before you confirm.*, CONFIRM REQUEST · CANCEL); REQUESTED · date with the return address and CANCEL REQUEST; YOUR PREPAID LABEL with DOWNLOAD LABEL, CARRIER and TRACKING NUMBER; AT THE ATELIER; ON ITS WAY BACK with TRACK THE SHIPMENT; its completion, recorded in SERVICE HISTORY as YEARLY CARE.

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 CSRF_FAILED`, `403 ACCOUNT_LOCKED`, `403 CARE_NOT_INCLUDED`, `404 PRODUCT_NOT_FOUND`, `404 CARE_REQUEST_NOT_FOUND`, `409 CARE_USED`, `409 CARE_ALREADY_REQUESTED`, `409 CARE_UNAVAILABLE`, `409 CARE_STEP`, `429 RATE_LIMITED`.

### 10.19 YOUR SIZES: `GET` and `PUT /api/v1/account/sizes` (extension of the contract)

Plan NEXT-NINE, AC-01 (`genome/src/server/routes/account.ts`, `services/sizes.ts`; DATABASE §5.71). The sizes a collector keeps in its account: a ring size, a bracelet size, a wrist (for watches) and a necklace length. A saved size preselects a model's size in I'LL BE THERE and the LIVE ready check (§10.12, `savedSize`) and in a salon request (§10.9, `suggestedSize`), for a model whose size kind is that size's (§13.4); the collector **confirms it each time**, by its own press. An account session is required (`401`); the PUT needs the CSRF token and a same-origin request; answers are `Cache-Control: no-store`.

- **`GET /api/v1/account/sizes`** → `{ "sizes": { "RING": 52, "BRACELET": null, "WRIST": 16.5, "NECKLACE": null } }`: a ring as its French size, the others in centimetres; `null` where none is saved.
- **`PUT /api/v1/account/sizes`** with `{ "sizes": { "RING": 52, "WRIST": 16.5 } }` → **200**, the sizes as `GET` reads them. Saved **whole**: a kind given a number is saved, a kind `null` or left out is **cleared** (its row deleted). Each kind within its range and step: a ring **40 to 76**; a bracelet **14 to 24 cm** and a wrist **12 to 24 cm**, by 0.5 cm; a necklace **35 to 100 cm**, by 1 cm (stored in whole millimetres, `account_sizes_value`). Off its range or step: `400 VALIDATION_FAILED` with the kind's words, *A ring size is 40 to 76.*, *A bracelet size is 14 to 24 cm, by 0.5 cm.*, *A wrist is 12 to 24 cm, by 0.5 cm.*, *A necklace length is 35 to 100 cm, by 1 cm.*; an unknown kind or field, or not a number: `400 VALIDATION_FAILED`. An account not ACTIVE: `403 FORBIDDEN`. Audited `account.sizes.update` with `{ set: [kinds], cleared: [kinds] }` (the kinds new or changed, and those cleared), **never the measures**; nothing changed, nothing audited.

How a saved size matches a model's size (`matchSavedSize`): the model's size kind, or a variant's main model's when it has none; among its sizes (its SKUs; a release's sizes with stock), a size's fit range (§13.4) when it has one, otherwise its label read as a measure (`labelToMm`: `52`, `SIZE 52`, `52 MM`, `17.5 CM`, `17,5 cm`; a number without a unit is a ring's French size, centimetres for the others; ONE SIZE reads as none). A size is preselected **only when exactly one matches**.

In the verify app: the account sheet's second row, **YOUR SIZES**, its line the sizes saved (`RING 52 · WRIST 16.5 CM`, or NOT SET), opens their view: four selects (NOT SET, then the range), each with its unit as its hint (*French size.*, *In centimetres.*), SAVE and CANCEL; saved, the sheet says *Your sizes are saved.*; a failure, *Your sizes could not be saved just now.* and the server's message. Saved sizes are not used in segments, the owner sheet or the draws. The account's export holds them (§16.13, `sizes`).

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 CSRF_FAILED`, `403 FORBIDDEN`, `429 RATE_LIMITED`.

### 10.20 A new claim code on an order: its reading, the buyer's card, REGISTER THIS PIECE (extension of the contract)

Plan NEXT LOT of 2026-10-07, §3.4 (`routes/account.ts`, `services/claim-renewals.ts`, `OwnershipService.registerFromOrder`; DATABASE §5.76). When the card of a sold piece not registered yet is lost, ORBES Client Services makes a new claim code for it (§15.10): it never shows in the console, and waits, sealed, for the buyer of the piece's open order, who reads it **once** in YOUR ORDERS. Every route: the account's own order only (`404 ORDER_NOT_FOUND` for another account's or an unknown one), the CSRF rules, `Cache-Control: no-store`. The code travels in the request's body only, never in a URL, and never reaches the audit log.

- **`POST /api/v1/account/orders/:id/claim-code`** (no body; SHOW THE CODE, never on a page load) → **200** `{ "claimCode": "ABCD-EFGH-JKMN", "productId": "O26-J-00184" }`. Final once answered: the sealed copy is wiped (`claim_code.read`, by the account). Then **409 `CLAIM_CODE_UNAVAILABLE`**, also when nothing waits, the piece's code changed since (the row withdrawn `SUPERSEDED`), the piece was registered (`REGISTERED`), the server's key no longer opens it (`UNREADABLE`), or the piece is not printable (LOST…) or the order no longer open (left waiting: it shows again once the piece is back). `403 ACCOUNT_LOCKED`: the code keeps waiting for an unlock.
- **`POST /api/v1/account/orders/:id/claim-card.pdf`** with `{ "claimCode": "ABCD-EFGH-JKMN" }` (SAVE YOUR NEW CARD) → **200** `application/pdf` attachment: the certificate card 79t of §15.7, one page, the ORBES CODE and this claim code, drawn once the code matches the piece's hash (`422 CLAIM_CODE_MISMATCH`). Only while the order's newest code is read and still the piece's, the order open, the piece unregistered and printable with an ACTIVE ORBES CODE: **409 `CLAIM_CARD_UNAVAILABLE`** otherwise, the renderer's own refusals included (`NO_ACTIVE_CODE`, `CODE_INTEGRITY`, `PRODUCT_NOT_PRINTABLE`, `ALREADY_REGISTERED`, `NO_CLAIM_SECRET`: their words are staff's, never shown to the buyer). One render at a time per account (`429 RATE_LIMITED`). Audited `certificate.render` with `{ orderId, by: 'buyer' }`.
- **`POST /api/v1/account/orders/:id/register`** with `{ "claimCode": "ABCD-EFGH-JKMN" }` (REGISTER THIS PIECE, question 10: without a scan, the 79t card carrying both codes) → **201** `{ "productId": "O26-J-00184", "verified": true, "since": "…" }`. As §11.1, the order's piece in place of a scan token: the order SHIPPED or DELIVERED (`409 REGISTRATION_NOT_ALLOWED` before: the piece has not arrived), the piece registrable (its warranty started), not registered (`409 ALREADY_REGISTERED`), the claim code checked under the per-piece attempt limit (`403 CLAIM_CODE_INVALID`, `400 CLAIM_CODE_MALFORMED`, `400 CLAIM_CODE_REQUIRED`, `429 RATE_LIMITED`; failures counted since the piece's latest new claim code), `409 REGISTRATION_CONFLICT` when the code changed meanwhile. A SHIPPED order becomes DELIVERED in the same transaction. Rate group `auth`. Audited `ownership.register` with `{ via: 'order', orderId }`.

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 CSRF_FAILED`, `403 ACCOUNT_LOCKED`, `404 ORDER_NOT_FOUND`, `409 CLAIM_CODE_UNAVAILABLE`, `409 CLAIM_CARD_UNAVAILABLE`, `409 REGISTRATION_NOT_ALLOWED`, `409 ALREADY_REGISTERED`, `409 REGISTRATION_CONFLICT`, `422 CLAIM_CODE_MISMATCH`, `403 CLAIM_CODE_INVALID`, `429 RATE_LIMITED`.

## 11. Ownership endpoints

All require an account session and the CSRF rules. Responses describe the ownership, never the product's internal status.

### 11.1 `POST /api/v1/ownership/register`

First registration of a product, authorised by the `registration.token` from an `AUTHENTIC_FIRST_REGISTRATION` verification, or from a `SUSPICIOUS_ACTIVITY` one that carries it (§9.4 step 10's exception, where `claimCodeRequired` is always true), valid 15 minutes, single use, bound to that product, and, when `claimCodeRequired` was true, the claim code supplied with the product. Rate group `auth`.

| Field | Type | Required | Rules |
|---|---|---|---|
| `registrationToken` | string | yes | base64url, 1–128 characters. |
| `claimCode` | string \| null | when the product has one | At most 32 characters. 12 Crockford base32 characters, case-insensitive; hyphens and spaces are ignored, `I`/`L` read as `1` and `O` as `0` (display form `XXXX-XXXX-XXXX`). |

Example request:

```json
{ "registrationToken": "rBSMWPS6jopabvjgFoZS96FbEGuRFy2LmnzQA696NtA", "claimCode": "M8KD-7ZW9-DHHN" }
```

**201**:

```json
{ "productId": "O26-J-00002", "verified": true, "since": "2026-10-01T08:13:21.929Z" }
```

`verified` is `true` when a claim code matched (the product becomes OWNED) and `false` otherwise (REGISTERED, until client services confirm it).

Claim-code guessing is limited to **5 failed attempts per product per rolling hour**, across all accounts and server instances; further attempts answer `429 RATE_LIMITED` (*Too many claim codes have been tried for this piece within the hour. Please try again later. ORBES Client Services can assist you.*), the right code included, until the oldest failure is an hour old. A malformed claim code is refused without counting as an attempt. The verification app answers any 429 on registration with a claim code by saying that registration is held for up to an hour and that ORBES Client Services can assist (`CLAIM_HELD`, `genome/src/web/verify/copy.ts`); the hold can outlast the scan's 15-minute token (THREAT-MODEL E).

A registration that was already on its way when ORBES Client Services locked the account (§16.12), its claim code's check included, is refused with `403 ACCOUNT_LOCKED` and the token is not used: the account row is re-read under a share lock before the piece is locked.

Errors: `400 VALIDATION_FAILED`, `400 REGISTRATION_TOKEN_INVALID`, `400 CLAIM_CODE_REQUIRED`, `400 CLAIM_CODE_MALFORMED`, `401 UNAUTHORIZED`, `403 ACCOUNT_LOCKED`, `403 CLAIM_CODE_INVALID`, `403 CSRF_FAILED`, `403 FORBIDDEN`, `409 REGISTRATION_TOKEN_USED`, `409 ALREADY_REGISTERED`, `409 REGISTRATION_NOT_ALLOWED`, `409 REGISTRATION_CONFLICT`, `410 REGISTRATION_TOKEN_EXPIRED`, `429 RATE_LIMITED`.

### 11.2 `POST /api/v1/ownership/transfers`

The current owner offers the product for transfer. Body `{ "productId": string }` (canonical id or uuid). The product must be REGISTERED, OWNED or TRANSFERRED, with no transfer pending.

**201** — the code is shown once; only its hash is stored:

```json
{ "transferCode": "2KRJ-RW75-58PH", "expiresAt": "2026-10-08T08:13:21.929Z" }
```

The offer expires after 7 days. While it is pending, verifications show `ownership.transferPending: true`, and the verification of a signed-in reader who is not the owner carries the transfer token that §11.3 requires (`transfer`, §9.2, F-03): the code is accepted for this piece only.

For 72 hours after an assisted recovery of the account's password (§10.8), new transfers out of it are refused with `409 TRANSFERS_PAUSED`, whose message gives the end of the pause (*… transfers from this account are paused until 5 October 2026, 09:00 UTC. ORBES Client Services can assist you.*).

A lock by ORBES Client Services (§16.12) ends the account's sessions and cancels its pending transfers; a transfer request that was already on its way when the lock took effect is refused with `403 ACCOUNT_LOCKED` (the account row is re-read under its lock).

While the piece's yearly care is REQUESTED or LABEL_SENT (§10.18), the offer is refused with `409 CARE_OPEN`: *This piece's yearly care is under way: cancel the request or wait until it returns.*

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 NOT_OWNER`, `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 CARE_OPEN`, `409 TRANSFER_ALREADY_PENDING`, `409 TRANSFER_NOT_ALLOWED`, `409 TRANSFERS_PAUSED`.

### 11.3 `POST /api/v1/ownership/transfers/accept`

The recipient redeems a transfer code **for the piece they scanned, with that scan** (F-03). Rate group `auth`.

| Field | Type | Required | Rules |
|---|---|---|---|
| `transferCode` | string | yes | 1–32 characters; any accepted spelling of the 12-character code. |
| `productId` | string | yes (unless `TRANSFER_ACCEPT_REQUIRE_PRODUCT=false`) | The piece the recipient scanned: canonical id or uuid (`product.productId` of the verification). |
| `transferToken` | string | yes (unless `TRANSFER_ACCEPT_REQUIRE_PRODUCT=false`) | base64url, 1–128 characters: `transfer.token` of the recipient's verification of that piece, signed in (§9.2). A missing one answers `400 TRANSFER_SCAN_REQUIRED` (*Scan this piece while signed in to your ORBES account, then enter its transfer code.*). |

```json
{ "transferCode": "2KRJ-RW75-58PH", "productId": "O26-J-00002", "transferToken": "q1xV0cTzW3kQm8yBf4PpH7sLr2aNd9eGu6jKw5vXc0Y" }
```

Why: the code alone used to be enough, so a seller who owns two pieces could give the buyer of the dearer one the code of the cheaper one, keep the piece sold, and later report it stolen. Now:

- **The code must be the scanned piece's.** A code of another piece answers `409 TRANSFER_PRODUCT_MISMATCH` (*This transfer code is not for this piece. Check the code with the owner of this piece.*), which names neither piece and says nothing more about the other code (whether it is pending, cancelled or expired); nothing changes, and the scan stays usable.
- **The scan is required and used up.** The `TRANSFER_ACCEPT` token is checked before the code is read: it must be of that piece (`productId`), unexpired, unused, and earned by **this account's** scan (the scan event names the account). The scan earns it on an authentic result, and on an UNUSUAL ACTIVITY result that comes from the scan history alone (§9.2, the exception registration has for the holder of the certificate card): strangers scanning copies of a code shown in a listing must not keep the recipient, who holds the transfer code, from receiving the piece. Refusals: `400 TRANSFER_TOKEN_INVALID` (unknown, malformed, another purpose, another piece, another account, a scan made signed out), `409 TRANSFER_TOKEN_USED`, `410 TRANSFER_TOKEN_EXPIRED` (15 minutes). Because the token is checked first, a scan of one piece cannot be used to try piece ids against a code: every other id gets the same `TRANSFER_TOKEN_INVALID`. The token is used up **in the acceptance's transaction**, under the piece's and the transfer's row locks: any refusal there (`CANNOT_ACCEPT_OWN_TRANSFER`, `TRANSFER_NOT_ALLOWED`, a lock of the account…) leaves it unused.
- **`TRANSFER_ACCEPT_REQUIRE_PRODUCT=false`** (DEPLOYMENT §3.1; a production start logs a warning) makes `productId` and `transferToken` optional, for an acceptance assisted by ORBES Client Services: whichever is sent is still checked (a `productId` of another piece is still `409 TRANSFER_PRODUCT_MISMATCH`; a token alone stands for its piece). Without a token, a `productId` that names no issued piece is refused only once the code has been read, exactly as the id of another piece: `404 TRANSFER_NOT_FOUND` for a code that is no one's, `409 TRANSFER_PRODUCT_MISMATCH` for any other code, so the switch does not tell an account which ids exist (product ids are sequential). The switch is at the API level only, and no client of this release uses it (a declared deviation of the plan): the verify app still offers RECEIVE THIS PIECE only after a signed-in scan of the piece, and neither it nor the console offers an acceptance without one, so it does not help a client whose piece cannot be scanned (LAUNCH §11). While it is set, the check is off for every pending transfer.

The previous ownership ends (`TRANSFERRED_OUT`), a new one starts (`acquiredVia: TRANSFER`, `verified` carried over) and the product becomes TRANSFERRED. The audit entry `ownership.transfer.accept` names the scan used (`details.scanEventId`, `null` for an assisted acceptance without one).

**200** `{ "productId": "O26-J-00002", "verified": true, "since": "2026-10-01T08:13:21.929Z" }`

An acceptance that was already on its way when ORBES Client Services locked the recipient's account (§16.12) is refused with `403 ACCOUNT_LOCKED`; the transfer stays pending.

In the verify app: **RECEIVING THIS PIECE** in the OWNERSHIP tab of a piece registered to someone else (BRAND §4.4). A reader signed in when they scan gets the result on that tab, with *RECEIVING OPEN UNTIL hh:mm* and the TRANSFER CODE field; one who signs in after the scan, or as another account than the scan's (the window is that account's), is asked to **VERIFY AGAIN** (the same code, now with the session); after 15 minutes the panel asks to **SCAN AGAIN**, without sending the code. The 15 minutes are counted on the device's own clock from the moment the result arrived (`expiresAt` − `verifiedAt`, both the server's), so a phone whose clock is minutes off still offers the form for the whole window. With no transfer pending, there is nothing to enter; VERIFY AGAIN takes an owner who signed in after the scan to the owner view. A staff scan (§9.7: the browser is signed in to the console) earns no window: the panel says **STAFF SCAN** and to scan the piece in a browser that is not signed in to the console, never VERIFY AGAIN, which would only repeat the staff scan. On an UNUSUAL ACTIVITY result that carries a window, the same form is the section **DO YOU HOLD A TRANSFER CODE?** under the help line, for the piece the GENOME names.

Errors: `400 VALIDATION_FAILED` (including a malformed transfer code, a missing or malformed `productId`, a malformed `transferToken`, an unknown field), `400 TRANSFER_SCAN_REQUIRED`, `400 TRANSFER_TOKEN_INVALID`, `401 UNAUTHORIZED`, `403 ACCOUNT_LOCKED`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 TRANSFER_NOT_FOUND`, `409 TRANSFER_PRODUCT_MISMATCH`, `409 TRANSFER_TOKEN_USED`, `409 TRANSFER_ALREADY_ACCEPTED`, `409 CANNOT_ACCEPT_OWN_TRANSFER`, `409 TRANSFER_STALE`, `409 TRANSFER_NOT_ALLOWED`, `410 TRANSFER_TOKEN_EXPIRED`, `410 TRANSFER_EXPIRED`, `410 TRANSFER_CANCELLED`, `429 RATE_LIMITED`.

### 11.4 `POST /api/v1/ownership/transfers/cancel`

The sender withdraws a pending offer. Body `{ "productId": string }`.

**200** `{ "ok": true }`. Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 NOT_OWNER`, `403 CSRF_FAILED`, `404 PRODUCT_NOT_FOUND`, `404 NO_PENDING_TRANSFER`.

### 11.5 `POST /api/v1/ownership/incidents`

The current owner reports the product lost or stolen. Body `{ "productId": string, "type": "LOST" | "STOLEN" }`. Any pending transfer is cancelled. From then on, verifications of the product answer `SUSPICIOUS_ACTIVITY` and its codes can no longer be printed. A loss the owner reported themselves, the owner withdraws (§11.6); a theft, and a loss recorded by ORBES Client Services, are withdrawn by Client Services once they have checked the piece (a transition back to the previous status, §14.4).

In the verify app: **REPORT LOST / STOLEN** in MY PIECES (§10.5), with no scan (an owner whose piece is gone cannot scan it), confirmed: LOST or STOLEN, then CONFIRM REPORT. Offered only where the owner can declare (`incidentReportable` of §10.5); elsewhere the page points to ORBES Client Services and their contact.

**Only from a status that allows it**: the lifecycle allows LOST and STOLEN from it (§14.4) and it is not REVOKED. A piece revoked, retired or flagged by ORBES, or one already reported, answers `409 INCIDENT_NOT_ALLOWED` (*This piece cannot be reported here. ORBES Client Services can assist you.*), which names neither the status nor a "product"; nothing changes. Ownership is checked first, so a stranger still gets `403 NOT_OWNER`.

A declaration that was already on its way when ORBES Client Services locked the account (§16.12) is refused with `403 ACCOUNT_LOCKED`, as a transfer is (§11.2): the account row is re-read under its lock.

**201** `{ "productId": "O26-J-00002", "type": "LOST", "reportedAt": "2026-10-01T08:15:21.929Z" }`

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 NOT_OWNER`, `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 INCIDENT_NOT_ALLOWED` (revoked, retired, flagged, or already reported).

### 11.6 `POST /api/v1/ownership/incidents/resolve` (extension of the contract)

The current owner withdraws a loss they reported themselves: the piece has been found (F-01). Rate group `auth`. Body `{ "productId": string, "currentPassword": string }` (canonical id or uuid; the account's password, 1–1024 characters; unknown fields are refused).

- **The password, typed again.** A session alone is not enough to make a piece reported lost read as clean: a session left open on another device, or taken over, must not undo the owner's report (THREAT-MODEL U). The password is checked first, as the current password of a password change is (§10.7): a wrong or missing one answers `400 CURRENT_PASSWORD_INVALID` (*The current password is not correct.*; never a 401, which would sign the app out), counts towards the account's sign-in throttle (audited `account.login_failed` with `details.via: "incident_resolve"`), and while the account is throttled even the right password gets the same answer. A body without the field is `400 VALIDATION_FAILED`.
- **Only the current owner**, checked next: a stranger, and an unknown id, get the same `403 NOT_OWNER`, so the route reveals neither whether a piece exists nor whether it is reported.
- **Only a `LOST` the owner declared** (§11.5): the last move of the piece's status history, into `LOST`, was made by this account. A `STOLEN`, or a `LOST` recorded by ORBES Client Services, answers `409 INCIDENT_NOT_RESOLVABLE` (*Only a loss you reported yourself can be withdrawn here. ORBES Client Services can assist you.*): a theft is withdrawn by staff once they have checked the recovered piece, so whoever takes over an account after a theft cannot make the stolen piece read as clean. A piece that is not reported answers `409 NO_INCIDENT`.
- In **one transaction**, under the piece's row lock: the piece returns to the status it held before the loss (`returnTargetOf`, the lifecycle's return rule, applied by `applyForService`, audited `product.transition` with `via: "ownership.resolveIncident"` and the reason *found by owner*), and the withdrawal is audited `ownership.incident.resolve` with `details: { type: "LOST", to }`. Verifications then answer as they did before the loss, and the piece can be transferred again.
- A withdrawal already on its way when ORBES Client Services locked the account (§16.12) is refused with `403 ACCOUNT_LOCKED`, as a declaration is: the account row is re-read under its lock before the piece.

**200**:

```json
{ "productId": "O26-J-00002", "type": "LOST", "resolvedAt": "2026-10-03T09:12:41.118Z" }
```

Errors: `400 VALIDATION_FAILED`, `400 CURRENT_PASSWORD_INVALID`, `401 UNAUTHORIZED`, `403 NOT_OWNER`, `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `409 NO_INCIDENT`, `409 INCIDENT_NOT_RESOLVABLE`, `429 RATE_LIMITED`.

In the verify app: **PIECE FOUND** in MY PIECES (§10.5), under a loss the owner reported, confirmed with the account's PASSWORD, then CONFIRM; a wrong one is said on its field, which is cleared. The piece is then read again (§10.5): it shows the status the server returned it to (IN SERVICE for a loss declared during a service), never a guess. Under a theft, or a loss Client Services recorded, the page offers their contact instead (an email titled `ORBES — {product id} — REPORTED STOLEN` that names the piece, the phone, the hours).

### 11.7 Ownership certificates (extension of the contract)

The current owner creates, lists and withdraws the links of §8.7 (F-06). In the verify app: OWNERSHIP CERTIFICATE in the OWNERSHIP tab of each piece of MY PIECES (§10.5) that is not reported lost or stolen and whose `certificateAllowed` is `true` (not revoked nor retired; BRAND §4.4, §5).

**`POST /api/v1/ownership/certificates`**: body `{ "productId": string, "validDays"?: integer }` (canonical id or uuid; `validDays` 1 to 90, 30 when omitted; MY PIECES offers 7, 30 or 90 days).

- **Only the current owner**, checked first: another account's piece and an unknown id answer the same `403 NOT_OWNER`.
- Refused for a piece LOST, STOLEN, REVOKED, COUNTERFEIT_FLAGGED or RETIRED (`409 CERTIFICATE_NOT_ALLOWED`), past **10 links in use** for the piece (`409 CERTIFICATE_LIMIT`: valid, neither expired nor withdrawn), and for an account ORBES Client Services locked while the request was on its way (`403 ACCOUNT_LOCKED`: the account row is read under its share lock before the piece's row lock, as for a transfer).
- **Bound to the session that asks.** Under that share lock the request's session is read again: one ended meanwhile (an assisted recovery, §10.8, or a password change, §10.7, both of which end the account's sessions under its row lock and leave it ACTIVE) answers `401 UNAUTHORIZED` and nothing is created, so no link reaches whoever held the account once a recovery has withdrawn the others.
- 32 random bytes make the token; only **SHA-256 of those bytes** is stored (`ownership_certificates.token_hash`, DATABASE §5.27), bound to the piece and to the current ownership period. The link is answered **once**:

**201**:

```json
{
  "id": "0b6f7c1e-2f43-4d55-9b1a-6a0e4c7f2d10",
  "productId": "O26-J-00184",
  "token": "7Q2MZXKW4R8T1V0G3H5J6K9N2P4S6T8V0W2X4Y6Z8A1B3C5D7E9G",
  "url": "https://verify.theorbes.com/verify/c#7Q2MZXKW4R8T1V0G3H5J6K9N2P4S6T8V0W2X4Y6Z8A1B3C5D7E9G",
  "createdAt": "2026-10-03T09:00:00.000Z",
  "expiresAt": "2027-01-01T09:00:00.000Z"
}
```

Audited `ownership.certificate.create` (`targetType` `product`, the product id; `details: { certificateId, expiresAt, validDays }`; never the token).

**`GET /api/v1/ownership/certificates`**: the account's links still open (not withdrawn, not expired) for the pieces it owns now, newest first; never a token.

```json
{ "certificates": [ { "id": "0b6f7c1e-…", "productId": "O26-J-00184", "createdAt": "2026-10-03T09:00:00.000Z", "expiresAt": "2027-01-01T09:00:00.000Z", "valid": true } ] }
```

`valid` is `false` once the piece has been reported lost or stolen (or revoked, flagged, retired) since the link was created: the link then reads NO_LONGER_VALID, and MY PIECES shows it so, with WITHDRAW.

**`DELETE /api/v1/ownership/certificates/:id`** (`:id` a uuid): the owner withdraws a link of one of the account's ownership periods. **200** `{ "ok": true }`; from then on the link answers `404 CERTIFICATE_NOT_FOUND` (§8.7). Another account's link, an unknown id and a link already withdrawn answer the same `404 CERTIFICATE_NOT_FOUND`. Audited `ownership.certificate.revoke` (`details: { certificateId }`).

The account's open links are also withdrawn, all at once, by an assisted recovery of its password (§10.8) and by a lock by ORBES Client Services (§16.12), as its pending transfers are cancelled: a link created by whoever held the account does not keep showing the record. Each is audited `ownership.certificate.revoke` with `details: { certificateId, reason }` (`"account_recovery"`, `"account_locked"`); the links stay withdrawn after an unlock.

Errors: `400 VALIDATION_FAILED` (unknown field, `validDays` out of 1–90 or not an integer, malformed `productId` or `:id`), `401 UNAUTHORIZED`, `403 NOT_OWNER`, `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `403 FORBIDDEN`, `404 CERTIFICATE_NOT_FOUND`, `409 CERTIFICATE_NOT_ALLOWED`, `409 CERTIFICATE_LIMIT`.

---

## 12. Admin: authentication

Admin routes use the `orbes_admin` cookie (`__Host-orbes_admin` in production). Every route in this section is reachable without a TOTP-verified session, even when MFA is enforced, except the password change of an admin who has enrolled TOTP (§12.5). Logout, `me` and the password change (§12.5) are also open to a session signed in with a temporary password (§2.4); login has no session yet.

The admin object used below is `{ "id": uuid, "email": string, "role": "ADMIN" | "OPERATOR" | "AUDITOR" | "RETAIL", "totpEnabled": boolean, "passwordChangeRequired": boolean }`. `passwordChangeRequired` is true while a staff account created from the console (§17.8) still has its temporary password.

### 12.1 `POST /api/admin/auth/login`

Body:

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | 3–254 characters |
| `password` | string | yes | 1–1024 characters |
| `totp` | string \| null | when TOTP is enrolled | At most 16 characters, digits and spaces (a 6-digit code; RFC 6238, 30-second steps, ±1 step tolerated). `""` means none. Each code is accepted once. |

Session-less (origin rule). Rate group `auth`.

**200** — sets `orbes_admin`:

```json
{
  "admin": { "id": "90b8d94a-0460-4db1-b618-38a29ba74eb9", "email": "admin@orbes.example", "role": "ADMIN", "totpEnabled": true, "passwordChangeRequired": false },
  "csrfToken": "Bz6HODVO1RCbUYkv9Bd7gziEOWGaxiMaojVcmTH06KQ",
  "mfaPassed": true,
  "mfaRequired": true
}
```

`mfaPassed`: this session passed TOTP. `mfaRequired`: the server enforces MFA (§2.4).

Ten consecutive failures (password or TOTP) lock the admin for 15 minutes; every further failure while the counter is at or above 10 re-locks it. While locked, the password is not even checked. Anyone who knows an admin's email can therefore keep that admin locked out by sending wrong passwords (the `auth` rate limit slows this to 10 attempts per minute per IP); this denial of service is accepted in exchange for a bounded guessing budget (SECURITY-MODEL §3).

The session is opened in a transaction that reads the admin again under its row lock: a lockout or a disable that took effect while the password was being checked refuses the sign-in, and so does a password change (§12.5) that committed meanwhile. The old password then answers `401 INVALID_CREDENTIALS` and opens no session, and its re-hash (when the stored hash uses older scrypt parameters) is never written over the new password.

Errors: `400 VALIDATION_FAILED`, `401 INVALID_CREDENTIALS`, `401 TOTP_REQUIRED`, `401 INVALID_TOTP`, `403 CSRF_FAILED`, `429 ACCOUNT_LOCKED`, `429 RATE_LIMITED`, `503 TOTP_UNAVAILABLE`.

### 12.2 `POST /api/admin/auth/logout`

No body. Like the account logout (§10.3): works with or without a session. **200** `{ "ok": true }`.

### 12.3 `GET /api/admin/auth/me`

**200** — same body as the login response. Errors: `401 UNAUTHORIZED`.

### 12.4 TOTP enrolment (extension of the contract)

Two steps, available to every role, RETAIL included, so that MFA can be enforced without shell access. Rate group `auth`. Whoever first enrols an admin's authenticator from the console is trusted (trust on first use): the recommended first enrolment of a new admin is from the shell, `scripts/admin.ts totp-setup` then `totp-enable`, with the secret handed over in person (SECURITY-MODEL §3).

**`POST /api/admin/auth/totp/setup`** — no body (a body is ignored). Generates a secret; nothing is stored yet.

```json
{
  "secret": "5ZMPCLH2QO6ZO43AZ5UI3UZB2XH72Q3A",
  "otpauthUri": "otpauth://totp/ORBES:admin%40orbes.example?secret=5ZMPCLH2QO6ZO43AZ5UI3UZB2XH72Q3A&issuer=ORBES&algorithm=SHA1&digits=6&period=30"
}
```

Errors: `409 TOTP_ALREADY_ENABLED`.

**`POST /api/admin/auth/totp/enable`** — proves that the authenticator holds the secret; only then is it stored (encrypted). **Every other session of that admin ends** in the same transaction (they were opened with the password alone; the audit entry `admin.totp.enable` gives `details.sessionsRevoked`), and the current session is then **replaced** by a new session that has passed MFA: a new `orbes_admin` cookie and a new CSRF token, same absolute expiry; the old token stops working (a token captured before the step-up never carries MFA). The shell's `scripts/admin.ts totp-enable` ends every session of that admin.

| Field | Type | Rules |
|---|---|---|
| `secret` | string | 16–128 characters of base32 (`A–Z`, `2–7`, `=`, whitespace); must decode to 16–64 bytes. |
| `code` | string | 6–16 characters, digits and spaces; a current code for that secret. |

**200** — sets `orbes_admin`: `{ "ok": true, "mfaPassed": true, "csrfToken": string }`. Errors: `400 VALIDATION_FAILED`, `400 TOTP_CODE_INVALID`, `401 UNAUTHORIZED`, `403 PASSWORD_CHANGE_REQUIRED` (a temporary password is replaced first, §2.4), `409 TOTP_ALREADY_ENABLED`.

### 12.5 `POST /api/admin/auth/password` (extension of the contract)

Every role, at any time: the signed-in admin changes its own password. It is also the way out of a temporary password (§2.4): the console shows nothing else to a staff account until it has chosen its own. Rate group `auth`. When MFA is enforced, a session that has not passed TOTP may use it only while the admin has no second factor (`403 MFA_REQUIRED` once TOTP is enrolled, §2.4).

| Field | Type | Rules |
|---|---|---|
| `currentPassword` | string | 1–1024 characters; the password the admin signed in with (the temporary one, the first time). |
| `newPassword` | string | 1–1024 characters, then the password policy: at least 12 characters (code points after NFKC), at most 1024 bytes, not trivial, not the email, different from the current password. |

The current session is kept (same token and CSRF token); **every other session of that admin ends**, in one transaction with the audit entry `admin.password_change` (`details.sessionsRevoked`; `temporaryReplaced: true` when it replaced a temporary password). `passwordChangeRequired` becomes false, and the failed sign-in counter returns to 0. A wrong current password answers `400 CURRENT_PASSWORD_INVALID` (not 401: the caller is signed in) and counts as a failed sign-in: ten lock the admin for 15 minutes (§12.1), and a locked admin is refused (`429 ACCOUNT_LOCKED`) before the password is looked at and again, under the row lock, before the new one is written (a disabled one `401 UNAUTHORIZED`, its sessions having ended with it), so a stolen session cookie cannot be used to guess the password, not even by a burst of guesses still in flight when the lockout fires. A sign-in with the old password whose check was under way when the change committed opens no session (§12.1).

**200** `{ "ok": true, "admin": { …admin object…, "passwordChangeRequired": false } }`. Errors: `400 VALIDATION_FAILED` (policy), `400 CURRENT_PASSWORD_INVALID`, `401 UNAUTHORIZED`, `403 CSRF_FAILED`, `403 MFA_REQUIRED`, `429 ACCOUNT_LOCKED`, `429 RATE_LIMITED`.

---

## 13. Admin: dashboard and catalogue

### 13.1 `GET /api/admin/dashboard`

AUDITOR. Landing counts.

```json
{
  "generatedAt": "2026-10-01T08:15:21.929Z",
  "products": {
    "total": 6,
    "byStatus": { "ISSUED": 3, "ACTIVATED": 1, "REGISTERED": 1, "OWNED": 0, "TRANSFERRED": 1, "SERVICED": 0,
                  "RESOLD": 0, "RETIRED": 0, "REVOKED": 0, "COUNTERFEIT_FLAGGED": 0, "LOST": 0, "STOLEN": 0 }
  },
  "scans": { "last24h": 13, "last7d": 13 },
  "anomalies": { "open": 4, "openBySeverity": { "LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 1 } },
  "activeKey": { "keyId": 1, "kid": "orbes-k001-20261001-ecc8", "activatedAt": "2026-10-01T08:13:21.929Z" },
  "recentEvents": [
    { "scanId": "b9f87d9b-de30-4061-9e00-ed92c0b43600", "occurredAt": "2026-10-01T08:15:21.929Z",
      "eventType": "VERIFY", "state": "SUSPICIOUS_ACTIVITY", "productId": "O26-J-00003", "country": "US" }
  ]
}
```

`anomalies.open` counts OPEN and ACKNOWLEDGED anomalies. `activeKey` is `null` when no key is ACTIVE. `recentEvents` holds the 10 most recent scans. `scans` counts the stored scan history, live, without the staff scans (`ADMIN_TEST`: the sale mode, §16.18, and a browser signed in to the console, §9.7), as the daily statistics leave them out; `recentEvents` lists them, with their `eventType`. The trends by day, result and country, which survive a purge, are those of §16.16.

### 13.2 Categories

**`GET /api/admin/categories`** (AUDITOR) — every category, active or not, by index:

```json
{ "items": [ { "index": 1, "code": "J", "name": "Jewelry", "warrantyMonths": 24, "active": true, "createdAt": "2026-10-01T08:13:21.929Z", "products": 184 } ] }
```

`products` is the number of pieces issued in the category (A-10): the console's Deactivate / Activate dialog says it first, with the fact that none of their results changes. The category object of the two writes below carries it too (`0` for a new category).

**`POST /api/admin/categories`** (**ADMIN**) — creates a category with the lowest free index (1–31). The index and letter can never change afterwards.

| Field | Type | Required | Rules |
|---|---|---|---|
| `code` | string | yes | One letter A–Z (case-insensitive). |
| `name` | string | yes | 1–64 characters. |
| `warrantyMonths` | integer | no | 0–600; default 24. |

**201** — the category object. Errors: `400 VALIDATION_FAILED`, `409 CATEGORY_CODE_TAKEN`, `409 CATEGORY_INDEX_EXHAUSTED`.

**`POST /api/admin/categories/:code/active`** (**ADMIN**; extension of the contract) — body `{ "active": boolean }`. `:code` is the category letter (case-insensitive). A deactivated category receives no new product (`POST /api/admin/products` answers `409 CATEGORY_INACTIVE`) and leaves the public list of `GET /api/v1/categories` and the console's generator; its pieces keep verifying exactly as before (the registry still resolves its index), and it can be activated again. Its index and letter never change and are never reused. Audited `category.deactivate` or `category.activate` (target the letter); asking for the state the category already has changes nothing and writes no audit entry. An issuance under way reads the category's `active` again under a share lock in its transaction (§14.2), so a deactivation and an issuance run one after the other. **200** — the category object. Errors: `400 VALIDATION_FAILED`, `404 CATEGORY_NOT_FOUND`.

### 13.3 Collections

**`GET /api/admin/collections`** (AUDITOR), by name: `{ "items": [ { "id": uuid, "name": "ORBIT", "models": 1, "products": 184, "createdAt": … } ] }` (`models` = number of models in the collection; `products` = issued pieces whose public result names it: their own collection, else their model's, the rule of `product_overview`).

**`POST /api/admin/collections`** (OPERATOR) — body `{ "name": string (1–100) }`. **201** `{ "id", "name", "models": 0, "products": 0, "createdAt" }`. Errors: `400 VALIDATION_FAILED`, `409 COLLECTION_EXISTS`.

**`PATCH /api/admin/collections/:id`** (OPERATOR; extension of the contract) — renames a collection: body `{ "name": string (1–100) }`. The name is read live by the public result (`product.collection`, §9.2) of every piece shown in the collection, at once: the console says how many (`products`) before saving. Audited `collection.update` with `{ before: { name }, after: { name }, issuedPieces }`; the same name again writes nothing. **200** — the collection object. Errors: `400 VALIDATION_FAILED`, `404 COLLECTION_NOT_FOUND`, `409 COLLECTION_EXISTS`.

### 13.4 Models

**`GET /api/admin/models`** (AUDITOR), by category letter then name:

```json
{
  "items": [
    {
      "id": "73c68b47-012d-4569-a59a-fd2effa613c1",
      "name": "MONOLITHE",
      "type": "RING",
      "skuPrefix": "MNL-RG",
      "category": { "index": 1, "code": "J", "name": "Jewelry" },
      "collection": { "id": "8e78d92a-e441-4530-8aac-48ba29d094b2", "name": "ORBIT" },
      "defaultMaterial": "925 STERLING SILVER",
      "careInstructions": "Polish with a soft dry cloth.",
      "active": true,
      "imageUrl": "/api/v1/media/9f2c4e8a…",
      "products": 184,
      "lookbook": "PUBLIC",
      "slug": "monolithe",
      "story": "The first ring of ORBES.\n\nCast in Paris.",
      "specs": "Metal: 925 sterling silver\nWeight: 12 g",
      "publishedAt": "2026-10-04T09:00:00.000Z",
      "discontinuedAt": null,
      "priceLabel": null,
      "privateMinTier": 1,
      "gallery": [ { "sha256": "4b1a…", "url": "/api/v1/media/4b1a…", "alt": null, "position": 1 } ],
      "basePriceMinor": 480000,
      "baseCurrency": "EUR",
      "careGuide": "Wipe it with a soft cloth.\nKeep it in its box.",
      "shopify": { "productId": "8123456789", "variants": 4, "linked": 4 },
      "variantOf": null,
      "variantLabel": "Steel",
      "variantSwatch": "#9D9B96",
      "variants": [ { "id": "b2d1…", "name": "MONOLITHE", "label": "Gold", "swatch": "#B88A3A", "skuPrefix": "MNL-GD", "imageUrl": "/api/v1/media/77c0…", "lookbook": "PUBLIC", "slug": "monolithe-gold", "active": true } ],
      "sizeType": "RING",
      "sizesOffered": 6,
      "createdAt": "2026-10-01T08:13:22.220Z"
    }
  ]
}
```

`sizeType` (plan NEXT LOT §3.3): the model's size type, `RING`, `BRACELET`, `NECKLACE`, `WATCH` or `ONE_SIZE`; `null`: to give (a model of before H1). `sizesOffered`: how many of its declared sizes are offered (the Catalogue's line).

`collection` is `null` when the model has none. `active`: the model is offered for new products (§13.4, `PATCH`). `imageUrl`: the model's reference photograph (below), `null` without one; it is the cover of its lookbook sheet. `products`: the pieces issued with the model, whose public results read its name, type, care instructions, collection and reference photograph. The lookbook (P-R02, §8.8): `lookbook` (`HIDDEN`, `PUBLIC`, `RESERVED`), `slug` (the address of its sheet, `null` until named), `story`, `specs`, `publishedAt` (when it first left HIDDEN, `null` while it never has) and `gallery` (its photographs beside the cover, in their order; `alt` `null`: the sheet's default). `discontinuedAt` (P-R06): when an ADMIN discontinued the model (ISO), `null` while it is not; a discontinued model is never `active`. THE PRIVATE SALON (P-X08, §10.9): `priceLabel`, the price the salon shows while the model is RESERVED (`null`: none), and `privateMinTier`, the lowest tier it is shown to (1 TITANE, 2 PLATINE, 3 PALLADIUM; 1 by default). Plan LIVE RELEASE+ (N2, M6): `basePriceMinor` with `baseCurrency` (both or neither, `null` without one), the price the Shopify product export gives the model (§16.27; each release keeps its own price); `careGuide`, the care guide MY PIECES shows with each order of the model (§10.14; `null`: its care instructions stand in); `shopify`, its Shopify product once its ids are pasted back (`productId`, `null` while not linked), the sizes the export gives it as variants (`variants`, at least 1) and those whose variant id is kept (`linked`). Plan NOCTURNE (N1, migration 0024): a model can have **variants** (MONOLITHE in steel, in gold, in blue), each a model of its own linked to its main model: `variantOf`, the main model of a variant (`{ id, name, label }`), `null` otherwise; `variantLabel` and `variantSwatch`, its name among its model's dots (« Steel », 1 to 40 characters) and the dot's colour (`#RRGGBB`), both or `null`; `variants`, a main model's variants in the order they were added (`{ id, name, label, swatch, skuPrefix, imageUrl, lookbook, slug, active }`), empty for a variant and for a model alone. Never chained: a variant's main model is never a variant.

**`GET /api/admin/models/:id`** (AUDITOR; extension of the contract, P-R02) — one model, the object of the list: the console's Lookbook page of the model. Read alone (here, and as the answer of every write of a model), it adds two fields the list leaves out (plan NEXT-NINE, BP-34, **Pairs well with**, below): `pairs`, the models its sheet ends with, in their order, as picked on its main model (a variant's record carries its main model's, read only), each `{ "position": 1, "id", "name": "ZENITH", "label": null, "swatch": null, "lookbook": "RESERVED", "slug": "zenith", "shown": "SALON" }`, `shown` saying whether the sheet shows it (`EVERYONE` for a PUBLIC one, `SALON` for a RESERVED one, to the owners of its tier, `HIDDEN` for one hidden or without an address, `DISCONTINUED`); and `pairsFallback`, what the sheet shows when no pick is shown, as an owner of the highest tier reads it (§8.8 `pairs`): `[ { "name": "ZENITH", "label": null }, … ]`, empty for nothing. Errors: `400 VALIDATION_FAILED` (`:id` not a UUID), `404 MODEL_NOT_FOUND`.

**`POST /api/admin/models`** (OPERATOR):

| Field | Type | Required | Rules |
|---|---|---|---|
| `categoryCode` | string | yes | One letter (case-insensitive); the category must exist. |
| `collectionId` | uuid | no | Must exist. `""`/`null` = none. |
| `name` | string | yes | 1–100 characters |
| `type` | string | yes | 1–60 characters |
| `skuPrefix` | string | yes | 1–32 characters: letters, digits, `.`, `_`, `-`, starting with a letter or digit. Upper-cased. Unique. |
| `defaultMaterial` | string | no | ≤ 200 characters |
| `careInstructions` | string | no | ≤ 2 000 characters; shown publicly as `product.care`. |
| `sizeType` | string | yes | (plan NEXT LOT §3.3 item 6b) `RING`, `BRACELET`, `NECKLACE`, `WATCH` or `ONE_SIZE`; missing: `400 VALIDATION_FAILED` *Give the model its size type.* A watch or a model of one size has its one size, ONE SIZE (its SKU the prefix alone), declared at once; a ring's, a bracelet's or a necklace's sizes are ticked next (`PUT …/sizes`), and until then every flow naming a size of it answers `400 SIZE_NOT_DECLARED`. |

**201** — the model object (`active: true`, `imageUrl: null`, `products: 0`). Errors: `400 VALIDATION_FAILED`, `404 CATEGORY_NOT_FOUND`, `404 COLLECTION_NOT_FOUND`, `409 SKU_PREFIX_TAKEN`. Audited `model.create` with `{ name, type, skuPrefix, category, collectionId, sizeType }`.

**`PATCH /api/admin/models/:id`** (OPERATOR; extension of the contract) — changes what a model shows or offers, at least one field:

| Field | Type | Rules |
|---|---|---|
| `name` | string | 1–100 characters. Public: `product.model`. |
| `defaultMaterial` | string \| null | ≤ 200 characters; `""`/`null` clears it. Proposed by the generator; each piece keeps its own `material`. |
| `careInstructions` | string \| null | ≤ 2 000 characters; `""`/`null` clears them (the CARE tab of /verify then shows its general care text). Public: `product.care`. |
| `collectionId` | uuid \| null | Must exist; `""`/`null` = none. Public: `product.collection` of the pieces without a collection of their own. |
| `active` | boolean | `false`: no new product with this model (`POST /api/admin/products` answers `409 MODEL_INACTIVE`, the generator hides it); its pieces keep verifying as before. `true` offers it again; on a discontinued model (P-R06) `true` is `409 MODEL_DISCONTINUED`: an ADMIN reinstates it instead (below). An issuance under way reads `active` again under a share lock in its transaction (§14.2), so it never completes with a model deactivated meanwhile. |
| `lookbook` | string | (P-R02) `HIDDEN`, `PUBLIC` or `RESERVED` (§8.8). A model shown (PUBLIC or RESERVED) has its `slug`, sent with it or already set (400 otherwise). The first time it is shown, `publishedAt` is set; it is never cleared. |
| `slug` | string \| null | (P-R02) The address of its sheet, `/verify/lookbook/<slug>`: 1–80 lower-case letters and digits, words joined by single hyphens (trimmed and lower-cased first). Another model's address: `409 SLUG_TAKEN`. Once the model has been published (`publishedAt`), its address never changes, nor goes: `409 SLUG_LOCKED`, links to its sheet are out. `""`/`null` clears it while the model was never published. |
| `story` | string \| null | (P-R02) Plain paragraphs, a blank line between two, at most 4 000 characters; no Markdown: shown as typed. Line breaks are kept (as `\n`), each line trimmed, runs of blank lines kept to one. `""`/`null` clears it. |
| `specs` | string \| null | (P-R02) One `Label: value` line per specification, at most 1 000 characters: the label before the first colon, 1–40 characters, **no figure** (labels are set in the display face); the value after it, not empty. Blank lines dropped; kept as `Label: value`. A line out of form: `400 VALIDATION_FAILED` naming the line. `""`/`null` clears them. |
| `priceLabel` | string \| null | (P-X08) The price THE PRIVATE SALON shows while the model is RESERVED (§10.9): one line, at most 60 characters, whitespace trimmed and collapsed (« € 4 800 », « Price on request »); `""`/`null` (or blank text) clears it: no price shown. A PUBLIC model shows none. |
| `privateMinTier` | integer | (P-X08) The lowest tier the model is shown to while it is RESERVED: 1 (TITANE, every owner), 2 (PLATINE) or 3 (PALLADIUM); anything else `400 VALIDATION_FAILED`. Below it, its sheet answers `404 LOOKBOOK_NOT_FOUND` like a model not in the collection. |
| `basePriceMinor`, `baseCurrency` | integer \| null, string \| null | (plan LIVE RELEASE+, N2) Sent together: the base price in minor units, 1 to 100 000 000, and its currency, `EUR`, `GBP`, `USD` or `CHF`; `null` for both clears it; one without the other `400 VALIDATION_FAILED`. The price of the Shopify product export (§16.27); each release keeps its own. |
| `careGuide` | string \| null | (plan LIVE RELEASE+, M6) Plain text, line breaks kept (each line's trailing spaces and a run of blank lines kept to one), at most 8 000 characters; `""`/`null` clears it. MY PIECES shows it with each order of the model (§10.14), before its care instructions. |
| `variantLabel`, `variantSwatch` | string \| null, string \| null | (plan NOCTURNE, N1) Sent together: its name among its model's dots, one line of 1 to 40 characters (trimmed, runs of spaces kept to one), and the dot's colour, `#RRGGBB` (the `#` optional, any case; kept in capitals); `null` for both clears them, on a model alone only: a variant and a model with variants keep theirs (`409 VARIANT_LABEL_REQUIRED`). Another dot of the same model with that label, whatever its case: `409 VARIANT_LABEL_TAKEN`. |

**Never `category`, `categoryCode` nor `skuPrefix`** (`400 VALIDATION_FAILED`, "The category and SKU prefix of a model never change: …"): the category letter is in the identity of every piece issued with the model, and the prefix starts every SKU issued with it (the database refuses them too, DATABASE §5.3). `type` cannot be changed either; any other field is unknown (400). The changes are read live by the public result (§9.2) of every piece issued with the model, at once (the collection only on the pieces without one of their own), and by its lookbook sheet (§8.8, within the 5 minutes of its cache): the console says how many (`products`) before saving, and shows the care block, the story and the specifications as the client reads them. Audited `model.update` with the changed fields only, `{ before: {…}, after: {…}, issuedPieces }`, a story and a care guide as `{ length, sha256 }` (never their words, the audit log is permanent), and `publishedAt` (`null` before, the time after) when the change first shows the model; a change that changes nothing writes nothing. The price and tier of the salon are audited the same way (`model.update`, before and after). **200** — the model object. Errors: `400 VALIDATION_FAILED`, `404 MODEL_NOT_FOUND`, `404 COLLECTION_NOT_FOUND`, `409 MODEL_DISCONTINUED`, `409 SLUG_TAKEN`, `409 SLUG_LOCKED`, `409 VARIANT_LABEL_REQUIRED`, `409 VARIANT_LABEL_TAKEN`.

**`POST /api/admin/models/:id/variants`** (OPERATOR, as editing a model; plan NOCTURNE, N1: ADD A VARIANT) — a new model, a **variant** of the model `:id`, that copies its category, collection, name, type, story, specifications and care (its instructions and its guide); HIDDEN from the lookbook, active, without a material, prices or photographs of its own yet (set next, on its page). JSON: `{ "label": string, "swatch": string, "skuPrefix": string, "mainLabel"?: string, "mainSwatch"?: string }` — its label (1 to 40 characters, one line) and colour (`#RRGGBB`), and its own SKU prefix (as `POST /api/admin/models`); `mainLabel` and `mainSwatch`, together, the main model's own label and colour, read only while it has none (its first variant: the main model is one of the dots too; `400 VALIDATION_FAILED` when they are missing then). **Its sizes** (plan NEXT LOT §3.3): it copies its main model's size type and kind, and each of its **offered** sizes (never one set aside) as its own SKU under its own prefix (`MNL-RG-BL-52`), with its fit, at 0; a watch or a model of one size has its ONE SIZE. Nothing links the two afterwards: a later change of either never reaches the other. `"sizeType"?: type` is required when the main model has none yet (a model of before H1: `400 VALIDATION_FAILED` *Give the model its size type.*), the variant then taking it and the main's offered sizes copied as they are (the main model unchanged), and refused when the main model has one (`400` *This model has its size type: its variant copies it.*). Audited `model.variant.create` (target the new variant) with `{ mainId, name, type, skuPrefix, category, collectionId, label, swatch, copied, sizeType?, sizes }` (`copied` includes `sizes`; `sizes` the labels the variant starts with), and, when the main model is given its dot, `model.update` on it. **201** — the variant's model object (`variantOf` its main model). Errors: `400 VALIDATION_FAILED`, `404 MODEL_NOT_FOUND`, `409 MODEL_IS_VARIANT` (variants are never chained: add it to the main model), `409 VARIANT_LABEL_TAKEN` (the main model's or another variant's label, whatever its case), `409 SKU_PREFIX_TAKEN`.

**`POST /api/admin/models/:id/image`** (OPERATOR; extension of the contract, F-04) — sets the model's **reference photograph**, shown above the GENOME on the authentic result (§9.2 `product.imageUrl`) of every piece issued with the model, at once. The body is **the image itself**, not JSON:

- `Content-Type: image/jpeg` or `image/webp` (anything else, a JSON body included: `415 UNSUPPORTED_MEDIA_TYPE`), at most **1 MiB** (`413 PAYLOAD_TOO_LARGE`); the CSRF rules of §2.2 apply as to any mutation. These photograph routes (with the gallery's, below, the piece's, §14.12, and a circle post's, §16.20) are the only ones with this parser and this limit (`genome/src/server/routes/admin/media.ts`).
- The type is read from the bytes (`genome/src/server/media/image.ts`): a JPEG (`FF D8 FF`) sent as `image/jpeg` or a WebP (`RIFF…WEBP`) sent as `image/webp`, still, at most 4 096 px on each side; anything else is `400 IMAGE_INVALID` (an SVG or a PNG under either name, a damaged or truncated file), an animated WebP `400 IMAGE_ANIMATED`.
- **Metadata removed** before anything is stored: from a JPEG, every APP1 segment (EXIF with its GPS position and thumbnail, XMP), every other application segment but the JFIF header (without its thumbnail), the ICC colour profile and the Adobe marker, every comment, and whatever follows the end of the image; from a WebP, the EXIF and XMP chunks (and their flags), every chunk that is not part of the picture, and whatever follows the container. The picture itself is not re-encoded: its pixels are the file's. **Kept**, because the colours need it: the colour profile (JPEG ICC_PROFILE, WebP ICCP), whole, with its own text (the profile's description and copyright and, in a profile a device wrote, the names of its maker and model).
- **Upright only**: the pixels are never turned, and the EXIF orientation goes with the EXIF, so a photograph turned by it (an orientation other than 1, as a phone often writes) is refused, `400 IMAGE_INVALID` ("The photograph is turned by its EXIF orientation, which is removed here: save it upright, then send it again."), rather than shown sideways. A client of the API sends the picture upright, as the console does.
- Stored once under the SHA-256 of what remains (`media_objects`, DATABASE §5.26): the same photograph uploaded for two models or pieces is one row.

The console re-encodes every photograph through a canvas before sending it (2 000 px at most on the longer side, a JPEG whose quality steps down until it fits 1 MiB), which carries no metadata in the first place; the Catalogue's **Photo** dialog previews what will be sent, its size and the number of issued pieces it reaches. Audited `model.image.set` (target the model) with `{ sha256, mime, width, height, bytes, previous, issuedPieces }`: the facts of the image, never its bytes, the photograph it replaced (`null` for the first) and the pieces it reaches. The same photograph again writes nothing. The one it replaced, used by no other model, gallery or piece, is deleted (§8.6 then answers 404). **200** — the model object, `imageUrl` set. Errors: `400 VALIDATION_FAILED` (`:id` not a UUID), `400 IMAGE_INVALID`, `400 IMAGE_ANIMATED`, `404 MODEL_NOT_FOUND` (checked after the image), `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`.

**`DELETE /api/admin/models/:id/image`** (OPERATOR; extension of the contract) — removes the reference photograph: the results of the model's pieces no longer show it, nor its lookbook sheet its cover. No body (or `{}`). Audited `model.image.remove` with `{ previous, issuedPieces }`; removing where there is none writes nothing. The image, used by no other model, gallery or piece, is deleted. **200** — the model object, `imageUrl: null`. Errors: `400 VALIDATION_FAILED`, `404 MODEL_NOT_FOUND`.

**The gallery of a model's lookbook sheet** (OPERATOR; extension of the contract, P-R02): up to **8** photographs beside the cover (the reference photograph above), in an order, each with its alternative text (`model_images`, DATABASE §5.28). Every change locks the model's row first, so two changes of one gallery run one after the other, and keeps its positions 1 to n. The console's Lookbook page sets them (Catalogue → Lookbook).

- **`POST /api/admin/models/:id/gallery`**: a photograph, added last. The body is **the image itself**, exactly as for the reference photograph (the same parser and limit, the same checks of its bytes, its metadata removed, stored once by its SHA-256 through MediaService). The model's reference photograph is its cover already: `409 IMAGE_IS_COVER`; a ninth: `409 GALLERY_FULL`; the same photograph again writes nothing. Audited `model.gallery.add` with `{ sha256, mime, width, height, bytes, position }`. **200** — the model object.
- **`PATCH /api/admin/models/:id/gallery`**: the order and the alternative texts, JSON: `{ "images": [ { "sha256": string, "alt"?: string | null } ] }`, every photograph of the gallery once, in the new order (`alt` one line of at most 200 characters; `""`/`null`: the sheet's default; left out: the photograph keeps its text). A list that does not name the gallery's photographs, each once: `409 GALLERY_CHANGED`, and nothing is written. Audited `model.gallery.update` with the gallery `{ before, after }` (each `{ sha256, alt }`); unchanged, nothing is written. **200** — the model object.
- **`DELETE /api/admin/models/:id/gallery/:sha256`**: a photograph leaves the gallery, the next ones move up; one that is not in it: `404 GALLERY_IMAGE_NOT_FOUND`. Audited `model.gallery.remove` with `{ sha256, position }`. The image, used by no other model, gallery or piece, is deleted (§8.6 then answers 404). **200** — the model object.

Errors besides: `400 VALIDATION_FAILED` (`:id` not a UUID, `:sha256` not 64 hexadecimal characters, a malformed order), `400 IMAGE_INVALID`, `400 IMAGE_ANIMATED`, `404 MODEL_NOT_FOUND`, `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE` (the POST takes the image only; the PATCH takes JSON).

At the edge of the VPS stack, the five photograph uploads (`POST` …`/image`, …`/gallery`, `/api/admin/products/:productId/photo`, P-X01's `/api/admin/circle/posts/:id/photos`, §16.20, and a LIVE RELEASE's `/api/admin/live/:id/silhouette`, §16.23), and only they, may carry 1 200 KB instead of 64 KB ([DEPLOYMENT §15](DEPLOYMENT.md#15-ovh-vps-deployment), `deploy/vps/Caddyfile`).

A model's narrative is its lookbook sheet (P-R02, §8.8): its story and its specifications, above.

**DISCONTINUED** (**ADMIN**; extension of the contract, P-R06; `services/catalog.ts`, migration `0019_model_discontinued`): an ADMIN closes a model's edition, and may open it again (the plan's choice 11: reversible). The console asks for a typed phrase first (`DISCONTINUE <SKU prefix>`, `REINSTATE <SKU prefix>`).

- **`POST /api/admin/models/:id/discontinue`**: `discontinued_at` now, its author (`discontinued_by`, the ADMIN; `null` for a script) and `active = false`, **in one transaction** under the model's row lock. Discontinued implies inactive, so the refusals of an inactive model apply as they are (`409 MODEL_INACTIVE` at issuance, the generator's filter): one refusal mechanism (a declared deviation from the brief: no new `EDITION_CLOSED`). Its pieces keep verifying as before, and say *DISCONTINUED · <year>* (the UTC year): `product.discontinuedYear` of an authentic result (§9.2), `discontinuedYear` of its lookbook sheet (§8.8) and of an ownership certificate's `piece` (§8.7, and the PDF's DISCONTINUED row). Already discontinued: `409 MODEL_ALREADY_DISCONTINUED`. Audited `model.discontinue` with `{ name, skuPrefix, discontinuedAt, wasActive, issuedPieces }`.
- **`POST /api/admin/models/:id/reinstate`**: `discontinued_at` and its author cleared, `active = true` again (offered for new pieces), in one transaction; the line DISCONTINUED goes from every result, sheet and certificate. Not discontinued: `409 MODEL_NOT_DISCONTINUED`. Audited `model.reinstate` with `{ name, skuPrefix, discontinuedAt, issuedPieces }`, `discontinuedAt` being the date it had been discontinued.

Both take an empty JSON body (`{}`) or none (any field is `400 VALIDATION_FAILED`), and the CSRF rules of §2.2. **200** — the model object (`discontinuedAt` set or `null`, `active`). Errors: `400 VALIDATION_FAILED` (`:id` not a UUID, a field in the body), `401`, `403 FORBIDDEN` (below ADMIN), `404 MODEL_NOT_FOUND`, `409 MODEL_ALREADY_DISCONTINUED`, `409 MODEL_NOT_DISCONTINUED`. The database holds it below the service: `models_discontinued_inactive` (a discontinued model is never active) and `models_discontinued_by_when` (an author only with the date), DATABASE §5.3.

**Sizes** (plan NEXT-NINE, AC-01, and plan NEXT LOT §3.3; `services/sizes.ts`, migrations `0030_account_sizes` and `0033_model_sizes`): the model's **size type** and its **declared sizes**, each its own SKU with its own stock, **offered** or **set aside**; which saved size of a collector (§10.19) preselects the model's size, and the measures each of its sizes fits. The console's Lookbook page of a model, its **Sizes** section. A size type's list is fixed (`standardSizes`): a ring French sizes `40` to `76`, a bracelet `14` to `24` by `0.5` (centimetres), a necklace `35` to `100` (centimetres), each label the bare number with a dot (`52`, `17.5`); a watch and a model of one size have a single SKU, ONE SIZE (its label `null`, its code the prefix alone). Until a model has its type (`null`: a model of before H1) its sizes work as before: a size named anywhere is created (sizes by accident included). Once typed, every size named (a release, an order, the salon, the Generator) must be one of its declared sizes, matched by its label whatever the case or by its measure (`SIZE 52`, `52 MM` are `52`) and stored with the declared label: otherwise `400 SIZE_NOT_DECLARED`, and `409 SIZE_SET_ASIDE` for a size set aside (the Generator and orders of earlier requests and releases accept one). The section (step 3.6) shows the type (*To give* until it is given), the sizes offered and set aside, each size's SKU, fit and state (*Offered*, *Offered · Not on the Ring size list*, *Offered · Same measure as 52*, *Set aside · 07 OCT 2026*), with *Edit size type*, *Tick sizes* (a ring, a bracelet, a necklace), *Remove* (never the last offered size) and *Reinstate*; a model created with a list type opens on *Tick sizes* at once, and the Catalogue shows each model's type and offered count (*Ring size · 6 sizes*, *Size type to give*). The writes below take an ORBES admin, or a script (the system actor: the demo seed, which gives each demo model its type, NOCTURNE excepted; `set_aside_by` then `null`); never an account.

- **`GET /api/admin/models/:id/sizes`** (AUDITOR) → `{ "modelId", "sizeType": "RING" | "BRACELET" | "NECKLACE" | "WATCH" | "ONE_SIZE" | null, "sizeKind": "RING" | "BRACELET" | "WRIST" | "NECKLACE" | null, "inherited": { "sizeKind", "from": "MONOLITHE" } | null, "list": ["40", …, "76"], "sizes": [ { "skuId", "label": "52" | null, "code": "MNL-RG-52", "fitMinMm": null, "fitMaxMm": null, "setAsideAt": null, "onList": true, "sameAs": null, "used": true, "awaiting": 0 } ], "offered": 6, "setAside": 1, "supplier": { "own": { "id", "name": "NORD RINGS", "active": true } | null, "inherited": { "id", "name", "active", "from": "MONOLITHE" } | null, "sizes": { "<skuId>": { "id", "name", "active" } } } }`. `supplier` (plan NEXT LOT §3.5.4.5, §16.33): the model's own supplier, a variant's main model's when it has none (`inherited`), and the sizes that name their own (a size not listed uses the model's). `inherited`: on a variant without a type nor a kind of its own, its main model's kind and name (*Reads Ring size from MONOLITHE*). `list`: the type's sizes to tick (empty without a type, and for a watch or a model of one size). `sizes`: every declared size, ONE SIZE included (`label: null`), the offered ones first, each in the order a client reads them; `setAsideAt` when it was set aside (`null`: offered); `onList` whether its label reads as a size of the type's list (ONE SIZE for a watch or a model of one size; `true` without a type); `sameAs` the list's label another declared size reads as too, on the one whose label is not the list's own (*Same measure as 52*); `used` whether something uses it (a stock movement, an order, a piece, a release's size, a minimum, a piece being made, from H2 a supplier-order line, a reception line, a return to a supplier or a stock correction, an OPEN salon request in that size, a Shopify id: removing it sets it aside); `awaiting` the orders waiting for supplier stock in it (0 before H2); each `fitMinMm` and `fitMaxMm` in whole millimetres of the kind (a French ring size, or centimetres × 10), both `null` when the size's label itself is read. Unknown: `404 MODEL_NOT_FOUND`.
- **`PUT /api/admin/models/:id/sizes`** (OPERATOR) with `{ "sizeType"?: type, "ticked"?: ["50", "52"], "sizeKind"?: kind | null, "fits"?: [ { "skuId", "fitMinMm": 1..1000 | null, "fitMaxMm": 1..1000 | null } ] }`, at least one of them, never `sizeType` with `sizeKind` (`400` *Give a size type or a size kind, not both.*) → **200**, the section as `GET` reads it.
  - `sizeType` gives the model its type and derives its kind (a ring, a bracelet, a necklace their own; a watch the wrist; one size none); a watch or a model of one size declares ONE SIZE (or offers it again). Giving or changing the type never removes a size: those off the new list stay offered, `onList: false`. Once given, a type is never cleared, only changed.
  - `ticked` (at most 66 labels of 12 characters; a ring, a bracelet or a necklace only, else `409 SIZE_TYPE_REQUIRED`): the list's sizes the model is made in, each on the list (`400` *Size 39 is not on the Ring size list.*). A ticked size no SKU reads as is created, its code the prefix and the size (`MNL-RG-52`, `MNL-BR-17-5`; `-2` on a collision); one a set-aside SKU reads as is offered again (no second SKU). A list size not ticked: every offered SKU that reads as it is removed when nothing uses it, otherwise set aside (`setAsideAt`, by the admin). At least one size stays offered, those off the list counted (`400` *Leave at least one size offered.*).
  - `sizeKind` (next-nine's): on a model with no type only (`409 SIZE_TYPE_GIVEN` on a typed one). `fits` as next-nine's: a fit is both or neither (*Give Fits from and Fits to, or neither.*) and its first at most its second (*Fits from is at most Fits to.*); a SKU of another model: `404 SKU_NOT_FOUND`.
  - In one transaction, the model's row `FOR NO KEY UPDATE` first, then each SKU removed or set aside `FOR UPDATE`. Audited `model.sizes.declare` with `{ sizeType?: { before, after }, added, reinstated, setAside, removed }` (SKU codes) for the type and the sizes, and `model.sizes.update` with `{ sizeKind?: { before, after }, skus }` for the kind and the fits. Nothing changed: `400` *Nothing has changed.*, nothing written. The console sends the type's unit as whole millimetres.
- **`POST /api/admin/models/:id/sizes/:skuId/remove`** (OPERATOR, no body) → **200** `{ "outcome": "REMOVED" | "SET_ASIDE", "sizes": section }`: the size removed (its SKU deleted) when nothing uses it, otherwise set aside. The last offered size: `409 SIZE_LAST_OFFERED`; a SKU of another model: `404 SKU_NOT_FOUND`; a size already set aside that something uses: `400` *Nothing has changed.* Audited `model.sizes.declare` with its code in `removed` or `setAside`.
- **`POST /api/admin/models/:id/sizes/:skuId/reinstate`** (OPERATOR, no body) → **200**, the section: a set-aside size offered again (one off the list too). Already offered: `400` *Nothing has changed.* Audited `model.sizes.declare` `{ reinstated: [code] }`.

**Pairs well with** (plan NEXT-NINE, BP-34; `services/catalog.ts` `setPairs`, migration `0031_model_pairs`): the two or three models a model's sheet ends with (§8.8 `pairs`), set on a main model or a model alone; a variant's sheet is its main model's, so are its pairs. The console's Lookbook page of a model, its **Pairs well with** section.

- **`PUT /api/admin/models/:id/pairs`** (OPERATOR) with `{ "models": [uuid, …] }`, at most three, in their order: **none** (`[]`: the sheet then shows other models of its collection), **two or three**, from any collection. **200**, the model object read alone (`pairs`, `pairsFallback`). The model's row is locked while its pairs are replaced, in one transaction; the same picks again write nothing and audit nothing. Audited `model.pairs` with `{ before, after }`, the ids in their order. Errors: `400 VALIDATION_FAILED` (one model, *Pick two or three models, or none: the sheet then shows other models of its collection.*; four; a model twice, *Each model is picked once.*; an id not a UUID), `404 MODEL_NOT_FOUND` (the model, or a model picked), `409 MODEL_IS_VARIANT` (*A variant’s pairs are set on its main model: its sheet is the same.*), `409 PAIR_SAME_MODEL` (*A model pairs with another model, not with itself or one of its variants.*), `401`, `403 FORBIDDEN` (AUDITOR). The fallback's size (3) is a constant; there is no setting.

### 13.5 `GET /api/admin/system/status` — the server's status (extension of the contract)

AUDITOR (every console role from AUDITOR; RETAIL: `403 FORBIDDEN`). What the console's Server panel reads every 2 s (test entrants: the Drops tab, a draw's page, a LIVE RELEASE's page). The app takes a sample every 2 s from its start and keeps the last 300, 10 minutes (`services/system-status.ts`); the route only reads them, and takes a first one when a request comes before it. No query string.

```json
{
  "now": "2026-10-07T03:10:02.114Z",
  "latest": {
    "at": "2026-10-07T03:10:01.002Z",
    "app": { "memBytes": 412876800, "memLimitBytes": 805306368, "memPeakBytes": 530579456, "cpuCores": 0.412,
             "cpuLimitCores": 1.5, "throttledPct": 0, "pids": 23, "pidsMax": 256 },
    "host": { "memAvailableBytes": 1918382080, "memTotalBytes": 4090892288, "swapUsedBytes": 268435456, "load1": 0.84,
              "load5": 0.62, "cpuPct": 18.5, "diskUsedPct": 41.2 },
    "node": { "heapUsedBytes": 98566144, "heapLimitBytes": 2197815296, "rssBytes": 251658240, "externalBytes": 4194304,
              "loopDelayP50Ms": 0.4, "loopDelayP99Ms": 3.1, "loopUtilPct": 12.7 },
    "live": { "streams": 42, "releases": 1, "accounts": 40 },
    "db": { "poolTotal": 6, "poolIdle": 4, "poolWaiting": 0, "connections": 8, "maxConnections": 40, "active": 1, "waiting": 0 },
    "http": { "rps": 37.4, "p95Ms": 18.3, "errors5xx": 0, "refused429": 2 }
  },
  "history": [ { "at": "2026-10-07T03:00:03.001Z", "…": "…" }, "… oldest first, the newest last (the same as latest)" ]
}
```

- `app`: the app's container, from its cgroup v2 (`/sys/fs/cgroup`, or the process's own cgroup under it): `memory.current`, `memory.max`, `memory.peak`; `cpuCores`, the cores used since the previous sample (`cpu.stat` `usage_usec`), against `cpuLimitCores` (`cpu.max`: quota / period); `throttledPct`, the share of the CPU periods throttled since the previous sample; `pids.current`, `pids.max`. A limit of `max` reads `null` (no limit).
- `host`: the server, from `/proc` (the host's, in the container too): `MemAvailable`, `MemTotal`, the swap used (`SwapTotal` − `SwapFree`), the load over 1 and 5 minutes, `cpuPct` its CPU busy since the previous sample (`/proc/stat`, iowait counted idle), and `diskUsedPct` of `/` as `df` counts it (statfs: used / (used + available)).
- `node`: the heap used and V8's limit, the resident and external memory, the event loop's delay p50 and p99 since the previous sample (a timer every 20 ms, its own interval taken off) and its busy share (`loopUtilPct`).
- `live`: the LIVE RELEASES' streams open on this process (§16.23), the releases they follow and the accounts following them (console users included).
- `db`: the app's pool (`poolTotal` connections, `poolIdle`, `poolWaiting`: queries waiting for a connection); this database's connections in `pg_stat_activity`, those running a query (`active`), those waiting on a lock (`waiting`), and the server's `max_connections`. One query per sample; still unanswered after 1 s, that sample's four are `null`, and the next sample sends none while it waits.
- `http`: every response of the app over the last 60 s (since the start, when younger): `rps`, `p95Ms` (from bins about 9 % wide, never under the true value; `null` without a response), the `5xx` sent and the `429` refused.

`at` and `now` are the server's clock. A rate needs two readings: the first sample after a start has `cpuCores`, `throttledPct` and `cpuPct` `null`. Whatever the host cannot give is `null`, never an error: macOS has no cgroup nor `/proc`, PGlite (development, tests, the demo) no pool nor other connections. The same samples raise a running test's peaks (the TEST REPORT's `peaks`: `appMemBytes`, `appCpuCores`, `p95Ms`, `loopDelayP99Ms`, `liveStreams`, `dbConnections`, `poolWaiting`, their maxima while it runs, and `errors5xx`, `refused429`, the responses counted meanwhile). **200**. Errors: `401`, `403 FORBIDDEN`.

---

## 14. Admin: products and lifecycle

### 14.1 `GET /api/admin/products`

AUDITOR. Paginated, newest first, from the `product_overview` view.

| Query | Rules |
|---|---|
| `status` | One of the 12 product statuses. |
| `category` | One letter (case-insensitive). |
| `q` | ≤ 64 characters. Case-insensitive substring of the product id, SKU, model name or genome fingerprint (`%` and `_` match literally). |
| `productionBatch` | ≤ 100 characters, trimmed; empty or blank counts as absent. The production batch recorded at issuance, matched exactly (case-sensitive, not a prefix). Indexed (migration `0007_print_batch_indexes`). |
| `page`, `pageSize` | §6 |

Item:

```json
{
  "id": "07e23b40-0146-4bde-953d-6842d8d3975e",
  "productId": "O26-J-00006",
  "sku": "MNL-RG-SIZE-52",
  "category": "Jewelry",
  "categoryCode": "J",
  "collection": "ORBIT",
  "model": "MONOLITHE",
  "modelVariant": "Steel",
  "modelType": "RING",
  "variant": "Size 52",
  "material": "925 STERLING SILVER",
  "productionBatch": null,
  "productionDate": "2026-01-15",
  "genomeId": "O26-J-00006",
  "genomePattern": "POINT·HALF_ARC_E·SMALL_ORBIT·RING_POINT·ARC_PAIR_NWSE·ARC_PAIR_NS·SMALL_ORBIT·ARC_PAIR_NESW",
  "genomeFingerprint": "G1-3521-B829",
  "codeId": "5dbf5b2c-2bab-4fd1-8177-a07e2eb37f4c",
  "codeVersion": 1,
  "codeIssue": 1,
  "status": "ISSUED",
  "ownershipState": "UNREGISTERED",
  "warrantyStart": null,
  "warrantyEnd": null,
  "createdAt": "2026-10-01T08:15:21.929Z",
  "updatedAt": "2026-10-01T08:15:21.929Z"
}
```

`codeId`, `codeVersion` and `codeIssue` refer to the ACTIVE code and are `null` when there is none. `modelVariant` (plan NEXT LOT §3.1) is the model's label among its variants (`models.variant_label`, read live for the page's rows beside the view), or `null` for a model without one; `variant` stays the piece's own Size field. Errors: `400 VALIDATION_FAILED`.

### 14.2 `POST /api/admin/products` — issue a product

**ADMIN** (the Generator, for one-offs: samples, press pieces, replacements; plan NEXT LOT §3.5.4.5, step 5.13: an OPERATOR gets `403 FORBIDDEN`; the stock's pieces are issued by the receptions, §16.33, and a Generator piece enters Logistics' stock only once ORBES counts it in). In one transaction: allocates the serial, creates the product (ISSUED), its GENOME-01, signs its first code (issue 1) with the ACTIVE key (the signature is verified before it is stored), creates the warranty row (not started) and writes the audit entry. The body is validated strictly by the issuance service. The category and the model are checked before the transaction and read again under a share lock inside it, so a deactivation (§13.2, §13.4) that commits while the piece is prepared still refuses it (`409 CATEGORY_INACTIVE`, `409 MODEL_INACTIVE`).

| Field | Type | Required | Rules |
|---|---|---|---|
| `categoryCode` | string | yes | One letter (case-insensitive). The category must exist and be active. |
| `modelId` | uuid | yes | Must exist, belong to that category and be active (§13.4). |
| `material` | string | yes | 1–200 characters, no control character (C0, DEL, C1) and no U+FFFD, the replacement character a wrong decoding leaves for a lost letter. |
| `year` | integer | no | 2000–2099; default the current UTC year. |
| `collectionId` | uuid | no | Must exist. Without it, the model's collection applies in admin and owner views. |
| `sku` | string | no | ≤ 64 characters: letters, digits, space, `.`, `_`, `-`, `/`, starting with a letter or digit. Default: model SKU prefix + slug of the variant (e.g. `MNL-RG-SIZE-52`). |
| `variant` | string | no | The piece's **size** (the console's field Size since plan NOCTURNE N1, formerly Variant; read back as SIZE on its results), as its SKU names it: 1–100 characters, as `material` (no control character, no U+FFFD). Free text: a value written before (« Size 52 ») is kept and shown as it is. |
| `productionBatch` | string | no | 1–100 characters, as `material` |
| `productionDate` | date | no | `YYYY-MM-DD`, a real date, not after tomorrow (UTC). |
| `serial` | integer | no | 1–999 999. Default: next free serial for (year, category). |
| `withClaimSecret` | boolean | no | Generate a claim code for proof of ownership at first registration. |
| `authPolicy` | string | no | `PRINTED_CODE` (default) or `PRINTED_CODE` joined with `+` to any of `SECURE_NFC`, `SECURE_ELEMENT`, `TAMPER_EVIDENT` (case-insensitive, no duplicates). Hardware authenticators are not implemented: such products verify with `assurance: "CODE_ONLY"`. |

`""` and `null` count as absent for optional fields.

Example request:

```json
{
  "categoryCode": "J",
  "modelId": "73c68b47-012d-4569-a59a-fd2effa613c1",
  "material": "925 STERLING SILVER",
  "variant": "Size 52",
  "productionDate": "2026-01-15",
  "withClaimSecret": true
}
```

**201**:

```json
{
  "product": {
    "id": "07e23b40-0146-4bde-953d-6842d8d3975e",
    "productId": "O26-J-00006",
    "packedIdentity": 873463814,
    "year": 2026,
    "categoryIndex": 1,
    "categoryCode": "J",
    "serial": 6,
    "sku": "MNL-RG-SIZE-52",
    "modelId": "73c68b47-012d-4569-a59a-fd2effa613c1",
    "collectionId": null,
    "variant": "Size 52",
    "material": "925 STERLING SILVER",
    "productionBatch": null,
    "productionDate": "2026-01-15",
    "status": "ISSUED",
    "ownershipState": "UNREGISTERED",
    "authPolicy": "PRINTED_CODE",
    "hasClaimSecret": true,
    "createdAt": "2026-10-01T08:15:21.929Z",
    "updatedAt": "2026-10-01T08:15:21.929Z"
  },
  "genome": {
    "id": "a7f7b2bb-0d1c-4475-8a52-92129d62651d",
    "productId": "O26-J-00006",
    "version": 1,
    "versionLabel": "GENOME-01",
    "value": 891402281,
    "glyphs": [3, 5, 2, 1, 11, 8, 2, 9],
    "ids": ["POINT", "HALF_ARC_E", "SMALL_ORBIT", "RING_POINT", "ARC_PAIR_NWSE", "ARC_PAIR_NS", "SMALL_ORBIT", "ARC_PAIR_NESW"],
    "pattern": "POINT·HALF_ARC_E·SMALL_ORBIT·RING_POINT·ARC_PAIR_NWSE·ARC_PAIR_NS·SMALL_ORBIT·ARC_PAIR_NESW",
    "fingerprint": "G1-3521-B829",
    "createdAt": "2026-10-01T08:15:21.929Z"
  },
  "code": {
    "id": "5dbf5b2c-2bab-4fd1-8177-a07e2eb37f4c",
    "productId": "O26-J-00006",
    "keyId": 1,
    "codeVersion": 1,
    "issue": 1,
    "issuedDay": 1004,
    "issuedAt": "2026-10-01",
    "nonce": "27400549",
    "payloadHash": "620d6fc953c7891babb92119fd0dd69e60f8dfe50d2edcbc252c61b4e6daf097",
    "status": "ACTIVE",
    "revokedAt": null,
    "revocationReason": null,
    "createdAt": "2026-10-01T08:15:21.929Z",
    "data": "EQE0EAAGAQPsJ0AFSSW0CzBn1F09d725vK5T-J6R6xQCLRMK10GBZY6Zdj5JZh_ymwM3gDVKCQw3IR-Ql00_yWy7UndwioDFiN1yQQMIzQ"
  },
  "claimCode": "M8KD-7ZW9-DHHN"
}
```

- `code.data` is the base64url of the 79-byte framed data: exactly what a scanner reads and what `POST /api/v1/verify` takes. Anyone holding it can print a code that verifies, so it is returned only to OPERATOR responses that produce codes (issuance and re-issue), never in read views.
- `claimCode` is present only with `withClaimSecret: true` and is **returned once**: only its scrypt hash is stored. Print it on the certificate card supplied with the piece, in plain sight: `POST /api/admin/certificates` (§15.7) renders that card after checking the code against its hash.
- `code.nonce` and `code.payloadHash` are hexadecimal; `issuedDay` counts days since 2024-01-01 UTC.
- Several pieces that share a template (a production run, a collection in sizes): §14.11 issues up to 50 per request, one result per piece.

Errors: `400 VALIDATION_FAILED`, `404 CATEGORY_NOT_FOUND`, `404 MODEL_NOT_FOUND`, `404 COLLECTION_NOT_FOUND`, `404 REFERENCE_NOT_FOUND`, `409 CATEGORY_INACTIVE`, `409 MODEL_INACTIVE`, `409 SERIAL_TAKEN`, `409 SERIALS_EXHAUSTED`, `409 ISSUANCE_CONFLICT`, `503 NO_ACTIVE_KEY`, `503 SIGNING_UNAVAILABLE`, `503 SIGNING_FAILED`.

### 14.3 `GET /api/admin/products/:productId`

AUDITOR. Full product record. `:productId` is the canonical id or the uuid.

```json
{
  "product": {
    "…": "every field of the issuance response's product object, plus:",
    "category": { "index": 1, "code": "J", "name": "Jewelry" },
    "model": { "id": "73c6…", "name": "MONOLITHE", "type": "RING", "variant": "Steel", "skuPrefix": "MNL-RG", "care": "Polish with a soft dry cloth.", "imageUrl": "/api/v1/media/9f2c4e8a…" },
    "collection": "ORBIT",
    "photoUrl": null
  },
  "genome": { "…": "current genome (highest version), same shape as in the issuance response" },
  "genomes": [ "…all genomes…" ],
  "codes": [
    {
      "id": "5dbf5b2c-2bab-4fd1-8177-a07e2eb37f4c",
      "productId": "O26-J-00006",
      "keyId": 1, "codeVersion": 1, "issue": 1, "issuedDay": 1004, "issuedAt": "2026-10-01",
      "nonce": "27400549", "payloadHash": "620d6fc9…", "status": "ACTIVE",
      "revokedAt": null, "revocationReason": null, "createdAt": "2026-10-01T08:15:21.929Z",
      "verification": { "valid": true, "keyStatus": "ACTIVE" }
    }
  ],
  "scans": { "count": 0, "lastAt": null },
  "ownership": { "current": null, "owners": [], "transfers": [] },
  "warranty": { "…": "warranty record, see §14.6" },
  "services": [],
  "anomalies": [],
  "statusHistory": [
    { "id": "5b57…", "from": null, "to": "ISSUED", "reason": "Product issued", "actorType": "admin", "actorId": "90b8…", "at": "2026-10-01T08:15:21.929Z" },
    { "id": "37f3…", "from": "ISSUED", "to": "ACTIVATED", "reason": "warranty activated", "actorType": "admin", "actorId": "90b8…", "at": "2026-10-01T08:15:21.930Z" }
  ],
  "lifecycle": {
    "status": "ACTIVATED",
    "allowed": ["REGISTERED", "OWNED", "SERVICED", "RESOLD", "RETIRED", "REVOKED", "COUNTERFEIT_FLAGGED", "LOST", "STOLEN"],
    "returnTo": null,
    "canReinstate": false
  },
  "claimCode": {
    "renewable": "SOLD", "refusal": null,
    "order": { "id": "3f9a21c4-…", "reference": "OR-3F9A21C4" },
    "lastRenewalId": "8d2e…", "cardNeeded": false,
    "renewals": [
      { "id": "8d2e…", "at": "2026-10-07T12:02:00.000Z", "by": "jane@orbes.example", "kind": "BUYER", "order": { "id": "3f9a21c4-…", "reference": "OR-3F9A21C4" },
        "status": "WAITING", "readAt": null, "withdrawnAt": null, "withdrawnReason": null, "reason": "Card lost by the buyer." }
    ]
  }
}
```

- `claimCode` (plan NEXT LOT §3.4, §15.10): what **New claim code** may do for the piece. `renewable` is `IN_STOCK` (no buyer: the code is shown once to staff), `SOLD` (its open order `order`: the code waits for that order's buyer) or `null`, with its `refusal`: `REGISTERED`, `NO_CLAIM_CODE` (issued without one, RESERVED included), `NOT_PRINTABLE` (RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN), `NO_ACTIVE_CODE` (its code revoked and not re-issued: re-issue it first) or `SOLD_IN_STORE` (sold outside an order: its warranty started by a sale, the sale mode or by hand, and no order of it returned or cancelled with it since; refused until the owner answers question 8). `lastRenewalId` (the newest row, the dialog's `after`), `cardNeeded` (the piece's current code is an UNSHOWN one, made when a sold piece's order was cancelled: no card registers it), and `renewals`, newest first (DATABASE §5.76; `by` the staff member's email): never a code, sealed or clear. Read by every role that reads the page.
- `codes[].verification` re-verifies each stored code live (payload fields against the row, payload hash, Ed25519 signature, key trust). It is `{ "valid": true, "keyStatus" }` or `{ "valid": false, "reason", "keyStatus" }` with `reason` one of `UNKNOWN_KEY`, `PAYLOAD_INVALID`, `PAYLOAD_MISMATCH`, `PAYLOAD_HASH_MISMATCH`, `SIGNATURE_INVALID`, `KEY_REVOKED`. A row tampered with in the database shows up here as invalid. Read views never include `data`.
- `ownership.current` is `{ "accountId", "acquiredVia", "verified", "since", "transferPending" }` or `null`; `ownership.owners` lists every ownership period with the account's email (masked for an AUDITOR, §16.2) and display name; each account opens its sheet in the console (§16.11); `ownership.transfers` lists every transfer (a pending transfer past its expiry reads `EXPIRED`).
- `anomalies` lists up to 100 anomalies of the product, most severe first (shape and order of §16.4); `services` the service records (§14.8).
- `product.model.variant` (plan NEXT LOT §3.1) is the model's label among its variants (`models.variant_label`, read live), or `null` for a model without one: the product page shows it under the model's name. The piece's own Size field stays `product.variant`.
- `product.photoUrl` is the piece's own photograph (§14.12) and `product.model.imageUrl` its model's reference photograph (§13.4), each `/api/v1/media/<sha256>` or `null`: the product page shows both, for ORBES staff; /verify shows the model's alone (F-04; plan NOCTURNE, decision 9).
- `lifecycle.allowed` lists the statuses `transitions` accepts now; `returnTo` is where a return, recovery or reinstatement would lead; `canReinstate` is true for a REVOKED product whose previous status is known.

Errors: `400 VALIDATION_FAILED`, `404 PRODUCT_NOT_FOUND`.

### 14.4 `POST /api/admin/products/:productId/transitions`

OPERATOR; a transition **to REVOKED or RETIRED requires ADMIN** (403 `FORBIDDEN` "Only an ADMIN can revoke or retire a product." otherwise): both end the product's public validity (it verifies as REVOKED) and RETIRED is terminal.

Body `{ "to": ProductStatus, "reason"?: string | null (≤ 1000) }`.

Allowed transitions (see [DATABASE §7](DATABASE.md#7-product-lifecycle) for the full rules):

| From | To |
|---|---|
| ISSUED | ACTIVATED, SERVICED (pre-sale inspection / quality control), RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| ACTIVATED | REGISTERED, OWNED, SERVICED, RESOLD, RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| REGISTERED | OWNED, TRANSFERRED, SERVICED, RESOLD, RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| OWNED | TRANSFERRED, SERVICED, RESOLD, RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| TRANSFERRED | OWNED, TRANSFERRED, SERVICED, RESOLD, RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| SERVICED | the pre-service status only (ISSUED after a pre-sale inspection); RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| RESOLD | REGISTERED, OWNED, SERVICED, RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST, STOLEN |
| LOST, STOLEN | the previous status only; RETIRED, REVOKED |
| COUNTERFEIT_FLAGGED | the previous status only; REVOKED, RETIRED |
| REVOKED | none (use reinstate) |
| RETIRED | none |

A transition to REVOKED also opens a revocation (§16.6). Transitions change the status only; ownership records are not modified. A product in a **pre-sale** service (ISSUED → SERVICED) was never sold: it is not open for first registration (`409 REGISTRATION_NOT_ALLOWED`) until it returns to ISSUED and is activated.

**200**:

```json
{
  "statusChange": { "id": "729ded0c-…", "productId": "O26-J-00001", "from": "ISSUED", "to": "RETIRED", "reason": "x", "at": "2026-10-01T08:15:21.929Z" },
  "lifecycle": { "status": "RETIRED", "allowed": [], "returnTo": null, "canReinstate": false }
}
```

Errors: `400 VALIDATION_FAILED`, `403 FORBIDDEN`, `404 PRODUCT_NOT_FOUND`, `409 TRANSITION_NOT_ALLOWED`, `409 PREVIOUS_STATUS_UNKNOWN`.

### 14.5 `POST /api/admin/products/:productId/reinstate`

**ADMIN**. Lifts a product revocation: REVOKED → the status held before the revocation. Optional body `{ "reason"?: string | null (≤ 1000) }`. The revocation row is marked lifted.

**200** — same shape as a transition. Errors: `400 VALIDATION_FAILED`, `403 FORBIDDEN`, `404 PRODUCT_NOT_FOUND`, `409 NOT_REVOKED`, `409 PREVIOUS_STATUS_UNKNOWN`.

### 14.6 `POST /api/admin/products/:productId/warranty/activate`

OPERATOR. Starts the warranty at the purchase date for the category's warranty months (end date clamped to the end of the month). An ISSUED product moves to ACTIVATED. Optional body:

| Field | Type | Rules |
|---|---|---|
| `purchaseDate` | date | `YYYY-MM-DD`, a real date, from 2000-01-01 to tomorrow (UTC). Default: today (UTC). |
| `retailerId` | uuid \| null | (A-08) A point of sale of the register (§16.17), active (`404 RETAILER_NOT_FOUND`, `409 RETAILER_INACTIVE`). Its country is the purchase country unless `country` is given. What the console sends. |
| `retailer` | string \| null | ≤ 200 characters. Free text, still accepted for the history and API callers; the console no longer sends it. |
| `country` | string \| null | ISO 3166-1 alpha-2, case-insensitive (stored upper case). Default: the point of sale's country, if any. |

The warranty's `retailer` is the point of sale's current name when `retailerId` is set (a rename shows on every warranty of its sales), the free text otherwise; `retailerId` names the register entry. The audit entry (`warranty.activate`) records both, and `saleScanId` when the activation came from the sale mode (§16.18).

**200**:

```json
{
  "warranty": {
    "productId": "O26-J-00006",
    "purchaseDate": "2026-03-01",
    "retailer": "ORBES PARIS — SAINT-HONORÉ",
    "retailerId": "5d0c3a8e-6b0f-4c51-9a37-2f1d8e4b7c10",
    "country": "FR",
    "startDate": "2026-03-01",
    "endDate": "2028-03-01",
    "durationMonths": 24,
    "voidedAt": null,
    "voidReason": null,
    "status": "ACTIVE",
    "createdAt": "2026-10-01T08:15:21.929Z",
    "updatedAt": "2026-10-01T08:15:21.930Z"
  },
  "statusChange": { "id": "07e2…", "productId": "O26-J-00006", "from": "ISSUED", "to": "ACTIVATED", "reason": "warranty activated", "at": "2026-10-01T08:15:21.930Z" }
}
```

`statusChange` is `null` when the product was not ISSUED. Errors: `400 VALIDATION_FAILED`, `404 PRODUCT_NOT_FOUND`, `404 RETAILER_NOT_FOUND`, `409 RETAILER_INACTIVE`, `409 WARRANTY_ALREADY_ACTIVATED`, `409 WARRANTY_VOID`, `409 WARRANTY_ACTIVATION_NOT_ALLOWED` (status RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST or STOLEN; or SERVICED in a pre-sale service entered from ISSUED: the service is completed or cancelled first, the piece returns to ISSUED, then it is sold. Started during that service, the warranty would run while closing the service brought the piece back to ISSUED, still looking unsold).

### 14.7 `POST /api/admin/products/:productId/warranty/extend` and `…/warranty/void`

**`…/warranty/extend`** (OPERATOR, extension of the contract). Body `{ "months": integer 1–120 }`. Adds whole months to an activated, non-void warranty; the end date is recomputed from the start date (start + total months, clamped to the end of the month) so repeated extensions never drift. The total duration is capped at 600 months. Audited as `warranty.extend` with the previous and new end dates.

**200** `{ "warranty": { …warranty record, "durationMonths": 36, "endDate": "2029-03-01" } }`. Errors: `400 VALIDATION_FAILED` (not an integer, out of range, or the cap), `404 PRODUCT_NOT_FOUND`, `409 WARRANTY_NOT_STARTED`, `409 WARRANTY_VOID`.

**`…/warranty/void`** (OPERATOR). Optional body `{ "reason"?: string | null (≤ 1000) }`. Works before activation too.

**200** `{ "warranty": { …warranty record, "status": "VOID" } }`. Errors: `400 VALIDATION_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 WARRANTY_ALREADY_VOID`.

### 14.8 `POST /api/admin/products/:productId/services`

OPERATOR. Opens a service record and moves the product to SERVICED.

| Field | Type | Required | Rules |
|---|---|---|---|
| `type` | string | yes | `INSPECTION`, `CLEANING`, `POLISH`, `RESIZE`, `REPAIR`, `REPLACEMENT` or `AUTHENTICATION` |
| `location` | string \| null | no | ≤ 200 characters; visible to the owner |
| `notes` | string \| null | no | ≤ 4 000 characters; internal |
| `performedBy` | string \| null | no | ≤ 200 characters; internal. Default: the acting admin (`admin:<uuid>`). |

**201** `{ "service": { "id", "productId", "type", "status": "OPEN", "location", "notes", "openedAt", "closedAt": null, "performedBy" } }`

Errors: `400 VALIDATION_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 TRANSITION_NOT_ALLOWED` (for example a product already SERVICED, RETIRED or REVOKED). An ISSUED product may be serviced before sale (inspection, quality control); completing the record returns it to ISSUED.

### 14.9 `POST /api/admin/services/:id/complete`

OPERATOR. Optional body `{ "notes"?: string | null (≤ 4000) }`, appended to the record's notes. When no other service record of the product is open, the product returns to its pre-service status.

**200** `{ "service": { …, "status": "COMPLETED", "closedAt": … }, "statusChange": { … } | null }`

Errors: `400 VALIDATION_FAILED`, `404 SERVICE_NOT_FOUND`, `409 SERVICE_NOT_OPEN`.

### 14.10 `POST /api/admin/products/:productId/ownership/confirm`

OPERATOR. Client services reviewed a proof of purchase: the current owner becomes verified, and a REGISTERED product becomes OWNED. No body (or `{}`).

**200**:

```json
{
  "ownership": {
    "productId": "O26-J-00007", "accountId": "85168c50-…", "acquiredVia": "FIRST_REGISTRATION",
    "verified": true, "ownershipState": "OWNED", "since": "2026-10-01T08:13:21.929Z",
    "statusChange": { "from": "REGISTERED", "to": "OWNED", "…": "…" }
  }
}
```

Errors: `400 VALIDATION_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 NO_OWNER`, `409 ALREADY_VERIFIED`.

### 14.11 `POST /api/admin/products/batch` — issue a batch (extension of the contract)

**ADMIN**, as §14.2 (plan NEXT LOT step 5.13). Up to **50 pieces that share a template**, one result per piece. Each piece is issued exactly as by §14.2 (`IssuanceService.issueProduct`): its own serial, product, GENOME-01, code signed with the ACTIVE key, warranty row and `product.issue` audit entry, **in its own transaction**. **The pieces that name their `serial` are signed first**, then those whose serial is allocated (the highest + 1), each group in the order given: an allocated serial so never takes a serial that a later piece of the batch names (`[{}, {}, { "serial": 14 }]` with 12 the highest: 14, then 15 and 16). Why 50: requests are limited to 16 KB (§1.2) and each claim code costs one scrypt; the console sends a larger batch as several requests, one after the other (*In the console*, below).

| Field | Type | Required | Rules |
|---|---|---|---|
| `template` | object | yes | What every piece shares: the fields of §14.2 except `variant`, `sku` and `serial`, with the same rules (`categoryCode`, `modelId`, `material` required; `collectionId`, `productionBatch`, `productionDate`, `year`, `authPolicy`, `withClaimSecret` optional; `""` and `null` count as absent). Unknown fields → `400`. |
| `items` | object[] | yes | 1–50 pieces, each `{ variant?, sku?, serial? }` with the rules of §14.2 (`{}` is a piece with an allocated serial and the model's SKU). Unknown fields → `400`. |

**Before anything is signed**, the whole request is refused and nothing is issued when: the body breaks a shape or a bound (`400`, the message names the piece, e.g. `items.2.sku: …`); the template or a piece breaks an issuance rule (`400`, e.g. `template: Material contains invalid characters.`, `items.1: Variant contains invalid characters.`); two pieces name the same `serial` (`400`, `items.2.serial: the same serial as items.0.`); a named serial leaves no serial for the pieces allocated after it, since they come above it (`400`, `items.0.serial: serial 999999 leaves no serial for the 2 pieces allocated after it. Sign it apart, or name their serials.`); or the template's category, model or collection is wrong (`404 CATEGORY_NOT_FOUND`, `404 MODEL_NOT_FOUND`, `404 COLLECTION_NOT_FOUND`, `409 CATEGORY_INACTIVE`, `409 MODEL_INACTIVE` for a model no longer offered (§13.4), `400` for a model of another category or a production date after tomorrow). The console's BATCH tab, like SINGLE PIECE, offers active categories and active models only.

**Then piece by piece.** A piece refused at signing time (its explicit serial taken meanwhile, a concurrent change, the serials of its year and category exhausted) fails **alone**: the other pieces are issued. A piece already signed is **never undone**. A failure that is not the piece's own (`503 NO_ACTIVE_KEY`, `503 SIGNING_UNAVAILABLE`, an unexpected error) stops the batch there: the pieces not yet attempted are `SKIPPED`.

**One batch at a time per admin**: each claim code is one scrypt on the server's small worker pool, which customers' sign-ins and claim-code registrations share (as for certificate cards, §15.7). A second batch sent by the same admin before the first is done answers `429 RATE_LIMITED` (*A batch is already being signed. Wait for it to finish, then try again.*), with nothing signed. The route also draws on the `admin` rate-limit group.

Example request:

```json
{
  "template": {
    "categoryCode": "J",
    "modelId": "73c68b47-012d-4569-a59a-fd2effa613c1",
    "material": "925 STERLING SILVER",
    "productionBatch": "B-2026-10-A",
    "productionDate": "2026-10-01",
    "withClaimSecret": true
  },
  "items": [{ "variant": "Size 52" }, { "variant": "Size 54", "sku": "MNL-RG-54-POLI" }, { "serial": 7 }]
}
```

**200** (`Cache-Control: no-store`), **even when pieces failed**: read each result. One per piece, in the order of `items` whatever the order of signing; `index` is the piece's position in `items` (from 0).

```json
{
  "issued": 2,
  "failed": 1,
  "skipped": 0,
  "items": [
    { "index": 0, "status": "ISSUED", "productId": "O26-J-00012", "codeId": "0b8e3c1e-…", "serial": 12, "sku": "MNL-RG-SIZE-52", "variant": "Size 52", "claimCode": "7KQ2-M4TD-9XWH" },
    { "index": 1, "status": "ISSUED", "productId": "O26-J-00013", "codeId": "5d1f0a77-…", "serial": 13, "sku": "MNL-RG-54-POLI", "variant": "Size 54", "claimCode": "Q3VN-8RJC-2PYE" },
    { "index": 2, "status": "FAILED", "error": { "code": "SERIAL_TAKEN", "message": "This serial number is already used." } }
  ]
}
```

- `ISSUED`: `productId`, `codeId` (the ACTIVE code, issue 1), `serial`, `sku`, `variant` (`null` when none), and `claimCode` with `withClaimSecret: true`, **returned once** as in §14.2 (only its scrypt hash is stored). No scannable `data`: print the batch's codes from the codes registry (§15.9, §15.3) and its certificate cards with §15.7.
- `FAILED`: `error` is the public `{ code, message }` the piece would have got from §14.2 (`409 SERIAL_TAKEN`, `409 SERIALS_EXHAUSTED`, `409 ISSUANCE_CONFLICT`, `409 CATEGORY_INACTIVE` or `409 MODEL_INACTIVE` when the catalogue changed while the batch was signing, `503 NO_ACTIVE_KEY`, `503 SIGNING_UNAVAILABLE`, `503 SIGNING_FAILED`), or `INTERNAL_ERROR` (*This piece could not be issued.*) for an unexpected failure, logged on the server.
- `SKIPPED`: never attempted, because the batch stopped at an earlier piece.

If the answer is lost (a network failure, a timeout), the server may have issued some or all of the pieces: find them in Products by their production batch (§14.1) before signing them again. Their claim codes cannot be shown again.

Audited: `product.issue` for every piece issued (as §14.2), then `product.issue_batch` with `{ count, issued, failed, skipped, productIds, failures: [{ index, code }], category, modelId, productionBatch, claimSecret }` (`target_id` null). **No claim code in either.** The batch's entry is written after its pieces; if it cannot be written, the failure is logged and the results are still returned, since the pieces are already signed and audited and their claim codes exist nowhere else.

**In the console** (Generator → BATCH, `#/generator?mode=batch`): the template, then *Pieces from* a CSV file or a quantity. The CSV holds one row per piece, its first line naming the columns `variant`, `sku` and `serial` (each optional, any order, case-insensitive; no other column); comma or semicolon (the one the first line that is not blank uses most), a byte-order mark and CRLF are accepted, blank lines skipped, at most 1 000 pieces and 1 MB. A first line that names one column holds no delimiter: each line is then one value, so `7,5 ML` stays one variant. The file is read as UTF-8; a file that is not UTF-8 is read as Windows-1252, the encoding of Excel's plain *CSV* (in France *CSV (séparateur : point-virgule)*), and the console says so above the preview, where its accents can be checked. A value that still holds U+FFFD (a letter lost before the file reached the console) is refused on its line. The browser checks the file and every piece with the single form's rules before anything is signed (control characters as the server counts them, C1 included), each problem with its line (*Line 4 · SKU: …*), then shows the plan (*120 pieces · 3 requests of up to 50*) and the first ten rows; a named serial that would leave the allocated pieces none is refused there too. **SIGN 120 PRODUCTS** sends the pieces that name their serial first, as the server signs a request, so an allocated serial never takes one a later request names, in requests one after the other (at most 50 pieces and 15 000 bytes each), and stops at the first request that fails; the result gives every piece its outcome, in the file's order: ISSUED, NOT SIGNED, NOT ATTEMPTED, NOT SENT (an earlier request failed), or NO ANSWER (look in Products before signing again). While the batch's claim codes are on screen, the page offers the **certificate cards** (§15.7, in requests of 50: cards, A4 sheets or the print shop's CSV) and a **results file** (CSV: line, piece, status, productId, sku, variant, serial, codeId, claimCode, message), and *"I have recorded them — hide"*; until one is saved or the codes are hidden, closing the tab (`beforeunload`), navigating in the console or signing out asks first. The codes are held in the page's memory only, as for one product. **A session that ends** (`401`) while the batch is being signed or its codes are on screen does not take the page: the console says the session has ended and keeps it, the pieces already signed and their codes included (a request refused for the session is NOT SIGNED: *the session ended before this request*); the results file, made in the browser, can still be saved, and leaving the page (which asks first) signs in again.

Errors (the whole request; nothing signed): `400 VALIDATION_FAILED`, `401`, `403 FORBIDDEN` (AUDITOR), `403 CSRF_FAILED`, `404 CATEGORY_NOT_FOUND`, `404 MODEL_NOT_FOUND`, `404 COLLECTION_NOT_FOUND`, `409 CATEGORY_INACTIVE`, `409 MODEL_INACTIVE`, `413 PAYLOAD_TOO_LARGE`, `429 RATE_LIMITED` (a batch of the same admin still in progress, or the `admin` group's limit).

### 14.12 `POST` and `DELETE /api/admin/products/:productId/photo` (extension of the contract)

OPERATOR (F-04, phase 2). The **photograph of one piece**, taken when it was issued. Since plan NOCTURNE (decision 9: the model's photograph is the reference for a piece), it is **the console's only**: kept in the records and shown to ORBES staff on the product page (§14.3 `product.photoUrl`), never to a collector (§9.2: no answer a collector receives names it). `:productId` is the canonical id or the uuid.

**`POST`** — the body is the image itself, with the same type, size, metadata and storage rules as a model's reference photograph (§13.4): `image/jpeg` or `image/webp`, at most 1 MiB, still, at most 4 096 px a side, EXIF and XMP removed, stored once by SHA-256. The console no longer offers it at issuance (NOCTURNE N1); its product page keeps *Add a photo of this piece*, then *Replace the photo of this piece*. Audited `product.photo.set` (target the product id) with `{ sha256, mime, width, height, bytes, previous }`; the same photograph again writes nothing; the one it replaced, used by nothing else, is deleted.

```json
{ "productId": "O26-J-00184", "photoUrl": "/api/v1/media/4b7d0c1e…" }
```

**`DELETE`** — removes it: no body (or `{}`); audited `product.photo.remove` with `{ previous }`; removing where there is none writes nothing. **200** `{ "productId": "O26-J-00184", "photoUrl": null }`.

Errors: `400 VALIDATION_FAILED`, `400 IMAGE_INVALID`, `400 IMAGE_ANIMATED`, `404 PRODUCT_NOT_FOUND` (checked after the image), `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`.

---

## 15. Admin: codes and artifacts

The code object in read views has the fields of the issuance response's `code` **without** `data`.

### 15.1 `POST /api/admin/products/:productId/codes/reissue`

OPERATOR. Replaces a damaged or suspect code: the ACTIVE code becomes SUPERSEDED (it verifies as `REVOKED` from now on) and a new code with issue + 1, a fresh nonce and the current ACTIVE key is signed for the same identity and genome.

Body `{ "reason": string (1–500) }` (required).

**201** `{ "code": { …code object…, "issue": 2, "status": "ACTIVE", "data": "…" } }` — `data` is included (§14.2).

Errors: `400 VALIDATION_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 PRODUCT_NOT_REISSUABLE`, `409 NO_CODE`, `409 ISSUES_EXHAUSTED`, `503 NO_ACTIVE_KEY`, `503 SIGNING_UNAVAILABLE`, `503 SIGNING_FAILED`.

### 15.2 `GET /api/admin/codes/:codeId/artifact.:format`

**OPERATOR** (a `GET`, but it produces a printable, verifying code). Renders the ACTIVE code of a printable product as SVG, PNG or PDF. Before rendering, the stored code is re-verified end to end (payload fields, payload hash, genome, key trust, signature); a row that fails is never rendered (`409 CODE_INTEGRITY`). Every download is audited (`code.render`). There is no `HEAD` variant.

`:format` is `svg`, `png` or `pdf`.

| Query | Type | Default | Rules |
|---|---|---|---|
| `widthMm` | number | 30 | Physical width of the code including its quiet zone, 10–500 mm (kept to 0.01 mm). 10 mm is a technical floor; the brand minimum for production prints is 30 mm ([BRAND-DESIGN-SYSTEM §2.6](BRAND-DESIGN-SYSTEM.md#26-minimum-sizes)), and the console warns under 30 mm and refuses under 15 mm unless the file is marked as a test print. |
| `theme` | string | `classic` | `classic` (black on white, the reference colourway), `inverted` (white on black) or `ivory` (ink on ivory), as named in the core (`ORBES_CODE_STYLES`). **Deprecated:** `black` is still accepted as an alias of `classic`; files are named `classic`. |
| `decor` | boolean | `true` | Decorative hairlines (never needed for decoding). `true`/`1`/`false`/`0`. |
| `label` | boolean | `false` | Adds the print label (product id and `ORBES`) under the code. |
| `dpi` | integer | 600 | 72–2400. Validated for every format; used for PNG. A PNG may not exceed 8 000 px on a side or 40 000 000 px in total. |
| `kOnly` | boolean | `false` | PDF only, `classic` and `inverted` only (`400` otherwise): every colour is written as DeviceCMYK with C = M = Y = 0 — ink K 100 %, white no ink, the decor tones as K tints (35 % horizon, 25 % guides). For print shops whose RGB → CMYK conversion would turn the black into a four-colour rich black that misregisters at small sizes. See the limitations below. |

Example:

```
GET /api/admin/codes/5dbf5b2c-2bab-4fd1-8177-a07e2eb37f4c/artifact.png?widthMm=25&theme=ivory&label=true&dpi=1200
```

Response headers:

```
Content-Type: image/png
Content-Disposition: attachment; filename="ORBES-O26-J-00006-I1-ivory-25mm-label-1200dpi.png"
Cache-Control: no-store
```

| Format | `Content-Type` | Body |
|---|---|---|
| `svg` | `image/svg+xml; charset=utf-8` | SVG document, served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox` so it never runs as a document on this origin. |
| `png` | `image/png` | Rasterised at `dpi`. |
| `pdf` | `application/pdf` | Vector PDF. |

File name: `ORBES-<productId>-I<issue>-<theme>-<widthMm>mm[-label][-<dpi>dpi][-K].<format>` (the dpi part for PNG only, `-K` for K-only PDFs).

**K-only black: limitations.** The file carries no ICC profile or output intent (it is not PDF/X): ask the print shop to print it as is, without colour conversion. K 100 % alone is a dense dark grey rather than a deep black on uncoated stock (no rich black, by design). The decor tones become halftone screens, which may look dotted at small sizes; they are decorative and never read by the decoder. Overprint is not set. Ivory has no K-only rendition (its paper colour is not neutral): print the ivory colourway on ivory stock in K-only `classic` instead.

Errors: `400 VALIDATION_FAILED` (format, query values, size limits), `403 FORBIDDEN` (AUDITOR), `404 CODE_NOT_FOUND`, `409 CODE_NOT_ACTIVE` (*Only the active code of a product can be rendered: issue 1 of O26-J-00184 is SUPERSEDED.*), `409 PRODUCT_NOT_PRINTABLE` (*Codes of O26-J-00184 cannot be printed in its current state (STOLEN).*), `409 CODE_INTEGRITY` (*Issue 1 of O26-J-00184 failed its integrity check and cannot be rendered.*; what failed stays in the server log). Each refusal names the piece, so a print sheet (§15.3) says which code to leave out.

### 15.3 `POST /api/admin/codes/print-sheet` (extension of the contract)

OPERATOR. One PDF with many labelled codes, crop marks, a 10 mm scale bar and a footer, for batch production. A `POST` because it carries a list (so it is CSRF-protected). Audited (`code.render_sheet`).

| Field | Type | Required | Default | Rules |
|---|---|---|---|---|
| `codeIds` | uuid[] | yes | — | 1–200 code ids (duplicates are removed). Each must be the ACTIVE code of a printable product and pass the integrity check. |
| `widthMm` | number | no | 25 | 10–500 mm; the code must fit the page. The console sends 30 mm (the brand minimum) by default. |
| `theme` | string | no | `classic` | `classic`, `inverted`, `ivory` (`black` = deprecated alias of `classic`) |
| `decor` | boolean | no | `true` | |
| `label` | boolean | no | `true` | Labels stay on by default so cut pieces remain identifiable. |
| `kOnly` | boolean | no | `false` | K-only black, as in §15.2 (`classic` and `inverted` only). |
| `page` | string | no | `A4` | `A4`, `A3` or `LETTER` |
| `cropMarks` | boolean | no | `true` | |

**200** — `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="ORBES-sheet-<YYYY-MM-DD>-<count>-<theme>-<widthMm>mm[-K].pdf"`, `Cache-Control: no-store`.

**Layout.** Codes are placed in the order of `codeIds` (duplicates removed, first occurrence kept), row by row from the top-left corner of each page, in a grid centred horizontally inside 12 mm margins with 8 mm gutters, above a 10 mm footer. The grid comes from `planPrintSheet` (`genome/src/server/render/artifact.ts`) and the core's `layoutSheet` (`genome/src/core/render/sheet-layout.ts`); the manifest (§15.8) and the console's preview use the same functions, so the three always agree. With the console's default (30 mm, labelled), an A4 page holds 30 codes (5 × 6): a batch of 120 prints on 4 pages.

In the console, the codes list (CODES) lets an OPERATOR select printable codes (`printable`, §15.5), page after page (the selection is kept while the filters stay the same), or every printable code of the filters at once (*Select the 120 codes of this batch*, §15.9). A selected code that can no longer be printed (revoked since it was picked, its piece lost, stolen, retired…) leaves the selection as soon as the list shows it, or the batch of the filters (§15.9, when complete) no longer lists it, and the panel says how many left; a refused part names the piece (`CODE_NOT_ACTIVE`, `PRODUCT_NOT_PRINTABLE`, `CODE_INTEGRITY`) and the panel says how to leave it out. Before rendering it shows the layout (*30 per A4 · 4 pages*). Over 200 codes, it requests the sheet in parts of 200 and saves each as `…-part-<n>-of-<total>.pdf`; *Download manifest* saves the matching CSV parts. Printing a batch from its filtered list takes two clicks: select the batch, download the sheet.

Errors: `400 VALIDATION_FAILED` (including "The artifact is too large for this page size."), `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 CODE_NOT_FOUND`, `409 CODE_NOT_ACTIVE`, `409 PRODUCT_NOT_PRINTABLE`, `409 CODE_INTEGRITY`.

### 15.4 `POST /api/admin/codes/:codeId/revoke`

**ADMIN**. Marks a code REVOKED (it verifies as `REVOKED`; the product keeps its identity and can receive a new code by re-issue) and opens a revocation with reason code `CODE_REVOKED`, in one transaction with its audit entry (`code.revoke`; `IssuanceService.revokeCode`). Body `{ "reason": string (1–500) }`.

**200** `{ "code": { …code object…, "status": "REVOKED", "revokedAt": …, "revocationReason": "leaked artwork" } }`

Errors: `400 VALIDATION_FAILED`, `404 CODE_NOT_FOUND`, `409 CODE_ALREADY_REVOKED`.

### 15.5 `GET /api/admin/codes`

AUDITOR. Paginated list of codes, newest first (`createdAt`); read view (no `data`). Filters (all optional, combined with AND; an empty or blank value counts as absent):

| Query | Rules |
|---|---|
| `productionBatch` | ≤ 100 characters, trimmed. The product's production batch, matched exactly. |
| `modelId` | uuid. The product's model. |
| `status` | `ACTIVE`, `SUPERSEDED` or `REVOKED` (the code's status). |
| `issuedFrom` | `YYYY-MM-DD`. Codes issued on or after this UTC day (`createdAt`; the day is the item's `issuedAt`). |
| `issuedTo` | `YYYY-MM-DD`. Codes issued on or before this UTC day (the whole day is included). Not before `issuedFrom`. |
| `page`, `pageSize` | §6 |

Days run from 0001-01-01 to 9999-12-31 (PostgreSQL has no year 0000; `issuedTo=9999-12-31` holds every code). Each item is the code object with **`printable`** (boolean): the code is ACTIVE and its product may still be printed (not RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST or STOLEN), so a print sheet accepts it (§15.3, the codes §15.9 selects); the console offers a sheet's tick box for those only.

The batch and the issue days are indexed (migration `0007_print_batch_indexes`). Errors: `400 VALIDATION_FAILED` (a malformed value, a year 0000, `issuedFrom` after `issuedTo`).

```
GET /api/admin/codes?productionBatch=B-2026-09-A&status=ACTIVE&issuedFrom=2026-09-01&issuedTo=2026-09-30
```

### 15.6 `GET /api/admin/genomes`

AUDITOR. Paginated list of genomes, newest first. Item: `{ "id", "productId", "version", "versionLabel": "GENOME-01", "value", "glyphs", "ids", "pattern", "fingerprint", "createdAt" }`.

### 15.7 `POST /api/admin/certificates` (extension of the contract)

**OPERATOR** (never AUDITOR: the response holds claim codes). Renders the **certificate card** delivered in the box with a piece: the card **79t**, *MINT CERTIFICATE*, validated by the owner on 2026-10-07, 95 × 62 mm on **one side** (the back is blank) ([BRAND-DESIGN-SYSTEM §7](BRAND-DESIGN-SYSTEM.md#7-artifact-specimens)). It carries, in plain sight, the piece's **ORBES CODE** (its ACTIVE code, with its GENOME glyphs) and its one-time **claim code**, with no scratch-off panel (owner, 2026-10-07): whoever holds the card can register the piece. Around them: ORBES, the serial, the GENOME row and fingerprint, the piece's three lines (`<model> · <type>`, the variant line `BLUE  ·  SIZE 17`, the material), the brand's monogram in guilloche with the year of the piece's identity, the three steps *1 SCAN THE ORBES CODE · 2 ENTER THE CLAIM CODE · 3 THE PIECE IS REGISTERED TO YOU*, *CLAIM CODE · KEEP IT PRIVATE*, and *VERIFY ONLY AT VERIFY.THEORBES.COM*. The variant line reads the model's variant label and the piece's Size field: `BLUE  ·  SIZE 17`, `BLUE` alone, `SIZE 17` alone (a size already written with its word, or ONE SIZE, as written), or no line, the material then moving up. Also the same data, except the ORBES CODE and the GENOME, as a CSV for a print shop's variable-data run.

The claim code is shown once at issuance (§14.2) and only its scrypt hash is stored, so the console sends it back here. A `POST` because the codes travel in the body, never in a URL (CSRF-protected). Before anything is drawn, **every code is checked against its product's hash**: a card printed with a mistyped code would lock the buyer out of registration for good. The codes are never stored, logged, audited or repeated in an error.

| Field | Type | Required | Default | Rules |
|---|---|---|---|---|
| `items` | `{ productId, claimCode }[]` | yes | — | 1–50 items, one per product (a product listed twice is `400`). `productId`: canonical id or row UUID. `claimCode`: at most 32 characters, any spelling accepted at registration (case, spaces and hyphens are ignored; I and L read as 1, O as 0). |
| `format` | string | no | `pdf` | `pdf` or `csv` |
| `layout` | string | no | `card` | PDF only. `card`: one 95 × 62 mm page per card. `sheet`: A4 sheets of eight cards (2 × 4, abutting, 10 mm left and right and 24.5 mm top and bottom margins) with cut marks outside the grid on every cut line, and a caption with a 10 mm scale bar centred at 284 mm (50 cards: 7 sheets). |

Checks, in this order (nothing is rendered when one fails): every product exists (`404 PRODUCT_NOT_FOUND`, naming it); every product was issued with a claim code (`422 NO_CLAIM_SECRET`); none is RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST or STOLEN (`409 PRODUCT_NOT_PRINTABLE`); every product has an ACTIVE code for the card to draw (`409 NO_ACTIVE_CODE`, *No active code for O26-J-00184: re-issue its code on the product page first.*: its code was revoked with no new one, §15.4; re-issue it, §15.1); every ACTIVE code passes its end-to-end check, as for every other print of a code (payload fields, payload hash, genome, a trusted key, the signature; §15.2): a code under a key revoked with a compromise date before it was recorded, or a tampered row, is never put on a card (`409 CODE_INTEGRITY`, *Issue 1 of O26-J-00184 failed its integrity check and cannot be rendered.*; what failed stays in the server log); none has an owner, whose registration has spent the code (`409 ALREADY_REGISTERED`); every claim code matches its product's hash (`422 CLAIM_CODE_MISMATCH`, naming the product, never the code). A malformed code is a mismatch. Mismatches are not counted towards the customers' claim-code attempt limit (§11.1): the route needs an OPERATOR session (with TOTP in production) and every refusal is audited.

**Cost.** Each check is one scrypt (32 MiB) on the server's small worker pool, which customers' logins and claim-code registrations share. The codes are checked one at a time, in the order given, and the checks stop at the first code that does not match: the refusal names that product only, and the codes after it are not checked. Each admin has at most one certificate request in progress: a second one sent before the first is done answers `429 RATE_LIMITED` (*A certificate download is already being prepared. Wait for it to finish, then try again.*), and is not audited. The route also draws on the `admin` rate-limit group.

**200**, `Cache-Control: no-store`, as an attachment:

| `format` / `layout` | `Content-Type` | File name |
|---|---|---|
| `pdf` / `card`, one item | `application/pdf` | `ORBES-certificate-<productId>[-PROOF].pdf` |
| `pdf` / `card`, several | `application/pdf` | `ORBES-certificates-<YYYY-MM-DD>-<count>-card[-PROOF].pdf` |
| `pdf` / `sheet` | `application/pdf` | `ORBES-certificates-<YYYY-MM-DD>-<count>-sheet[-PROOF].pdf` |
| `csv` | `text/csv; charset=utf-8; header=present` | `ORBES-certificates-<YYYY-MM-DD>-<count>[-PROOF].csv` |

**The PDF** is pure vector and embeds no font: the type (Gravesend Sans 500, Helvetica Neue Light and Regular) is drawn as glyph outlines, the ORBES CODE, the GENOME and the monogram are paths, so the claim code is never text that could be searched or copied out of the file. It is **K only** (DeviceCMYK, as `kOnly`, §15.2): the guilloche's two warm greys print as the K tints of the same lightness (ground K 5.9, waves K 29.8), the code's decor keeps its tints, the stock is never inked, and there is **no spot colour**: one file the agent's office or digital printer prints as it is. Every position is the validated layout's (`CARD_79T`, `genome/src/server/render/certificate.ts`). `CERTIFICATE_LAYOUT_STATUS` is `VALIDATED`, so no card, caption or file name says PROOF; were it ever `PROOF` (a future layout), each card would say **PROOF · LAYOUT NOT VALIDATED** in its top rule, in MINT CERTIFICATE's place, and the sheet caption, the document title and the file names (the CSV's too) would say PROOF.

**The CSV** (RFC 4180, UTF-8 without BOM, CRLF, a header row, every field quoted) has the columns `productId`, `model` (`<name> · <type>`), `variant` (the variant line as printed, empty when the card has none), `material`, `year` (the year of the piece's identity, as printed) and `code` (`XXXX-XXXX-XXXX`), values as recorded. A value starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with an apostrophe, so opening the file in a spreadsheet never runs a formula. The ORBES CODE and the GENOME row are not in the CSV (a print shop cannot typeset them), so a print shop cannot make the card from the CSV alone: the PDF remains the reference.

Example:

```json
{ "items": [{ "productId": "O26-J-00184", "claimCode": "7KQ2-M4TD-9XWH" }], "format": "pdf", "layout": "card" }
```

Audited: `certificate.render` with `{ productIds, count, format, layout, layoutStatus, codeIssues }` (`codeIssues`: the issue of the ORBES CODE printed for each product, in `productIds` order, so the log says which code went into which box); each refusal after validation as `certificate.render_refused` with `{ reason, productIds, refused, format, layout }` (`refused`: the product ids concerned). Both carry canonical product ids, also for a product the request named by its uuid; only a product that was not found keeps the reference given. No claim code in either.

In the console, the generator's result screen offers **Download certificate card** while the one-time claim code is shown; the button goes with *Copy* when the operator hides the code. A batch's result (§14.11) offers the cards of all its pieces (*Cards, one per page* · *Sheets of eight cards* · *CSV for the print shop*), sent one request after the other: by 50, or by 48 for sheets (six full sheets of eight), so only the batch's last file can end on a part-filled sheet.

Errors: `400 VALIDATION_FAILED` (shape, bounds, a product listed twice), `401`, `403 FORBIDDEN` (AUDITOR), `403 CSRF_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 PRODUCT_NOT_PRINTABLE`, `409 NO_ACTIVE_CODE`, `409 CODE_INTEGRITY`, `409 ALREADY_REGISTERED`, `422 NO_CLAIM_SECRET`, `422 CLAIM_CODE_MISMATCH`, `429 RATE_LIMITED` (a request of the same admin still in progress, or the `admin` group's limit).

### 15.8 `POST /api/admin/codes/print-sheet/manifest` (extension of the contract)

OPERATOR. The **manifest** of a print sheet: a CSV that tells the workshop which label goes on which piece, so that the label of a ring in size 52 never goes on a size 54. Same body as §15.3 (`codeIds` and the sheet options; the options that change the layout are `widthMm`, `label` and `page`), the same checks in the same order (every code exists, is ACTIVE, belongs to a printable product and passes the integrity check, with the same errors), and the same plan as the PDF (`planPrintSheet`): its rows are in the exact order in which the PDF made from the same request draws the codes. Nothing is rendered. Audited (`code.sheet_manifest`, with the same details as `code.render_sheet`: `codeIds`, `productIds` and the options). No scannable data and no claim code: the manifest is safe to send to a print shop.

**200**, `Cache-Control: no-store`, `Content-Type: text/csv; charset=utf-8; header=present`, `Content-Disposition: attachment; filename="ORBES-sheet-<YYYY-MM-DD>-<count>-<theme>-<widthMm>mm[-K]-manifest.csv"` (the sheet's name with `-manifest.csv`).

The CSV is written as the certificate CSV (§15.7: RFC 4180, UTF-8 without BOM, CRLF, a header row, every field quoted, formulas neutralised with a leading apostrophe). Columns:

| Column | Value |
|---|---|
| `page` | Page of the PDF, from 1. |
| `row` | Row on that page, from 1 (top). |
| `column` | Column on that page, from 1 (left). |
| `productId` | Canonical product id, also printed on the label. |
| `sku` | The product's SKU. |
| `variant` | The product's variant (size, colour…), empty when none. |
| `material` | The product's material. |
| `codeId` | The code's id. |

Example (30 mm, labelled, A4: 5 columns × 6 rows):

```
"page","row","column","productId","sku","variant","material","codeId"
"1","1","1","O26-J-00184","MNL-RG-SIZE-52","Size 52","925 STERLING SILVER","5dbf5b2c-2bab-4fd1-8177-a07e2eb37f4c"
"1","1","2","O26-J-00185","MNL-RG-SIZE-54","Size 54","925 STERLING SILVER","8a0e6f3d-41c2-4f7e-9d55-0c3b2a7e1f90"
```

Errors: as §15.3.

### 15.9 `GET /api/admin/codes/ids` (extension of the contract)

AUDITOR (a read: the ids are those of the codes list). The ids of the **printable** codes among those the filters of §15.5 select (`productionBatch`, `modelId`, `status`, `issuedFrom`, `issuedTo`; `page` and `pageSize` do not apply): ACTIVE codes of products that may still be printed (not RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST or STOLEN), the ones a print sheet accepts. In identity order (year, category, serial), at most **1 000**. The console uses it for *Select the N codes of this batch*.

**200**

```json
{ "ids": ["5dbf5b2c-2bab-4fd1-8177-a07e2eb37f4c", "…"], "total": 120, "truncated": false }
```

`total` counts every printable code of the filters; `truncated` is `true` when it exceeds 1 000, in which case `ids` holds the first 1 000 (narrow the filters, by issue days for instance, to reach the others). A `status` other than `ACTIVE` gives an empty list. Not audited (a read).

Errors: `400 VALIDATION_FAILED` (as §15.5).

---

### 15.10 `POST /api/admin/products/:productId/claim-code` — New claim code (extension of the contract)

OPERATOR (ADMIN too; never RETAIL, AUDITOR, nor the LOGISTICS role of H2), CSRF and same origin, **`Cache-Control: no-store`**. Plan NEXT LOT of 2026-10-07, §3.4 (`routes/admin/products.ts`, `ClaimRenewalService.renew` in `services/claim-renewals.ts`; DATABASE §5.76). A new claim code for a piece **not registered yet** whose card was lost: the old code stops working at once (a new scrypt hash in `products.claim_secret_hash`; a registration under way gets `409 REGISTRATION_CONFLICT`).

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | yes | 1–500 characters once trimmed. Kept on the row and in the audit log. |
| `expect` | string | yes | `IN_STOCK`, `SOLD` or `SOLD_IN_STORE`: the situation the dialog showed (§14.3 `claimCode.renewable`). |
| `after` | uuid \| null | yes | The newest new claim code the dialog saw (`claimCode.lastRenewalId`), `null` for none. |

**201**: for a piece **in stock** (`IN_STOCK`, no buyer), `{ "claimCode": "ABCD-EFGH-JKMN", "renewal": { … } }`: the code shown once, with its certificate card to print (§15.7, one per page); for a **sold** piece (`SOLD`, its open order), `{ "renewal": { … } }` only: the code is sealed for the order's buyer, who reads it once in YOUR ORDERS (§10.20), and never reaches the console. `renewal` is a row of §14.3's `renewals`. A code still waiting for the buyer is withdrawn (`RENEWED_AGAIN`): only the latest ever shows.

Refusals, in this order: `404 PRODUCT_NOT_FOUND`; `409 ALREADY_REGISTERED`; `422 NO_CLAIM_SECRET` (issued without a claim code, RESERVED included); `409 PRODUCT_NOT_PRINTABLE`; `409 NO_ACTIVE_CODE` (*This piece has no active code: re-issue its code first, then make a new claim code.*); `409 CLAIM_CODE_SOLD_IN_STORE` (sold outside an order: question 8, answer (b) until the owner answers); then `409 CLAIM_CODE_SITUATION_CHANGED` when the situation is not `expect` or a newer code than `after` exists (sold, registered or given a new code meanwhile: a code meant for a buyer is never shown to staff).

Audited `claim_code.renew` (`{ renewalId, for, orderId?, accountId?, reason, replacedRenewalId? }`) and, for a code it replaced, `claim_code.withdraw`; never the code. A cancellation of the order later replaces a buyer's code, read or not, by one nobody sees (`claim_code.withdraw`, an UNSHOWN row; the product page's `cardNeeded`), a return withdraws a waiting one, a registration likewise.

Errors: `400 VALIDATION_FAILED`, `401`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 ALREADY_REGISTERED`, `409 PRODUCT_NOT_PRINTABLE`, `409 NO_ACTIVE_CODE`, `409 CLAIM_CODE_SOLD_IN_STORE`, `409 CLAIM_CODE_SITUATION_CHANGED`, `422 NO_CLAIM_SECRET`, `429 RATE_LIMITED`.

## 16. Admin: registries, anomalies, revocations and cases

These are the only places where internal verification facts (reasons, risk scores, authenticator results) leave the database, and only to an admin session. The same holds for customers' reports on their scans (§8.5): the scans, the anomalies and the Cases queue (§16.8) show them.

### 16.1 `GET /api/admin/scans`

AUDITOR. Paginated scan events with their authentication record, newest first.

| Query | Rules |
|---|---|
| `productId` | Canonical id or uuid. An unknown product gives an empty page. |
| `state` | One of the 9 verification states. |
| `scanId` | One scan (uuid): a case's link to its scan (§16.8). |
| `from`, `to` | The window the scans were made in, both ends included (extension): an ISO 8601 date-time with its zone (`2026-10-01T08:15:21.929Z`, `2026-10-01T10:15:21+02:00`), or a UTC day `YYYY-MM-DD`, which stands for its first millisecond as `from` and its last as `to`. Either may be given alone; `from` after `to` is `400 VALIDATION_FAILED`, and so is a time without a zone or a bound outside `0001-01-01` to `9999-12-31` (UTC): `9999-12-31T23:00:00-05:00` is already year 10000. The console opens an anomaly's window (§16.15) and its triggering scan (the second it was made in, the scan marked) this way. |

An empty value (`?state=&from=`) means the filter is not given, as a filter form sends it.

Item:

```json
{
  "id": "3832bf94-7424-45f4-a00f-8dc418714edf",
  "occurredAt": "2026-10-01T08:15:21.929Z",
  "eventType": "VERIFY",
  "state": "MALFORMED_CODE",
  "productId": null,
  "codeId": null,
  "packedIdentity": null,
  "accountId": null,
  "adminEmail": null,
  "deviceHash": "ZoczF36EXHiXIA5PySPFEVXU9dp3DtIwls2sk71UW-I",
  "country": null,
  "region": null,
  "lat": null,
  "lon": null,
  "userAgentFamily": "Safari/iOS",
  "clientMetrics": null,
  "latencyMs": 3,
  "authentication": {
    "signatureValid": false,
    "genomeCheck": "NOT_PROVIDED",
    "keyId": null,
    "reasons": ["MALFORMED:CRC"],
    "riskScore": 0,
    "authenticators": { "policy": null, "results": [] }
  },
  "report": {
    "id": "8f0b2c4e-…",
    "channel": "ONLINE",
    "place": "a marketplace listing",
    "note": "Offered at a third of the boutique price.",
    "status": "OPEN",
    "createdAt": "2026-10-01T08:17:02.114Z"
  }
}
```

`report` is the customer's report on the scan (§8.5) and the state of its case, or `null`. `productId` is the canonical id; `deviceHash` is a pseudonym (HMAC), never a raw id; the IP pseudonym is not returned. `eventType` is `VERIFY` for a public scan and `ADMIN_TEST` for a staff scan (the sale mode, §16.18, or `/api/v1/verify` from a browser signed in to the console, §9.7), whose `adminEmail` names the console user who scanned (read at display time; the row keeps `scan_events.admin_id`); `adminEmail` is `null` on every other scan. `genomeCheck` is `MATCH`, `MISMATCH`, `NOT_PROVIDED` or `INCONCLUSIVE`. `reasons` lists machine reasons such as `MALFORMED:<CRC|LENGTH|VERSION|RANGE|RESERVED|ENCODING|INPUT>`, `UNKNOWN_KEY`, `BAD_SIGNATURE`, `PRODUCT_NOT_REGISTERED`, `CODE_NOT_REGISTERED`, `CODE_MISMATCH`, `KEY_REVOKED`, `GENOME_MISMATCH`, `CODE_SUPERSEDED`, `CODE_REVOKED`, `UNSUPPORTED_GENOME_VERSION`, `UNSUPPORTED_CODE_VERSION`, `PRODUCT_<STATUS>`, `ANOMALY:<TYPE>`, `RISK_THRESHOLD`, `RISK_THRESHOLD_OWNER`, `REGISTRATION_WITH_CLAIM_CODE` (a registration token was issued on a suspicious scan, §9.4 step 10), `TRANSFER_WITH_TRANSFER_CODE` (a transfer token was issued on a suspicious scan, §9.4 step 10, F-03). The console's Verification events lists them under the result, humanized (`MALFORMED:CRC`, `RISK THRESHOLD`), an `ANOMALY:<TYPE>` under the anomaly's console name (§16.4): `ANOMALY:UNSOLD_PIECE_SCAN` reads **ANOMALY: UNSOLD PIECE SCANNED** (§9.7).

### 16.2 `GET /api/admin/owners`

AUDITOR. Paginated customer accounts, newest first: `{ "id", "email", "displayName", "country", "status", "createdAt", "products" (currently owned), "productsEver", "transfersPausedUntil", "recoveryCodeExpiresAt", "recoveryCodeThrottledUntil" }`. `status` is `ACTIVE`, `LOCKED` (§16.12) or `DELETED`. `transfersPausedUntil` is the end of the 72-hour transfer pause after an assisted recovery (§10.8) while it lasts, else `null`; `recoveryCodeExpiresAt` the expiry of the open recovery code (§16.10) while it can still be used, else `null`; `recoveryCodeThrottledUntil`, after 5 wrong guesses at that open code within an hour, the time until which it is refused without being checked (§10.8, attempt limit), else `null`: the code is spent, and Client Services issues a new one, which starts with the whole budget. The code itself is never listed. The routes of the owners live in `routes/admin/owners.ts`, their service in `services/owners.ts` (A-06).

**Emails.** OPERATOR and ADMIN read customers' emails in clear. An **AUDITOR reads them masked**: the first character of the local part, `***`, then the domain (`jane@example.com` → `j***@example.com`), here, in the searches below, on the owner's sheet (§16.11) and in a product's ownership history (§14.3).

**Search** (one of the two, or neither; both → `400 VALIDATION_FAILED`):

| Query | Rules |
|---|---|
| `email` | One account by its **exact** email, trimmed and in any case, as at sign-in (§10.2): 0 or 1 item. A partial address answers `400 VALIDATION_FAILED` (*Enter the whole email address of the account.*): there is no prefix or substring search. |
| `ref` | The REF the verify app prints under every result (`REF 1A2B3C4D`: the first 8 hexadecimal characters of the scan's id), with or without the word REF, in any case, or a whole scan id. Anything else → `400 VALIDATION_FAILED`. |

A `ref` search adds `scans`: the verification events the REF names (at most 20, newest first; 8 characters are 32 bits, so more than one is rare), each with the piece, the account signed in when it scanned (`scannedBy`, or `null`) and the piece's current owner (`ownerId`, or `null`). `items` are then those accounts:

```json
{
  "items": [ { "id": "6d1c…", "email": "ada@example.com", "status": "ACTIVE", "…": "…" } ],
  "page": 1, "pageSize": 50, "total": 1,
  "scans": [
    { "scanId": "1a2b3c4d-…", "reference": "1A2B3C4D", "occurredAt": "2026-10-02T09:15:21.929Z", "eventType": "VERIFY",
      "state": "SUSPICIOUS_ACTIVITY", "productId": "O26-J-00184", "scannedBy": null, "ownerId": "6d1c…" }
  ]
}
```

Query strings never reach a log: the app logs paths only, and Caddy's access log drops the query ([DEPLOYMENT](DEPLOYMENT.md), logging).

In the console: Owners has one search field, *Email or REF* (an `@` makes it an email); a REF lists its scans under *Reference*, each linked to its verification event, its piece, who scanned it and the owner of the piece, then the *Accounts*. Each account opens its sheet (§16.11).

### 16.3 `GET /api/admin/warranties`

AUDITOR. Paginated warranty records (shape of §14.6), newest first. Query `status`: `NOT_STARTED`, `ACTIVE`, `EXPIRED` or `VOID` (computed at today's UTC date). `retailer` is the point of sale's name from the register when `retailerId` is set, the free text of older records otherwise.

### 16.4 `GET /api/admin/anomalies`

AUDITOR. Paginated, the most severe first.

| Query | Rules |
|---|---|
| `status` | `OPEN`, `ACKNOWLEDGED`, `RESOLVED` or `DISMISSED`. |
| `severity` | `LOW`, `MEDIUM`, `HIGH` or `CRITICAL`. |
| `type` | One of the types below (extension). The list is `ANOMALY_TYPES`, derived from the weights table of `anomaly-rules.ts`: a type added there is accepted here, listed by §16.14 and offered by the console's Type filter without further change, under its console name (`UNSOLD_PIECE_SCAN` reads UNSOLD PIECE SCANNED there, in the list, the detail, the decision dialog, the Cases queue, the product page's Finding column, and among a scan's reasons in Verification events as ANOMALY: UNSOLD PIECE SCANNED, §16.1). Anything else, lower case included, is `400 VALIDATION_FAILED`. |
| `productId` | Canonical id (any case) or uuid (extension). An unknown product gives an empty page. |
| `sort` | `severity` (default): CRITICAL, HIGH, MEDIUM, LOW, then the highest `riskScore` within a severity. `risk`: the highest `riskScore` first, then the most severe. `lastSeen`: the most recently seen first (the order before 2026-10-02). Ties end on the most recently seen, then the id, so pages never overlap (extension). |
| `id` | One anomaly (uuid): a case's link to the anomaly its scan took part in (§16.8; extension). |

An empty value (`?type=&sort=`) means the filter is not given. The console keeps every filter and the order in the view's URL (`#/anomalies?productId=O26-J-00003&type=IMPOSSIBLE_TRAVEL&sort=risk`), a finding's detail in `id` and the one finding a case links to in `finding` (the list narrowed to it, with *Show all*); a product page's TRIAGE link opens the list filtered by that product. Its Product field takes a full id or a uuid only: anything else is said on the field (*Enter a full product id (O26-J-00184).*) and the URL does not change. Filters the server refuses (a URL typed by hand) keep the filter form on screen with the refusal and *Clear filters*, instead of a failed page. The decision dialog (§16.5) wears the destructive marks, the oxblood rule and a danger confirm, while its boxes revoke the code or flag the piece COUNTERFEIT; while its steps run, Confirm stays disabled whatever is typed, and a second submission is ignored.

```json
{
  "id": "1dd3573b-6a3d-4412-8847-7f73ec4bd474",
  "productId": "O26-J-00003",
  "productUuid": "cf12980a-a6e3-4b37-b09d-ca1d5d4f41ca",
  "codeId": "c7dda4b5-17e1-4d47-9170-d49fb72f819c",
  "type": "IMPOSSIBLE_TRAVEL",
  "severity": "HIGH",
  "riskScore": 60,
  "details": { "basis": "country", "fromCountry": "JP", "toCountry": "US", "distanceKm": 6451, "minutes": 1,
               "speedKmh": 387073, "violations": 2, "weight": 60, "decay": 1, "scanEventId": "b9f87d9b-…" },
  "status": "OPEN",
  "occurrences": 2,
  "firstSeenAt": "2026-10-01T08:14:21.929Z",
  "lastSeenAt": "2026-10-01T08:15:21.929Z",
  "resolvedBy": null,
  "resolvedAt": null,
  "resolutionNote": null,
  "actorEmail": null,
  "reports": { "count": 1, "open": 1, "latest": { "id": "8f0b2c4e-…", "channel": "ONLINE", "place": "a marketplace listing", "note": "…", "status": "OPEN", "createdAt": "…" } }
}
```

`resolvedBy` (`admin:<id>`) and `resolvedAt` are set when a finding is RESOLVED or DISMISSED. `actorEmail` names the console user whose triage decision (§16.5) is the latest on the finding, whatever it was (acknowledged, resolved, dismissed or reopened): read at display time from the audit log's newest `anomaly.update` entry by an admin and from `admin_users`, null while no admin has triaged it. The same object appears in the product detail (§14.3).

`reports` counts the customers' reports on the scans that took part in the finding (§16.8), with how many cases are still open and the latest report; `null` when there is none. This list and a finding's context (§16.15) carry it, not the anomalies of the product page. In the console, the Reports column shows the number of cases (a link to them in Cases), how many are open, and the latest report's channel, place and note, as Verification events shows a scan's. Types: `IMPOSSIBLE_TRAVEL`, `SCAN_VELOCITY`, `DEVICE_DIVERSITY`, `GEO_DISPERSION`, `LOST_STOLEN_SCAN`, `POST_REVOCATION_SCAN`, `GENOME_MISMATCH`, `CODE_MISMATCH`, `VALID_SIGNATURE_UNREGISTERED`, `UNSOLD_PIECE_SCAN`. `CODE_MISMATCH` and `VALID_SIGNATURE_UNREGISTERED` (CRITICAL) indicate a possible signing-key compromise. These two and `GENOME_MISMATCH` are recorded on every scan, a staff scan included (on `/api/v1/verify` from a browser signed in to the console, §9.7, and in the sale mode, §16.18); the details of one recorded by a staff scan carry `staffScan: true` (details follow the latest occurrence). `details.scanEventId` names the scan that last raised the finding, for the rule findings and, since 2026-10-02, for the three service findings too (a service finding recorded before has none until it occurs again: its detail then says the triggering scan was not recorded). `UNSOLD_PIECE_SCAN` (MEDIUM, risk 0, shown as **UNSOLD PIECE SCANNED** in the console) is a scan of a piece ORBES has not sold yet (its warranty not started) outside a console session, recorded once per piece and per UTC day, so its `occurrences` count days; details `{ country, productStatus, preSaleService?, scanEventId }` (§9.7). `SCAN_VELOCITY` details are `{ scans, sources, windowMin }` and `DEVICE_DIVERSITY` details `{ sources, scans, windowDays }`: both rules count distinct **sources** (the IP pseudonym, else the device cookie, else the session), not raw device cookies, so one address that drops its cookie on every request counts once.

### 16.5 `PATCH /api/admin/anomalies/:id`

OPERATOR. Triage. Body `{ "status": AnomalyStatus, "note"?: string | null (≤ 2000) }`. RESOLVED and DISMISSED record who and when; OPEN or ACKNOWLEDGED clears them.

**200** — the updated anomaly. Errors: `400 VALIDATION_FAILED`, `404 ANOMALY_NOT_FOUND`, `409 ANOMALY_ALREADY_OPEN`.

**The console's decision dialog** can act on the piece in the same gesture. For a finding that can be resolved it offers, as tick boxes, the marks `COUNTERFEIT_FLAGGED` and `STOLEN` its product's lifecycle allows (§16.15 `product.lifecycle.allowed`; OPERATOR, one mark at a time) and the revocation of its code while ACTIVE (ADMIN, with the typed phrase `REVOKE ISSUE <n>` of the product page). Acting on the piece resolves the finding. The dialog calls the existing routes, in this order, each audited by its own service: the transition (§14.4), the code's revocation (§15.4), then this route with `RESOLVED` and the note. The reason of the first two cites the finding, `Anomaly <id> (<TYPE>): <note>` (cut to the route's limit: 1 000 and 500 characters), so the status history, the revocation register and the audit log lead back to it. A step that fails stops the chain: the dialog lists each step as done, failed or not done, and confirming again runs only what was not done. A mark or a revocation already done stays part of the decision: its box stays ticked and locked, so the retry can only resolve the finding (not dismiss it while the piece stays marked), and the confirmation names everything done. Nothing is ever chained without the admin's tick.

### 16.6 `GET /api/admin/revocations`

AUDITOR. Paginated revocation register, newest first:

```json
{ "id": "…", "targetType": "PRODUCT", "targetId": "O26-J-00012", "reasonCode": "ADMIN_DECISION", "reason": "counterfeit seized",
  "createdBy": "admin:90b8d94a-…", "createdAt": "…", "liftedAt": null, "liftedBy": null }
```

`targetId` is the code uuid (CODE), the canonical product id (PRODUCT) or the key id as a decimal string (KEY). `reasonCode`: `CODE_REVOKED`, `KEY_REVOKED`, `KEY_COMPROMISED`, `ADMIN_DECISION`, `COUNTERFEIT`, `LOST`, `STOLEN`.

### 16.7 `POST /api/admin/revocations`

**ADMIN**. One entry point that dispatches to the owning operation:

| Field | Type | Rules |
|---|---|---|
| `targetType` | string | `CODE`, `PRODUCT` or `KEY` |
| `targetId` | string | 1–64 characters. CODE: the code uuid. PRODUCT: canonical id or uuid. KEY: a key id 1–255. |
| `reason` | string | 1–500 characters |

- CODE → code revocation (§15.4);
- PRODUCT → lifecycle transition to REVOKED;
- KEY → key revocation without a compromise time (codes recorded before now stay trusted). Use §17.4 to set a compromise time.

**201** — the new revocation row (shape of §16.6). Errors: `400 VALIDATION_FAILED`, plus the errors of the dispatched operation (`404 CODE_NOT_FOUND`, `409 CODE_ALREADY_REVOKED`, `404 PRODUCT_NOT_FOUND`, `409 TRANSITION_NOT_ALLOWED`, `404 KEY_NOT_FOUND`, `409 KEY_ALREADY_REVOKED`, …).

### 16.8 `GET /api/admin/reports` (extension of the contract)

AUDITOR. The **Cases** queue: customers' reports on scans that were not authentic (§8.5), one case per scan, each with its scan, the anomaly the scan took part in and its piece. Paginated; open cases first, then the newest.

| Query | Rules |
|---|---|
| `status` | `OPEN` or `CLOSED`. |
| `scanId` | The case of one scan (uuid): a scan's link to its case. |
| `anomalyId` | The cases of the scans that took part in one anomaly (uuid). |

```json
{
  "id": "8f0b2c4e-…",
  "scanId": "5a864af8-0d6b-4c1e-9f2a-3b7c1d2e4f5a",
  "channel": "ONLINE",
  "place": "a marketplace listing",
  "note": "Offered at a third of the boutique price.",
  "status": "OPEN",
  "createdAt": "2026-10-01T08:17:02.114Z",
  "handledBy": null,
  "handledAt": null,
  "resolutionNote": null,
  "scan": { "occurredAt": "2026-10-01T08:15:21.929Z", "state": "SUSPICIOUS_ACTIVITY", "productId": "O26-J-00005", "country": "IT", "region": null },
  "anomaly": { "id": "1dd3573b-…", "type": "LOST_STOLEN_SCAN", "severity": "HIGH", "status": "OPEN" }
}
```

- `scan.productId` is the canonical id of the piece, `null` when the signed identity is not registered (or the code could not be read).
- **The anomaly of a case.** A scan took part in an anomaly when the anomaly was recorded by it (`details.scanEventId`) or when the scan is of the same piece (its product; for an identity that is not registered, its packed identity) and was made between the anomaly's first and last sighting. A case names one: the most severe of those its scan recorded, else of those it was seen during (then the highest risk score, then the latest seen); `null` when there is none. The same rule gives an anomaly's `reports` (§16.4) and the `anomalyId` filter. An anomaly is always recorded with the product of the scan that raised it (none for an unregistered identity), so a page of cases looks its anomalies up through their product (`anomalies_product_id_idx`, which also serves the anomalies without one), never by reading the whole table, which is never purged.
- `handledBy` is `{ "id", "email" }` of the admin who closed the case.

### 16.9 `PATCH /api/admin/reports/:id` (extension of the contract)

OPERATOR. Closes a case. Body `{ "status": "CLOSED", "note": string }`: the note (1–2 000 characters after trimming) says what was done for the customer, or why nothing was; it stays with the case.

**200** — the closed case (shape of §16.8), with `handledBy`, `handledAt` and `resolutionNote`. Errors: `400 VALIDATION_FAILED` (no note, another status, unknown fields), `404 REPORT_NOT_FOUND`, `409 REPORT_ALREADY_CLOSED`. Audited `scan.report.close`, targeting the scan like `scan.report` (so the audit log reads a case's two entries together), with `{ "reportId" }` in the details and neither the customer's words nor the note. A case is not reopened; it is deleted with its scan by the scan-history purge, open or closed.

### 16.10 `POST /api/admin/owners/:id/recovery-code` (extension of the contract)

**ADMIN**. A one-time recovery code for a customer who forgot the password (C-04), issued by ORBES Client Services **after checking the customer's identity** (SECURITY-MODEL §3.6; the procedure is written with counsel, and outlined for staff in the [sales playbook](launch/SALES-PLAYBOOK.md), §6). `:id` is the account id (`accounts.id`, uuid, as listed by §16.2). No body (or `{}`).

**201** — the code is in this response only:

```json
{ "recoveryCode": "7KQ2-MWX9-D4RT", "expiresAt": "2026-10-02T09:30:00.000Z" }
```

- 12 Crockford base32 characters (60 bits) from the server's random generator, shown as `XXXX-XXXX-XXXX`. Only its scrypt hash is stored ([DATABASE §5.23](DATABASE.md#523-account_recovery_codes)): it cannot be shown again.
- Valid **30 minutes**, used once (§10.8). One code at most is open per account: a new code revokes the previous one, which then fails like a wrong code.
- Only for an ACTIVE account.
- Audited `account.recovery_code.issue` with the account as target and `{ recoveryCodeId, expiresAt, replaced }` (the number of codes it revoked); never the code or the email.

Errors: `400 VALIDATION_FAILED` (malformed id, a body with fields), `403 FORBIDDEN` (AUDITOR, OPERATOR), `403 CSRF_FAILED`, `404 ACCOUNT_NOT_FOUND`, `409 ACCOUNT_NOT_ACTIVE`.

In the console: *Recovery code* on the account's row of Owners and on the owner's sheet (§16.11; ADMIN only), a dialog that says what the code does, then the code once on an ivory panel with COPY and *Given to the client — hide*; the row then reads *Recovery code open until …* (and *Recovery attempts throttled until …* once 5 wrong guesses have spent it), and after the recovery *Transfers paused until …*. The A-06 brief named this route `/:id/recovery` and its public field `code`; there is one recovery mechanism, so they keep the names of C-04 (`/:id/recovery-code`, `recoveryCode`).

### 16.11 `GET /api/admin/owners/:id` (extension of the contract)

AUDITOR. The owner's sheet for ORBES Client Services (A-06): what they need while a customer is on the line. `:id` is the account id (uuid).

```json
{
  "owner": { "id": "6d1c…", "email": "ada@example.com", "displayName": "Ada", "country": "FR", "status": "ACTIVE", "createdAt": "…",
             "products": 1, "productsEver": 2, "transfersPausedUntil": null, "recoveryCodeExpiresAt": null, "recoveryCodeThrottledUntil": null },
  "pieces": [
    { "productId": "O26-J-00184", "model": "MONOLITHE", "type": "RING", "material": "925 STERLING SILVER", "variant": "54",
      "status": "OWNED", "ownershipState": "TRANSFER_PENDING", "acquiredVia": "FIRST_REGISTRATION", "verified": true,
      "since": "…", "until": null, "endedReason": null },
    { "productId": "O26-J-00102", "…": "…", "until": "2026-09-30T10:00:00.000Z", "endedReason": "TRANSFERRED_OUT" }
  ],
  "transfers": [ { "id": "…", "productId": "O26-J-00184", "createdAt": "…", "expiresAt": "…" } ],
  "scans": [ { "id": "…", "reference": "1A2B3C4D", "occurredAt": "…", "eventType": "VERIFY", "state": "AUTHENTIC_OWNERSHIP_VERIFIED", "productId": "O26-J-00184", "country": "FR" } ]
}
```

- `owner`: the shape of §16.2 (email masked for an AUDITOR).
- `pieces`: every ownership period of the account (`ownership`), the pieces owned now first (`until: null`), then those owned before; newest first within each.
- `transfers`: the transfers the account offered that are still pending and unexpired.
- `scans`: its **20 latest** scans made while signed in (`scan_events.account_id`), newest first, each with its REF.
- `tier` (P-X04): the account's tier in the club now, `{ "level": 2, "name": "PLATINE", "pieces": 5, "seniority": 1 }`, computed as §10.10 computes it (`level` 0 and `name` `null` without a piece).
- The client sheet (plan LIVE RELEASE+, N4):
  - `orders`: every order of the account, the latest first, each the board's card (§16.24) without its collector, with its `priceMinor` and `currency` (`null` until entered) and `steps`, the time it reached each step (`reservedAt`, `paidAt`, `shippedAt`, `deliveredAt`, `cancelledAt`, `returnedAt`, `null` until reached), and its `timing` (late or not, by the M3 rules);
  - `releases`: `{ "count", "secured", "items": [{ "id", "kind": "LIVE" | "DRAW", "title", "opensAt", "secured" }] }`, the releases it took part in (§10.15's definition), the latest first, with the pieces it secured in each (its after-room's in its release; a draw's entry confirmed is one), `secured` their sum;
  - `answers`: its answers to the questions after (§10.16), the latest first: `{ "dropId", "title", "question", "answer", "answerText", "answeredAt" }`;
  - `interest`: its I'LL BE THERE, the latest release first: `{ "dropId", "title", "size", "since", "opensAt", "outcome" }`, `outcome` `UPCOMING` before its T0, `CAME` when it had a place in the line, `DID_NOT_COME` otherwise, `CANCELLED` with the release;
  - `segments`: the segments it belongs to now (§16.26, read live), by name: `[{ "id", "name" }]`;
  - `notes`: the notes ORBES Client Services wrote on its orders' steps, its draw entries, its requests of the private salon closed and its LIVE reservations concluded, the latest first: `{ "at", "about": "ORDER" | "DRAW" | "SALON" | "LIVE", "subject", "orderId", "text", "by" }`, `subject` the order's reference, the release's title or the model's name, `by` the console user's email (`null` for a script).
  Never the buyer's name and address (on the order's page, §16.24) nor an engraving's words. An AUDITOR reads the account's email masked, the rest as an OPERATOR.
- `messages` (plan NEXT-NINE, CS-01): the account's conversation with ORBES Client Services, `{ "conversationId", "status": "TO_ANSWER" | "ANSWERED" | "CLOSED" }`, or `null` when it never wrote (§16.28).
- `club` (plan NEXT-NINE, BP-19 T10): `{ "tier", "grants": [{ "tier", "kind": "GIFT" | "CREDIT", "grantedAt", "amountMinor", "balanceMinor", "currency", "expiresAt", "gift": { "state": "PENDING" | "WITH_ORDER" | "DELIVERED", "orderId", "orderReference" } | null }], "careThisYear": { "year", "used", "allowance", "open": { "id", "productId" } | null } | null }`: what the tier program gave the account (PLATINE's first) and the yearly care of the year (`null` when its tier gives none and none is open). The console's *Club* lines under the tier: *Credit PLATINE € 50, € 50 left, until 06 OCT 2027*, *Welcome gift PLATINE: pending* (*with OR-…*, a link to that order; *delivered*), *Yearly care: 2026: 0 of 1* (an open request linked).
- `guarantees` (plan NEXT-NINE, IN-01): every guarantee granted to the account, the open ones first: `{ "id", "scope", "target": { "kind", "id", "name", "variant" }, "pieces", "validUntil", "visible", "note", "status", "state", "release": { "id", "title", "mode" } | null, "entryId", "grantedAt", "grantedBy", "updatedAt", "updatedBy", "usedAt", "closedAt", "closedReason", "revokeNote" }`, `state` one of `WAITING` (for the next release in its scope), `SET_ASIDE` (for `release`), `ENTERED` (its client entered with it), `USED`, `EXPIRED`, `REVOKED` (§16.30). The console's *House guarantee* section, after *Releases*.
- `lifetimeValue` (plan NEXT-NINE, BP-29): what the client is worth, per currency, by GROWTH's rule (§16.31): its app orders at their invoiced price after credit notes, and its pieces registered from elsewhere at their model's price, `[{ "currency": "EUR", "valueMinor": 670000 }]`, the currencies in order; `[]` when no priced piece is counted. Amounts are never converted. The console's *Lifetime value* line, after the tier's Club lines: *€ 6 700* (several currencies joined by ` · `; *—* when there is none), with the note *App orders at their invoiced price, after credit notes, and pieces registered from elsewhere at their model’s price*.

Errors: `400 VALIDATION_FAILED` (malformed id), `404 ACCOUNT_NOT_FOUND`.

In the console: `#/owners/:id`, reached from Owners, from a REF search and from a product's ownership (§14.3). It shows the account (status, email, name, country, since, id, and its *Tier*: the tier's name, its pieces and its seniority), *Pieces*, *Orders* (each with its steps and their dates, a late one marked, opening its page), *Releases* (with the pieces secured), *Answers to the question after*, *Interest* (and whether the collector came), *Segments*, *Notes*, *Transfers in progress* and *Latest verifications* (each linked to its verification event and its piece), the line *Messages* (the conversation's status, linking to it, §16.28), and, for an ADMIN, *Recovery code*, *Lock account* or *Unlock account*, and *Export data*. An AUDITOR reads it masked, without the actions.

### 16.12 `POST /api/admin/owners/:id/lock` and `POST /api/admin/owners/:id/unlock` (extension of the contract)

**ADMIN**. No body (or `{}`).

**Lock** an ACTIVE account, for example while a takeover is suspected or at the customer's request (then after the identity check of SECURITY-MODEL §3.6, outlined for staff in the [sales playbook](launch/SALES-PLAYBOOK.md), §6). In **one transaction**: the status becomes `LOCKED`, **every session of the account ends**, and its **pending transfers are cancelled** (audited `ownership.transfer.cancel` with `details.reason: "account_locked"`), so a transfer code already handed out no longer completes (`410 TRANSFER_CANCELLED`), and its **open links to ownership certificates are withdrawn** (§11.7; audited `ownership.certificate.revoke` with `details.reason: "account_locked"`), so a link shared by whoever held the account answers `404 CERTIFICATE_NOT_FOUND` (§8.7), and its **entries in releases not drawn yet are withdrawn** (§10.10; P-R03: an `ENTERED` entry of a release neither drawn nor cancelled becomes `WITHDRAWN`, audited `drop.withdraw` with `details.reason: "account_locked"`, before the transfers are cancelled), so a draw does not select the account, and its **open requests of the private salon are closed** (§10.9; P-X08: an `OPEN` request becomes `CLOSED`, handled by the lock's ADMIN, without a note, audited `shop.request.close` with `details: { modelId, reason: "account_locked" }`, also before the transfers are cancelled), so ORBES Client Services does not follow them up, and its **open entries in the LIVE RELEASES are removed** (§10.12: `WAITING`, `QUEUED`, `TURN` and `SECURED` become `REMOVED`, their add-ons dropped, a piece held going to the next in line; audited `drop.live.remove` with `details.reason: "account_locked"`) and its **I'LL BE THERE withdrawn** from the releases not opened yet (`drop.live.interest.withdraw`, the same reason); a confirmed reservation stays for ORBES Client Services to conclude. Until it is unlocked the customer cannot sign in: a sign-in with the right password answers `403 ACCOUNT_LOCKED` (*This account is locked. ORBES Client Services can assist you.*, §10.2). Nor can they use a recovery code: the lock revoked the open one and none can be issued while the account is locked, so a code answers `400 RECOVERY_CODE_INVALID` like a replaced one (§10.8); `403 ACCOUNT_LOCKED` comes only when the lock lands between the check of a code and its use. A request already on its way when the lock takes effect is refused with `403 ACCOUNT_LOCKED`: a transfer (§11.2), a LOST or STOLEN declaration (§11.5), a first registration (§11.1, its claim code's check included) and the acceptance of a transfer by the locked account (§11.3), each of which reads the account again under a share lock before it locks the piece, so no piece reaches a LOCKED account; a password change (§10.7) and a sign-in whose password check was under way (§10.2). The pieces stay registered to the account; its scans keep showing them as registered. The **open recovery code is revoked** in the same transaction: a code obtained by fooling the identity check is the takeover a lock is for (THREAT-MODEL U), so it does not outlive the lock; it then fails like a replaced code (§10.8). A new one cannot be issued while the account is locked (`409 ACCOUNT_NOT_ACTIVE`).

**200** `{ "status": "LOCKED", "sessionsRevoked": 2, "transfersCancelled": 1, "recoveryCodesRevoked": 1, "certificatesRevoked": 1, "dropEntriesWithdrawn": 1, "shopRequestsClosed": 1, "liveEntriesRemoved": 1, "liveInterestWithdrawn": 0 }` (`recoveryCodesRevoked`: 0 or 1; a code already expired is left as it was; `certificatesRevoked`: the links withdrawn, an expired one left as it was; `dropEntriesWithdrawn`: the entries withdrawn, P-R03; `shopRequestsClosed`: the requests of the private salon closed, P-X08; `liveEntriesRemoved` and `liveInterestWithdrawn`: the LIVE RELEASES' open entries removed and interest withdrawn). Audited `account.lock` with the account as target and these counts; never the email.

**Unlock** a LOCKED account: the status becomes `ACTIVE` again and the customer signs in as before. Transfers cancelled, certificate links withdrawn, entries withdrawn (the customer enters again while a release's entries are open), requests closed (the customer requests the model again from its sheet) and a recovery code revoked by the lock stay so: Client Services issues a new code if the customer needs one (§16.10). **200** `{ "status": "ACTIVE" }`. Audited `account.unlock`.

Errors: `400 VALIDATION_FAILED` (malformed id, a body with fields), `403 FORBIDDEN` (AUDITOR, OPERATOR), `403 CSRF_FAILED`, `404 ACCOUNT_NOT_FOUND`, `409 ACCOUNT_ALREADY_LOCKED`, `409 ACCOUNT_NOT_ACTIVE` (a deleted account), `409 ACCOUNT_NOT_LOCKED`.

In the console: *Lock account* and *Unlock account* on the owner's sheet, each behind a dialog that says what it does (the lock's dialog names the recovery code it stops, the unlock's says that it does not come back); the sheet then reads *LOCKED*.

### 16.13 `GET /api/admin/owners/:id/export` (extension of the contract)

**ADMIN** (a `GET`, but it hands over a customer's personal data). Everything the registry holds about one account, readable, for a request under the **right of access** (GDPR art. 15), after the same identity check as a recovery code (SECURITY-MODEL §3.6, outlined for staff in the [sales playbook](launch/SALES-PLAYBOOK.md), §6). A `Cache-Control: no-store` JSON attachment, `orbes-account-<first 8 characters of the id>-<YYYY-MM-DD>.json`:

| Field | Content |
|---|---|
| `format`, `version`, `exportedAt` | `"orbes.account-export"`, `1`, the time of the export. |
| `account` | `id`, `email` (in clear), `displayName`, `country`, `status`, `createdAt`, `updatedAt`, `transfersPausedUntil`. |
| `pieces` | Every ownership period, as on the sheet (§16.11), with one difference: a piece the account **owned before** (`until` set) carries no current `status` nor `ownershipState`, which now describe the next owner (a LOST or STOLEN declaration, a transfer under way) and are not this account's data; its period, `acquiredVia`, `verified`, `since`, `until` and `endedReason` describe the account's own ownership. A piece it owns now keeps both, in the public vocabulary: a piece flagged as counterfeit reads `REVOKED`, as it does on /verify (BRAND §4.1). |
| `transfers` | Every transfer offered by the account (`direction: "OUT"`) or accepted by it (`"IN"`), with its status (a pending one past its expiry reads `EXPIRED`), creation, expiry and completion. |
| `scans` | Every scan made while signed in, oldest first: `reference` (the REF), time, event, result, piece, `country`, `region`, `lat`/`lon` (rounded to 0.1°, §4), `userAgentFamily` (the browser family, e.g. `Safari/iOS`; the whole user agent of a scan is never stored), `clientMetrics` (what the app measured while decoding, as stored: corrections, module size, decode time, camera or upload; or `null`), and the customer's `report` on it (§8.5: `channel`, `place`, `note`, `createdAt`) or `null`. The scan's whole id is never given, only its REF. |
| `sessions` | The account's sessions still stored: `createdAt`, `lastSeenAt`, `expiresAt`, `userAgent`. |
| `recoveryCodes` | The recovery codes issued (§16.10): `createdAt`, `expiresAt`, `usedAt`, `revokedAt`. |
| `certificates` | The links to ownership certificates the account created (§11.7, F-06), in its current and past ownership periods, oldest first: `productId`, `createdAt`, `expiresAt`, `revokedAt` (withdrawn by the owner, or with the account's lock or assisted recovery, whose audit entries name the ADMIN or the piece rather than the account) and `status`, what a reader of the link meets now: `VALID`, `NO_LONGER_VALID` (expired, its ownership period ended, or the piece lost, stolen, revoked, flagged or retired since; computed as in §8.7) or `WITHDRAWN` (§8.7's 404). Never the token, its hash or the link's id. |
| `dropEntries` | (P-R03) Every entry of the account in a release (§10.10), oldest first: `entryId` (the id the draw's list publishes), `dropId`, `title`, `status`, `enteredAt`, and from the draw `tier`, `seniority`, `rank`, `respondBy`, `handledAt` (a direct reservation of the early access, P-X02: the `tier` and `seniority` of its request, its `respondBy`, no `rank`), and `note`, the note ORBES Client Services added when it concluded the entry (CONFIRMED, LAPSED; `null` without one). Never who concluded it. |
| `circleAnswers` | (P-X01) Every answer of the account to an invitation of the circle (§10.11), oldest first: `postId`, `title`, `answer` (`YES`, `NO`), `firstAnsweredAt`, `answeredAt` (its latest change). |
| `circleVotes` | (P-X01) Every vote of the account in a poll of the circle, oldest first: `postId`, `title`, `option` (its index, from 0), `optionText` (its words as the poll has them), `votedAt`. |
| `shopRequests` | (P-X08) Every request of the account in THE PRIVATE SALON (§10.9), oldest first: `requestId`, `modelId`, `model` (its name), `note` (the account's words, or `null`), `size` (the size asked, plan NEXT-NINE AC-01, or `null`), `status` (`OPEN`, `CLOSED`), `requestedAt`, `handledAt` and `resolutionNote`, the note ORBES Client Services wrote when it closed the request (`null` while open, or closed by a lock). Never who closed it. |
| `liveEntries` | Every entry of the account in a LIVE RELEASE (§10.12), oldest first: `entryId`, `dropId`, `title`, `size`, `quantity`, `status`, `tier`, `position`, `joinedAt`, `queuedAt`, `turnAt`, `turnExpiresAt`, `pressStartedAt`, `gestureMs` (the length of the hold, in milliseconds), `securedAt`, `holdExpiresAt`, `confirmedAt`, `endedAt`, `letIn` (whether the console let it take its turn out of order), `country`, `currency`, `priceMinor`, `addons` (`label`, `priceMinor` at the time), `resolution` (`CONCLUDED`, `CANCELLED` or `null`), `handledAt`, `resolutionNote`. Never its network's hash (`notIncluded`), nor who let it in, removed it or concluded it. |
| `liveInterest` | Every I'LL BE THERE of the account still held: `dropId`, `title`, `size`, `since`. |
| `releaseAnswers` | (plan LIVE RELEASE+, choice 11) Every answer of the account to the question after a LIVE RELEASE (§10.16), oldest first: `dropId`, `title`, `question` (its words as the release asked them), `answer` (its position, from 1), `answerText`, `answeredAt` (its latest change). |
| `orders` | (plan LIVE RELEASE+) Every order of the account (§10.13), oldest first: `reference`, `channel`, `release`, `model`, `size`, `priceMinor`, `currency`, `addons` (`label`, `priceMinor`), `engravingText`, `buyer` (the name and address entered on the order, as they are now), `status`, `reservedAt`, `paidAt`, `shippedAt`, `deliveredAt`, `cancelledAt`, `returnedAt`, `carrier`, `trackingNumber`; its `invoices`, each document as issued: `number`, `kind`, `issuedAt`, `currency`, `totalMinor`, the `buyer` it was issued to (`name`, `address` and the account's `email` at issue, which may differ from the order's buyer entered since) and its `lines` (`label`, `detail`, `amountMinor`); its `history` (`status`, `at`, `note`), never who handled it. |
| `messages` | (plan NEXT-NINE, CS-01) Every message of the account's conversation with ORBES Client Services (§10.17), oldest first: `at`, `from` (`YOU` or `ORBES_CLIENT_SERVICES`; never who answered), `body`, `concerning` (`kind`, `label`) or `null`. |
| `careRequests` | (plan NEXT-NINE, BP-19 T6) Every yearly care request of the account (§10.18), oldest first: `id`, `productId`, `year`, `tier`, `status`, `requestedAt`, `returnName`, `returnAddress` (as the collector gave them), `labelAt`, `receivedAt`, `returnShippedAt`, `doneAt`, `cancelledAt`. Never the label itself nor who handled it. |
| `sizes` | (plan NEXT-NINE, AC-01) The sizes the account saved in YOUR SIZES (§10.19), in the order ring, bracelet, wrist, necklace: `kind`, `value` (a French ring size, or centimetres), `unit` (`FR` or `CM`), `updatedAt`. `account.export` counts them (`sizes`). |
| `claimCodes` | (plan NEXT LOT §3.4) Every new claim code ORBES Client Services made for one of the account's orders (§10.20), oldest first: `order` (its reference), `madeAt`, `status` (`WAITING`, `READ`, `WITHDRAWN`), `readAt`. Never the code, sealed or clear, nor who made it. Its reading is in `activity` (`claim_code.read`, made by the account). `account.export` counts them (`claimCodes`). |
| `guarantees` | (plan NEXT-NINE, IN-01) Every house's guarantee granted to the account, oldest first, shown to it or not: `id`, `scope`, `target` (the model's or the collection's name, or the release's title), `pieces`, `validUntil`, `visible`, `note`, `revokeNote` (Client Services' note at a revocation, or `null`), `status`, `releaseId`, `grantedAt`, `usedAt`, `closedAt`. Never who granted or revoked it. `account.export` counts them (`guarantees`). |
| `tierGrants` | (plan NEXT-NINE, BP-19 T5) Every grant of a tier the account received (DATABASE §5.66), oldest first: `tier` (`PLATINE` or `PALLADIUM`), `kind` (`GIFT` or `CREDIT`), `grantedAt`; a CREDIT's `amountMinor`, `currency`, `expiresAt`, `balanceMinor` (its amount less its open uses) and `uses`, oldest first (DATABASE §5.67): `orderReference`, `amountMinor`, `appliedAt`, `releasedAt` and `reason` (`REMOVED`, `CANCELLED`, `RETURNED`) or `null`; a GIFT's `model` (`name`, `variant`) once an order carries it, else `null` (`null` amounts, `uses: []`). Never who applied or released a use. `account.export` counts them (`tierGrants`). |
| `activity` | Every audit entry that names the account, oldest first: those **about** it (target: `account.register`, `account.login`, `account.login_failed`, `account.password_change`, `account.recover`, `account.recover_failed`, `account.lock`, …) and those it **made** (actor: `ownership.register`, `ownership.claim_failed`, `ownership.transfer.initiate`, `.accept`, `.cancel`, `ownership.incident`, `ownership.incident.resolve`, `ownership.certificate.create`, `ownership.certificate.revoke` (the owner's withdrawals and those of its assisted recovery; a lock's withdrawals name the ADMIN, and show in `certificates`), `product.transition`, `scan.report`, `drop.enter`, `drop.withdraw`, `drop.reserve`, `circle.rsvp`, `drop.live.enter`, `drop.live.secure`, `drop.live.confirm`, …; never a vote, which the audit log does not hold). Each gives `occurredAt`, `action`, `by` (`account`, `admin` or `system`; never the staff member's identity), what it was about (`productId`, the piece's canonical id, or `reference`, a scan's REF, never its whole id; else `null`) and `status`, the status it gave the piece (`LOST` or `STOLEN` for a declared incident, the status it returned to for a loss withdrawn by its owner, `ownership.incident.resolve`, §11.6, the new status for a change of status) or `null`. Nothing else of an entry's details, which can name staff or other accounts. The audit log has no index on the actor, so the second half reads the whole log: accepted for this rare ADMIN request (DATABASE §5.21). A transfer the account offered and another account accepted is in `transfers`; its `ownership.transfer.accept` entry names the buyer as actor. |
| `truncated` | The lists cut at 50 000 entries (`scans`, `activity`); empty when the export is complete. |
| `notIncluded` | What the registry holds but cannot give back readably: the password and recovery codes (one-way scrypt hashes), the tokens of the certificate links (a one-way SHA-256 each), and the IP and device pseudonyms of scans, sessions and audit entries (keyed one-way hashes; no IP address or device cookie is stored). |

Audited `account.export` with the account as target and the number of entries of each list (`dropEntries`, `circleAnswers`, `circleVotes`, `shopRequests`, `liveEntries`, `liveInterest`, `releaseAnswers`, `orders` and `messages` included); never the content or the email.

Errors: `400 VALIDATION_FAILED`, `403 FORBIDDEN` (AUDITOR, OPERATOR), `404 ACCOUNT_NOT_FOUND`.

In the console: *Export data* on the owner's sheet saves the file.

### 16.14 `GET /api/admin/anomalies/summary` (extension of the contract)

AUDITOR. What waits for triage:

```json
{
  "open": { "LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 1 },
  "attention": 3,
  "types": ["IMPOSSIBLE_TRAVEL", "SCAN_VELOCITY", "DEVICE_DIVERSITY", "GEO_DISPERSION", "LOST_STOLEN_SCAN",
            "POST_REVOCATION_SCAN", "GENOME_MISMATCH", "CODE_MISMATCH", "VALID_SIGNATURE_UNREGISTERED", "UNSOLD_PIECE_SCAN"]
}
```

`open` counts the **OPEN** findings by severity (an ACKNOWLEDGED finding has been seen; the dashboard's `anomalies.open`, §13.1, counts both). `attention` is `open.HIGH + open.CRITICAL`: the console shows it as a badge on the ANOMALIES link (`99+` beyond 99, nothing at 0) and prefixes it to the tab title, `(3) Dashboard — ORBES Genome Console`. The console asks on every navigation and every 60 s while its tab is visible; a hidden tab stops asking and asks again when it is shown; the Anomalies view, which reads the summary itself, gives the badge its count instead. These are background requests: a `401` never signs the admin out or replaces the page on screen (a batch's claim codes, a single product's), it only stops the refresh; the admin's next action meets the ended session. `types` is every type the server records (§16.4), for the list's Type filter.

### 16.15 `GET /api/admin/anomalies/:id/context` (extension of the contract)

AUDITOR. The scans around one finding, for the console's detail panel (`#/anomalies?id=<id>`):

```json
{
  "anomaly": { "id": "1dd3573b-…", "type": "IMPOSSIBLE_TRAVEL", "severity": "HIGH", "status": "OPEN", "reports": null, "…": "shape of §16.4" },
  "window": { "from": "2026-09-30T08:14:21.929Z", "to": "2026-10-01T09:15:21.929Z" },
  "scans": {
    "total": 3,
    "truncated": false,
    "items": [
      { "id": "b9f87d9b-…", "occurredAt": "2026-10-01T08:15:21.929Z", "eventType": "VERIFY", "state": "SUSPICIOUS_ACTIVITY",
        "country": "JP", "region": null, "deviceHash": "ZoczF36E…", "userAgentFamily": "Mobile Safari", "riskScore": 60, "trigger": true,
        "report": { "id": "0c9e2f51-…", "channel": "ONLINE", "place": "a marketplace listing", "status": "OPEN" } }
    ]
  },
  "countries": [{ "country": "FR", "scans": 2 }, { "country": "JP", "scans": 1 }],
  "devices": 2,
  "trigger": { "id": "b9f87d9b-…", "…": "the scan named by details.scanEventId" },
  "code": { "id": "c7dda4b5-…", "issue": 1, "status": "ACTIVE" },
  "product": { "productId": "O26-J-00003", "lifecycle": { "status": "OWNED", "allowed": ["TRANSFERRED", "…", "COUNTERFEIT_FLAGGED", "LOST", "STOLEN", "REVOKED"], "returnTo": null, "canReinstate": false } }
}
```

- `anomaly` carries `reports` as the list does (§16.4: how many customers' reports on the finding's scans, how many cases open, the latest), so a finding opened by its id, from a case, says what customers said about it whatever page of the list holds it.
- `window` runs from 24 h before the finding's first occurrence (or its rule's window, `details.windowMin` / `details.windowDays`, when longer) to 1 h after its last.
- `scans` are the product's scans in the window (for a finding without a product, `VALID_SIGNATURE_UNREGISTERED`, those of the scanned identity, `details.packedIdentity`), ADMIN_TEST scans left out as the rules leave them out: `total` counts them all, `items` holds the latest 100, oldest first (`truncated` when there are more). `riskScore` is the verification's (null without an authentication record); `trigger` marks the scan named by `details.scanEventId`; `report` is the customer's report on that scan (§8.5: its case id, where they saw or bought the piece, and the case's status), or null. The customer's note stays on the case (§16.8) and the scans list (§16.1). The console's detail panel shows the finding's *Cases* (linked to the queue narrowed to the finding) and marks each reported scan of its timeline, linked to its case.
- `countries` counts the window's scans per country (null: unknown), most first; `devices` counts the distinct device pseudonyms. Only pseudonyms leave the database: never an IP pseudonym, an account or a coordinate.
- `trigger` is the scan named by `details.scanEventId` wherever it falls, or null (none recorded, or purged by retention).
- `code` is the code the finding names (null for none); `product` its canonical id and lifecycle snapshot (§14.3), null without a product. The console offers only the marks `lifecycle.allowed` holds and revokes only an ACTIVE code (§16.5).

Errors: `400 VALIDATION_FAILED` (an id that is not a uuid), `404 ANOMALY_NOT_FOUND`.

### 16.16 `GET /api/admin/analytics` (extension of the contract)

AUDITOR. The daily scan statistics of a window of complete UTC days, for the console's Analytics view (`#/analytics`, the last 30 or 90 days): where the pieces are scanned, with which result, and where the counterfeit signals appear.

| Query | Meaning |
|---|---|
| `from`, `to` | UTC days (`YYYY-MM-DD`), both included. `to` defaults to the last complete day (`through` below). |
| `days` | Without `from`: the window is the `days` days (1–366, default 30) that end on `to`. Refused together with `from`. |

The window is at most **366 days**. Every figure comes from `scan_daily_stats` ([DATABASE §5.24](DATABASE.md#524-scan_daily_stats) and [§10](DATABASE.md#10-housekeeping-and-retention)), never from the scan history:

- **complete days only:** housekeeping counts a UTC day once it is over and ten minutes old (a pass every 10 minutes), and this route first runs the same idempotent count for the complete days no pass has counted yet, so yesterday's scans are in the figures from 00:10 UTC; today's are not yet. A count that fails here is logged and the report still answers, with `through` saying how far the figures go;
- **staff scans never:** `ADMIN_TEST` scans are not counted;
- **the same after a purge:** the counts are written before the scan history is purged (`SCAN_RETENTION_DAYS`) and are never rewritten, so a window reads the same before and after;
- **anonymous:** counts by day, country, state and event type, nothing about a scan, a piece, an account or a device.

```json
{
  "from": "2026-09-02", "to": "2026-10-01", "days": 30, "through": "2026-10-01",
  "total": 6,
  "byState": { "AUTHENTIC": 2, "AUTHENTIC_FIRST_REGISTRATION": 0, "AUTHENTIC_REGISTERED": 0, "AUTHENTIC_OWNERSHIP_VERIFIED": 1,
               "SUSPICIOUS_ACTIVITY": 1, "REVOKED": 0, "UNKNOWN": 1, "INVALID_SIGNATURE": 1, "MALFORMED_CODE": 0 },
  "byEventType": { "VERIFY": 6, "REGISTER": 0, "TRANSFER": 0 },
  "signals": { "INVALID_SIGNATURE": 1, "UNKNOWN": 1, "MALFORMED_CODE": 0, "SUSPICIOUS_ACTIVITY": 1, "total": 3 },
  "daily": [
    { "day": "2026-09-02", "total": 0, "byState": { "AUTHENTIC": 0, "…": 0 } },
    { "day": "2026-10-01", "total": 4, "byState": { "AUTHENTIC": 2, "UNKNOWN": 1, "INVALID_SIGNATURE": 1, "…": 0 } }
  ],
  "countries": [
    { "country": "FR", "total": 2, "signals": 0, "byState": { "AUTHENTIC": 2, "…": 0 } },
    { "country": "CN", "total": 1, "signals": 1, "byState": { "INVALID_SIGNATURE": 1, "…": 0 } },
    { "country": "ZZ", "total": 1, "signals": 1, "byState": { "UNKNOWN": 1, "…": 0 } }
  ]
}
```

- `through` is the last day the statistics really cover: yesterday (the day before in the first ten minutes after midnight UTC) once its scans are counted; otherwise the day before the first scan no count has reached yet (the count failed, here and in housekeeping), the days of the window after it reading 0 because they are not counted yet, not for want of scans. The console's Analytics view then says *Counted through <day> only* before anything else.
- `byState` and every `byState` below it carry the nine states of §9.3, zeros included; `byEventType` the three counted types.
- `signals` sums the four states that signal a code ORBES did not issue, or did not issue for this scan: `INVALID_SIGNATURE`, `UNKNOWN`, `MALFORMED_CODE` and `SUSPICIOUS_ACTIVITY`. A signal is a reason to look, not a verdict: a damaged print reads as MALFORMED CODE.
- `daily` holds one entry per day of the window, oldest first, days without scans included.
- `countries` holds every country with scans in the window, most scans first, then by code; `ZZ` is a scan whose location is unknown (`GEO_MODE=none`, or no country for its address). `signals` counts that country's scans in the four states.

The console shows four figures (scans, authentic, counterfeit signals, countries), every scan per day as one curve whose cursor reads a day (pointer, or the arrow keys once the curve has focus), one small curve per state scaled to its busiest day and linked to its scans in Verification events (§16.1, while the history keeps them) over the window's whole days (`from` the first day's `T00:00:00.000Z`, `to` the last day's `T23:59:59.999Z`), the ten countries with the most scans and the ten with the most signals as hairline bars (oxblood where a signature did not verify), the signals by country and state, and the days with scans as a table. No map: the CSP admits no external tiles, and the volume does not call for one.

Errors: `400 VALIDATION_FAILED` (a day that is not `YYYY-MM-DD` or does not exist, a day of year 0000, `days` outside 1–366 or not a whole number, `from` with `days`, `from` after `to`, a window over 366 days, `days` that would start the window before `0001-01-01`).

**`GET /api/admin/analytics/circle?days=` or `?from=&to=`** (AUDITOR; P-X01, `routes/admin/analytics.ts`, `CircleService.stats`): the panel **The Circle**, over the same window as the report above (the same parameters, defaults and errors):

```json
{
  "from": "2026-09-05",
  "to": "2026-10-04",
  "days": 30,
  "members": { "TITANE": 41, "PLATINE": 6, "PALLADIUM": 1, "total": 48 },
  "visits": { "total": 212, "daily": [ { "day": "2026-09-05", "visits": 0 }, { "day": "2026-09-06", "visits": 9 } ] }
}
```

- `members`: the members of the club **now**, by tier (`clubMembersByTier`): the ACTIVE accounts, each counted at its tier as the club counts its pieces (§10.10; a locked account reads nothing of the club and is left out). Counts only: no account is named.
- `visits`: the visits of the circle on each UTC day of the window, oldest first, days without one included (`circle_daily_visits`: the first page of the feed adds one, §10.11), and their `total`. A count per day, which names nobody; there is no follow-up by account, so no retention.

The console's Analytics view shows it under the scans, as the panel *The Circle*: the members by tier and the visits per day.

**`GET /api/admin/analytics/best-time?days=&tier=&country=`** (AUDITOR; plan LIVE RELEASE+, choice 10, G3; `services/activity.ts`): **the best time to open**. The sign-ins (`account.login`, `account.register`) and the public verification's scans (`VERIFY`, `REGISTER`, `TRANSFER`; never a staff scan) are counted by complete UTC hour, country and tier into `activity_hourly` (migration 0023) by the housekeeping's pass, after the daily statistics and before any purge of the scan history, and again before each reading: the hour, the country (the account's for a sign-in, the scan's for a scan, `ZZ` unknown), the tier its account holds when the hour is counted (`0` without one, a scan without an account included) and the two counts. **Never an account.** An hour counts once it ended 10 minutes ago; each pass writes the hours after the last one counted in one transaction. `days` 1–366 (30 by default), `tier` 0–3 (this tier and above; 0, everyone, by default), `country` two letters (all by default).

```json
{
  "days": 30, "from": "2026-10-11T13:00:00.000Z", "to": "2026-11-10T13:00:00.000Z", "minTier": 2, "country": null,
  "hours": [ { "hour": 19, "signIns": 2, "scans": 1, "activity": 3, "byTier": [0, 0, 3, 0], "past": { "releases": 1, "present": 1 } } ],
  "countries": [ { "country": "FR", "activity": 3, "peakHour": 19 } ],
  "total": 3, "suggested": { "hour": 19, "activity": 3, "share": 1 }, "release": null, "pastReleases": 1, "reasoning": ["…"]
}
```

- `hours`: the 24 hours of the day **in Paris time**, each with the sign-ins and scans of the tiers read (and the country), `byTier` every tier's activity then, and `past`, the latest 12 past LIVE RELEASES (never an after-room) that opened at that hour and their line at T0 from the tiers read.
- `countries`: the countries with activity from the tiers read, the most first, each with its busiest hour.
- `suggested`: the busiest hour and its share of the activity read (on equal activity, the hour more were present at past T0s, then the earlier); `null` without any. `reasoning`: how it is read, in words.

The console shows it as the panel *Best time to open* in Analytics (the tiers as tabs, the country as a choice) and on a LIVE RELEASE's page until its announcement (its tiers, its T0 outlined): the 24 hours as columns, the table of the hours, the countries.

### 16.17 Points of sale (boutique, extension of the contract)

The register a warranty's point of sale is chosen from (A-08, migration 0008, table `retailers`), in the product page's Activate warranty dialog (§14.6) and in the sale mode (§16.18), so a boutique is never typed three ways. Implementation: `routes/admin/retailers.ts`, `services/retailers.ts`.

**`GET /api/admin/retailers`** (RETAIL and every higher role, read only: the sale screen lists them; never LOGISTICS, which ranks with RETAIL: the route names its roles, plan NEXT LOT §3.5.6.1). Query `active=true`: the active ones only (the lists a sale is chosen from); otherwise all. By name, then city.

```json
{ "items": [
  { "id": "5d0c3a8e-6b0f-4c51-9a37-2f1d8e4b7c10", "name": "ORBES PARIS — SAINT-HONORÉ", "city": "Paris", "country": "FR",
    "active": true, "createdAt": "2026-10-02T09:00:00.000Z", "updatedAt": "2026-10-02T09:00:00.000Z" }
] }
```

**`POST /api/admin/retailers`** (**ADMIN**). Body `{ "name": 1–120 characters, "city"?: ≤ 80 characters or null, "country"?: ISO 3166-1 alpha-2 or null }`. **201** `{ "retailer": … }`. The country is the default purchase country of the sales made there; the online shop leaves it empty (the country is then the buyer's, given with the activation). One point of sale per name and city, ignoring case: `409 RETAILER_EXISTS`.

**`PATCH /api/admin/retailers/:id`** (**ADMIN**). Body: any of `name`, `city`, `country`, `active` (at least one). Renames, moves, deactivates (`"active": false`: it leaves the lists and refuses new activations, `409 RETAILER_INACTIVE`) or reactivates. A point of sale is never deleted (the database refuses it): the warranties of its sales keep naming it, by its current name. **200** `{ "retailer": … }`; `404 RETAILER_NOT_FOUND`, `409 RETAILER_EXISTS`.

Audited by RetailerService: `retailer.create` (name, city, country) and `retailer.update` with the changed values before and after (a change that changes nothing is not recorded).

### 16.18 Sale mode (boutique, extension of the contract)

The console's `#/sale` screen on a seller's phone (A-08): scan the seal of the piece being sold, see the piece, choose the point of sale, start the warranty in one gesture. Two steps, so that an activation is always tied to a real scan of that piece, never to a typed or remembered product id (a declared deviation from the brief, which asked for the lookup only). RETAIL, OPERATOR and ADMIN, never the read-only AUDITOR (`403 FORBIDDEN`; §2.3); ordinary admin mutations (session, CSRF, temporary password, MFA, role); the lookup in rate group `verify` (the budget of `/api/v1/verify`: the counter is not a faster way to judge codes than the public route), the activation in `admin`. Implementation: `routes/admin/sale.ts`, `services/sale.ts`, `VerificationService.staffScan`.

**`POST /api/admin/sale/lookup`**. Body: what the console's decoder read, in the shape of `/api/v1/verify` (§9.1: `code`, optional `genome` and `client`). The code is judged by steps 1–8 of the decision procedure (§9.4: structure, key, signature, revoked-key trust, genome version, registry, genome cross-check, code and product status), then ONE scan event is written, `event_type` **ADMIN_TEST** with the console user's id in `scan_events.admin_id`, and its authentication event (its risk is the weight of a step 6–7 finding when there is one, 0 otherwise). **No history rule is evaluated** (ADMIN_TEST scans are outside every one, so a busy counter never makes a piece look suspicious) and no `UNSOLD_PIECE_SCAN` is raised; **the code's own findings of steps 6–7 are recorded**, with `staffScan: true` in their details, as for a staff scan of `/api/v1/verify` (§9.7): `VALID_SIGNATURE_UNREGISTERED`, `CODE_MISMATCH` and `GENOME_MISMATCH` describe the code, not who scanned it, and a forged but validly signed code shown at the counter pages on a possible key compromise (§16.4) as anywhere else. No registration token, no public wording.

```json
{
  "scanId": "8b0f…",
  "state": "AUTHENTIC",
  "piece": {
    "productId": "O26-J-00184", "status": "ISSUED",
    "category": { "code": "J", "name": "Jewelry" }, "collection": "ORBIT",
    "model": "MONOLITHE", "type": "RING", "variant": "52", "material": "925 STERLING SILVER", "createdYear": 2026,
    "registered": false,
    "warranty": { "status": "NOT_STARTED", "startDate": null, "endDate": null }
  },
  "sale": { "token": "Qm9n…43 base64url characters", "expiresAt": "2026-10-02T10:10:00.000Z" },
  "refusal": null
}
```

`state` is the decision of steps 1–8, `AUTHENTIC` when none of them refused the code (no ownership or history state). `piece` is `null` unless the code is a registered ORBES code (key trusted, product and code found, payload hash equal). `sale` is a **10-minute, single-use SALE_ACTIVATION scan token** (stored as its SHA-256 only, minted in the scan's transaction), present only when the piece can be sold; otherwise `sale` is `null` and `refusal` says why, with the console's sentence. The checks run in this order:

| `refusal.code` | When |
|---|---|
| `NOT_AUTHENTIC` | `state` is not `AUTHENTIC` (malformed, unknown, invalid signature, suspicious: code or genome mismatch, LOST or STOLEN; revoked). The sentence says the code did not verify; for a piece the registry knows (`piece` present: lost, stolen, revoked, a superseded code, a seal that does not match), that ORBES must review it before it can be sold. |
| `WARRANTY_VOID` | The warranty was voided. |
| `WARRANTY_ACTIVE` | The warranty has already started: the piece was sold before. |
| `ALREADY_REGISTERED` | A client account holds the piece (`piece.registered`): it has been sold, even if its warranty never started. |
| `NOT_FOR_SALE` | The status does not allow a warranty to start, or the piece is in a service (SERVICED: at the workshop, not at the counter; a pre-sale service is refused by the warranty activation too, §14.6). |

Errors: `400 VALIDATION_FAILED` (body shape only; an undecodable code is a `MALFORMED_CODE` state, recorded like any scan).

**`POST /api/admin/sale/activate`**. Body `{ "token": the sale token, "retailerId": an active point of sale (§16.17) }`. In one transaction: the token is used up, then the warranty starts **today** (UTC) at that point of sale, its country the point of sale's (WarrantyService.activate, §14.6); an ISSUED piece moves to ACTIVATED. The token only works for the console user whose scan earned it; any refusal rolls the use back, so the token stays usable until it expires. What the token was minted on is checked again under the piece's row lock, since it may have changed during the 10 minutes: no client account holds the piece (a client who registered it meanwhile from its card: `409 ALREADY_REGISTERED`), it is not in a service, and the scanned code is still its ACTIVE code (`409 WARRANTY_ACTIVATION_NOT_ALLOWED`). **200** `{ "warranty": … (§14.6), "statusChange": … | null, "scanId": "8b0f…" }`. The audit entry `warranty.activate` names the seller (actor), the point of sale (`retailer`, `retailerId`) and the scan (`saleScanId`).

Errors: `400 VALIDATION_FAILED`, `400 SALE_TOKEN_INVALID` (unknown, a registration token, or another console user's), `409 SALE_TOKEN_USED`, `410 SALE_TOKEN_EXPIRED` (the three SALE_TOKEN errors call for a new scan: the screen keeps ACTIVATE WARRANTY off whatever point of sale is then chosen), `404 RETAILER_NOT_FOUND`, `409 RETAILER_INACTIVE`, `409 ALREADY_REGISTERED` (*This piece is registered to a client: it has been sold. Contact ORBES.*), `409 WARRANTY_ALREADY_ACTIVATED` (sold meanwhile from another phone or the console), `409 WARRANTY_VOID`, `409 WARRANTY_ACTIVATION_NOT_ALLOWED` (*The status of this piece does not allow a sale. Contact ORBES.* for a service opened or a code revoked meanwhile). These four hold whatever point of sale is chosen: the screen keeps ACTIVATE WARRANTY off after them too. Conversely, a sale token is refused by `/api/v1/ownership/register` (`400 REGISTRATION_TOKEN_INVALID`): a sale never registers an owner. The client registers the piece afterwards from the certificate card ("Register your piece with its card at theorbes.com/verify", the sale screen's closing instruction): the activated piece then verifies as AUTHENTIC — FIRST REGISTRATION.

### 16.19 Releases: the Club page's drops (extension of the contract)

P-R03 (`routes/admin/drops.ts`, `services/drops.ts`): the console's **Club** page (Clients), its **Drops** tab (`#/club`), and a release's page (`#/club/drops/:dropId`, reached from its row). These routes are the draw's: a LIVE RELEASE is left out of their list and answers `409 DROP_LIVE` to a draw, an offer to the waiting list, a change, a publication or a cancellation here; its own routes are §16.23. An AUDITOR reads, with the customers' emails masked; an OPERATOR creates, edits, publishes and cancels a release and concludes its entries; the draw is **ADMIN**'s.

A release is created a **`DRAFT`**: nothing of it is public. Its **seed**, 32 random bytes, is drawn at once, sealed (AES-256-GCM, with a key derived by HKDF from `KEY_ENCRYPTION_KEY`, as the console's TOTP secrets are, from `COOKIE_SECRET` without one, and the release's id as associated data) and committed by its SHA-256 (`seedHash`), which /verify shows from the publication on (§8.9): the draw cannot be run with another seed. A `DRAFT` changes freely; once published, its description only (`409 DROP_PUBLISHED`). Published, it shows on /verify. Cancelled, before its draw only.

The release object:

```json
{
  "id": "1f0c6c52-…",
  "title": "MONOLITHE, the first fifty",
  "description": null,
  "model": { "id": "5b8e…", "name": "MONOLITHE", "type": "RING", "active": true },
  "quantity": 50,
  "opensAt": "2026-10-12T10:00:00.000Z",
  "closesAt": "2026-10-14T10:00:00.000Z",
  "purchaseWindowHours": 48,
  "earlyAccessHours": 48,
  "earlyAccessOpensAt": "2026-10-10T10:00:00.000Z",
  "state": "OPEN",
  "publishedAt": "2026-10-10T09:00:00.000Z",
  "cancelledAt": null,
  "drawnAt": null,
  "createdAt": "2026-10-09T15:20:00.000Z",
  "createdBy": { "id": "c41d…", "email": "operator@theorbes.com" },
  "seedHash": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
  "seed": null,
  "entries": { "ENTERED": 120, "SELECTED": 3, "WAITLISTED": 0, "CONFIRMED": 0, "LAPSED": 0, "WITHDRAWN": 4 },
  "reserved": 3
}
```

`sizes` (plan NEXT LOT §3.6.F): the draw's sizes in order, `[{ "id", "label", "pieces", "reserved", "entered", "held", "waitlisted", "guaranteedEntered" }]`, each size's pieces, the pieces reserved directly in it, its entries waiting for the draw, the pieces held or sold in it, its waiting list, the pieces of its guaranteed entries waiting; `[]` for a draw without sizes; `quantity` is the sum of their pieces. `state`: `DRAFT`, else as §8.9. `seed`: `null` until the draw; the sealed seed is never sent. `entries`: the release's entries, counted by status. `earlyAccessHours` (P-X02): PALLADIUM's hours of early access before `opensAt`, 0 to 336; `earlyAccessPlatineHours` (BP-19 T3) PLATINE's, never more. `earlyAccessOpensAt`: when PALLADIUM's direct reservations begin, `opensAt` less those hours, and `earlyAccessPlatineOpensAt` PLATINE's; for a `DRAFT` without the clamp to its publication that §8.9 applies (the console says *from its publication* when publishing now would open them at once); `null` without an early access. `reserved`: the entries `SELECTED` or `CONFIRMED` that are direct reservations (the rest of them was drawn or offered). `priceMinor` and `currency` (plan NOCTURNE, addition 5; migration 0024): the price of a piece, in minor units of `currency`, or `null` for both; `model.variant` (N1): the model's label among its variants, or `null`.

- **`GET /api/admin/drops`** (AUDITOR): every release, the latest created first, paginated (§6).
- **`POST /api/admin/drops`** (OPERATOR): `{ modelId, title, description?, sizes, opensAt, closesAt, purchaseWindowHours?, earlyAccessHours?, earlyAccessPlatineHours?, priceMinor?, currency? }`: a model offered for new pieces (`404 MODEL_NOT_FOUND`, `409 MODEL_INACTIVE`); a title of one line, 1 to 120 characters; plain paragraphs of at most 2 000 characters (`""` or `null`: none); plan NEXT LOT §3.6.F, its **sizes** `[{ "label", "pieces" }]`, one per size of the model (at most 200 sent), each label one of the model's offered sizes (`linkDropSizes`: `400 SIZE_NOT_DECLARED`, `409 SIZE_SET_ASIDE` for a typed model; written as declared; given twice `400`), 0 to 10 000 pieces, a size at 0 left out; 1 to 24 sizes with pieces (`400 VALIDATION_FAILED` *A release has 1 to 24 sizes with pieces.*, without sizes too) and 10 000 pieces at most in all (*A release has at most 10 000 pieces.*); `quantity` is their sum, and a `quantity` sent is refused (*A draw’s pieces are given per size.*); ISO 8601 times, `closesAt` after `opensAt`; the hours a place drawn or reserved is held, 1 to 336 (48 when omitted); the hours of early access before `opensAt` by tier (P-X02; plan NEXT-NINE, BP-19 T3), PALLADIUM's `earlyAccessHours` and PLATINE's `earlyAccessPlatineHours`, whole numbers from 0 to 336 (THE PROGRAM's when omitted, §16.21: 4 and 2 by default, PLATINE's within PALLADIUM's; 0 for none; PLATINE's more than PALLADIUM's `400 VALIDATION_FAILED`, *PALLADIUM’s early access starts no later than PLATINE’s.*); its price (plan NOCTURNE, addition 5), optional, sent together: `priceMinor` a whole number of cents from 0 to 100 000 000 and `currency` `EUR`, `GBP`, `USD` or `CHF` (`null` for both, or neither sent: none; one without the other `400 VALIDATION_FAILED`), shown on its card and page (§8.9) and taken by the order of each entry confirmed (§16.24) instead of a price to enter. **201** — the release, a `DRAFT`. Audited `drop.create` with its fields (`earlyAccessHours`, `earlyAccessPlatineHours`, `priceMinor` and `currency` included), its `seedHash` and its `sizes` (`[{ label, pieces }]`).
- **`GET /api/admin/drops/:id`** (AUDITOR): one release. `404 DROP_NOT_FOUND`.
- **`PATCH /api/admin/drops/:id`** (OPERATOR): at least one field of the creation's; plan NEXT LOT §3.6.F: `sizes` replace the draft's (a size of the same label keeps its id; a draft of before this lot gets its first), `quantity` following, a `quantity` sent refused as at the creation, a new model linking the sizes again (its own sizes); a `DRAFT` changes any of them, a release published (or cancelled) its `description` only (`409 DROP_PUBLISHED`, `409 DROP_CANCELLED`). `earlyAccessHours`, `earlyAccessPlatineHours` (never more than PALLADIUM's: `400 VALIDATION_FAILED`) and the price (`priceMinor` with `currency`, `null` for both clears it) are fields a `DRAFT` only changes (`409 DROP_PUBLISHED` after); a LIVE RELEASE has none (`409 DROP_LIVE`). **200** — the release. Audited `drop.update` with each value changed, before and after (the description as its length and SHA-256, never its words; `earlyAccessHours` like the others; the sizes as `[{ label, pieces }]` with `quantity`); nothing changed, nothing written.
- **`POST /api/admin/drops/:id/publish`** (OPERATOR, no body): the `DRAFT` shows on /verify with its `seedHash`. Refused once published (`409 DROP_ALREADY_PUBLISHED`), cancelled (`409 DROP_CANCELLED`), when its entries would already be closed (`409 DROP_WINDOW_PAST`) or its model is no longer offered (`409 MODEL_INACTIVE`), and (plan NEXT LOT §3.6.F) a `DRAFT` created before this lot, without sizes (`409 DROP_SIZES_REQUIRED`). Audited `drop.publish` with `{ seedHash, quantity, opensAt, closesAt, earlyAccessHours, earlyAccessOpensAt, sizes }`, `earlyAccessOpensAt` the actual opening of its direct reservations (from the publication at the earliest), or `null` without one.
- **`POST /api/admin/drops/:id/cancel`** (OPERATOR, no body; the console asks for the phrase `CANCEL` and the first 8 characters of the id): before the draw only (`409 DROP_ALREADY_DRAWN`; `409 DROP_CANCELLED` twice). Its entries stay as they were, without a draw. Audited `drop.cancel` with `{ published, entered }`.
- **`POST /api/admin/drops/:id/draw`** (**ADMIN**, no body; the console asks for the phrase `DRAW` and the first 8 characters of the id): under the release's row lock, refused for a draft (`409 DROP_NOT_PUBLISHED`), before `closesAt` (`409 DROP_NOT_CLOSED`), cancelled (`409 DROP_CANCELLED`) or drawn (`409 DROP_ALREADY_DRAWN`: once only). The seed is opened and checked against `seedHash` (`503 DROP_SEED_UNAVAILABLE` otherwise, and nothing is written). Every entry still `ENTERED` takes part: its account's tier and seniority are read **now** (§10.10), never at its entry, and the order of §8.9 ranks them; the places left (`quantity` less the entries `SELECTED` or `CONFIRMED`, the direct reservations of the early access among them) are `SELECTED`, held `purchaseWindowHours` from now (`respondBy`), the others `WAITLISTED`, each with its rank. The seed is stored in clear with `drawnAt`, and published (§8.9). A draw with sizes (plan NEXT LOT §3.6.F) fills each size in the rank order, as §8.9 says. **200** `{ "drop": { … }, "entries": 132, "places": 50, "selected": 50, "waitlisted": 82, "sizes": [{ "id", "label", "places", "selected", "waitlisted" }] }` (`sizes` `[]` without sizes). Audited `drop.draw` with `{ entries, places, selected, waitlisted, seed }` and, per size, `sizes`.
- **`GET /api/admin/drops/:id/entries`** (AUDITOR; `?status=` one of the six, `?sizeId=` one of its sizes (plan NEXT LOT §3.6.F; `404 DROP_SIZE_UNKNOWN` otherwise), `?page=`, `?pageSize=`): its entries, by rank once drawn (the others after them), else by entry: `{ id, accountId, email, status, enteredAt, tier, seniority, rank, respondBy, reserved, size, handledBy, handledAt, note }`, `size` `{ id, label }` or `null`, `reserved` `true` for a direct reservation of the early access (P-X02; its `tier` and `seniority` those of its request, no `rank`), `email` masked for an AUDITOR (`j***@example.com`), `handledBy` `{ id, email }` of the staff member who concluded it.
- **`POST /api/admin/drops/:id/entries/:entryId/confirm`** and **`…/lapse`** (OPERATOR; `{ "note"?: string | null }`, at most 500 characters): on an entry whose place is held (`409 DROP_ENTRY_NOT_SELECTED` otherwise), `CONFIRMED` (the sale concluded by ORBES Client Services) or `LAPSED`, **only once its `respondBy` has passed** (`409 DROP_PLACE_HELD` before: a place is never taken back early). No sale is confirmed on a cancelled release (`409 DROP_CANCELLED`; its direct reservations, still held, may lapse). A direct reservation is concluded or lapses the same way; lapsed, its place returns to the draw (before it) or to *Offer next* (after it). **200** — the entry. Audited `drop.entry.confirm` or `drop.entry.lapse` with `{ entryId, rank }` (and `noted: true` with a note, never its words). `404 DROP_ENTRY_NOT_FOUND`.
- **`POST /api/admin/drops/:id/offer-next`** (OPERATOR, no body, `{}`, or `{ "sizeId" }`): the first `WAITLISTED` entry by rank is `SELECTED`, its place held `purchaseWindowHours` from now, only while the entries `SELECTED` and `CONFIRMED` stay under `quantity` (`409 DROP_FULL`) and one is left (`409 DROP_WAITLIST_EMPTY`); before the draw, `409 DROP_NOT_DRAWN`. Plan NEXT LOT §3.6.F: a draw with sizes offers per size, `sizeId` required (`400 DROP_SIZE_REQUIRED`, `404 DROP_SIZE_UNKNOWN`), the first of that size's waiting list while the pieces held or sold in it stay under its pieces (`409 DROP_FULL`). **200** — the entry. Audited `drop.entry.offer` with `{ entryId, rank, respondBy }` (and `sizeId`).

Every action reads the release's row under an update lock, so two of them, or an action and a draw, never cross; an entry or a withdrawal (§10.10) waits on it too. The audit log names the release and the entry's id, never an email; a direct reservation is audited `drop.reserve` `{ entryId, tier, respondBy }`, the account as actor (§10.10).

Errors besides: `400 VALIDATION_FAILED` (`:id` or `:entryId` not a UUID, a body out of bounds), `403 FORBIDDEN` (an AUDITOR's mutation, an OPERATOR's draw), `403 CSRF_FAILED`, `404 DROP_NOT_FOUND`.

In the console: Club (Clients), Drops: the releases with their state, window of entries (UTC), pieces, entries and places held or sold; **New release** (OPERATOR) opens two dialogs (plan NEXT LOT §3.6.F): its **Model**, then its fields (times read and written in UTC; *Early access, PALLADIUM (hours)* and *Early access, PLATINE (hours)*, prefilled from THE PROGRAM, 0 for none), where one field of pieces per offered size of that model (read from `GET /api/admin/models/:id/sizes`, labelled with the size: *Size 52*, *ONE SIZE*) takes the place of *Pieces*, under *The sizes this model declares. Give each size its pieces; 0 leaves it out of the draw.* (and *Up to 24 sizes with pieces.* for a model that declares more), the pieces in all said below (*12 pieces in all*) with, per size the stock at the default location does not cover, *52: 12 in stock, 13 will wait for supplier stock.* (§3.5.4.3, read from the size mix, `GET /api/admin/live/size-mix`); a model with no offered size reads *No sizes yet: give this model its size type and its sizes in the Catalogue.* and cannot be created a draw. A draft's **Edit** takes the same two dialogs, and **Sizes and pieces** (a DRAFT, OPERATOR) its sizes' fields alone. A release's page adds **Sizes**: *Size · Pieces · Reserved · Entered · Held or sold · Waiting list*, with **Offer next** on a size's row once drawn while it has a place free and a waiting list (OPERATOR; the release's own Offer next stays for a draw without sizes); its entries a **Size** column and a size filter (*All sizes*); the draw's toast says each size, *17: 5 selected, 12 on the waiting list.* A release's page: its facts (*Early access PALLADIUM 4 hours · from 10 OCT 2026 · 06:00 UTC; PLATINE 2 hours · from 08:00 UTC*, or *None*; *Reserved directly 3 of 50*), the fingerprint of its seed, its address on /verify once published, then, once drawn, its seed; Edit, Description, Publish, Cancel (a phrase to type) and **Run the draw** (ADMIN, a phrase to type); its entries with Confirm and Lapse on a place held (Lapse once its time has passed), and Offer next while places are left.

**The house's guarantee** (plan NEXT-NINE, IN-01; §16.30): a release's object adds `guaranteed` (`{ "places", "pieces" }`, the guarantees set aside for it or used in it), `heldPieces` (the pieces of its places held or sold: a guaranteed place may hold several) and `guaranteedEntered` (`{ "places", "pieces" }`, the entries waiting for the draw with a guarantee); an entry of `…/entries` adds `guaranteed` and `pieces`. **Publish** sets aside, for the release, the guarantees waiting in its scope (its model's, its collection's) while it has room (`guarantee.cover`). A `DRAFT`'s `quantity` never goes below the pieces guaranteed (`409 DROP_GUARANTEES_EXCEED`). **The draw** selects the entries with a guarantee first, without a rank, each holding its pieces (one order per piece when Client Services confirms it, §16.24), then ranks the others for `quantity` less the pieces held and guaranteed, exactly as §8.9 says; it uses the guarantees (`guarantee.use`) and releases those set aside for the release but not entered: a RELEASE guarantee, or one past its validity, expires; a MODEL or COLLECTION one waits for the next release in its scope (`guarantee.carry`). `drop.draw` adds `guaranteed` and `guaranteedPieces`, and the draw's answer too. A cancellation releases them the same way. In the console: the release's page reads *Guaranteed 2 places · 3 pieces* (*Selected first at the draw, listed apart on the public page.*), its entries mark GUARANTEED, the run-the-draw dialog says *1 guaranteed place, 2 pieces, is selected first; the draw ranks the other entries for the 48 places left.*, and **Guarantees** lists the release's guarantees (*Places guaranteed by the house: selected first, for their pieces*; §16.30).

### 16.20 The circle: the Club page's posts (extension of the contract)

P-X01 (`routes/admin/circle.ts`, `services/circle.ts`; the photographs in `routes/admin/media.ts`): the console's **Club** page, its **Circle** tab (`#/club`, tab `circle`), and a post's page (`#/club/circle/:postId`). An AUDITOR reads, with the customers' emails masked; an OPERATOR (console capability `manageCircle`) creates, edits, publishes and withdraws a post and its photographs. Every change takes the post's row lock (`FOR UPDATE`).

A post may name a **segment** (`segmentId`, plan LIVE RELEASE+, choice 27; `null`: none; **`404 SEGMENT_NOT_FOUND`**): only that segment's members among its tiers read it, evaluated at each request (the feed, the post, an answer, a vote: the same `404 CIRCLE_POST_NOT_FOUND` for anyone else); the post object says it as `segment: { id, name }`, a member never reads its name. Audited with `circle.post.create`, `.update` and `.publish` (`segmentId`).

An invitation may be an **experience** of the tier program (`experience`, plan NEXT-NINE, BP-19 T7: `MEMBERS_EVENING`, `LAUNCH_PREVIEW`, `PARTNER_EXPERIENCE`, or `null`), on `POST` and `PATCH`; any other kind refuses one (**`422 VALIDATION_FAILED`** *Only an invitation is an experience.*), an unknown value is `400`. Its `minTier` is then the tier THE PROGRAM names for it (§16.21: the members' evening from PLATINE, the launch previews and the partner experiences from PALLADIUM by default), set when the experience is, whatever `minTier` is sent; cleared, the post keeps its tier or takes the one sent. The post object, the feed's cards and a member's post carry `experience`; /verify shows it above the invitation's title (*MEMBERS' EVENING*, *LAUNCH PREVIEW*, *PARTNER EXPERIENCE*). Audited with `circle.post.create` and `.update` (`experience`, and the tier it set). In the console, the invitation's dialog has *Experience* (None, Members' evening, Launch preview, Partner experience): once one is chosen, *Read by* shows THE PROGRAM's tier, locked (*Set in Club → Tiers, THE PROGRAM.*); the list says the experience beside the kind.

The post object (`AdminCirclePost`):

```json
{
  "id": "3d0b6f0e-…",
  "kind": "POLL",
  "title": "Which stone next winter?",
  "body": "Two stones are in the atelier.\n\nTell us which one you would wear.",
  "minTier": 1,
  "experience": null,
  "eventAt": null,
  "eventPlace": null,
  "capacity": null,
  "pollOptions": ["Onyx", "Moonstone"],
  "drop": null,
  "model": { "id": "5b8e…", "name": "MONOLITHE", "type": "RING", "lookbook": "PUBLIC", "slug": "monolithe" },
  "externalUrl": "https://www.youtube.com/watch?v=…",
  "published": true,
  "publishedAt": "2026-10-05T09:00:00.000Z",
  "createdAt": "2026-10-04T16:00:00.000Z",
  "createdBy": { "id": "c41d…", "email": "operator@theorbes.com" },
  "photos": [ { "sha256": "4b1a…", "url": "/api/v1/media/4b1a…", "alt": null, "position": 1 } ],
  "answers": { "YES": 0, "NO": 0 },
  "results": { "counts": [12, 9], "total": 21 }
}
```

`drop`: the linked release `{ id, title, state }`; `model`: the linked model `{ id, name, type, lookbook, slug }` (a HIDDEN model is not shown to members, §10.11); `answers`: an invitation's answers by answer (`0` and `0` for another kind); `results`: a poll's votes by option, `null` for another kind (the console reads them at once; a member, once voted).

- **`GET /api/admin/circle/posts`** (AUDITOR): every post, the latest created first, paginated (§6), **without its body**.
- **`POST /api/admin/circle/posts`** (OPERATOR): `{ kind, title, body?, minTier?, eventAt?, eventPlace?, capacity?, pollOptions?, dropId?, modelId?, externalUrl? }`. `kind` `NOTE`, `INVITATION` or `POLL`; `title` one line, 1 to 120 characters; `body` plain paragraphs, at most 6 000 characters (`""`/`null`: none); `minTier` 1, 2 or 3 (1 when omitted); an invitation's `eventAt` (ISO 8601, required), `eventPlace` (one line, at most 200) and `capacity` (1 to 10 000; `null`: no limit); a poll's `pollOptions` (2 to 6 lines of 1 to 40 characters, each different). The fields of another kind: `400 VALIDATION_FAILED`. Links, each optional: `dropId` (`404 DROP_NOT_FOUND`), `modelId` (`404 MODEL_NOT_FOUND`), `externalUrl` (an `https` address on `CIRCLE_LINK_HOSTS` or a subdomain, without credentials or port, at most 500 characters; another host: `400 VALIDATION_FAILED`). **201** — the post, not published. Audited `circle.post.create` with its fields, the body as `{ length, sha256 }`.
- **`GET /api/admin/circle/posts/:id`** (AUDITOR): one post, with its body. `404 CIRCLE_POST_NOT_FOUND`.
- **`PATCH /api/admin/circle/posts/:id`** (OPERATOR): at least one field of the creation's but `kind` (a post never changes kind; `kind` is an unknown field, 400); `null` or `""` clears an optional one. A poll's options no longer change once a vote is cast (`409 CIRCLE_POLL_VOTED`); an invitation's capacity never goes under its YES (`409 CIRCLE_CAPACITY_BELOW`). Published or not. **200** — the post. Audited `circle.post.update` with each value changed, before and after (the body as its length and SHA-256); nothing changed, nothing written.
- **`POST /api/admin/circle/posts/:id/publish`** (OPERATOR, no body): the post shows in the circle from its tier up, from now on. `409 CIRCLE_ALREADY_PUBLISHED`. Audited `circle.post.publish` with `{ kind, minTier }`.
- **`POST /api/admin/circle/posts/:id/unpublish`** (OPERATOR, no body): withdrawn from the circle (members read 404); its answers and votes are kept, and it may be published again. `409 CIRCLE_NOT_PUBLISHED`. Audited `circle.post.unpublish` with `{ publishedAt }`.
- **`GET /api/admin/circle/posts/:id/answers`** (AUDITOR; `?answer=YES|NO`, `?page=`, `?pageSize=`): the answers to an invitation, the latest changed first: `{ accountId, email, answer, createdAt, answeredAt }`, `email` masked for an AUDITOR (`j***@example.com`), in clear for an OPERATOR or an ADMIN.

**The photographs of a post** (OPERATOR; `routes/admin/media.ts`, `MediaService`): at most **4**, in an order, each with its alternative text (`circle_post_images`, DATABASE §5.32), under the post's row lock.

- **`POST /api/admin/circle/posts/:id/photos`**: a photograph, added last. The body is **the image itself**, exactly as for a model's reference photograph (§13.4: `image/jpeg` or `image/webp`, at most 1 MiB, its bytes checked, its metadata removed, stored once by its SHA-256). A fifth: `409 CIRCLE_PHOTOS_FULL`; the same photograph again writes nothing. Audited `circle.post.photo.add` with `{ sha256, mime, width, height, bytes, position }`. **200** — the post.
- **`DELETE /api/admin/circle/posts/:id/photos/:sha256`**: a photograph leaves the post, the next ones move up; one that is not the post's: `404 CIRCLE_PHOTO_NOT_FOUND`. Audited `circle.post.photo.remove` with `{ sha256, position }`. The image, used by no model, gallery, other post or piece, is deleted. **200** — the post.
- **`PATCH /api/admin/circle/posts/:id/photos`**: the order and the alternative texts, JSON `{ "images": [ { "sha256": string, "alt"?: string | null } ] }`, every photograph of the post once, in the new order (`alt` one line of at most 200 characters; `""`/`null`: the post's default; left out: unchanged). A list that no longer matches: `409 CIRCLE_PHOTOS_CHANGED`, nothing written. Audited `circle.post.photo.update` with `{ before, after }`; unchanged, nothing written. **200** — the post.

Errors besides: `400 VALIDATION_FAILED` (`:id` not a UUID, `:sha256` not 64 hexadecimal characters, a body out of bounds), `400 IMAGE_INVALID`, `400 IMAGE_ANIMATED`, `403 FORBIDDEN` (an AUDITOR's mutation), `403 CSRF_FAILED`, `404 CIRCLE_POST_NOT_FOUND`, `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`. The photograph upload is one of the four routes the edge lets carry 1 200 KB (§13.4).

In the console: Club (Clients), **Circle**: the posts with their kind, tier, state and answers or votes; **New note**, **New invitation**, **New poll** (OPERATOR). A post's page: its fields and its page on /verify once published, Edit (any field but the kind), Publish or Withdraw; its text as a member reads it; its photographs (added through the photograph dialog, Earlier, Later, Alt text, Remove); the answers to an invitation (YES and NO, the places left, each account with its email masked for an AUDITOR and a link to its sheet) and the results of a poll.

### 16.21 The tiers: the Club page's benefits (extension of the contract)

P-X04 (`routes/admin/club.ts`, `services/club.ts`): the console's **Club** page, its **Tiers** tab. The tiers are TITANE, PLATINE and PALLADIUM, reached at **1, 5 and 10 pieces held now** (`CLUB_TIER_THRESHOLDS`, a constant of the code that never changes here: a setting could contradict the published rule of a draw). Only the **words of their benefits** change, what each tier adds to the ones below it, shown in MY PIECES (§10.10). Nothing personal is read or written.

- **`GET /api/admin/club/tiers`** (AUDITOR): `{ "items": [ { "tier": "TITANE", "level": 1, "pieces": 1, "benefits": "…", "defaultBenefits": "…", "edited": false, "updatedAt": null }, … ] }`, TITANE first. `benefits`: the words now, one benefit per line; `defaultBenefits`: the words by default (`CLUB_TIER_DEFAULT_BENEFITS`, in English); `edited`: the console changed them (a row of `club_tiers`); `updatedAt`: when, `null` while they are the default ones.
- **`PATCH /api/admin/club/tiers/:tier`** (OPERATOR; console capability `manageClubTiers`): `:tier` is `TITANE`, `PLATINE` or `PALLADIUM` exactly (any other value: `400 VALIDATION_FAILED`). Body `{ "benefits": string | null }`, strict. One benefit per line: blank lines and the spaces around each line are dropped, then at most **600 characters** and **8 lines** (`CLUB_TIER_BENEFITS_MAX`, `CLUB_TIER_BENEFIT_LINES`; `400 VALIDATION_FAILED` beyond). `null`, `""` or the default words exactly **restore the default** (the tier's row is deleted). **200** — the tier's sheet, as in the list. Audited `club.tier.update` with `{ tier, benefits, previous }` (`benefits` `null`: the default restored; `previous` the console's words before, or `null`).

Errors: `400 VALIDATION_FAILED`, `403 FORBIDDEN` (an AUDITOR's change), `403 CSRF_FAILED`.

In the console: Club (Clients), **Tiers**: one panel per tier with *Reached* (its threshold, a constant of the code), its *Program* (the lines of THE PROGRAM below, as /verify shows them), its *Benefits* as MY PIECES lists them and its *Words* (*Default*, or *Edited* with the time); **Edit benefits** (OPERATOR) opens a dialog of one benefit per line, and **Restore default** removes the console's words. The owner's sheet (§16.11) reads the account's tier.

**THE PROGRAM** (plan NEXT-NINE of 2026-10-06, BP-19 T2; `services/club-program.ts`, `club_program_settings`, DATABASE §5.64): every figure of the tiers' benefits the owner called configurable, above the three panels of the Tiers tab. The thresholds stay a constant of the code.

- **`GET /api/admin/club/program`** (AUDITOR): the program now (its row, or the columns' defaults), with the gift models and each tier's lines:

  ```json
  { "earlyAccessPalladiumHours": 4, "earlyAccessPlatineHours": 2, "shippingFreePlatine": "STANDARD", "shippingFreePalladium": "EXPRESS",
    "carePiecesPlatine": 1, "carePiecesPalladium": null, "messagesPriorityMinTier": 2, "giftPlatineModelId": null, "giftPalladiumModelId": null,
    "creditPlatineMinor": 5000, "creditPalladiumMinor": 10000, "creditCurrency": "EUR", "creditValidityMonths": 12, "creditChannels": ["DRAW", "LIVE", "SALON"],
    "experienceMembersEveningMinTier": 2, "experienceLaunchPreviewMinTier": 3, "experiencePartnerMinTier": 3,
    "gifts": { "platine": null, "palladium": null },
    "giftOptions": [ { "id": "…", "name": "ECLIPSE", "active": true, "discontinued": false, "sizes": 3, "available": 4, "imageUrl": "/api/v1/media/…" } ],
    "lines": { "TITANE": [], "PLATINE": [ "Early access to each draw: a place reserved directly 2 hours before entries open to everyone, unless its page says otherwise.", "…" ], "PALLADIUM": [ "…" ] },
    "updatedAt": null, "updatedBy": null }
  ```

  `carePiecesPalladium` `null`: every piece; `messagesPriorityMinTier` `0`: off; a gift model's `sizes` are its SKUs and `available` its pieces available now, every location together; `giftOptions` the active models a gift may be. `lines`: what each tier's program says, in English, in this order: its early access, its free shipping, its yearly care, the priority with Client Services (on the tier it starts from), its welcome gift (while its model is active), its credit, then the experiences of the circle (each on the tier it invites from); a setting that gives nothing gives no line.
- **`PUT /api/admin/club/program`** (**ADMIN**; console capability `manageClubProgram`): the program whole, every field of the shape above but `gifts`, `giftOptions`, `lines`, `updatedAt` and `updatedBy`, strict. Bounds: each early access 0–336 hours and PALLADIUM's at least PLATINE's (`422 PROGRAM_EARLY_ACCESS`); the free shipping `NONE`, `STANDARD` or `EXPRESS`; the care 0–20 pieces (PALLADIUM's `null` for every piece); the priority `0`, `2` or `3`; a gift's model existing (`404 MODEL_NOT_FOUND`) and active (`409 MODEL_INACTIVE`; a model chosen before and discontinued since may stay, and gives no gift until another is chosen), or `null`; each credit 0 (none) to 100 000 000 minor units, in `EUR`, `GBP`, `USD` or `CHF`, valid 1–60 months, on at least one of `DRAW`, `LIVE`, `SALON`; each experience's tier 1–3. **200** — the program as `GET` reads it. Audited `club.program.update` with `{ before, after }` (figures and model ids only).

Errors: `400 VALIDATION_FAILED`, `403 FORBIDDEN` (an OPERATOR's or an AUDITOR's change), `403 CSRF_FAILED`, `404 MODEL_NOT_FOUND`, `409 MODEL_INACTIVE`, `422 PROGRAM_EARLY_ACCESS`.

In the console: **THE PROGRAM** lists every setting with *Set* (*Changed by … on …*, or *The defaults*); **Edit program** (ADMIN) opens one dialog of every field, refusing what the server would refuse before anything is sent. The gift selects list the active models as `MODEL · n sizes · n available` (`MODEL · one size · n available`), with the hint *A model of several sizes: Client Services chooses the size on the gift’s order.*; a gift model discontinued since shows *This gift’s model is discontinued: no gift is added until another is chosen.*

### 16.22 The private salon: the Club page's requests (extension of the contract)

P-X08 (`routes/admin/club.ts`, `services/salon.ts`; DATABASE §5.37): the console's **Club** page, its **Requests** tab. What owners requested from THE PRIVATE SALON (§10.9, REQUEST THIS PIECE): ORBES Client Services contacts each client, concludes the sale outside the service (nothing is paid on /verify, no email is sent), then closes the request with a note.

- **`GET /api/admin/club/requests`** (AUDITOR): `?status=OPEN|CLOSED` (left out: every request), `?page`, `?pageSize` (§6). Paginated, **OPEN first, then the newest** (`shop_requests_queue_idx`):

  ```json
  { "items": [ { "id": "6f1c…", "status": "OPEN", "createdAt": "2026-10-04T10:02:11.000Z", "note": "A call after six, please.", "size": "54",
                 "account": { "id": "9a3e…", "email": "j***@example.com" },
                 "model": { "id": "73c6…", "name": "ECLIPSE", "type": "RING", "slug": "eclipse", "priceLabel": "€ 4 800" },
                 "handledBy": null, "handledAt": null, "resolutionNote": null } ],
    "page": 1, "pageSize": 50, "total": 1 }
  ```

  `note`: the account's words, `null` without one. `size` (plan NEXT-NINE, AC-01): the size asked, `null` when none was (the console's Size cell: *Not given*); once ACCEPTED is chosen, the close dialog says *The order takes size 54.*, and the request's order is created with that size and its SKU (held as any order's); on a model with its size type, the order keeps the declared label of the SKU the size names (plan NEXT LOT §3.3: `SIZE 52` asked where `52` is declared too is stored `52`). `account.email`: **masked for an AUDITOR** (`j***@example.com`, as in §16.2), in clear for OPERATOR and ADMIN (`routes/admin/serialize.ts` `clientEmail`). `handledBy`: the console user who closed it (`{ id, email }`), `null` while open or when closed by a script; `handledAt`, `resolutionNote` (the console's note, `null` while open or when a lock closed it). An unknown `status`: `400 VALIDATION_FAILED`.
- **`POST /api/admin/club/requests/:id/close`** (OPERATOR; console capability `closeShopRequest`): body `{ "note": string }`, strict, **required**: what was done for the client (the sale concluded, a fitting arranged, or why nothing was), 1 to **2 000** characters once trimmed (`SHOP_RESOLUTION_MAX`), no control character. Under the request's row lock: `CLOSED`, `handled_by` the admin, `handled_at` now (never before its creation), `resolution_note` the note. **200** — the request, as in the list (the email masked for an AUDITOR, who cannot close it anyway). Audited `shop.request.close` (target the `shop_request`, details `{ modelId }`): **the note is never copied into the audit log** (it may name the client), nor the account's note. Unknown: `404 SHOP_REQUEST_NOT_FOUND`; closed already: `409 SHOP_REQUEST_CLOSED`.

A lock of the account (§16.12) closes its open requests too, without a note (`shop.request.close` with `reason: "account_locked"`). The account's requests are in its export (§16.13, `shopRequests`). The audit entry of a request, `shop.request`, names the account as actor (§10.9).

Errors: `400 VALIDATION_FAILED` (a missing or blank note, over 2 000 characters, `:id` not a UUID, an unknown field), `403 FORBIDDEN` (an AUDITOR's close), `403 CSRF_FAILED`, `404 SHOP_REQUEST_NOT_FOUND`, `409 SHOP_REQUEST_CLOSED`.

In the console: Club (Clients), **Requests** (`#/club?tab=requests`): the filter *Status* (All, Open, Closed), then one row per request: *Requested*, *Client* (a link to the owner's sheet, §16.11), *Model* (its type and the price the salon shows, then the client's note), *Status* (OPEN as an alert mark, CLOSED muted, with who closed it, when, and the note); **Close** (OPERATOR) opens a dialog that shows the client's note and asks for the note, required. The price and tier of each model are set on its Lookbook page, section **Private salon** (§13.4).

---

### 16.23 The LIVE RELEASES: the Club page's live releases (extension of the contract)

The console of the LIVE RELEASES (plan of 2026-10-04; `routes/admin/live.ts`, `services/live-console.ts`, `services/live.ts` for the live controls, `services/live-insights.ts` for the intelligence, `MediaService` for the silhouette): the **Club** page's **Drops** tab lists them (`Live releases`, `New live release`), and a release's page is `#/club/live/:dropId`. An **AUDITOR** reads everything, the customers' emails masked (`j***@example.com`: in the board, its stream, the entries, the bot radar and the collector insights); an **OPERATOR** creates, edits, publishes and cancels a release and runs the live controls; **END NOW** and **REMOVE** are **ADMIN**'s. Every mutation is audited by its service (`drop.live.*`, ids only, never an email, a secret or a note); every route has its role probe (`test/api/admin-roles.test.ts`). A DRAW's id answers `404 DROP_NOT_FOUND` here, a LIVE RELEASE's on the draw's routes `409 DROP_LIVE` (§16.19). Plan LIVE RELEASE+ (step S8): *New live release* names the stock location and, once the model is chosen, proposes its sizes from the size mix (written into the sizes while they are the default or the last proposal, never over sizes typed by hand); *Publish* first reads the feasibility check and shows its warning per size, then publishes all the same; the page's *Question after* part sets the question and, once the release has ended, says who is asked where and counts each answer; *Best time to open* stands among its readings until the announcement.

**Settings** (`POST /api/admin/live`, `PATCH /api/admin/live/:id`; `createLiveBody`, `updateLiveBody`): `modelId` (a model offered for new pieces), `title`, `description`; `opensAt` (T0) and `closesAt` (the end of the sales, after T0); `roomOpensMinutes` (1–60, 5 by default), `turnSeconds` (10–300, 30), `payMinutes` (1–60, 5), `perAccount` (1–5, 1); `priceMinor` (cents) and `currency` (`EUR`, `GBP`, `USD`, `CHF`; EUR by default); who may enter, `minTier` (0 any ORBES account … 3 PALLADIUM), `accessModelIds` (at most 20) and `accessCollectionId`, `minParticipations` (1–100 releases taken part in; `null`: no such rule), `accessSegmentId` (a segment, §16.26; **`404 SEGMENT_NOT_FOUND`**) and `accessCombine` (`AND`, the default, or `OR`: one choice for every rule); the surprise (choice 3), `surpriseEnabled` and `surpriseText` (1–500 characters, required while on; kept when turned off): on each order of the release and its after-room, on its packing slip and work sheet, the page saying only A SURPRISE IN EVERY BOX, the audit log its length and fingerprint; `tierPriority` (on by default); `sizes`, 1 to 24 rows `{ id?, label (≤ 12), stock (0–10 000) }`, 1 to 10 000 pieces in all (the release's `quantity` is their sum); `quantityLine` (≤ 40 characters; empty: `<quantity> PIECES`, which then follows the stock); `addons`, at most 6 `{ id?, label (≤ 40), line (≤ 120)?, priceMinor }`; the staged reveals `announceAt` (empty: at the publication), `silhouetteAt`, `nameAt`, `photoAt` (empty: at the announcement), in that order and all before the room's opening (the CHECK `drops_live_stages` reads an empty stage as the announcement, so a stage set after an empty one is refused); `tierWindows`, at most one per tier `{ tier, turnSeconds?, payMinutes? }` (e.g. PALLADIUM: 10 minutes to pay); `stockLocationId` (plan LIVE RELEASE+, choice 16; a location of §16.24, **`404 STOCK_LOCATION_NOT_FOUND`**; empty or `null`: the default location): where its orders hold a piece in stock or have one made, and the stock its feasibility check reads (an after-room's is its release's); the question after (choice 11, §10.16), `questionEnabled` (on by default; turned off, its words are kept) and `questionText` (one line, 1–120 characters) with `questionAnswers` (2 to 6, one line of 1–40 characters each, each once whatever its case), both or neither (`null` and `null`: the default question; the default's own words are stored as it); `afterRoom` (plan LIVE RELEASE+, choice 2; `null`: none), `{ modelId, priceMinor, sizes, addons?, delayMinutes (1–60, 10), lengthMinutes (5–120, 15) }`: a child LIVE RELEASE, a DRAFT until a sell-out opens it for those still in the line, its turn and pay windows (per tier too), pieces per person, currency, location and surprise the release's, no question after; never listed, set, published, cancelled nor given a board link on its own (**`409 LIVE_AFTER_ROOM`**), its own page `afterRoomOf` with the live board and controls; the release's page `afterRoom` (its settings, `state` WAITING · OPENS · OPEN · OVER · NOT_OPENED, `skipped` NO_GUESTS · NOT_SOLD_OUT · CANCELLED, its times, `guests`, `entries`). Audited by the engine on the release: `drop.live.after_room.open` (its id, the guests' count, its times), `drop.live.after_room.skip` (its id, why). A list given replaces the release's (a row with the `id` of an existing size or add-on keeps it). The seed is drawn and sealed at creation (`seedHash`, its SHA-256, shown in the console, never revealed for a LIVE RELEASE). **Everything changes until the announcement**; after it, **`409 LIVE_ANNOUNCED`**: only the stock rises, with ADD PIECES.

**The sizes of a model with its size type** (plan NEXT LOT §3.3, §13.4): each line of `sizes` names one of the model's offered sizes (`400 SIZE_NOT_DECLARED`, the error listing them; `409 SIZE_SET_ASIDE`), matched by its label whatever the case or by its measure, and stored with the declared label (`SIZE 52` and `52 MM` are `52`; a model of one size `ONE SIZE`). Two lines of one size (`52` and `SIZE 52`) are `400` *The size 52 is listed twice.* before anything is written. A model with no size type (one of before H1) as before: its sizes named as typed, their SKUs created when missing.

| Method | Path | Role | What it does |
|---|---|---|---|
| GET | `/api/admin/live` | AUDITOR | Every LIVE RELEASE, the latest created first, paginated (§6): `{ id, title, model, phase, over, announcedAt, roomOpensAt, opensAt, closesAt, quantity, quantityLine, priceMinor, currency, endedReason, entries (by status), interest }` |
| POST | `/api/admin/live` | OPERATOR | A `DRAFT` with its settings. **201** the release. Audited `drop.live.create` |
| GET | `/api/admin/live/:id` | AUDITOR | One, every setting: the card and `description`, `editable`, the windows, `access` (with its words), `sizes`, `addons`, `tierWindows`, the stages as set and, once published, as revealed, `silhouette`, `boardLink` (`{ issuedAt }`, never its secret), `circlePosts`, `publishedAt`, `cancelledAt`, `pausedAt`, `pausedMs`, `endedAt`, `createdBy`, `seedHash`; plan LIVE RELEASE+: `locationId` (as set, `null` the default) and `location` (the one it means, `{ id, name }`), and `question` (`null` for an after-room): `{ text, answers, custom, enabled, state (OFF · WAITING · OPEN · CLOSED), opensAt, closesAt, asked: { tookPart, interest }, answered, tally: [ { answer, label, count } ] }`, who is asked in each place now and each answer counted (§10.16) |
| PATCH | `/api/admin/live/:id` | OPERATOR | Any setting until the announcement. Audited `drop.live.update`, each setting before and after |
| POST | `/api/admin/live/:id/publish` | OPERATOR | Published: announced at `announceAt` (now when empty). `{ "circlePost": true }` also posts a NOTE in the owners' circle for the release's tier (TITANE at least), shown from the announcement, never naming the piece, kept in step with the release's times while it is not shown, withdrawn if the release is cancelled. Audited `drop.live.publish` (and the circle's `circle.post.create`) with the feasibility check as it stood: `locationId`, `toMakeToOrder` and `shortSizes` (`52:1`, an after-room's `AFTER-ROOM 52:1`); never refused by it |
| POST, DELETE | `/api/admin/live/:id/circle-post` | OPERATOR | That post added or withdrawn after the publication, until the announcement (`409 LIVE_CIRCLE_POSTED`, `409 LIVE_NO_CIRCLE_POST`) |
| POST | `/api/admin/live/:id/cancel` | OPERATOR | Cancelled, before its room opens (`409 LIVE_ROOM_OPEN` after: an ADMIN ends it with END NOW). The console asks for a typed phrase (`CANCEL <first 8 characters of the id>`). Audited `drop.live.cancel` |
| POST, DELETE | `/api/admin/live/:id/silhouette` | OPERATOR | The silhouette (an image body, as §13.4's photographs: `image/jpeg` or `image/webp`, at most 1 MiB, its metadata removed), until the announcement. Audited `drop.live.silhouette.set`, `.remove` |
| POST | `/api/admin/live/:id/board-link` | OPERATOR | The boutique board's secret link (§8.10): **200** `{ "url", "issuedAt" }`, `no-store`, the link (`https://<APP_DOMAIN>/verify/releases/<id>/board#<secret>`, 32 random bytes) shown **once**; only its SHA-256 is kept. Issuing again replaces it: the previous link stops at once. Audited `drop.live.board.issue`, never with the secret |
| DELETE | `/api/admin/live/:id/board-link` | OPERATOR | Revoked: the board answers 404 from then on (`409 LIVE_NO_BOARD_LINK` without one). Audited `drop.live.board.revoke` |
| GET | `/api/admin/live/:id/board` | AUDITOR | The **live board**: `phase`, `paused`, `over`, the times, `quantityLine`, `totals` and `sizes` (stock, left, held, sold, waiting, line, turns, secured, confirmed, missed, expired, interest; overall also in the room, released, departed, removed, ended), the latest host `message`, the open entries by place (`line`, the first 200, `lineTotal`), and from T0 the live `alerts` and the live `sellOut` forecast (below) |
| GET | `/api/admin/live/:id/stream` | AUDITOR | The same, live (Server-Sent Events, `console` events `{ now, board }`, built once a pulse; a role read again at every pulse switches the masking; at most 2 streams per console user, `429 LIVE_STREAMS_LIMIT`; it ends with the session or the release) |
| GET | `/api/admin/live/:id/entries` | AUDITOR | The entries, `?status=` one status or `OPEN` (`WAITING`, `QUEUED`, `TURN`, `SECURED`), by place then arrival, paginated: `{ id, accountId, email, status, size, quantity, tier, position, joinedAt, turnAt, turnExpiresAt, securedAt, holdExpiresAt, confirmedAt, endedAt, gestureMs, letIn }` |
| POST | `/api/admin/live/:id/pause`, `/resume` | OPERATOR | PAUSE (once T0 has passed, before the end): no new turn, nobody presses or secures, the deadlines frozen; RESUME: the turns and holds still running when it began moved by its length, then turns again. Audited `drop.live.pause`, `drop.live.resume` (with the time paused) |
| POST | `/api/admin/live/:id/extend` | OPERATOR | `{ "minutes": 1–240 }`: the end of the sales later, before it. Audited `drop.live.extend` (the close before and after) |
| POST | `/api/admin/live/:id/stock` | OPERATOR | ADD PIECES: `{ "sizeId", "pieces": 1–1 000 }`, from the announcement to the end: the size's stock and the release's quantity raised, a turn given at once to whoever they serve. Audited `drop.live.stock` with the stock before and after **and the quantity line the announcement promised** (choice 36: every addition reported) |
| POST | `/api/admin/live/:id/messages` | OPERATOR | A host message: `{ "text" }`, one line of 1 to 140 characters, from the announcement to the end; the latest shows in the room. **201**. Audited `drop.live.message` (staff text) |
| POST | `/api/admin/live/:id/end` | **ADMIN** | END NOW (the console asks for a typed phrase, `END <first 8 characters of the id>`): no new turn; `WAITING`, `QUEUED` and `TURN` entries `ENDED` at once; holds may still be confirmed until their deadlines. Audited `drop.live.end` with the reason `ENDED` |
| POST | `/api/admin/live/:id/entries/:entryId/free` | OPERATOR | FREE A HOLD: a `SECURED` entry `EXPIRED`, its add-ons dropped; the piece to the next in line. Audited `drop.live.free` |
| POST | `/api/admin/live/:id/entries/:entryId/let-in` | OPERATOR | LET IN: a `QUEUED` entry takes its turn now, out of order, within the free pieces of its size, the release live and not paused (`409 LIVE_NO_FREE_PIECE`). The entry keeps who (`let_in_by`). Audited `drop.live.let_in` with its place |
| POST | `/api/admin/live/:id/entries/:entryId/remove` | **ADMIN** | REMOVE: an open entry `REMOVED`, its add-ons dropped; a piece it held goes to the next. Audited `drop.live.remove` |
| — | — | — | A confirmed sale's orders, one per piece, are stepped on the Orders board (§16.24), which replaces the LIVE plan's Client Services list |

**The engine's own entries** (the system as actor): `drop.live.queue` at T0 (the entries placed), `drop.live.end` for `SOLD_OUT` and `CLOSED`. The customers' (§10.12): `drop.live.enter`, `.size`, `.leave`, `.interest`, `.interest.withdraw`, `.secure` (with the gesture's length), `.addons`, `.confirm`, `.release`.

**The intelligence** (AUDITOR and up, `GET`, each answer with its `reasoning`: the rule in words and the figures it used; every number of the rules is in `LIVE_INSIGHT_RULES` and `LIVE_ROOM_CAPACITY`):

| Path | Reading |
|---|---|
| `/api/admin/live/:id/plan` | The **release planner**, before the announcement: the quantity (the expected room at T0 × the pieces asked per person present in past releases; 0.5 without one) and the size mix (the interest by size, and the eligible collectors whose latest piece of the same model type is in that size, `products.variant`); the eligible collectors by tier; the sizes they hold that the release does not offer |
| `/api/admin/live/:id/forecast` | The **audience forecast**: a range for the room at T0, from the interest at the share past releases saw (50–100 % without one), or before any interest from each tier's eligible accounts at its past share; never above the eligible accounts; says so above the measured capacity (1 000 in the room, [reports/live-load.md](reports/live-load.md)) |
| `/api/admin/live/:id/radar` | The **demand radar**, before T0: the room against the pieces, interest and presence by size and tier, the pressure per size, the expected sell-out time; ADD PIECES suggested when the demand reaches twice a size's stock, with the quantity line the announcement promised |
| `/api/admin/live/:id/bots` | The **bot radar**, from the room's opening: accounts created less than 24 hours before they entered, 3 entries or more from one network (its keyed hash never leaves the server), holds under 1 450 ms, and holds of one account repeated within 10 ms across releases. It flags; an ADMIN removes with REMOVE, by hand |
| `/api/admin/live/:id/report` | The **release report**, once ended: the time to sell out (per size, overall), unserved demand, missed turns and ended holds per size, the same by tier, the add-ons and their revenue, the funnel interest → room → turn → secured → confirmed → concluded, every ADD PIECES (from the audit log), and next time's quantity and size mix |
| `/api/admin/live/:id/report.csv` | The same, as a CSV |
| `/api/admin/live/:id/collectors` | The **collector insights**, once ended: conversion by tier, by country and for repeat collectors against first-timers, and the accounts that came without securing a piece (emails masked for an AUDITOR); entries ORBES removed left out |
| `/api/admin/live/:id/comparison` | The **release comparison**: this release beside up to 12 others whose T0 has passed |
| `/api/admin/live/size-mix?modelId=&locationId=` | The **size mix** a new release of a model is proposed (plan LIVE RELEASE+, choice 13, L1; `services/release-stock.ts` `sizeMix`): the sizes available at the location (the default one without `locationId`; on hand less what orders hold) first; then, when the planner (read as for a release open to every ORBES account opening now) expects more pieces than the stock holds, the difference shared among the sizes where its demand exceeds the stock, in proportion to that excess (largest remainder). `{ model, location, sizes: [ { label, stock, fromStock, fromDemand } ], quantity, inStock, planned, reasoning, offered }`. A model in one size reads ONE SIZE, the SKU of its pieces without a variant. A model with its size type (plan NEXT LOT §3.3, §13.4): its **offered** sizes only, `offered` their declared labels (empty for a model with no type); the stock of each by its SKU, the collectors' sizes read by their measure (`SIZE 52` is `52`) and named by the declared label, anything else left out. `404 MODEL_NOT_FOUND`, `404 STOCK_LOCATION_NOT_FOUND` |
| `/api/admin/live/:id/feasibility` | The **feasibility check** (choice 12, K5), before PUBLISH: per size, the pieces on sale against the pieces available at the release's location, the sizes in order, then its after-room's from what they leave (one SKU, one stock). `{ location, sizes: [ { sizeId, label, onSale, available, fromStock, short, skuId, skuWords, supplier: { id, name } \| null, ordered: { expected, inDraft } \| null } ], afterRoom, short, warnings, reasoning }`: what the stock does not cover waits for supplier stock once sold, the oldest orders first (plan NEXT LOT §3.5.4.3; each warning the owner's sentence « 52: 12 in stock, 13 will wait for supplier stock. »); `skuId`, `skuWords` (the SKU named with its variant, `MONOLITHE · BLUE · 52`, for the dialog's sentence) and `supplier` (the size's, else its model's, else its main model's) serve the console's *Add to supplier order* (`POST /api/admin/supplier-orders/draft-lines`, `from: RELEASE`), shown on the release's page under its sizes and in the PUBLISH dialog's Stock block; `ordered` is what is already ordered for the SKU to the location (`expected` on the supplier orders on their way, `inDraft` in a draft), so the console adds only `max(0, short − expected − inDraft)` (§3.5.6.4) and says the rest is already ordered. A warning, never a refusal, and no date. `409 LIVE_AFTER_ROOM` for an after-room |
| `/api/admin/live/:id/best-time?days=&country=` | The **best time to open** (choice 10, G3) for the release's tiers (its tier and above), as §16.16's `best-time`, with `release`: its T0's hour, Paris time, and that hour's share. The console shows it beside the settings until the announcement |

The **live alerts** and the **live sell-out forecast** ride on the live board and its stream (`alerts`, `sellOut`), from T0: a size sold out; a wave of missed turns (5 or more in 2 minutes, and half of the turns ended then); a line stalled while pieces are free (a turn due for 10 s, none given); and, per size and overall, the pace of the pieces secured in the last 5 minutes against what the line can still absorb.

Errors of this section: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 DROP_NOT_FOUND`, `404 LIVE_ENTRY_NOT_FOUND`, `404 MODEL_NOT_FOUND`, `409 DROP_CANCELLED`, `409 DROP_ALREADY_PUBLISHED`, `409 DROP_NOT_PUBLISHED`, `409 MODEL_INACTIVE`, and the `LIVE_*` codes of §5.2.

**The house's guarantee** (plan NEXT-NINE, IN-01; §10.12, §16.30): a release's object adds `guaranteed` (`{ "places", "pieces" }`) and an entry of the console's line `guaranteed`, listed first in its size. Publish sets aside the guarantees waiting in its scope (`guarantee.cover`); the stock of a `DRAFT` never goes below the pieces guaranteed (`409 DROP_GUARANTEES_EXCEED`; the Sizes dialog warns before: *2 pieces of this release are guaranteed by the house: the stock cannot go below.*); the end and a cancellation release the guarantees not used (§10.12). In the console: *Guaranteed 1 place · 2 pieces* (*First in line in their size, listed first.*), the mark GUARANTEED on its entries, and **Guarantees**, the release's guarantees (*Places guaranteed by the house: first in line in their size*).

### 16.24 Orders, LOGISTICS, locations and carriers (extension of the contract)

The fulfilment of every sales channel (plan LIVE RELEASE+ of 2026-10-04; `routes/admin/orders.ts`, `routes/admin/locations.ts`, `routes/admin/logistics.ts`; `services/orders.ts`, `services/fulfilment.ts`, `services/logistics.ts`, `services/stock.ts`; migrations 0022 and, plan NEXT LOT, 0035 to 0037): one order per piece sold (a LIVE RELEASE's entry confirmed, a draw's entry confirmed, a private salon's request accepted), `RESERVED` → `PAID` | `CANCELLED`; `PAID` → `SHIPPED` | `CANCELLED`; `SHIPPED` → `DELIVERED` | `RETURNED`; `DELIVERED` → `RETURNED`. While `RESERVED` or `PAID`, an order holds a piece in stock at its location (`STOCK`) or waits for supplier stock (`AWAITING`, plan NEXT LOT §3.5: served the oldest first as pieces arrive; no piece is made for an order and no identity reserved any more). Its piece is bound to it by the agent's packing scan (§16.33), and it ships only with its parcel, through Logistics' Ship, packed and checked (the SHIPPED gate, step 5.12: `409 ORDER_NOT_PACKED` for a bare `SHIPPED` step); it is `DELIVERED` by Logistics, by Client Services or by itself when its buyer registers that piece. The Atelier (its stock tab, pieces to make, work sheets and `POST /api/admin/orders/:id/piece`, Link a piece) is removed by plan NEXT LOT step 5.13: Logistics' stock, minimums, transfers and corrections replace it (§16.33), and its routes answer `404`. An **AUDITOR** reads everything, the collectors' emails and the buyer's name masked and the address withheld; an **OPERATOR** steps the orders and enters their terms, buyer and location; the alerts' delays, the locations and the carriers are **ADMIN**'s. Every mutation is audited by its service (`order.*`, `stock.*`, `carrier.*`; never the buyer's details nor an engraving's words); every route has its role probe (`test/api/admin-roles.test.ts`).

| Method | Path | Role | What it does |
|---|---|---|---|
| GET | `/api/admin/orders` | AUDITOR | The board: six columns by step, their counts and late counts, the longest waiting first (`?channel=&dropId=&locationId=&late=&q=`), and the delays; each card's `waitingForParcel` (plan NEXT LOT §3.5.6.6): its piece ready while its parcel waits for another of its orders, never LATE meanwhile (§16.33) |
| GET | `/api/admin/orders.csv` | AUDITOR | Every order the same filters keep, as a CSV attachment (`no-store`) |
| GET, PUT | `/api/admin/orders/alerts` | AUDITOR, **ADMIN** | The delays after which an order stands out as late (reserved and not paid; paid with its piece ready and not shipped; shipped and not delivered; delivered and its piece not registered), changed within their bounds. Audited `order.alerts` |
| GET | `/api/admin/orders/:id` | AUDITOR | One order: its facts (its `model` `{ id, name, variant }`, the variant's label or `null`: the packing slip's Piece reads MONOLITHE · BLUE, plan NEXT LOT §3.5.3), timing, piece and history; `orderCases` (plan NEXT LOT §3.5.4.4), its order cases the newest first as `GET /api/admin/order-cases/:id` gives each (§16.34, every note `null` for an AUDITOR), and `exchangeSizes` `[ { skuId, label, available, selectable } ]`, once SHIPPED or DELIVERED, the model's other offered sizes and what is available of each at the order's location (an exchange takes a selectable one), `[]` otherwise; and `claimCode` (plan NEXT LOT §3.4, §15.10): the order's newest new claim code made for its buyer, `{ status, madeAt, readAt, withdrawnAt, withdrawnReason, cardNeeded, cardNeededOrder }` (`status` `WAITING`, `READ` or `WITHDRAWN`; `withdrawnReason` as DATABASE §5.76 says it; `cardNeeded` when no card registers its piece any more, its current code an UNSHOWN one made at the cancellation of `cardNeededOrder` `{ id, reference }`), or `null`: never the code; and `claimCard` `{ cardNeeded, cardNeededOrder }`, the same two fields read from the order's piece (the piece bound to it, else the piece of its newest buyer code), so the order page says no card registers its piece even when the order has no new claim code of its own (a piece linked again after its sale was cancelled; §3.4.7). A cancellation (`transition` to `CANCELLED`, of the order or of the order its welcome gift travels with) replaces a buyer's new claim code, read or not, by one nobody sees, with hashes prepared before its transaction: `409 ORDER_CHANGED` when a code was made in between, nothing changed |
| POST | `/api/admin/orders/:id/transition` | OPERATOR | `PAID` (once priced, `409 ORDER_PRICE_MISSING` before: its invoice is issued, §16.25); `DELIVERED`; `CANCELLED` (a note; once paid, a credit note cancels the invoice). Audited `order.pay`, `.deliver`, `.cancel`, and `invoice.issue` or `invoice.credit`. `SHIPPED` is refused here since the SHIPPED gate (plan NEXT LOT §3.5.6.7, step 5.12): `409 ORDER_NOT_READY` while it waits for supplier stock, `409 ORDER_PIECE_NOT_LINKED` before the packing scan binds its piece, then `409 ORDER_NOT_PACKED` always: an order ships with its parcel through `POST /api/admin/logistics/orders/:id/ship` (§16.33), packed and checked, every order of the parcel in one transaction (audited `order.ship`) |
| POST | `/api/admin/orders/:id/location` | OPERATOR | Served from another location: what it holds moves (`409 ORDER_PIECE_LINKED` once its piece is linked). Audited `order.location` |
| PATCH | `/api/admin/orders/:id/terms` | OPERATOR | A draw's or a salon's size, price and currency (a draw's order is created with its draw's price when the draw has one, plan NOCTURNE addition 5, §16.19; plan NEXT LOT §3.6.F and §3.6.G: a draw's order from a draw with sizes is created in its entry's size with its SKU, and neither it nor a salon order whose request named a size takes another size, `409 ORDER_SIZE_FIXED`; a request made with NOT SURE YET leaves the size to Client Services); the engraving of any order. Audited `order.terms`. Its shipping while `RESERVED` (plan NEXT-NINE, BP-19 T4): `shippingService` (`STANDARD`, `EXPRESS`) with `shippingMinor` (0 to 100 000 000 in its currency), both or `null` for both (no shipping); `409 ORDER_SHIPPING_FREE` for a fee on the service its tier makes free (express below PALLADIUM is paid at the fee entered), `409 ORDER_SHIPPING_WITH` for an order travelling with another, `409 ORDER_PAID` once paid, `400` for a fee before the order has its currency. The first price of an order without shipping takes the rate of its currency when one is set (§16.24, shipping rates); a rate it took follows a later change of its currency (the new currency's rate, or no shipping when none is set), while a fee entered by hand stays as entered, for Client Services to enter again. The orders travelling with it follow (its service at 0). Audited `order.shipping` |
| POST, DELETE | `/api/admin/orders/:id/credit` | OPERATOR | APPLY CREDIT and REMOVE CREDIT (plan NEXT-NINE, BP-19 T5): `POST { "amountMinor" }` (1 to 100 000 000) takes the client's tier credit off a `RESERVED` order's invoice: priced, of a channel THE PROGRAM names (`409 ORDER_CREDIT_CHANNEL`, also for a welcome gift), from grants of the tier held now and not expired (`409 ORDER_CREDIT_NONE`), in the order's currency (`409 ORDER_CREDIT_CURRENCY`), within their balance and, with what is already taken off it, the piece's price (`409 ORDER_CREDIT_EXCEEDS`); PALLADIUM's grant first, then the earliest expiry. Audited `order.credit.apply`. `DELETE` gives it back whole, its expiry unchanged (`409 ORDER_CREDIT_NONE` when none is taken off it). Audited `order.credit.remove`. Both `409 ORDER_CLOSED` past `RESERVED` |
| PUT | `/api/admin/orders/:id/buyer` | OPERATOR | The buyer's name and address. Audited `order.buyer`, never what they are |
| GET, POST, PATCH | `/api/admin/locations`, `/:id` | AUDITOR, **ADMIN** | The locations, the default first, each with its postal `address` (plan NEXT LOT §3.5.6.9: 1–500 characters, line breaks kept, `null` while none; the supplier order's « Deliver to » and a return's address); one added (`{ "name", "address"? }`); renamed, made the default, or its `address` entered or cleared (`null`). Served by `routes/admin/locations.ts` since step 5.6. Audited `stock.location.create`, `.update` (the address by `fields: ['address']`, never its words) |
| GET, POST, PATCH | `/api/admin/carriers`, `/:id` | AUDITOR, **ADMIN** | The carriers, the active ones first; one added with its tracking link; its name, its link, offered or set aside. Audited `carrier.create`, `.update` |
| GET, PUT | `/api/admin/orders/shipping-rates` | AUDITOR, **ADMIN** | SHIPPING (plan NEXT-NINE, BP-19 T2; `services/club-program.ts`, DATABASE §5.65), optional: what an order's delivery costs below the free shipping of PLATINE and PALLADIUM, per currency (`EUR`, `GBP`, `USD`, `CHF`) and service (`STANDARD`, `EXPRESS`). `GET`: `{ "items": [ { "currency", "service", "feeMinor", "updatedAt", "updatedBy" } ] }`, the rates set, currency then service; none preset. `PUT`: `{ "rates": [ { "currency", "service", "feeMinor" } ] }`, the rates set whole, each currency and service once, each fee 0–100 000 000 minor units; a rate left out is cleared. Audited `order.shipping_rates.update` with `{ before, after }` |

**Shipping** (plan NEXT-NINE, BP-19 T4; migration 0027): an order's `shipping` `{ service, minor, benefit }` (all `null`: none) is fixed at its creation, the tier read then: PLATINE free standard and PALLADIUM free express (THE PROGRAM, §16.21; `benefit` 2 or 3, `minor` 0), otherwise the optional rate of its currency (STANDARD), otherwise none, as before; it keeps it if the tier changes later. A LIVE entry of several pieces pays one fee, on its first order: the others travel with it (`withOrder` `{ id, reference }`, its service at 0). A known limit: when that first order is cancelled, the others still travel with it, at 0 and without a SHIPPING line, so the entry's fee is no longer on any invoice (and `409 ORDER_SHIPPING_WITH` keeps a fee off them); handing the first order's role to the next piece is left to the owner's decision. MARK PAID is never refused for shipping; returns are unchanged. The order's page reads *Shipping: Standard · free (PLATINE)*, *Express · free (PALLADIUM)*, *Standard · € 20*, *With OR-…* or *None*; its terms' dialog gains *Shipping service* and *Shipping fee* (empty: no shipping line). The board names the GIFT channel *Welcome gift*.

**The welcome gift and the credit** (plan NEXT-NINE, BP-19 T5; migration 0027, DATABASE §5.66 and §5.67): on reaching PLATINE or PALLADIUM (a first registration, a transfer accepted, a piece reinstated, an order's creation, a status read; at boot for every account already there) an account receives that tier's GIFT and CREDIT, once per tier and per account, ever (audited `club.grant`, the system as actor). The gift is added to the account's next order (a draw's, a salon's, a LIVE entry's first piece) while its tier has an active gift model: a GIFT order at 0 in its order's currency (no price while that order has none), travelling with it (`withOrder`), holding its piece at once when the model has one size, otherwise with its size to be confirmed (the console's *Choose size*: `PATCH …/terms` `sizeLabel`, one of `giftOf.sizes`; a size its model has no SKU of is refused, `400 VALIDATION_FAILED` *Choose one of the gift model’s sizes.*, and no SKU is made for it); its order's MARK PAID waits for it (`409 ORDER_GIFT_SIZE_MISSING`). It is paid with its order and never alone (`409 ORDER_TRANSITION_NOT_ALLOWED`), has no price of its own (`409 ORDER_TERMS_FIXED`) nor invoice (its order's carries its GIFT line), is cancelled with it (its grant then waits for the next order) and stays as it is when its order is returned. A credit taken off an order is given back when it is cancelled or returned (`order.credit.release`), its expiry unchanged. An order reaching PLATINE and PALLADIUM at once carries both tiers' gifts. An order's page gains `gifts` `[ { id, reference, model, status, sizeToChoose, tier } ]` (every gift travelling with it, not cancelled, by tier then oldest first; `[]` for none; the console shows one *Welcome gift* row each, *Welcome gift · PLATINE* and *Welcome gift · PALLADIUM* when there are two, and MARK PAID waits until every gift's size is chosen), `giftOf` `{ tier, sizes, savedSize }` on a GIFT order (`savedSize`, plan NEXT-NINE AC-01: while its size is to be chosen, the client's saved size of the gift model's kind, the matching size's label or else the saved measure, `52` or `16.5 CM`; a hint only, *Saved size: 52 (YOUR SIZES)* in Choose size, which preselects nothing; `null` otherwise), `credit` `{ available: [ { grantId, tier, balanceMinor, currency, expiresAt } ], applied: [ { id, grantId, tier, amountMinor, appliedAt, releasedAt, releasedReason } ] }` and `withOrder.shipment` (`{ carrierId, trackingNumber }` once the order it travels with has shipped: SHIP WITH ITS ORDER prefills them).

Errors of this section: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 ORDER_NOT_FOUND`, `404 PRODUCT_NOT_FOUND`, `404 SKU_NOT_FOUND`, `404 STOCK_LOCATION_NOT_FOUND`, `404 CARRIER_NOT_FOUND`, `409 ORDER_TRANSITION_NOT_ALLOWED`, `409 ORDER_PRICE_MISSING`, `409 ORDER_RETURN_NOT_RESTOCKABLE`, `409 ORDER_RETURN_CHANGED`, `409 ORDER_NOT_READY`, `409 ORDER_PIECE_NOT_LINKED`, `409 ORDER_PIECE_LINKED`, `409 ORDER_NOT_PACKED`, `409 ORDER_TERMS_FIXED`, `409 ORDER_PAID`, `409 ORDER_SHIPPING_FREE`, `409 ORDER_SHIPPING_WITH`, `409 ORDER_GIFT_SIZE_MISSING`, `409 ORDER_CREDIT_NONE`, `409 ORDER_CREDIT_CURRENCY`, `409 ORDER_CREDIT_CHANNEL`, `409 ORDER_CREDIT_EXCEEDS`, `409 ORDER_CLOSED`, `409 STOCK_NOT_AVAILABLE`, `409 SIZE_SET_ASIDE`, `409 STOCK_LOCATION_NAME_TAKEN`, `409 CARRIER_NAME_TAKEN`, `503 STOCK_NOT_READY`.

### 16.25 Invoices and credit notes (extension of the contract)

The invoices of the orders (plan LIVE RELEASE+ of 2026-10-04, choices 20 and 22, M7; `routes/admin/invoices.ts`, `services/invoices.ts`, `render/invoice.ts`; the `invoices` table of migration 0022). An order's **invoice** is issued when it is paid; a **credit note** cancels it in full, once, when the order is cancelled after it was paid or returned (§16.24). Each is issued by **CONGLOMERAT LLC** (the legal notice's identity and registered office), in English, **without VAT**: `vatRateBp` and `vatMinor` stay `null`, the total is the subtotal. Numbered in sequence per kind and year of issue (UTC), from 1 each year: `INV-2026-000001`, `CN-2026-000001` (an advisory lock per kind and year; the unique key `(kind, year, sequence)`). Its content is kept as issued — the issuer, the buyer (the name and address entered on the order, the account's email), the lines (the piece: its model and size, where it was sold; each add-on as sold), the currency and the amounts — and never changes. Each is journaled (`invoice.issue`, `invoice.credit`, without its buyer) and audited by ids, numbers and amounts, never the buyer's details. Nothing here issues or changes one.

An **AUDITOR** reads the buyer masked (the name `J*** D***`, the address `***`, the email `j***@example.com`) on the page, in the CSV and in the PDF; OPERATOR and ADMIN in clear.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/admin/invoices` | AUDITOR | A month's documents (`?month=YYYY-MM`, UTC, the current one by default; `kind=INVOICE\|CREDIT_NOTE`; `q=` a number or an order's reference, at most 40 characters), the latest first, each with its order, what it cancels (`credits`) or what cancels it (`creditedBy`), its issuer, buyer, lines and amounts (1 000 at most, the kind and the search applied before); `totals` per currency (invoiced, credited, net), the whole month's whatever the kind and the search keep; `month` and `currentMonth` |
| GET | `/api/admin/invoices.csv` | AUDITOR | The month's CSV for the accountant (`?month=YYYY-MM`, required), in order of issue: number, kind, time and date, order, the invoice it cancels, issuer, buyer, lines, currency, subtotal, VAT rate and VAT (empty), total — a credit note's amounts as issued, its kind saying they are credited. An attachment, `no-store` |
| GET | `/api/admin/invoices/:id/pdf` | AUDITOR | One document's PDF (one A4 page in the house's lettering, black on white, no font, no VAT line; a credit note names the invoice it cancels), `ORBES-invoice-INV-2026-000001.pdf`. An attachment, `no-store` |

**The lines** (plan NEXT-NINE, BP-19 T4 and T5): each `{ kind, label, detail, amountMinor }`, `kind` one of `PIECE`, `ADDON`, `SHIPPING` (*SHIPPING · STANDARD*, its detail *FREE · PLATINE* when its tier made it free; none for an order travelling with another), `CREDIT` (*CREDIT · PLATINE*, a negative amount, the PDF printing it with its minus sign) and `GIFT` (*WELCOME GIFT · MODEL*, its detail *ORDER OR-…*, at 0), read back with its own kind (an unknown stored kind reads as `PIECE`); a credit note repeats them. A GIFT order has no invoice of its own: its order's carries its line. A page holds twelve lines (the piece, six add-ons, its shipping, a CREDIT line and a GIFT line per tier), the table sharing its height beyond seven.

In the console: **Invoices** (Clients): the month (the last 24 offered), the kind, a search; the month's totals; each document with its order's page and its PDF; DOWNLOAD THE MONTH (CSV). An order's page lists its documents with their PDFs.

Errors of this section: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 INVOICE_NOT_FOUND`.

### 16.26 Segments (extension of the contract)

Saved groups of collectors (plan LIVE RELEASE+ of 2026-10-04, choice 27, N5; `routes/admin/segments.ts`, `services/segments.ts`, `services/participation.ts`; the `segments` table of migration 0023), built in the console's **Segments** page (Clients, `#/segments`). Their members are the ACTIVE accounts their rules match **now**, never stored: a LIVE RELEASE's access rule (§10.12, said FOR SELECTED COLLECTORS, the name never public) and the audience of a post of the circle (§16.20) read them at each check.

A segment's `criteria` is a rule tree: `{ "match": "ALL" | "ANY", "rules": [ … ] }`, 1 to 20 rules, each a criterion or a group of criteria one level down; any criterion may carry `"not": true`. The criteria, by the four groups of choice 27:

| Group | `kind` | Fields | Matches |
|---|---|---|---|
| Releases | `PARTICIPATIONS` | `min` (1–100) | took part in at least `min` releases (§10.12's definition) |
| | `TOOK_PART` | `dropId` | took part in that release |
| | `SECURED` | `min` (1–100) | secured at least `min` pieces (LIVE entries CONFIRMED, their quantity; draw entries CONFIRMED) |
| | `SECURED_IN` | `dropId` | secured a piece in that release (its after-room's included) |
| The club | `TIER` | `tiers` (0–3) | its tier now is one of them (0: no piece held) |
| | `OWNS_MODEL` | `modelIds` | holds now a piece of one of the models |
| | `OWNS_COLLECTION` | `collectionIds` | holds now a piece of one of the collections (the piece's own, else its model's) |
| Profile | `SIZE` | `sizes` (≤ 12 characters each) | a size of a piece held now, chosen in a LIVE RELEASE or said with I'LL BE THERE, or of an order |
| | `COUNTRY` | `countries` (two letters) | the account's country, else the one its latest LIVE entry came from |
| Signals | `INTEREST` | `dropId` (or `null`: any) | said I'LL BE THERE to that LIVE RELEASE |
| | `ANSWER` | `dropId`, `answer` (1–6) | answered that answer to the release's question after |
| | `ACTIVE` | `days` (1–3 650) | signed in, used a session or scanned within that many days |

Lists hold 1 to 50 items, written sorted and once. The releases, models and collections named must exist (**`404 DROP_NOT_FOUND`**, **`MODEL_NOT_FOUND`**, **`COLLECTION_NOT_FOUND`**); `INTEREST` and `ANSWER` name a LIVE RELEASE, an answer one of its question's (**`400 VALIDATION_FAILED`**).

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/admin/segments` | AUDITOR | `{ "items": [ … ] }`, every segment by name: `{ id, name, criteria, count, usedBy: { releases: [{ id, title }], posts: [{ id, title }] }, createdAt, createdBy, updatedAt }`, `count` its members now |
| GET | `/api/admin/segments/names` | AUDITOR | `{ "items": [{ id, name }] }`, every segment by name, no count read: the choices of a release's access rule and a post's audience |
| GET | `/api/admin/segments/options` | AUDITOR | What the builder names: `releases` (published, not cancelled, never an after-room: `{ id, title, mode, opensAt, answers }`, `answers` a LIVE RELEASE's question's, else `null`), `models`, `collections`, the `sizes` and `countries` known |
| POST | `/api/admin/segments/count` | OPERATOR | `{ "criteria" }` → `{ "count" }`: the members criteria being built would have now (the builder's live count) |
| POST | `/api/admin/segments` | OPERATOR | `{ "name" (1–60, one line, unique whatever the case), "criteria" }` → **201**, the segment. Audited `segment.create` (name, criteria) |
| GET | `/api/admin/segments/:id` | AUDITOR | One segment |
| PATCH | `/api/admin/segments/:id` | OPERATOR | `{ "name"?, "criteria"? }`, at least one; the same again writes nothing. Audited `segment.update` (each before and after) |
| DELETE | `/api/admin/segments/:id` | OPERATOR | **204**, when no release and no post uses it (**`409 SEGMENT_IN_USE`** otherwise). Audited `segment.delete` |
| GET | `/api/admin/segments/:id/members.csv` | AUDITOR | Its members now, by email: email, country, tier, pieces held, releases taken part in, pieces secured, account created. An attachment, `no-store`; the emails masked for an AUDITOR (`j***@example.com`) |

Errors of this section: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 SEGMENT_NOT_FOUND` (and the 404s of what a tree names), `409 SEGMENT_NAME_TAKEN`, `409 SEGMENT_IN_USE`.

### 16.27 Shopify readiness: the product and order exports (extension of the contract)

The store is not decided (plan LIVE RELEASE+ of 2026-10-04, choices 9, 24 and 25: N2 and N3; `routes/admin/shopify.ts`, `services/shopify.ts`): files in Shopify's own import formats, and the ids its store gives back, kept on the SKUs (migration 0022: `skus.shopify_product_id`, `skus.shopify_variant_id`). **Nothing calls Shopify.** Only the columns ORBES fills are written, spelled and ordered as Shopify's help center publishes them (« Using CSV files to import and export products » and « Exporting orders », read 2026-10-05; `test/services/shopify.test.ts` holds them against the published lists); Shopify keeps its defaults for the others. Files are attachments (RFC 4180, every field quoted, a value a spreadsheet would read as a formula prefixed with `'`), `no-store`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/admin/shopify/products.csv` | AUDITOR | `?currency=EUR\|GBP\|USD\|CHF`, the store's currency (required): every model with a base price in it (§13.4, `basePriceMinor`), by name, one product each: `Title`, `URL handle` (its lookbook address, else its name in lower-case words; one another model holds, whatever its currency, takes its SKU prefix, then a number, until free; the console's dialog names the same), `Vendor` `ORBES`, `Type`, `Published on online store` `false`, `Status` `draft` (`archived` for a model inactive or discontinued), its sizes as variants (its SKUs, ONE SIZE first then naturally sorted: `Option1 name` `Size`, `Option1 value` the size; a model in one size, or never issued nor sold, is Shopify's single variant `Title` / `Default Title`), each with its `SKU`, the base price as `Price` (`4800.50`) and `Requires shipping` `true`; its photographs (the reference photograph, then the gallery) as `Product image URL` (absolute, `PUBLIC_ORIGIN/api/v1/media/<sha256>`, which Shopify fetches at the import), `Image position` and `Image alt text`, one row each after the first under the same handle. A model and its **variants** (plan NOCTURNE, N1, §13.4) are **one product**, the main model's (its `Title`, `Type` and handle, even when it is not priced in the currency itself): `Option1 name` `Variant` (each model's label, `Option1 value` `Steel`), `Option2 name` `Size` (its sizes, ONE SIZE for a model in one size; left out when every model of it is in one size), each model of it priced in the currency in its order (the main model first, then its variants as they were added) with its own SKUs, base price and photographs, its cover as the `Variant image URL` of its variants (alt texts *The MONOLITHE BRACELET model in gold, photographed by ORBES*); `archived` once none of its models is active. `ORBES-shopify-products-EUR-2026-11-02.csv` |
| GET | `/api/admin/models/:id/shopify` | AUDITOR | The model's Shopify product: `{ "model": { "id", "name", "skuPrefix" }, "handle" (the one the product export writes: a variant's, its main model's), "productId", "variants": [{ "size", "sku", "known", "variantId" }] }`, its sizes as the export gives them (`known` `false`: the SKU of a model never issued nor sold, made when its id is pasted) |
| PUT | `/api/admin/models/:id/shopify` | OPERATOR | `{ "productId", "variants": [{ "size", "variantId" }] }`, the ids Shopify gave once the export is imported, each the number or the address of its page in Shopify's admin (`…/products/8123456789`, `…/variants/44012345678`); `null` or `""` clears one. The product's id goes on every SKU of the model (a model never issued nor sold has its one-size SKU made, variant given or not), each size's variant on its SKU (a size not given keeps its own); without the product no variant stands. Two links of one product run one after the other. Each size one of the export's, once; a variant id once; a variant with its product (`400 VALIDATION_FAILED` otherwise); `409 SHOPIFY_PRODUCT_TAKEN` when a model outside its group is linked to that product (a model and its variants share their product, N1), `409 SHOPIFY_VARIANT_TAKEN` when another size has that variant. Audited `model.shopify` with the product's id and each variant's before and after (nothing written when nothing changes). Answers the model's Shopify product |
| GET | `/api/admin/shopify/orders.csv` | AUDITOR | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (UTC days, both included, at most 366): the orders reserved then whose price is entered, the oldest first, as Shopify's order CSV: `Name` (its OR- reference), `Email` (the collector's account: how the store will match its customers to the accounts, N3), `Financial Status` (`pending` while reserved, `paid`, `refunded` once returned or cancelled after it was paid, `voided` cancelled before), `Paid at`, `Fulfillment Status` (`fulfilled` once shipped) and `Fulfilled at`, `Currency`, `Subtotal` (the piece and its add-ons), `Shipping` (its shipping fee, plan NEXT-NINE, BP-19 T4: `0.00` when free, when the order has none, or when it travels with another, whose row carries it), `Taxes` `0.00` (no VAT), `Total` (the subtotal and the shipping), `Shipping Method` (the carrier), `Created at` (reserved), the piece as the first line item (`Lineitem quantity` 1, `Lineitem name` `MONOLITHE - 54`, `Lineitem price`, `Lineitem SKU`, `Lineitem requires shipping` `true`, `Lineitem taxable` `false`, `Lineitem fulfillment status`), each add-on as the next ones (a row with the order's `Name` and its line item only), the buyer Client Services entered as billing and shipping (`… Name`, `… Street` the whole address, `… Address1` its first line, `… Address2` the rest), `Canceled at`, `Refunded Amount`, `Vendor` `ORBES`, `Location`, `Id` (its Shopify id once it has one) and `Source` (`orbes-live`, `orbes-draw`, `orbes-salon`, `orbes-gift`: a welcome gift, its own order at `0.00` once its order has its currency). Dates read `2026-11-02 09:00:00 +0000`. An AUDITOR reads the emails masked (`j***@example.com`) and the buyer masked (`J*** D***`, the address `***`). `ORBES-shopify-orders-2026-11-01-to-2026-11-30.csv` |

A size **set aside** (plan NEXT LOT §3.3, §13.4) is left out of the product export, the model's Shopify product (`GET …/shopify`, the Catalogue's *Price · Shopify* count) and the link (unknown there: `400`); its ids stay on its SKU as they are. On a model with its size type no SKU is made by the link: its sizes are declared in the Catalogue.

In the console: **Catalogue** — a model's base price, its currency and its care guide in its *Edit*; the list's *Price · Shopify* (the base price, and NOT LINKED, LINKED or LINKED · 2 OF 4 SIZES); *Shopify export* (every role that reads: the store's currency, what the file holds and leaves out said first); *Shopify* on a model's row (OPERATOR: the product's and each size's ids pasted back). **Orders** — *Shopify export*: the period, the current month to today by default.

Errors of this section: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 MODEL_NOT_FOUND`, `409 SHOPIFY_PRODUCT_TAKEN`, `409 SHOPIFY_VARIANT_TAKEN`.

### 16.28 The Messages board (extension of the contract)

Plan NEXT-NINE, CS-01 (`genome/src/server/routes/admin/messages.ts`, `services/messages.ts`): one conversation per client. Clients write from the app (§10.17); the answers appear in their account. **No email is sent**, staff **never open** a conversation (they answer one a client opened; there is no `Write to the client`), and **no answer time** is shown or promised anywhere. An AUDITOR reads the clients' emails masked (`j***@example.com`); OPERATOR and ADMIN read them in clear. RETAIL has no access.

| Method | Path | Role | |
|---|---|---|---|
| GET | `/api/admin/messages` | AUDITOR | The board: `?status=` `TO_ANSWER` (left out), `ANSWERED`, `CLOSED` or `ALL`; `?who=` `mine` (answered by the reader) or `unassigned`; `?q=` part of a client's email, or a scan's REF (8 hex characters); a reader who sees the emails masked (an AUDITOR) finds a client by the whole email only (any case), never by part of it, so that the search cannot rebuild a masked address; `?page`, `?pageSize` (§6). Paginated, with `toAnswer`, the count To answer. **Order**: TO_ANSWER first; within it PALLADIUM, then PLATINE, then the rest (the tier read now, as §10.10 computes it), the longest waiting first in each; then the others, newest message first. Each row: `id`, `account` (`id`, `email`), `tier` (`level`, `name`), `priority` (`PALLADIUM` or `PLATINE` from THE PROGRAM's priority tier up, PLATINE by default; else `null`), `concerns` (the latest context of the client's messages: `kind`, `label`, `productId`, `orderId`, `dropId`, `dropMode`, `modelId`, `shopRequestId`, `scanEventId`, `scanRef`) and `moreConcerns` (how many other places they concern), `lastMessage` (`author`, `excerpt` of 140 characters, `at`), `waitingSince`, `status`, `answeredBy` (`id`, `email`) or `null`. |
| GET | `/api/admin/messages/summary` | AUDITOR | `{ "toAnswer", "priority" }`: the sidebar's badge (`priority`: those answered first). |
| GET | `/api/admin/messages/:id` | AUDITOR | A conversation: the row's head, `createdAt`, `closedAt`, `closedBy`, and its `messages`, oldest first: `id`, `author` (`COLLECTOR`, `STAFF`), `admin` (the staff member of an answer, by email), `body`, `at`, `concerns` (as above, on a client's message) or `null`. |
| POST | `/api/admin/messages/:id/answer` | OPERATOR | `{ "body": string }`, 1 to **4 000** characters once trimmed (*Write the answer.*, *An answer is limited to 4,000 characters.*). Under the conversation's row lock: the answer, signed ORBES Client Services for the client; ANSWERED; `answered_by` set when nobody was. Answers the conversation. Audited `message.answer` (`{ conversationId, messageId }`). |
| POST | `/api/admin/messages/:id/take` | OPERATOR | The reader answers it from now. Audited `message.take` (`{ conversationId, before, after }`). |
| POST | `/api/admin/messages/:id/assign` | **ADMIN** | `{ "adminId" }`: an active OPERATOR or ADMIN (`400 VALIDATION_FAILED` otherwise). Audited `message.assign` (`{ conversationId, before, after }`). |
| POST | `/api/admin/messages/:id/close` | OPERATOR | CLOSED (`409 CONVERSATION_CLOSED` when it is). The client never sees it; writing again reopens it, To answer. Audited `message.close` (`{ conversationId, from }`). |

A row and a conversation also carry `care`: the client's open yearly care (§16.29), `{ id, serial }` of the newest request not DONE nor CANCELLED, or `null`; the console shows it as *Yearly care · O26-J-00184*, a link to its request. It changes neither the conversation's status nor its place in the order, and no step of the care writes a message.

No audit entry ever holds a message's words. A lock of the account (§16.12) leaves its conversation as it is: staff can still answer it. The priority applies from the tier THE PROGRAM names (`messagesPriorityMinTier`, §16.21; BP-19 T8): PLATINE by default, PALLADIUM, or off (`0`: no row is put first nor marked, the longest waiting first only), read at each request; it drives both the order and the mark. No answer time is held in any field.

Errors of this section: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 CONVERSATION_NOT_FOUND`, `409 CONVERSATION_CLOSED`.

In the console: **Messages**, the first item of Clients (`#/messages`), its badge counting To answer, refreshed once a minute while the tab is visible (the tab title's `(n)` stays the Anomalies count). The board's filters *To answer (n) · Answered · Closed · All*, *Everyone · Mine · Unassigned* and a search by email or REF; its columns *Priority*, *Client* (its sheet), *Concerns* (`Piece O26-J-00184`, `Order OR-3F9A21C4`, `Release Monolithe in steel`, `Scan REF 5A864AF8 · Invalid signature`, `Model Eclipse · salon request` or `General`, then `+2 more`, each a link to its page), *Last message*, *Waiting since*, *Status* and *Answering*; empty: *No conversation to answer.* A conversation (`#/messages/:id`): its head (the client, the tier, the priority tag, the status, who answers), *Take it* (OPERATOR), an ADMIN's choice of who answers, *Close conversation* after a confirmation; its thread (each message with its author and time, a *Concerns* link to the piece, the order, the release, the model or the salon's requests, a scan's to its verification event while the scan retention keeps it); the answer box (OPERATOR, no attachment): *The client reads this in their account, signed ORBES Client Services.*, toasts *Answer sent.* and *Conversation closed.* The client sheet's *Messages* line opens it (capabilities `answerMessages` OPERATOR, `assignMessages` ADMIN).

### 16.29 Yearly care (extension of the contract)

Plan NEXT-NINE, BP-19 T6 (`genome/src/server/routes/admin/care.ts`, `services/care.ts`; DATABASE §5.68). The collectors' requests for the yearly care of a piece (§10.18), and their steps. **Nothing is written in MESSAGES** at any step; the prepaid label is shown in the piece's SERVICE tab only. An AUDITOR reads the clients' emails and the return name and address masked; OPERATOR and ADMIN in clear. RETAIL has no access. The steps are OPERATOR's (console capability `manageCare`).

| Method | Path | Role | |
|---|---|---|---|
| GET | `/api/admin/care` | AUDITOR | The board: `?status=` one step (`REQUESTED`, `LABEL_SENT`, `RECEIVED`, `RETURNING`, `DONE`, `CANCELLED`), `?year=`, `?page`, `?pageSize`; oldest first. Each row: `id`, `status`, `requestedAt`, `year`, `tier` (the tier at the request), `piece` (`productId`, `model`), `account` (`id`, `email`). |
| GET | `/api/admin/care/:id` | AUDITOR | A request: the row, `returnName`, `returnAddress`, `label` (`carrier`, `tracking`, `trackingUrl`, `at`, `pdf`) or `null`, `receivedAt`, `serviceRecordId`, `return` or `null`, `doneAt`, `cancelledAt`, `cancelledBy` (`account`, `admin`), `note`, `handledBy`, and `conversation` (`{ conversationId, status }` of the client's MESSAGES, or `null`: *No conversation yet.*). |
| POST | `/api/admin/care/:id/label` | OPERATOR | **SEND LABEL**, REQUESTED → LABEL_SENT. The body is the PDF itself (`Content-Type: application/pdf`, at most **2 MiB**), its carrier and tracking number in the query: `?carrierId=` an active carrier, `&tracking=` 3 to 40 letters and digits (`careLabelQuery`, `400 VALIDATION_FAILED`). Another type, or bytes that do not begin with `%PDF-`: `415 FILE_NOT_PDF`; over 2 MiB: `413 FILE_TOO_LARGE`. Audited `care.label` (`{ requestId, productId, year, carrierId, bytes }`). |
| POST | `/api/admin/care/:id/receive` | OPERATOR | **RECEIVED AT THE ATELIER**, LABEL_SENT → RECEIVED: the piece's YEARLY_CARE service record opened (location *ORBES atelier*, the piece SERVICED, IN SERVICE in the app), in the same transaction. Audited `care.receive` (and `service.open`). |
| POST | `/api/admin/care/:id/return` | OPERATOR | **SHIP BACK** `{ "carrierId", "tracking" }`, RECEIVED → RETURNING, to the address the client gave. Audited `care.return`. |
| POST | `/api/admin/care/:id/complete` | OPERATOR | **COMPLETE** `{ "notes"? }` (the record's notes, staff only), RETURNING → DONE: the record COMPLETED and the piece back to its status, in the same transaction. Audited `care.complete` (and `service.complete`). |
| POST | `/api/admin/care/:id/cancel` | OPERATOR | **CANCEL** `{ "note" }` (1 to 500 characters, staff only), before the piece is shipped back (REQUESTED, LABEL_SENT or RECEIVED); an open record is cancelled with it, in the same transaction. Audited `care.cancel` (`{ requestId, productId, year, by, from }`). |

A step at the wrong time is `409 CARE_STEP`. The product page's *Open service* never offers YEARLY_CARE, and `POST /api/admin/products/:productId/services` refuses it (`422 VALIDATION_FAILED`): only this flow opens one. The audit log never holds the return name or address.

Errors of this section: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 CARE_REQUEST_NOT_FOUND`, `409 CARE_STEP`, `413 FILE_TOO_LARGE`, `415 FILE_NOT_PDF`.

In the console: **Yearly care** under Clients, after Warranties (`#/care`): tabs *Requested · Label sent · At the atelier · On its way back · Done · Cancelled*, oldest first; each row when it was asked for, the piece's serial and model, the client, the tier at the request and the year. A request's page (`#/care/:id`): its facts, the *Return address* as the client gave it, the client's *Messages* conversation as a link, and *Send label* (the PDF, a carrier, a tracking number), *Received at the atelier*, *Ship back*, *Complete*, *Cancel* (a note), each at its step. The client's Messages row and the conversation's head show *Yearly care · O26-J-00184* while a request is open.

### 16.30 The house's guarantee (extension of the contract)

Plan NEXT-NINE, IN-01 (`genome/src/server/routes/admin/guarantees.ts`, `services/guarantees.ts`; DATABASE §5.69, §5.70; TERMS-FACTS R150). **THE HOUSE'S GUARANTEE** is a guaranteed place at a coming release, granted by ORBES Client Services to one client: in a draw, its entry is selected first, for its pieces (§8.9); in a LIVE RELEASE, it is first in line in its size, for up to its pieces (§10.12). It names a place in a release, never the authenticity of a piece. Personal and used once: it is never transferred. It covers **a chosen release**, **the next release of a model** (a main model covers its variants; a variant covers itself) or **the next release of a collection**, published by its last day (`validUntil`, a day in Paris: it covers a release that opens by the end of that day). An after-room is never covered.

A guarantee's `status` is stored (`ACTIVE`, `USED`, `EXPIRED`, `REVOKED`); its `state` follows: `WAITING` (active, for the next release in its scope), `SET_ASIDE` (active, for `release`), `ENTERED` (its client entered with it), `USED` (at the draw, a reservation of the early access or a LIVE turn), `EXPIRED` (its release ended or was cancelled, or its validity passed), `REVOKED`. A MODEL or COLLECTION guarantee is set aside at the grant for the next release in its scope already published and not yet closed, with room for its pieces, or at the publication of the next one (§16.19, §16.23); one not used when its release ends or is cancelled waits for the next one while valid (`guarantee.carry`).

**Shown to the client** (`visible`): on, the client reads it in the app (§10.10, §10.12). Off, nothing appears in the client's account or on the release page for them; once drawn, the draw's public list still shows the place among GUARANTEED BY THE HOUSE, unmarked. Only the account's export (§16.13) gives a guarantee not shown to its client, and the notes: the grant's (`note`) and the revocation's (`revokeNote`). A guarantee not shown never refuses its holder a size: where the size can no longer give its pieces, the entry is an ordinary one and the guarantee stays set aside (§10.12).

| Method | Path | Role | |
|---|---|---|---|
| POST | `/api/admin/owners/:id/guarantees` | OPERATOR | **Grant** `{ "scope": "RELEASE" \| "MODEL" \| "COLLECTION", "targetId", "pieces": 1..5, "validUntil": "YYYY-MM-DD", "visible", "note"? }` (`note` 1 to 500 characters, for Client Services). **201** `{ "guarantee", "setAsideFor": { "id", "title" } \| null }`, `guarantee` as the client sheet lists it (§16.11). A client entered already in the release has the guarantee bound to that entry. Audited `guarantee.grant` (`{ accountId, scope, targetId, pieces, validUntil, visible, noted, coveredDropId }`: whether a note was given, never its words). |
| PATCH | `/api/admin/guarantees/:id` | OPERATOR | **Change** `{ "pieces"?, "validUntil"?, "visible"?, "note"? }`, at least one, while `ACTIVE`; its pieces no longer change once its client entered with it. **200** `{ "guarantee" }`. Audited `guarantee.update` (before and after, the note as `noted`). |
| POST | `/api/admin/guarantees/:id/revoke` | OPERATOR | **Revoke** `{ "note"? }`, while `ACTIVE`: the client's entry, if any, stays as an ordinary entry (a draw's for one piece; a LIVE RELEASE's still waiting within `perAccount`). **200** `{ "guarantee" }`. Audited `guarantee.revoke`. |
| GET | `/api/admin/drops/:id/guarantees` | AUDITOR | A release's guarantees, a draw's or a LIVE RELEASE's: `{ "items": [{ "id", "account": { "id", "email" }, "pieces", "visible", "state", "entry": { "id", "status" } \| null, "validUntil", "grantedAt" }] }`, the client's email masked for an AUDITOR. |
| GET | `/api/admin/settings/guarantees` | AUDITOR | The Grant dialog's defaults: `{ "validDays", "pieces", "visible", "defaultValidUntil", "updatedAt", "updatedBy" }` (90 days, 1 piece, shown, unless an ADMIN set others). |
| PUT | `/api/admin/settings/guarantees` | **ADMIN** | Those defaults `{ "validDays": 1..730, "pieces": 1..5, "visible" }`, whole. Audited `guarantee.settings`. |

**Grant** refuses: an unknown account (`404 ACCOUNT_NOT_FOUND`), a locked one (`403 ACCOUNT_LOCKED`), a deleted one (`409 ACCOUNT_NOT_ACTIVE`); an unknown target (`404 DROP_NOT_FOUND`, `404 MODEL_NOT_FOUND`, `404 COLLECTION_NOT_FOUND`), a model no longer offered (`409 MODEL_INACTIVE`); a `validUntil` before today in Paris or more than 730 days ahead (`400 VALIDATION_FAILED`); a chosen release over (`409 GUARANTEE_RELEASE_OVER`), past its close or an after-room (`409 GUARANTEE_RELEASE_CLOSED`), opening after the validity (`409 GUARANTEE_RELEASE_OPENS_LATE`), without room for its pieces (`409 GUARANTEE_EXCEEDS_RELEASE`), or where the client already holds a guarantee or a place (`409 GUARANTEE_ALREADY`). A grant, a change and a revocation read the account under a share lock, then the release under an update lock, then the entry, then the guarantee: a draw, a publication or a LIVE turn under way finishes first. Every step of a guarantee is in the audit log (`guarantee.grant`, `.update`, `.revoke`, `.cover`, `.use`, `.carry`, `.expire`, `.settings`); never a note's words.

Errors of this section: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `403 ACCOUNT_LOCKED`, `404 ACCOUNT_NOT_FOUND`, `404 GUARANTEE_NOT_FOUND`, `404 DROP_NOT_FOUND`, `404 MODEL_NOT_FOUND`, `404 COLLECTION_NOT_FOUND`, `409 ACCOUNT_NOT_ACTIVE`, `409 MODEL_INACTIVE`, `409 GUARANTEE_RELEASE_OVER`, `409 GUARANTEE_RELEASE_OPENS_LATE`, `409 GUARANTEE_RELEASE_CLOSED`, `409 GUARANTEE_EXCEEDS_RELEASE`, `409 GUARANTEE_ALREADY`, `409 GUARANTEE_IN_USE`, `409 GUARANTEE_USED`, `409 GUARANTEE_CLOSED`, `409 GUARANTEE_BUSY`.

In the console: the client sheet's **House guarantee**, after *Releases* (*A guaranteed place at a coming release, granted by Client Services. Personal, used once.*): each guarantee, what it covers, its pieces, valid until, shown, its status (WAITING FOR A RELEASE, SET ASIDE, ENTERED, USED, EXPIRED, REVOKED), its release, who granted it and its note; **Grant a guarantee** (OPERATOR, an ACTIVE account) opens *Grant the house’s guarantee*: *Covers* (the next release of a model, by default; of a collection; a chosen release, with its rule of access), *Pieces*, *Valid until*, *Shown to the client*, *Note*; **Change** and **Revoke** on an active one. A release's page (draw or LIVE) shows its guarantees in **Guarantees**. Orders → Settings, **House guarantee**: *Valid for*, *Pieces*, *Shown to the client*, edited by an ADMIN.

### 16.31 Growth (extension of the contract)

Plan NEXT-NINE, BP-29 (`genome/src/server/routes/admin/growth.ts`, `services/growth.ts`; DATABASE §5.9, §5.12, §5.51 and §9, migration `0032_growth_indexes`). **GROWTH** reads how the house grows: what a collector is worth, who comes back for a second piece, how a scan becomes a member, and the revenue. It only reads: nothing is written, audited or cached, and there is no snapshot table. Every role from AUDITOR reads it; RETAIL gets `403 FORBIDDEN`. Amounts are in minor units and **never converted**: one currency at a time (`EUR`, `GBP`, `USD` or `CHF`; by default the one with the most invoices, `EUR` when there is none).

**The rules.**

- **A purchase** is a paid order not `CANCELLED` or `RETURNED`, and never a `GIFT` order (a welcome gift is not bought), at its invoiced price after credit notes (its invoice's total, so BP-19's shipping lines and credits are inside it); or a `FIRST_REGISTRATION` of a piece no order names (an order not `CANCELLED` names its piece for its buyer, and for anyone while not `RETURNED`: an ordered piece counts once, and a returned order nets to zero), at its model's base price (`base_price_minor`), or its main model's for a variant without one. A piece whose model has neither counts and adds no value (*Pieces without a price*). `TRANSFER`, `RESALE` and `ADMIN` pieces never count. A piece from elsewhere is `POINT_OF_SALE` when its warranty names a point of sale, otherwise `ELSEWHERE`; the Shopify store's pieces are `ELSEWHERE` until the sync, whose channel then joins the sources.
- **Lifetime value** is lifetime to date, whatever the window; its channel and model are those of the collector's first piece (a variant under its main model), its tier the one held now (`CLUB_TIER_THRESHOLDS`), its country the account's (`null`: not given). **Repeat buying** counts every purchase whatever its currency. **The funnel** counts each account in the month it first reached each step: its creation, its first ownership of any kind (*Registered owners*), its first paid `LIVE`, `DRAW` or `SALON` order not cancelled or returned (*Buyers*, never a `GIFT` order), and PLATINE and PALLADIUM by the pieces held over all history under the constant thresholds (the pieces now revoked, flagged or retired left out); *Scans* are Analytics' total per UTC month (§16.16), counted, not people. **Revenue** is invoices less credit notes, in the UTC month each was issued; it equals the Invoices page's totals of that month (§16.25).
- `DELETED` accounts are left out of lifetime value, repeat buying and COLLECTORS BY VALUE, and kept in the funnel and the revenue.
- The **test entrants' pool** (§16.32's `test-0001@orbes.test`…, a `test_entrants` row each, kept after END TEST, their accounts' creation dates moved back at each test) is left out of the purchases (lifetime value, repeat buying, COLLECTORS BY VALUE, the client sheet's `lifetimeValue`) and of every step of the funnel, `clubNow` included: they are not sign-ups, owners or buyers.
- In the breakdowns, a group of **fewer than 3 collectors** keeps its count and gives its amounts as `null` (*Fewer than 3 collectors: amounts not shown.*).

| Method | Path | Role | |
|---|---|---|---|
| GET | `/api/admin/growth?months=12\|24&currency=` | AUDITOR | **The report** of the last `months` UTC months (12 by default; the current month included): `{ "window", "ltv", "repeat", "funnel", "revenue" }`, below. It names no account: no id, email or name. Read in one `REPEATABLE READ, READ ONLY` transaction. The route first counts the scan days not counted yet (`aggregateScanStats`, as §16.16); a count that fails is logged and the report still answers. |
| GET | `/api/admin/growth/collectors?currency=&page=` | AUDITOR | **COLLECTORS BY VALUE**: `{ "currency", "currencies", "page", "pageSize": 25, "total", "items": [{ "accountId", "email", "tier", "country", "pieces", "valueMinor", "firstPieceAt" }] }`, every collector with a counted piece in the currency (or a piece without a price), the highest value first, then by account id, 25 a page (`page` from 1). The email is masked for an AUDITOR (`j***@example.com`, as on the owners' list, §16.2), in clear for OPERATOR and ADMIN. Each row agrees with the client sheet's `lifetimeValue` (§16.11). |
| GET | `/api/admin/growth/releases` | AUDITOR | **Latest releases**: `{ "items": [{ "id", "mode": "DRAW" \| "LIVE", "title", "opensAt", "pieces", "sold", "sellOutMs", "entries" }] }`, the 6 latest releases past their opening, the latest first; no draft, cancelled release or after-room. A draw's `pieces` is its quantity, `sold` its paid orders not cancelled or returned, `entries` its entries not withdrawn; a LIVE RELEASE's `pieces` its stock, `sold` its confirmed pieces less those cancelled, `sellOutMs` from T0 to its last piece confirmed when every piece was (the release report's `summarize`, §16.23). |

```json
{
  "window": { "months": 12, "from": "2025-11", "to": "2026-10", "list": ["2025-11", "…", "2026-10"], "currency": "EUR", "currencies": ["EUR", "GBP"], "generatedAt": "…" },
  "ltv": {
    "perCollector": { "collectors": 7, "totalMinor": 2715000, "averageMinor": 387857, "medianMinor": 240000, "topTenthFromMinor": 960000 },
    "unpricedPieces": 1,
    "byTier": [{ "key": "PALLADIUM", "label": null, "collectors": 1, "totalMinor": null, "averageMinor": null, "medianMinor": null }, { "key": "TITANE", "…": "…" }, { "key": "NONE", "…": "…" }],
    "byCountry": [{ "key": "FR", "label": null, "collectors": 5, "totalMinor": 1925000, "averageMinor": 385000, "medianMinor": 120000 }],
    "byFirstModel": [{ "key": "<model id>", "label": "HALO", "…": "…" }],
    "byChannel": [{ "key": "LIVE", "…": "…" }, { "key": "DRAW" }, { "key": "SALON" }, { "key": "POINT_OF_SALE" }, { "key": "ELSEWHERE" }]
  },
  "repeat": {
    "collectors": 8, "withSecond": 4, "rate": 0.5, "medianDays": 168,
    "buckets": { "MONTH": 0, "THREE_MONTHS": 1, "SIX_MONTHS": 1, "YEAR": 1, "LATER": 1 },
    "cohorts": [{ "month": "2026-10", "collectors": 0, "within": [null, null, null, null], "toDate": 0 }, "…"]
  },
  "funnel": {
    "thresholds": [1, 5, 10],
    "totals": { "scans": 100, "accounts": 9, "owners": 4, "buyers": 5, "platine": 1, "palladium": 1 },
    "months": [{ "month": "2026-10", "counts": { "scans": 0, "accounts": 0, "owners": 0, "buyers": 0, "platine": 0, "palladium": 0 } }, "…"],
    "clubNow": { "TITANE": 4, "PLATINE": 0, "PALLADIUM": 1, "total": 5 }
  },
  "revenue": {
    "months": [{ "month": "2026-10", "orders": 2, "invoicedMinor": 550000, "creditedMinor": 0, "netMinor": 550000 }, "…"],
    "total": { "orders": 9, "invoicedMinor": 2115000, "creditedMinor": 600000, "netMinor": 1515000 },
    "byChannel": [{ "key": "LIVE", "label": null, "collectors": 1, "orders": 1, "netMinor": null }, { "key": "DRAW", "…": "…" }, { "key": "SALON", "…": "…" }],
    "byCountry": [{ "key": "FR", "…": "…" }],
    "byModel": [{ "key": "<model id>", "label": "MONOLITHE", "collectors": 3, "orders": 3, "netMinor": 910000 }]
  }
}
```

- `ltv.perCollector`: the collectors with a counted piece in the currency, their total, average, median, and `topTenthFromMinor`, the value from which the top tenth of them start (the lowest of the ⌈n / 10⌉ highest).
- `repeat.buckets`: the time from the first piece to the second, before 1, 3, 6 or 12 months after the first (calendar months, UTC), or after a year. `repeat.cohorts`: the months of the window, the newest first, by month of the first piece: its collectors, `within` those with a second piece before 1, 3, 6 and 12 months (`null` while the mark is not reached for the whole cohort) and `toDate`.
- `funnel.months`, `revenue.months`: the months of the window, the newest first. `funnel.clubNow`: the members of the club now, as Analytics counts them (§16.16, the ACTIVE accounts holding a piece).
- `revenue.byChannel`, `byCountry` and `byModel` over the window, the highest net first (`byChannel` in the order LIVE, DRAW, SALON); a variant under its main model. `collectors` is the accounts behind a group.

Errors: `400 VALIDATION_FAILED` (`months` other than 12 or 24; a currency not of the house; `page` not a whole number from 1), `401 UNAUTHORIZED`, `403 FORBIDDEN` (RETAIL).

In the console: **Growth** (`#/growth?months=12|24&currency=&ltv=tier|country|model|channel&rev=channel|country|model&page=`), under Overview after Dashboard, for AUDITOR and up (capability `readGrowth`). *LAST 12 MONTHS · LAST 24 MONTHS*, the currency's choice when more than one appears; the figures *Collectors* (*AVERAGE VALUE €…*), *Second piece* (*MEDIAN … DAYS*), *New owners* and *Net revenue* (*IN 12 MONTHS · AFTER CREDIT NOTES*); **Lifetime value** (per collector, COLLECTORS BY VALUE with *Next 25* and *Previous 25*, each row opening the client sheet, then *BY TIER · BY COUNTRY · BY FIRST MODEL · BY CHANNEL*); **Repeat buying** (the figures, the time to the second piece as hairline bars, *By month of first piece*); **From scan to PALLADIUM** (each step and its share of the one before, *Accounts* per 100 scans, *Scans are counted, not people.*, the months, *In the club now: …*); **Revenue** (the net of each month, each opening the Invoices page of that month, *BY CHANNEL · BY COUNTRY · BY MODEL*); **Elsewhere in the console** (*Scans by country*, the top five over 30 days, and *The circle by tier*, to Analytics; *Latest releases*, each row opening its release, *All drops*; *Best time to open*, the hour in Paris and its share or *Not enough activity yet.*, to Analytics). A panel that cannot be read says *This figure could not be read. The rest of the page is current.*

### 16.32 Test entrants: a release's tests (extension of the contract)

The owner's lot of 2026-10-07 (`routes/admin/test-entrants.ts`, `services/test-entrants.ts`, migration `0024_z_test_entrants`, DATABASE §5.73 to §5.75): from a draw's page or a LIVE RELEASE's page, an ADMIN sends **test entrants**, artificial collectors, to prove the release's process, prove it holds a crowd and watch it live. A test entrant is an ordinary ORBES account of a pool (`test-0001@orbes.test`, display name `TEST 0001`, ACTIVE, a password hash no password matches: it never signs in), reused from test to test (5 000 accounts at most). It behaves exactly as a collector: it enters through the public routes (§10.10, §8.10) with its own session minted by the server, the CSRF token and the site's Origin, from its own address in `100.64.0.0/10` (RFC 6598; its own `/24`, or `100.127.255.0/24` for the « shared network » share), so validation, rate limits, network hashes and the bot radar apply; it wins, takes real places and pieces, and PAY or a Confirm creates its real orders; public counts and the console's figures count it. Only three things are its own: its tier and seniority come from its test row, never from pieces (every reader of a tier: the draw, the early access, the LIVE line, access); it counts as owning a LIVE RELEASE's models and collection for its rule (and for a segment's « owns a model » and « owns a collection » criteria, so a release open to a segment of owners lets it in); and END TEST cleans up after it.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/admin/drops/:id/test-runs` | **ADMIN** | SEND TEST ENTRANTS (the body below): a draw `OPEN`, or in the early access of a tier sent to reserve, PALLADIUM's from its time or PLATINE's from its own (`409 TEST_DRAW_NOT_OPEN` « Start the test while the draw is open. »); a LIVE RELEASE announced, its room open, not over (`409 TEST_ROOM_NOT_OPEN` « Start the test once the room is open. »). One test RUNNING at a time in the whole console (`409 TEST_RUNNING`); the pool at most 5 000 accounts (`409 TEST_POOL_FULL`, its message saying how many more could still be made, and that END TEST on an earlier test gives its accounts back). **201** `{ "run": TestRunView }`. Audited `test_run.start` `{ dropId, mode, entrants, tiers }` |
| POST | `/api/admin/test-runs/:id/add` | **ADMIN** | ADD MORE: the same body (the phrase `TEST <8>`, the tiers; a group left out keeps the run's last press's), only on a RUNNING test (`409 TEST_NOT_RUNNING`), at most 5 000 test entrants per test (`409 TEST_RUN_FULL`). **200** `{ run }`. Audited `test_run.add` `{ dropId, entrants, total, tiers }` |
| POST | `/api/admin/test-runs/:id/stop` | **ADMIN** | STOP, no body, one press: the test entrants halt at once, nothing is cleaned; `STOPPED` (`409 TEST_NOT_RUNNING` unless RUNNING). **200** `{ run }`. Audited `test_run.stop` |
| POST | `/api/admin/test-runs/:id/entrants/:accountId/confirm` | **ADMIN** | CONFIRM by hand, no body: a draw's `SELECTED` place confirmed by the staff's Confirm (§16.19, its order created); on a LIVE RELEASE, the test entrant on its turn or holding its piece presses, holds the seal, secures and pays now (`409 TEST_PLACE_NOT_HELD` otherwise). **200** `{ run }`. Audited `test_run.confirm` `{ accountId, entryId }` |
| POST | `/api/admin/test-runs/:id/entrants/:accountId/release` | **ADMIN** | RELEASE by hand, no body, a LIVE RELEASE only: the held piece given back now (RELEASE MY PLACE; `409 TEST_HOLD_NOT_HELD` without a hold); a draw's place is never given back (`409 TEST_DRAW_NO_RELEASE`). **200** `{ run }`. Audited `test_run.release` |
| POST | `/api/admin/test-runs/:id/end` | **ADMIN** | END TEST, `{ "phrase": "END TEST 1A2B3C4D" }`, on RUNNING, DONE, STOPPED or INTERRUPTED (`409 TEST_ENDED` once ended): see below. **200** `{ run }`, `ENDED` with its `report`. Audited `test_run.end` `{ dropId, from, checksPassed, checksTotal, cleaned }` |
| GET | `/api/admin/drops/:id/test-runs/current` | AUDITOR | `{ "run": TestRunView \| null }`: the release's newest test not ended (`404 DROP_NOT_FOUND`) |
| GET | `/api/admin/drops/:id/test-runs` | AUDITOR | `{ "runs": TestRunSummary[] }`: the release's tests, newest first |
| GET | `/api/admin/test-runs/active` | AUDITOR | `{ "run": { id, dropId, dropName, mode, status, entrants } \| null }`: the RUNNING test, whatever its release (the Drops tab) |

The body of SEND TEST ENTRANTS and ADD MORE (strict; every group but `tiers` optional, a group left out taking the settings by default at START and the last press's at ADD MORE; a group sent is whole):

```json
{
  "phrase": "TEST 1A2B3C4D",
  "tiers": { "none": 0, "titane": 100, "platine": 0, "palladium": 0 },
  "arrival": { "mode": "burst", "seconds": 10, "interestPct": 0 },
  "behaviour": { "payPct": 70, "releasePct": 20, "missPct": 10, "leavePct": 0, "holdSeconds": 1.5,
                 "withdrawPct": 0, "reservePct": 0, "confirmPct": 70 },
  "choices": { "size": null, "quantity": 1, "addOnsPct": 0 },
  "profile": { "seniorityMin": 0, "seniorityMax": 3, "accountAgeDaysMin": 30, "accountAgeDaysMax": 720,
               "countries": [], "sharedNetworkPct": 0 }
}
```

- `phrase`: `TEST` and the release's id, its first 8 characters in capitals (spaces and case aside; `400 VALIDATION_FAILED` « Type TEST 1A2B3C4D to confirm. »).
- `tiers`: test entrants per tier (NO TIER, TITANE, PLATINE, PALLADIUM), whole numbers, 1 to 1 000 per press in all.
- `arrival.mode`: `all` (at once), `burst` (evenly over `seconds`, 1 to 3 600, 10 by default) or `before` (a LIVE RELEASE only: spread from now until T0); `interestPct`: the share that says I'LL BE THERE first (a LIVE RELEASE, before T0).
- `behaviour`: on a LIVE RELEASE, the shares that PAY, RELEASE MY PLACE, miss their turn (do nothing) or LEAVE (on their turn, or 5 to 60 s after entering), 100 in all, and the seal held `holdSeconds` (1.5 to 10) between PRESS and SECURE; PAY or RELEASE comes 2 to 10 s after SECURE. On a draw, the share that withdraws 2 to 10 s after entering, the share of the PLATINE and PALLADIUM that reserve during the early access instead, each in its own tier's window (a PLATINE early for its own waits for it; a test entrant that cannot enter yet waits for the opening), and the share of the places held that confirm by themselves (`confirmPct`). Every share is exact (70 % of 10 is 7), the test entrants drawn at random.
- `choices` (a LIVE RELEASE): `size`, one of the release's sizes, its id or its label (`400` otherwise), or `null` for one at random each; `quantity`, 1 to 5 pieces, or `null` at random, within the release's own limit and the size's stock; `addOnsPct`, the share that adds one of its add-ons.
- `profile`: each test entrant drawn within: its seniority (0 to 50 years), its account's age (0 to 3 650 days: its account's `createdAt` moved back; a new account trips the bot radar), a country of `countries` (ISO 3166-1 alpha-2; none: none) and the share coming from the one shared network.

A press takes the pool's accounts with no entry in the release and in no test not yet ENDED (a DONE draw's test waiting for its draw keeps its accounts and their tiers; END TEST gives them back), makes the missing ones, and sets each one's test row (its tier, a seniority), its country and its account's age.

**A run**: `RUNNING` (its test entrants acting), `DONE` (every one has acted; a draw's test waits there for the staff's draw), `STOPPED` (STOP), `INTERRUPTED` (a restart or a deploy while it ran: the next start of the server marks it), `ENDED` (END TEST). Only `RUNNING` blocks a new test. While a draw's test is RUNNING or DONE, each place a test entrant holds (drawn, reserved in the early access or offered next) and drawn to confirm is confirmed by the staff's Confirm, with the test's ADMIN as actor, 5 to 60 s after it is held; the time is kept in the database, so a restart resumes it. The others keep their place until its time ends and lapse as anyone's.

**END TEST**: the test entrants stop; the TEST REPORT is computed **before** the clean-up and kept (a clean-up cut short keeps it: END TEST again finishes it); then, for the test's accounts in that release: their open orders (RESERVED, PAID) cancelled one by one as Client Services cancels one (§16.24: the stock goes back and serves the next order waiting for it; since plan NEXT LOT §3.5.9 the test's waiting orders are cancelled first, and no identity is reserved, so none is retired), the orders first, then the GIFT orders travelling with them (a PLATINE or PALLADIUM test entrant's welcome gift, §16.21: cancelled with its order, each re-read before its cancel so one already closed is skipped), the credit taken off them given back (`order.credit.release`, the grant's expiry unchanged), then checked: no GIFT order of the test left RESERVED or PAID and no credit left taken off a cancelled order of the test (any left is cancelled or given back the same way); the tiers' grants themselves stay with the pool's accounts (once per tier and per account, never deleted): their gift waits again, their credit is whole; a draw's `ENTERED` entries `WITHDRAWN` and its `SELECTED`, `CONFIRMED` and `WAITLISTED` ones `LAPSED` now (`respondBy` set to that time, their rank kept: staff OFFER NEXT to real collectors), a LIVE RELEASE's open entries `REMOVED` (§16.23 REMOVE: a piece held goes to the next), then, its orders cancelled, its `CONFIRMED` ones `REMOVED` too (`drop.live.remove` with `from: "CONFIRMED"`, `reason: "test_ended"`: the room sells their pieces again while the release runs), their I'LL BE THERE withdrawn before T0, their sessions ended. A draw's places are closed before its orders are cancelled, so no Confirm makes an order behind them. `ENDED`. The accounts stay in the pool.

`TestRunView`:

```json
{
  "id": "7c1e…", "dropId": "1a2b3c4d-…", "mode": "DRAW", "status": "RUNNING",
  "createdAt": "2026-10-07T03:00:00.000Z", "endedAt": null, "createdBy": "admin@theorbes.com",
  "settings": [ { "at": "2026-10-07T03:00:00.000Z", "entrants": 100, "tiers": { … }, "arrival": { … }, "behaviour": { … }, "choices": { … }, "profile": { … } } ],
  "entrants": 100,
  "byTier": [ { "tier": 0, "label": "NO TIER", "entered": 0, "inRoom": 0, "selected": 0, "confirmed": 0, "lapsed": 0,
                "released": 0, "missed": 0, "left": 0, "withdrawn": 0 }, "… TITANE, PLATINE, PALLADIUM" ],
  "release": { "real": 412, "test": 100, "total": 512 },
  "selected": [ { "accountId": "…", "email": "test-0042@orbes.test", "tier": 1, "status": "SELECTED",
                  "respondBy": "2026-10-09T03:00:00.000Z", "orderRef": null, "canConfirm": true, "canRelease": false } ],
  "errors": [ { "at": "2026-10-07T03:00:04.120Z", "message": "ENTER refused for test-0042@orbes.test: 429 RATE_LIMITED" } ],
  "report": null,
  "peaks": null
}
```

`settings`: each press, oldest first, with its time and its test entrants. `byTier` by the test row's tier: on a draw `entered` (an entry), `inRoom` (`ENTERED` or `WAITLISTED`), `selected`, `confirmed`, `lapsed`, `withdrawn`; on a LIVE RELEASE `inRoom` (WAITING, QUEUED, TURN, SECURED), `selected` (TURN, SECURED), `confirmed`, `lapsed` (EXPIRED), `released`, `missed`, `left`. `release`: the release's entries, any test's counted as `test`. `selected` (at most 500): the test entrants holding a place (a draw's `SELECTED` or `CONFIRMED`; a LIVE `TURN`, `SECURED` or `CONFIRMED`), `respondBy` the end of the place held (a LIVE hold's, or its turn's), `orderRef` its order's `OR-` reference; the email masked for an AUDITOR. `errors`: the last 20 refusals the test entrants met (this process's memory). `peaks`: the test's running maxima while it ran (§13.5), saved every ~10 s.

`report` (and `TestRunSummary.report`): `{ "at", "checks": [ { "id", "label", "pass", "line" } ], "passed", "total", "peaks" }`, five checks over the whole release, real and test entries together, each with one plain line: `ONE_ENTRY` one entry per account; `ORDER` a drawn draw's order follows tier then seniority (the ranks recomputed from the seed it revealed; the early access's reservations are outside the ranking), or a LIVE RELEASE's line at T0 by tier when it gives tier priority; `ONE_PLACE` nobody holds two places (a LIVE RELEASE and its after-room together; 1 to 5 pieces each); `STOCK` the places held or sold within the release's pieces (per size on a LIVE RELEASE), one order per place or piece confirmed, no stock line below zero; `ORDERS` every confirmed place has its order (one per piece on a LIVE RELEASE). `TestRunSummary`: `{ id, status, createdAt, endedAt, createdBy, entrants, checksPassed, checksTotal, report, peaks }`, the checks `null` until END TEST.

Errors besides: `400 VALIDATION_FAILED`, `401`, `403 FORBIDDEN` (below ADMIN for a change), `403 CSRF_FAILED`, `404 DROP_NOT_FOUND`, `404 TEST_RUN_NOT_FOUND`, `404 TEST_ENTRANT_NOT_FOUND`, `409 TEST_ENDING` (END TEST already under way).

In the console: a draw's page and a LIVE RELEASE's page carry **Test entrants** (BRAND-DESIGN-SYSTEM §6, principle 26): **Send test entrants** (ADMIN, a phrase to type), the test not ended read every 2 s (its status, settings, test entrants by tier, the release's entries real, test and in all, those holding a place with **Confirm** and, on a LIVE RELEASE, **Release**, the last errors), **Add more**, **Stop**, **End test** (a phrase to type), then **Past tests** with each report (and **End test** for an earlier test not ended, when a newer one was sent since). A test entrant's email carries **TEST** in the entries' lists. The **Server** panel (§13.5) stands on the right of these pages and of the Drops tab, which also shows the test running with **Stop**.

### 16.33 Supplier orders, receptions and the agent (extension of the contract)

Plan NEXT LOT of 2026-10-07, §3.5 (deployment H2; migration `0035_logistics_access`, DATABASE §5.77 and §5.90). « ORBES does not make its pieces: suppliers do »: several suppliers, one logistics agent, the collector. Implementation: `routes/admin/supplier-orders.ts`, `services/suppliers.ts`; the agent's role and scope, `routes/admin/logistics.ts` (`LOGISTICS_ACT`, `LOGISTICS_READ`, `logisticsScope`, §2.3); the parcels, `services/logistics.ts` and `services/parcels.ts` (step 5.9).

**The suppliers** are ORBES's, read by an AUDITOR and changed by an OPERATOR; a LOGISTICS login never reaches them (`403 FORBIDDEN`). A supplier is never deleted: set inactive, it stays on its models and orders and is offered for no new draft.

| Method | Path | Role | |
|---|---|---|---|
| GET | `/api/admin/suppliers` | AUDITOR | `{ "items": [ { "id", "name": "NORD RINGS", "contactName", "email", "phone", "address", "currency": "EUR", "note", "active": true, "models": 3, "createdAt" } ] }`, by name; `models`: how many models name it. |
| POST | `/api/admin/suppliers` | OPERATOR | Body `{ "name": string (1–120), "contactName"?, "email"?, "phone"?, "address"? (≤ 500, line breaks kept), "currency"?, "note"? (≤ 1 000), "active"?: boolean }`; '' or `null` leaves an optional field empty. **201** the supplier. `409 SUPPLIER_NAME_TAKEN` 'Another supplier has this name.' (whatever the case). The currency is any ISO 4217 code **with two decimals** (every amount is kept and printed in hundredths): a zero- or three-decimal one (BIF, CLP, DJF, GNF, ISK, JPY, KMF, KRW, PYG, RWF, UGX, UYI, VND, VUV, XAF, XOF, XPF; BHD, IQD, JOD, KWD, LYD, OMR, TND) is a `400 VALIDATION_FAILED` 'This currency is not supported: choose one with cents.'. Audited `supplier.create` `{ name, currency, active }`. |
| PATCH | `/api/admin/suppliers/:id` | OPERATOR | The fields given (at least one; `null` or '' clears an optional one, never the name), or `active: false`. **200** the supplier. `404 SUPPLIER_NOT_FOUND`, `409 SUPPLIER_NAME_TAKEN`. Audited `supplier.update` `{ fields }`, the names of the fields changed, **never the contact's words**; nothing changed, nothing written. |
| PUT | `/api/admin/models/:id/supplier` | OPERATOR | « Each model (or each size) has its supplier ». Body `{ "supplierId"?: uuid \| null, "sizes"?: { "<skuId>": uuid \| null } }` (at least one; at most 200 sizes): the model's supplier (`null`: none) and each listed size's own (`null`: the model's); a size not listed is left as it is. A size's own supplier wins over its model's, and a variant without one uses its main model's (`supplierOf`). **200** the model's Sizes section (§13.4) with its `supplier`. `404 MODEL_NOT_FOUND`, `404 SKU_NOT_FOUND` (a size of another model), `404 SUPPLIER_NOT_FOUND`; refused whole. Under the model's row `FOR NO KEY UPDATE`. Audited `model.supplier` `{ supplierId: { from, to }?, sizes: { <skuId>: { from, to } }? }`; nothing changed, nothing written. |

**The supplier orders** (step 5.6, `services/supplier-orders.ts`, migration `0036`, DATABASE §5.78 to §5.83): « The console proposes, ORBES confirms ». ORBES's own, read by an AUDITOR, written by an OPERATOR; every answer carries prices, so a LOGISTICS login never reaches one of these routes (`403 FORBIDDEN`): the agent sees an order's lines without prices during a reception only. A supplier order's reference is `SO-` and the first eight hexadecimal figures of its id (`SO-7C21A0B9`); every amount is in hundredths of its currency.

| Method | Path | Role | |
|---|---|---|---|
| GET | `/api/admin/supplier-orders` | AUDITOR | `?status=DRAFT\|SENT\|EXPECTED\|PARTLY_RECEIVED\|RECEIVED\|CANCELLED&supplierId=`. `{ "items": [ { "id", "reference", "status", "supplier": { "id", "name" }, "location": { "id", "name" }, "pieces": { "ordered", "received" }, "currency", "totalMinor" (null while a price is missing), "expectedOn": "YYYY-MM-DD" \| null, "invoice": { "number", "paid" } \| null, "createdAt" } ] }`, the latest first. |
| GET | `/api/admin/supplier-orders/proposal` | AUDITOR | `?locationId=&supplierId=`. « The console proposes »: `{ "toOrder", "groups": [ { "supplier": { "id", "name" } \| null, "location": { "id", "name" }, "draft": { "id", "reference" } \| null, "toOrder", "rows": [ { "sku": { "id", "code", "model": { "id", "name" }, "variant", "sizeLabel", "setAside" }, "waiting", "underMinimum", "expected", "inDraft", "toOrder" } ] } ] }`: per offered size and location where an order waits for supplier stock (`waiting`, reservation AWAITING) or the stock is under its minimum (`underMinimum` = max(0, minimum − available)); `expected`, what the sent orders to that location still owe; `inDraft`, what a draft there holds; `toOrder` = max(0, waiting + underMinimum − expected − inDraft). A size set aside is left out, its waiting orders and its minimum alike; a size without an active supplier is in the group whose `supplier` is null, last. Test orders count like real ones. |
| POST | `/api/admin/supplier-orders/draft-lines` | OPERATOR | Body `{ "skuId", "locationId", "quantity": 1–10 000, "from"?: "PROPOSAL" \| "RELEASE" }`. The pieces added to the size's line in its supplier's draft to that location, created when there is none (one per supplier and location, in the supplier's currency; audited `supplier_order.create`); a new line's unit price is the last sent price of that SKU with that supplier. **200** the order. `409 SIZE_SET_ASIDE`, `409 SKU_NO_SUPPLIER`, `404 SKU_NOT_FOUND`, `404 STOCK_LOCATION_NOT_FOUND`. Audited `supplier_order.draft` `{ skuId, quantity, from }`. |
| GET | `/api/admin/supplier-orders/:id` | AUDITOR | The order: `{ "id", "reference", "status", "supplier": { "id", "name", "active", "currency" }, "location": { "id", "name", "address" }, "currency", "shippingMinor" (null: none), "expectedOn", "note", "createdAt", "updatedAt", "sentAt", "supplierConfirmedAt", "receivedAt", "restCancelled": { "at", "note" } \| null, "invoice": { "number", "amountMinor", "date", "paidAt" } \| null, "lines": [ { "id", "sku", "quantity", "unitPriceMinor", "lineTotalMinor", "received", "rejected", "credited", "restCancelled", "expected", "expectedElsewhere" } ], "extras": [ { "sku", "received", "rejected", "notes": [] } ], "receptions": [ { "id", "status", "countedAt", "accepted", "rejected", "confirmedAt", "confirmedBy" } ], "returns": [ { "id", "sku", "quantity", "status", "returnedAt", "settlement", "creditMinor", "settledAt", "note" } ], "pieces": { "ordered", "received", "expected" }, "linesTotalMinor", "totalMinor", "history": [ { "action", "at", "by" } ] }`. `received` and `rejected` come from its CONFIRMED receptions; `expected` = max(0, quantity − received − credited − rest cancelled); `extras` are the confirmed reception lines with no order line (extra pieces, a size not ordered: Not on the order); `expectedElsewhere`, on a draft's line, what other sent orders of that size to that location still owe. `404 SUPPLIER_ORDER_NOT_FOUND`. |
| PATCH | `/api/admin/supplier-orders/:id` | OPERATOR | A draft's fields (at least one): `{ "lines"?: [ { "skuId", "quantity": 1–10 000, "unitPriceMinor"?: 0–100 000 000 \| null } ] (the list becomes its lines; each size once, offered), "currency"?: ISO 4217 with two decimals \| null, "shippingMinor"?: 0–100 000 000 \| null (none), "expectedOn"?: "YYYY-MM-DD" \| null, "note"?: ≤ 1 000 \| null }`. **200** the order. `409 SUPPLIER_ORDER_NOT_DRAFT` once sent; `400` 'This currency is not supported: choose one with cents.'. Audited `supplier_order.update` `{ fields }`, never the note's words. |
| DELETE | `/api/admin/supplier-orders/:id` | OPERATOR | A draft discarded (deleted: it never left ORBES). **204**. `409 SUPPLIER_ORDER_NOT_DRAFT`. Audited `supplier_order.discard` `{ lines, pieces }`. |
| POST | `/api/admin/supplier-orders/:id/send` | OPERATOR | DRAFT → SENT; its lines and prices then never change. `422 SUPPLIER_ORDER_INCOMPLETE` without a line, a unit price on each, its currency or its expected date; `409 SUPPLIER_ORDER_NOT_DRAFT`. Audited `supplier_order.send` `{ lines, pieces, currency, expectedOn }`. |
| POST | `/api/admin/supplier-orders/:id/supplier-confirmed` | OPERATOR | Body `{ "expectedOn"?: "YYYY-MM-DD" }`. SENT → EXPECTED (an optional step: the supplier confirmed the order and its date). `409 SUPPLIER_ORDER_NOT_SENT`, `SUPPLIER_ORDER_CONFIRMED` (once confirmed), `SUPPLIER_ORDER_PARTLY_RECEIVED` (pieces came in before any confirmation), `SUPPLIER_ORDER_CLOSED`. Audited `supplier_order.confirm`. |
| POST | `/api/admin/supplier-orders/:id/cancel-rest` | OPERATOR | Body `{ "note": 1–1 000 }`. What has not arrived stops being expected (each line's expected moves to its rest cancelled): RECEIVED when something was accepted, otherwise CANCELLED; the orders waiting for it go back into the next proposal. `409 RECEPTION_OPEN` while a reception waits for ORBES, `409 SUPPLIER_ORDER_NOT_SENT`, `409 SUPPLIER_ORDER_CLOSED`. Audited `supplier_order.cancel_rest` `{ pieces, to }`. |
| GET | `/api/admin/supplier-orders/:id/pdf` | AUDITOR | The PDF ORBES sends the supplier itself (the console sends no email): `application/pdf`, `attachment; filename="ORBES-SO-7C21A0B9.pdf"`, `cache-control: no-store`. From CONGLOMERAT LLC, to the supplier (its name and address, never its email or phone), Deliver to the location and its address; its date (sent, or last changed for a draft), its expected delivery; the lines (model · variant · size, SKU, quantity, unit price, line total); Shipping ('—' when none, adding nothing); the Total in its currency; the note. |
| PUT | `/api/admin/supplier-orders/:id/invoice` | OPERATOR | Body `{ "number": 1–60, "amountMinor": 0–100 000 000 000, "date": "YYYY-MM-DD" }`: the supplier's invoice, entered or replaced until it is paid. `409 SUPPLIER_ORDER_NOT_SENT`, `409 SUPPLIER_INVOICE_PAID`. Audited `supplier_order.invoice`. |
| POST | `/api/admin/supplier-orders/:id/invoice/paid` | OPERATOR | ORBES has paid the invoice. `409 SUPPLIER_INVOICE_MISSING`, `409 SUPPLIER_INVOICE_PAID`. Audited `supplier_order.invoice_paid`. |
| POST | `/api/admin/supplier-returns/:id/settle` | OPERATOR | Body `{ "settlement": "REPLACEMENT" \| "CREDIT", "creditMinor"? (a CREDIT's, required; never a REPLACEMENT's), "note"?: ≤ 500 }`: the supplier's answer to rejected pieces, once. A REPLACEMENT keeps them expected on the order; a CREDIT adds them to their line's credited pieces, no longer expected, and settles the order's status. **200** the order. `404 SUPPLIER_RETURN_NOT_FOUND`, `409 SUPPLIER_RETURN_SETTLED`. Audited `supplier_return.settle` `{ supplierReturnId, skuId, quantity, settlement, creditMinor?, status }`. |

The statuses: DRAFT → SENT → EXPECTED (optional) → PARTLY_RECEIVED (something accepted, something still expected) → RECEIVED (nothing expected), or CANCELLED (the rest cancelled with nothing accepted); a reception or a credit settles them (`refreshStatus`). Every change is journaled `supplier_order.*` (the order as it stands, prices included: the journal is internal), and audited by ids, counts and amounts, never a note's words nor a supplier's contact.

Errors besides: `400 VALIDATION_FAILED`, `401`, `403 FORBIDDEN` (a LOGISTICS login, an AUDITOR writing), `403 CSRF_FAILED`.

**The receptions** (step 5.7, `services/receptions.ts`, `routes/admin/logistics.ts`, migration `0036`, DATABASE §5.80 to §5.83): « The agent records a reception against its supplier order », « an ORBES staff member confirms the reception: that issues the identities ». The agent's routes name their roles: `LOGISTICS_ACT` (LOGISTICS, OPERATOR, ADMIN) and `LOGISTICS_READ` (LOGISTICS, AUDITOR, OPERATOR, ADMIN). A LOGISTICS login reaches only its own locations: a reception, an order or rejected pieces of another location answer **404**, never 403. No answer to the agent carries a price, a total, a currency or a supplier's contact.

| Method | Path | Role | |
|---|---|---|---|
| GET | `/api/admin/logistics/receptions` | LOGISTICS_READ | `?locationId=`. The Receptions tab: `{ "toConfirm": [Reception], "cardsToPrint": [Reception], "backToSupplier": [ { "id", "supplierOrder": { "id", "reference" }, "sku", "quantity", "status": "TO_RETURN", "location": { "id", "name" } } ], "carriers": [ { "id", "name" } ], "count", "expected"?: [ { "id", "reference", "supplierName", "location": { "id", "name" }, "expectedOn", "piecesExpected" } ] }`. `toConfirm`: TO_CONFIRM and SENT_BACK; `cardsToPrint`: CONFIRMED, cards not attached yet. `expected`, the supplier orders on their way (SENT, EXPECTED, PARTLY_RECEIVED), is **ORBES staff's only**: absent for the agent. `count`: for the agent, its receptions to confirm or sent back plus those with cards to print; for ORBES staff, the TO_CONFIRM receptions. `carriers`: the active carriers, for *Sent back* (the agent never reads `GET /api/admin/carriers`, as a parcel's reply carries them). `404 STOCK_LOCATION_NOT_FOUND` for a location outside the agent's. |
| GET | `/api/admin/logistics/receptions/supplier-order` | LOGISTICS_ACT | `?reference=SO-7C21A0B9` (any case, with or without its dash). The agent's one way in: `{ "id", "reference", "supplierName", "location": { "id", "name" }, "expectedOn", "lines": [ { "lineId", "sku": { "id", "code", "model": { "id", "name" }, "variant", "sizeLabel", "setAside" }, "ordered", "alreadyReceived", "expected" } ], "offered": [sku] }`: an order SENT, EXPECTED or PARTLY_RECEIVED delivering to one of the login's locations; `alreadyReceived` = accepted + rejected of its CONFIRMED receptions; `offered`, the sizes « Add a piece not on this order » offers. Anything else: `404 SUPPLIER_ORDER_NOT_FOUND` *No supplier order SO-7C21A0B9 is expected here. Check the reference, or ask ORBES.* |
| GET | `/api/admin/logistics/receptions/lines/:supplierOrderId` | LOGISTICS_ACT | The same for an open order by its id (the reception page). `404 SUPPLIER_ORDER_NOT_FOUND`. |
| GET | `/api/admin/logistics/receptions/:id` | LOGISTICS_READ | A Reception: `{ "id", "supplierOrder": { "id", "reference" }, "supplierName" (ORBES staff's; null for the agent), "location", "status": "TO_CONFIRM" \| "SENT_BACK" \| "CONFIRMED", "deliveryNote", "note", "countedAt", "sentBack": { "at", "note" } \| null, "confirmedAt", "lines": [ { "id", "sku", "onOrder", "accepted", "rejected", "issued", "note" } ], "accepted", "rejected", "issuing": { "issued", "accepted", "done" }, "cards": { "sealed", "printed", "erased": { "REPLACED"?, "REGISTERED"?, "UNREADABLE"?, "ATTACHED"? }, "attachedAt", "runs": { "sheet": [ { "run", "cards", "sealed", "printed" } ], "card": [...] } } }`. `404 RECEPTION_NOT_FOUND`. |
| POST | `/api/admin/logistics/receptions` | LOGISTICS_ACT | Body `{ "supplierOrderId", "lines": [ { "skuId", "accepted": 0–10 000, "rejected": 0–10 000, "note"?: ≤ 500 } ] (≤ 500, each size once), "deliveryNote"?: ≤ 60, "note"?: ≤ 1 000 }`. **201** the Reception, TO_CONFIRM. A line with more pieces OK than its order line expects, or a size not on the order (an offered size), needs its note (`422 RECEPTION_NOTE_REQUIRED`); at least one piece (`422 RECEPTION_EMPTY`); one open reception per order (`409 RECEPTION_OPEN`); `409 SUPPLIER_ORDER_CLOSED`, `404 SUPPLIER_ORDER_NOT_FOUND`, `409 SIZE_SET_ASIDE`. Audited `reception.record` `{ supplierOrderId, reference, lines: [ { skuId, accepted, rejected } ] }`. |
| PUT | `/api/admin/logistics/receptions/:id` | LOGISTICS_ACT | Body `{ "lines", "deliveryNote"?, "note"? }`: counted again while TO_CONFIRM or SENT_BACK (→ TO_CONFIRM). `409 RECEPTION_CONFIRMED`, `409 SUPPLIER_ORDER_CLOSED`. Audited `reception.update` `{ supplierOrderId, from, lines }`. |
| POST | `/api/admin/logistics/receptions/:id/send-back` | OPERATOR | Body `{ "note": 1–1 000 }`: ORBES sends it back to be counted again (SENT_BACK). `409 RECEPTION_CONFIRMED`, `409 RECEPTION_SENT_BACK`. Audited `reception.send_back` `{ supplierOrderId, noted: true }`. |
| POST | `/api/admin/logistics/receptions/:id/confirm` | OPERATOR | CONFIRMED, under the supplier order's lock first (`supplier_orders` → `receptions` → lines): the order's lines counted (received, rejected), the rejected pieces listed TO_RETURN, its status settled; then the identities are issued by the worker (below). `409 SUPPLIER_ORDER_CLOSED`, `409 RECEPTION_MATERIAL_MISSING`, `409 RECEPTION_CONFIRMED`, `409 RECEPTION_SENT_BACK`. Audited `reception.confirm` `{ supplierOrderId, reference, accepted, rejected, lines, status }`; journaled `reception.confirm` on the supplier order. |
| POST | `/api/admin/logistics/receptions/:id/cards` | LOGISTICS_ACT | Body `{ "layout": "sheet" \| "card", "run"?: 1… }`. A run of the reception's cards, the 79t card of §15.7: `application/pdf`, `attachment`, **`cache-control: no-store`**; `x-orbes-cards-printed` (how many), `x-orbes-cards-skipped` (`O26-J-00184:REPLACED,…` when any). Runs are fixed: the reception's cards ordered by serial, cut into blocks of 48 (A4 sheets of eight) or 50 (one per page); a card skipped leaves a gap and never shifts the next run. Each sealed claim code is opened and checked against the piece's hash; a code replaced (a new claim code, §15.10), a piece registered, or a sealed copy that no longer opens (the key changed) is skipped and its copy erased (`REPLACED`, `REGISTERED`, `UNREADABLE`: that piece needs a new claim code). `409 RECEPTION_NOT_CONFIRMED`, `409 RECEPTION_ISSUING` until every identity is issued, `409 CARDS_ATTACHED`, `409 CARDS_NONE_TO_PRINT`, `429` one render at a time. Audited `card.print` `{ receptionId, run, layout, productIds, skipped }`. |
| POST | `/api/admin/logistics/receptions/:id/cards-attached` | LOGISTICS_ACT | Every card is with its piece: every sealed copy left is erased (`ATTACHED`); a lost card then needs a new claim code. `409 RECEPTION_ISSUING`, `409 CARDS_ATTACHED`. Audited `card.attached` `{ receptionId, cards }`. |
| POST | `/api/admin/logistics/supplier-returns/:id/sent` | LOGISTICS_ACT | Body `{ "carrierId"?, "trackingNumber"?: 3–40 letters and digits (with its carrier) }`: rejected pieces sent back to their supplier, TO_RETURN → RETURNED. **200** `{ "id", "supplierOrder", "sku", "quantity", "status" }`. `404 SUPPLIER_RETURN_NOT_FOUND`, `404 CARRIER_NOT_FOUND`, `409 SUPPLIER_RETURN_SENT`. Audited `supplier_return.returned` `{ reference, supplierReturnId, skuId, quantity, carrierId? }`. The supplier's answer is ORBES's (`/settle`, above). |

**The stock** (step 5.8, `services/logistics.ts`, `routes/admin/logistics.ts`; it replaces the Atelier's routes, removed in step 5.13):

| Method | Path | Role | |
|---|---|---|---|
| GET | `/api/admin/logistics/stock` | LOGISTICS_READ | `?locationId=&modelId=`. `{ "rows": [ { "sku": { "id", "code", "model": { "id", "name" }, "variant", "sizeLabel", "setAside" }, "location": { "id", "name" }, "onHand", "reserved", "available", "waiting", "minimum", "expected"?, "toOrder"?, "unbacked"? } ], "skus": [sku], "locations": [ { "id", "name", "isDefault" } ], "unbackedSizes"? }`: every offered size of every active model at each location, 0 included, and every other pair that holds something (on hand, reserved, waiting, a minimum: a size set aside, an inactive model's). `waiting`: orders AWAITING a piece of that size there. **ORBES staff only**: `expected` (what SENT, EXPECTED and PARTLY_RECEIVED supplier orders still owe there), `toOrder` (the proposal's figure; 0 for a size set aside), `unbacked` (the size's on-hand count, every location together, minus the ORBES identities that back it: counted in, unregistered, not retired, revoked, lost, stolen or flagged, not on a SHIPPED or DELIVERED order; the console's `NO PIECE · n`) and `unbackedSizes`. A LOGISTICS login reads its own locations only, without those fields; another location: `404 STOCK_LOCATION_NOT_FOUND`. |
| GET | `/api/admin/logistics/corrections` | LOGISTICS_READ | `?status=TO_APPROVE\|APPROVED\|DECLINED`. `{ "items": [ { "id", "sku", "location", "delta", "reason", "status", "proposedAt", "decidedAt", "decisionNote" } ], "toApprove" }`, the newest first; the agent's locations only. |
| POST | `/api/admin/logistics/corrections` | LOGISTICS_ACT | Body `{ "skuId", "locationId", "delta": ±1–10 000, "reason": 1–500 }`. **201** the correction: the agent's waits for ORBES (TO_APPROVE); an OPERATOR's or ADMIN's is applied at once and recorded APPROVED with them as approver. Applied: an ADJUSTED movement with the reason as its note; never below what orders reserve there (`409 STOCK_NOT_AVAILABLE`), never above the pieces that back the count (`409 STOCK_NOT_BACKED`); up, the orders waiting there are served, the oldest first. `404 STOCK_LOCATION_NOT_FOUND` (outside the agent's locations), `404 SKU_NOT_FOUND`. Audited `stock.correction.propose` `{ correctionId, locationId, delta }`, never the reason's words. |
| POST | `/api/admin/logistics/corrections/:id/approve` | OPERATOR | The count moves as above. **200** the correction. `409 CORRECTION_NOT_PENDING`, `409 STOCK_NOT_AVAILABLE`, `409 STOCK_NOT_BACKED`. Audited `stock.adjust` and `stock.correction.approve` `{ correctionId, locationId, delta, movementId }`. |
| POST | `/api/admin/logistics/corrections/:id/decline` | OPERATOR | Body `{ "note": 1–500 }`. DECLINED with ORBES's note, read by the agent. `409 CORRECTION_NOT_PENDING`. Audited `stock.correction.decline`. |
| POST | `/api/admin/logistics/transfers` | OPERATOR | Body `{ skuId, fromLocationId, toLocationId, quantity, note? }`, answer `{ transferId, from, to }` (the two levels), as the Atelier's `stock/transfer` was: available pieces moved; the orders waiting at the destination served. Audited `stock.transfer`. |
| PUT | `/api/admin/logistics/minimums` | OPERATOR | Body `{ "skuId", "locationId", "minimum": 1–10 000 \| null }`. **204**. `409 SIZE_SET_ASIDE` for a new minimum of a size set aside; `400` 'Nothing to change.'. Audited `stock.threshold` `{ locationId, from, to }`. |
| POST | `/api/admin/logistics/count-in` | OPERATOR | Body `{ "skuId", "productIds": [ "O26-J-00184" ] (1–100), "note": 1–500 }`. Named pieces of that size enter the stock with their identity (`stock_entered_at`), refused whole: each ISSUED or RESOLD, unregistered, in no open order, never counted in (`409 PIECE_NOT_COUNTABLE`), of that size (`409 PIECE_NOT_COUNTABLE`), known (`404 PRODUCT_NOT_FOUND`). No stock movement: the count already holds them, or a correction up follows. **200** `{ "skuId", "productIds", "unbacked" }`. Audited `stock.count_in` `{ skuId, productIds }`, never the note's words. The note is checked (1–500 characters, required by the console's dialog) but not stored: no column of plan NEXT LOT §3.5.5 holds it (an open point for the hand-over). |

**The parcels: packing and shipping** (step 5.9, `services/logistics.ts` and `services/parcels.ts`, migration `0037`, DATABASE §5.82 and §5.83). « An order ships complete »: a **parcel** is an order and the orders travelling with it (`with_order_id`: a LIVE entry's further pieces, a welcome gift), keyed by that first order (its `id`, its reference), minus its cancelled orders; a cancelled first order still keys it and gives its address. Its **open orders** are those RESERVED or PAID (one shipped on its own before H2 is not waited for). The agent reaches only the parcels of its locations (`404 ORDER_NOT_FOUND` outside them); no price, total, email, account nor release reaches it from these routes.

| Method | Path | Role | |
|---|---|---|---|
| GET | `/api/admin/logistics/orders` | LOGISTICS_READ | `?locationId=`. `{ "toShip": [ { "id", "reference", "others", "location", "readySince", "late", "pieces": [ { "model", "variant", "sizeLabel" } ], "addons": [label], "engraving": boolean, "shipTo": { "name", "address", "country" }, "step": "READY_TO_PACK"\|"PACKING"\|"PACKED", "addressChanged": boolean } ], "onItsWay": [ { "id", "reference", "location", "shippedAt", "carrier": { "id", "name" }, "trackingNumber", "trackingUrl" } ], "locations": [ { "id", "name", "isDefault" } ] }`. **To ship**: the parcels whose open orders are all PAID and hold their piece in stock (`reservation` STOCK) at one location, the oldest ready first; `readySince` the latest ready time of its open orders (each the later of its payment and the moment it took its piece); `late` past the READY delay (5 days, §16.24's delays); `others` the orders travelling in it ('+ 2 pieces'). **On its way**: the parcels SHIPPED, the latest first. `addressChanged` and the country come with the delivery address (step 6.7): `false` and `null` until then. `shipTo` reads in clear for the agent, an OPERATOR and an ADMIN; an AUDITOR reads it as an order's buyer (§16.24): the name masked (`J*** D***`), the address `***`, the country shown. |
| GET | `/api/admin/logistics/orders/:id` | LOGISTICS_READ | One parcel by any of its orders (`ShippingOrderView`): `{ "id" (its first order), "reference", "location", "step": "NOT_READY"\|"READY_TO_PACK"\|"PACKING"\|"PACKED"\|"SHIPPED"\|"DELIVERED"\|"BACK_TO_SENDER"\|"LOST"\|"DAMAGED", "readySince", "late", "orders": [ { "orderId", "reference", "status", "model", "variant", "sizeLabel", "skuCode", "addons": [label], "engraving" (its words), "surprise", "piece": { "productId", "scanned" } \| null } ], "shipTo": { "name", "address", "country", "phone" }, "addressChanged": null, "shipment": { "id", "status", "packingStartedAt", "packedAt", "shippedAt", "deliveredAt", "photo": boolean, "carrier", "trackingNumber", "trackingUrl" } \| null, "checklist": [ { "key", "label", "byScan", "ticked" } ], "history": [ { "action", "at", "by": "ORBES"\|"LOGISTICS"\|"COLLECTOR"\|"SYSTEM", "order" } ], "carriers": [ { "id", "name" } ] }`. The shipment shown is the open one (PACKING, PACKED, SHIPPED); while orders are left to ship, none; otherwise the latest not cancelled. The checklist (question 12 as built: one card line per piece): `piece:<order>` 'The right piece: its card scanned' (ticked by the scan only), `card:<order>` 'The card, its claim code visible', `box` 'The box and the pouch', `addon:<order>:<n>` 'Add-on: <label>', `engraving:<order>` 'Engraving done: "<words>"'. `carriers`: the active ones, for Ship (the agent never reads `/api/admin/carriers`). The history names roles, never people. It also feeds the agent's packing slip. An AUDITOR reads `shipTo` masked as on the list (the name `J*** D***`, the address `***`), the phone withheld (`null`), the country shown. |
| POST | `/api/admin/logistics/orders/:id/packing` | LOGISTICS_ACT | Start packing. Every open order PAID and holding its piece in stock at one location (`409 PACKING_NOT_READY`), the first order's name and address entered (`409 ORDER_ADDRESS_MISSING`): a shipment PACKING with one item per open order, and each order's `packingStartedAt` set (never cleared: from then on only Client Services changes the address and the engraving, §3.6). Again while packing: no change. **200** the parcel. Audited `order.pack.start` `{ shipmentId, parcel }` per order. |
| POST | `/api/admin/logistics/orders/:id/packing/scan` | LOGISTICS_ACT | Rate group **verify** (the budget of `/api/v1/verify`). Body: the card's decoded code, as `/api/v1/verify` takes it (`{ "code", "genome"?, "client"? }`). The code is judged by the decision steps of /verify and recorded as one ADMIN_TEST scan naming the login (as the sale mode, §16.18). AUTHENTIC only (`422 PACKING_SCAN_NOT_ORBES`); a piece of the model, variant and size of an order not scanned yet (`409 PACKING_SCAN_OTHER_PIECE`); a piece in stock: counted in or received (`stock_entered_at`), ISSUED or RESOLD, unregistered, in no open order (`409 PACKING_SCAN_NOT_IN_STOCK`; a Generator one-off is scanned once ORBES has counted it in), or the piece already bound to that order (a parcel packed again). It is bound to the order (`productId`; audited `order.link` `{ via: 'scan' }`) and its item scanned (`order.pack.scan` `{ shipmentId, productId, scanId }`). The same card again: no change. Every item scanned: `409 PACKING_SCAN_DONE`; packed: `409 PACKING_PACKED`; no shipment being packed: `409 PACKING_NOT_STARTED`. **200** `{ "piece": { "productId", "sku" }, "parcel" }`: the console says 'MONOLITHE · BLUE · 52 · O26-J-00184: the right piece.'. |
| PUT | `/api/admin/logistics/orders/:id/packing/photo` | LOGISTICS_ACT | Rate group **media**. The body is the photo itself, `image/jpeg` or `image/webp` (any other type, JSON included: `415 UNSUPPORTED_MEDIA_TYPE`), at most 1 MiB (`413` over the body limit); bytes that are no photo of their type: `422 PACKING_PHOTO_INVALID`. EXIF and XMP removed (`media/image.ts`), kept on the shipment (never among the public media), replaced until Packed (`409 PACKING_PACKED` after). Registered in `routes/admin/media.ts` (its image parsers). **200** the parcel. Audited `order.pack.photo` `{ shipmentId, sha256, bytes }` per order, never the image. In production the edge gives this path 64 KB until its exception is added (deploy/vps/Caddyfile; this lot changes nothing on the host, an open point for the hand-over). |
| POST | `/api/admin/logistics/orders/:id/packing/check` | LOGISTICS_ACT | Packed. Body `{ "ticked": [key] }` (≤ 128): every line ticked (the scan lines by their scans), every card scanned, the photo added (`422 PACKING_INCOMPLETE`). PACKED, the lines kept (`checklist`). **200** the parcel. Audited `order.pack.check` `{ shipmentId, keys }` per order. |
| POST | `/api/admin/logistics/orders/:id/ship` | LOGISTICS_ACT | Body `{ "carrierId", "trackingNumber": 3–40 letters and digits, "declaredValues"?: [ { "orderId", "minor": 0–100 000 000 \| null } ] (≤ 10) }`. PACKED only (`409 ORDER_NOT_PACKED`); the first order's address still entered (`409 ORDER_ADDRESS_MISSING`); an active carrier (`404 CARRIER_NOT_FOUND`). Every order of the parcel SHIPPED in one transaction with the parcel's carrier and tracking number (the ledger's SHIPPED −1 per order, its bound piece), its declared value in its own currency. `declaredValues` from ORBES staff only: a LOGISTICS login sending it gets `403 FORBIDDEN`, so the agent never sends a price. Each piece whose warranty has not started gets it now (question 14, §3.5.6.8b): ISSUED becomes ACTIVATED for its category's months, the purchase date the shipping day (UTC), no point of sale, the delivery address's country (from step 6.7, which passes the parcel's delivery country to the activation; none before: an open point for H2's hand-over); audited `warranty.activate` `{ …, via: 'ship', orderId }`. A warranty started already (by hand before H2, or a piece reshipped) is left as it is. **200** the parcel. Audited `order.ship` per order. |
| POST | `/api/admin/logistics/orders/:id/delivered` | LOGISTICS_ACT | Mark delivered: every order SHIPPED → DELIVERED (`order.deliver` `{ by: 'logistics' }`), the shipment DELIVERED. Before it ships: `409 ORDER_TRANSITION_NOT_ALLOWED`. The shipment is also DELIVERED once its last order is delivered another way (Client Services' step, or its buyer registering the piece). **200** the parcel. |
| GET | `/api/admin/logistics/shipments/:id/photo` | LOGISTICS_READ | The packing photo, `cache-control: no-store`, its own type; `404 SHIPMENT_NOT_FOUND` without one, once erased, or outside the agent's locations. Erased by the housekeeping (`packingPhotos`, DATABASE §10) 14 days after delivery, or once a return or an exchange opened in that time is closed or cancelled; for a parcel never delivered, 14 days after its parcel problem is decided or cancelled, or (Default (mine)) after its shipment was cancelled. |

A paid order cancelled while its parcel is packed (`transition` CANCELLED): the shipment is CANCELLED and that order's item unbound; the other orders keep their bound pieces and their packing start, and Start packing opens a new shipment for them. The transactions that serve the orders waiting for stock (a cancellation, a location or a size changed, a return, a count corrected up, a transfer) run again from the start, at most 3 times, when PostgreSQL aborts one for a deadlock (40P01) or a serialization failure (40001). On the Orders board (§16.24) the READY rule is read per parcel: an order whose piece is ready while its parcel waits for another of its orders is never LATE (`waitingForParcel: true` on its card), and a parcel's orders are LATE from its latest ready time.

**The issuing worker.** Restart-safe and driven by the database: while a CONFIRMED reception has a line with identities to issue, up to 50 pieces of that line at a time (`RECEPTION_ISSUE_CHUNK`), their claim codes generated and hashed one at a time outside the transaction, then one signing transaction under the line's advisory lock: each piece ISSUED with its serial, its signed code, its genome, warranty and history, `stock_entered_at` and its reception line, production batch = the order's reference (audited `product.issue` with `receptionId`, by the confirming admin); its claim code sealed for its card (`card_prints`, AES-256-GCM under the HKDF subkey `orbes/card-claim-codes/v1` of `KEY_ENCRYPTION_KEY`, or `COOKIE_SECRET` without one; AAD `card:<product uuid>`); one `RECEIVED` movement of +n for the chunk; then the orders waiting for that size at that location served, the oldest first, a reshipment first (`order.serve`). Every line issued: audited `reception.issued` `{ supplierOrderId, identities }`. The process starts it at boot (`createContext`, timers off with `ORBES_ENV=test`), runs a chunk every 250 ms while work remains, polls every 30 s, and is woken by a confirmation; a chunk refused for want of a signing key waits for the next poll. No claim code, clear or sealed, reaches a log, an event, the journal or an audit entry.

In the console: **Supplier orders** (`#/supplier-orders`, the sidebar's Registry, under Logistics, in the Atelier's place; never shown to a LOGISTICS login) holds **Suppliers** for now (`Add a supplier`, `Edit`; empty: 'No supplier yet: add the first one.'); a model's page, in its **Sizes** section, a `Supplier` row ('No supplier yet.', its name, or a variant's main model's, 'Reads its supplier from MONOLITHE.') and a `Supplier` column per size (empty: the model's), with `Edit supplier` (OPERATOR).

### 16.34 Order cases (extension of the contract)

Plan NEXT LOT of 2026-10-07, §1.1 (b) and §3.5.6.7 (deployment H2; migration `0037`, DATABASE §5.87). One table and one service for every return, size exchange and parcel problem (`services/order-cases.ts`, `ctx.services.orderCases`). Not « cases »: the console's Cases are the customers' reports on scans (§16.8). An order has one order case not ended at most (`409 ORDER_CASE_OPEN`). A case goes OPEN → RECEIVED (the agent records the parcel back) → CLOSED (ORBES decides), or ends CANCELLED. Its notes (the client's, the agent's or the staff member's words) never reach the audit log, the order's events nor the journal; an AUDITOR reads the case without any of them. The collector's own request (REQUEST A RETURN, EXCHANGE THE SIZE) comes with §3.6.D.

| Method | Path | Role | |
|---|---|---|---|
| POST | `/api/admin/orders/:id/case` | OPERATOR | `Open a return` (Client Services). Body `{ "kind": "RETURN"\|"EXCHANGE", "reason": "SIZE"\|"NOT_AS_EXPECTED"\|"DAMAGED"\|"OTHER", "exchangeSkuId"? (an exchange only, required), "note": 1–1 000 }`. On an order SHIPPED or DELIVERED (`409 ORDER_TRANSITION_NOT_ALLOWED` otherwise), at any time: question 20 as built, Client Services keeps opening returns after the collector's 14 days. An exchange's size is one of the model's other offered sizes (`400` otherwise) with a piece available at the order's location now (`409 EXCHANGE_SIZE_NOT_IN_STOCK`); it is not held. **201** the order case. Audited `order.case.open` `{ caseId, kind, reason, sizeLabel?, by: 'admin' }`. It replaces `POST /api/admin/orders/:id/return`, removed with step 5.11e: ORBES decides a return on `POST /api/admin/order-cases/:id/decide` once the agent has the parcel back. |
| POST | `/api/admin/logistics/orders/:id/order-case` | LOGISTICS_ACT | `Report a parcel problem` (the agent or Client Services). Body `{ "kind": "BACK_TO_SENDER"\|"LOST"\|"DAMAGED", "note": 1–1 000 }`. The parcel of the order, SHIPPED (`404 SHIPMENT_NOT_FOUND` otherwise; `404 ORDER_NOT_FOUND` outside the agent's locations); no order of it with a case not ended. The case names the shipment, whose status takes its kind. **201** the order case. Audited `order.case.open` `{ caseId, kind, shipmentId, by: 'admin' }`. |
| GET | `/api/admin/logistics/order-cases` | LOGISTICS_READ | `?locationId=`. `{ "items": [ { "id", "order": { "id", "reference" }, "kind", "pieces": [ { "model", "variant", "sizeLabel" } ], "openedAt", "location" } ] }`: the parcels expected back at the scope's locations (OPEN returns, exchanges, parcels back to sender or damaged), the oldest first; no note. |
| POST | `/api/admin/logistics/order-cases/:id/received` | LOGISTICS_ACT | `The parcel is back`. Body `{ "pieceState": "OK"\|"DAMAGED", "note"? (≤ 500) }`. RECEIVED. A lost parcel: `409 ORDER_CASE_NOT_RECEIVABLE`; recorded already: `409 ORDER_CASE_RECEIVED`; ended: `409 ORDER_CASE_CLOSED`. **200** `{ "id", "status", "kind", "received" }`. Audited `order.case.receive` `{ caseId, kind, pieceState }`. |
| GET | `/api/admin/order-cases/:id` | AUDITOR | `{ "id", "order": { "id", "reference" }, "kind", "status", "openedBy": "COLLECTOR"\|"CLIENT_SERVICES", "openedAt", "reason", "note" (null for an AUDITOR), "exchange": { "skuId", "sizeLabel", "available" } \| null, "shipment": { "id", "orders": [ { "id", "reference" } ] } \| null, "messageId", "received": { "at", "pieceState", "note" } \| null, "decision": { "at", "outcome", "pieceTo", "exchangeOrder": { "id", "reference" } \| null, "note" } \| null, "cancelled": { "at", "note" } \| null }`; for an AUDITOR every `note` (the case's, `received`'s, `decision`'s and `cancelled`'s) is `null`. |
| POST | `/api/admin/order-cases/:id/decide` | OPERATOR | `cache-control: no-store`. Body `{ "decision": "REFUND"\|"EXCHANGE"\|"RESHIP", "pieceTo"?: "RESTOCKED"\|"ARCHIVED", "locationId"?, "note"? (≤ 1 000; required for a return or an exchange) }`. Once the agent has recorded the parcel back (`409 ORDER_CASE_NOT_RECEIVED`), a LOST parcel from OPEN; ended: `409 ORDER_CASE_CLOSED`. A LOST parcel and the archive: **ADMIN** (`403 FORBIDDEN` for an OPERATOR). **A return** (REFUND) or **an exchange** (REFUND or EXCHANGE), `pieceTo` required: the return's core as §16.24's return says it (back to stock at `locationId`, the order's location by default, with a new claim code shown once in this answer, `claimCode`, and the piece's `productId`; or to the archive, RETIRED; the ownership taken back; the credit given back; the credit note), the orders waiting there served; a parcel shipped and never marked delivered becomes DELIVERED, as §16.24's return says; for EXCHANGE, the **EXCHANGE order**: the original's account, release, price, currency, add-ons, surprise, engraving words, shipping and buyer, the new size, at the original's location, holding a piece or waiting like any order, PAID at once with its own invoice (beneath the piece: `SIZE EXCHANGE`); the credit the original's return gave back is taken off the exchange again before PAID, so its invoice carries the same CREDIT lines and the original's total, and the collector's balance does not grow; audited `order.create` (EXCHANGE), `order.credit.apply` `{ amountMinor, currency, uses, exchangeOfOrderId }` (with a credit), `order.pay`, `invoice.issue` and `order.exchange` `{ exchangeOrderId, skuId }` on the original. **A parcel problem** (RESHIP or REFUND): each order of the parcel goes SHIPPED → PAID, its carrier, tracking number and declared value cleared, the parcel kept (`order.reship`). BACK_TO_SENDER: its pieces back in stock (the ledger's RETURNED, +1), still bound to their orders, to pack again (RESHIP; their warranties kept), or freed (REFUND). DAMAGED, `pieceTo` required: each piece back to stock (RETURNED +1 at `locationId`, the order's location by default, the orders waiting there served; unbound, RESOLD, with a new claim code, so the card the collector saw no longer registers it: each code is shown once in this answer, `claimCodes` `[ { "productId", "claimCode" } ]`, so staff print the piece's new card before it ships again, as a return's; `order.reship` carries `claimCodeReissued: true`) or to the archive (RETIRED, ADMIN), as ORBES chooses from the agent's record. LOST: each piece REVOKED (`product.transition`), unbound: it can never be registered. RESHIP after DAMAGED or LOST holds new pieces ahead of the queue (`queue_first`: a piece at once when one is available, otherwise first in line); REFUND cancels each order (a credit note; a buyer's new claim code on its piece replaced, §3.4's hook, its hash made before the transaction; the piece serving the next waiting order). `pieceTo` is not taken for BACK_TO_SENDER or LOST (`400`). Each order's `order.reship` event says what it holds once decided (`reservation`: STOCK, AWAITING, or nothing for a refund), so a parcel reshipped is ready again from the decision (its Ready since, LATE after 5 days), never from its first sale. A return's or an exchange's `order.return` event keeps no words (`caseId`, `noted: true`): the decision's note stays on the case and the return, and an AUDITOR reads it on neither (the order page's `return.note` is null for an AUDITOR). **200** `{ "case", "claimCode"?, "productId"?, "claimCodes"? }`. Audited `order.case.decide` `{ caseId, kind, outcome, pieceTo, exchangeOrderId?, shipmentId? }`. |
| POST | `/api/admin/order-cases/:id/cancel` | OPERATOR | `Cancel the order case`. Body `{ "note": 1–1 000 }`. CANCELLED with no decision (a request refused or withdrawn; a damaged parcel that never came back, to report it lost); a parcel problem's shipment SHIPPED again. Client Services answers the collector in MESSAGES. Ended already: `409 ORDER_CASE_CLOSED`. **200** the order case. Audited `order.case.cancel` `{ caseId, kind }`. |

A parcel reported lost, damaged or back to sender, whose piece its buyer registers while the case is OPEN, arrived: the registration cancels the case ('Registered by its buyer.', `order.case.cancel` `{ caseId, kind, by: 'registration' }`), its shipment SHIPPED then DELIVERED with the order; its pieces are never revoked. The return's own route, the order page's Order case section and the console's dialogs come with step 5.11e; the EXCHANGE channel reads `SIZE EXCHANGE` on the Orders board (`CHANNEL_LABELS`) and on its invoice (`CHANNEL_WORDS`).

## 17. Admin: keys, audit log and console users

Private keys never pass through the API: only public keys and registry metadata are returned.

Key object:

```json
{
  "keyId": 2,
  "kid": "orbes-k002-20261001-be99",
  "alg": "Ed25519",
  "publicKey": "Q15SXEQvl5HqtcEdysEvtNSOpzSJ8v8eOQSm64jF8gM",
  "status": "ACTIVE",
  "provider": "local",
  "createdAt": "2026-10-01T08:15:21.929Z",
  "activatedAt": "2026-10-01T08:15:21.929Z",
  "retiredAt": null,
  "revokedAt": null,
  "compromisedAt": null,
  "revocationReason": null
}
```

### 17.1 `GET /api/admin/keys`

AUDITOR. `{ "items": [ …key objects… ] }`, by key id.

### 17.2 `POST /api/admin/keys/rotate`

**ADMIN**. Generates a new key with the custody provider, checks it (strict Ed25519 public key, proof of possession by a verified probe signature), registers it as ACTIVE and retires the previous ACTIVE key (which keeps verifying). Optional body `{ "kid"?: string (≤ 64) }`; a custom label must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. Default label `orbes-k<NNN>-<yyyymmdd>-<4 hex>`.

**201** — the new key. Errors: `400 VALIDATION_FAILED`, `409 KID_TAKEN`, `409 KEY_IDS_EXHAUSTED`, `409 KEY_CONFLICT`, `500 KEY_REJECTED`, `503 KEY_PROVIDER_UNAVAILABLE`, `503 SIGNING_UNAVAILABLE`, `503 SIGNING_FAILED`.

### 17.3 `POST /api/admin/keys/:keyId/retire`

**ADMIN**. ACTIVE → RETIRED. Codes it signed stay valid. Issuance stops (`503 NO_ACTIVE_KEY`) until the next rotation. No body.

**200** — the key. Errors: `400 VALIDATION_FAILED` (`:keyId` not 1–255), `404 KEY_NOT_FOUND`, `409 KEY_NOT_ACTIVE`.

### 17.4 `POST /api/admin/keys/:keyId/revoke`

**ADMIN**. Revokes an ACTIVE or RETIRED key.

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | yes | 1–500 characters |
| `compromisedAt` | string | no | ISO 8601 date-time with a time zone (≤ 40 characters), not in the future. |

Codes whose registry record was created strictly before `compromisedAt` (or before the revocation time when it is omitted) keep verifying; later ones answer `INVALID_SIGNATURE`. Revoking an already revoked key is accepted only to move the compromise time **earlier**. A KEY revocation row is opened (`KEY_COMPROMISED` with a compromise time, else `KEY_REVOKED`). See [CRYPTOGRAPHY §5.3](CRYPTOGRAPHY.md#53-compromise-response) for the response procedure.

**200** — the key. Errors: `400 VALIDATION_FAILED`, `404 KEY_NOT_FOUND`, `409 KEY_ALREADY_REVOKED`.

### 17.5 `GET /api/admin/audit`

AUDITOR. Paginated audit entries, newest first.

| Query | Rules |
|---|---|
| `action` | Exact action, e.g. `key.rotate` (≤ 200 characters, `^[A-Za-z][A-Za-z0-9_.:-]*$`). |
| `actorType` | `admin`, `account` or `system` |
| `actorId` | ≤ 200 characters |
| `targetType` | ≤ 64 characters |
| `targetId` | ≤ 200 characters |

```json
{
  "id": 27,
  "occurredAt": "2026-10-01T08:15:21.929Z",
  "actorType": "admin",
  "actorId": "90b8d94a-0460-4db1-b618-38a29ba74eb9",
  "actorEmail": "ops@theorbes.com",
  "action": "warranty.activate",
  "targetType": "product",
  "targetId": "O26-J-00006",
  "targetEmail": null,
  "details": { "purchaseDate": "2026-03-01", "startDate": "2026-03-01", "endDate": "2028-03-01", "durationMonths": 24, "retailer": "ORBES PARIS", "country": "FR" },
  "ipHash": "_ipKnYv4ukVGRt5d6HoLLPVRTNYiB_f0Atif0lKtMj8",
  "prevHash": "a67a413ea127418798a9ce8bec469bf9a45ce7b55efd2a49f5de11fcc9b581a4",
  "hash": "1990434d2e256ce4a29c24233ec8af837486d5c00ddce71b3e193fe9f5970bf2"
}
```

`prevHash` and `hash` are hexadecimal. The chain construction is described in [DATABASE §5.21](DATABASE.md#521-audit_logs).

`actorEmail` is the email of the console user when `actorType` is `admin` (null for customers, the system and the CLI), and `targetEmail` the email of the console user when `targetType` is `admin` (the Team page's actions, logins, password changes; null otherwise). Both are read from `admin_users` when the page is served and are not part of the entry, its hash or the chain: the log itself names admins by id, so it never has to change when an email does. Customers stay ids (their emails are personal data, kept out of the audit views).

### 17.6 `GET /api/admin/audit/verify`

AUDITOR. Recomputes every hash and link of the audit chain.

```json
{ "ok": true, "checked": 27, "head": { "id": 27, "hash": "1990434d2e256ce4a29c24233ec8af837486d5c00ddce71b3e193fe9f5970bf2" } }
```

On failure, `ok` is `false`, `checked` counts the entries verified before the failure and `firstBadId` names the first inconsistent entry. `head` (`null` for an empty log) is the value to export regularly to write-once storage: it detects removal of the newest entries, which the chain alone cannot.

### 17.7 `GET /api/admin/admins` (extension of the contract)

**ADMIN**. The console users (the console's Team page), by email; never a password hash or TOTP secret.

```json
{ "items": [ { "id": "6a0b…", "email": "ops@theorbes.com", "role": "OPERATOR", "totpEnabled": true, "passwordChangeRequired": false, "locked": false, "disabled": false, "createdAt": "2026-09-01T08:00:00.000Z", "stockLocationIds": [] } ] }
```

`stockLocationIds`: a LOGISTICS login's locations (plan NEXT LOT §3.5.6.1, `admin_user_locations`), sorted; empty for every other role. `locked`: temporarily locked after 10 failed sign-ins (§12.1). `passwordChangeRequired`: the account still has the temporary password it was created with (§17.8). `disabled`: sign-in refused (§17.10).

The routes §17.8–§17.13 are the rest of the Team page. All are **ADMIN**, audited by `AuthService` in the transaction of the change with the acting ADMIN as actor, and answer `404 ADMIN_NOT_FOUND` for an unknown id and `400 VALIDATION_FAILED` when `:id` is not a UUID. Their admin object is the list item above. No change may target the caller's own account (`409 SELF_ACTION`; listing one's own sessions and resetting one's own second factor are allowed), and none may leave the console without an active ADMIN (`409 LAST_ADMIN`; role changes and (de)activations are serialised by an advisory lock, so two ADMINs disabling each other at the same moment cannot both succeed).

### 17.8 `POST /api/admin/admins` (extension of the contract)

Creates a staff account. Body `{ "email": string (3–254), "role": "OPERATOR" | "AUDITOR" | "RETAIL" | "LOGISTICS", "stockLocationIds"?: uuid[] (≤ 50) }`; any other role, `ADMIN` included, is a `400 VALIDATION_FAILED` (ADMIN accounts come from the shell, §2.3). RETAIL (A-08) is a seller: after its own password, it reaches the sale mode only (§2.3, §16.18). LOGISTICS (plan NEXT LOT §3.5.6.1) is a person at the logistics agent, one login per person: `stockLocationIds` names the locations it works at, at least one (`400 VALIDATION_FAILED` 'Choose at least one location.'), each a known location (`404 STOCK_LOCATION_NOT_FOUND`), tied in the transaction that creates the login; any other role takes none (`400` 'Only a LOGISTICS login works at locations.').

The server generates a **temporary password**: 16 Crockford base32 characters (80 bits) in four groups, `XXXX-XXXX-XXXX-XXXX`. It is returned **once**, in this response, and stored only as its scrypt hash; it is never logged nor written to the audit log. The account starts with `passwordChangeRequired: true`: at its first sign-in it can do nothing but choose its own password (§2.4, §12.5). Hand the temporary password over in person or over a trusted channel. Unlike a claim code, it is compared exactly: it is typed as shown, capitals and dashes included, and a wrong try counts as a failed sign-in (§12.1). Audit `admin.create` (`details: { role, passwordChangeRequired: true }`, and `stockLocationIds` for LOGISTICS).

**201** `{ "admin": { …, "passwordChangeRequired": true }, "temporaryPassword": "QV7H-JFT0-QK82-V9ER" }`. Errors: `400 VALIDATION_FAILED`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 STOCK_LOCATION_NOT_FOUND`, `409 EMAIL_TAKEN`.

### 17.9 `PATCH /api/admin/admins/:id/role` (extension of the contract)

Body `{ "role": "OPERATOR" | "AUDITOR" | "RETAIL" | "LOGISTICS", "stockLocationIds"?: uuid[] (≤ 50) }`. Changes the role of another console user, an ADMIN included (stepping down), except the last active ADMIN (`409 LAST_ADMIN`). The guard reads the role from the database at every request: the change applies at that account's next request, without signing it out. LOGISTICS comes with its locations, as in §17.8; a LOGISTICS login keeping its role has its locations changed to these (the ones kept keep their row); a role changed away from LOGISTICS deletes them in the same transaction. Unchanged role (and, for LOGISTICS, unchanged locations): no-op, no audit entry. Audit `admin.role_change` (`details: { from, to }`, and `stockLocationIds` when the role is LOGISTICS).

**200** `{ "admin": … }`. Errors: `400 VALIDATION_FAILED`, `404 ADMIN_NOT_FOUND`, `404 STOCK_LOCATION_NOT_FOUND`, `409 SELF_ACTION`, `409 LAST_ADMIN`.

### 17.10 `POST /api/admin/admins/:id/disable` and `…/enable` (extension of the contract)

No body (or `{}`). **Disable** is the departure of a staff member: it sets `disabled_at` and **deletes every session of that account** in the same transaction (their open console is signed out at its next request), and sign-in is then refused with the same `401 INVALID_CREDENTIALS` as a wrong password. The account, its role and its history stay. **Enable** clears `disabled_at`: the account signs in again with its password, in its current role. Both are idempotent (no audit entry when nothing changes). Audit `admin.disable` (`details.sessionsRevoked`) and `admin.enable`.

**200** `{ "admin": …, "sessionsRevoked": number }`. Errors: `400 VALIDATION_FAILED`, `404 ADMIN_NOT_FOUND`, `409 SELF_ACTION`, `409 LAST_ADMIN` (disable).

### 17.11 `POST /api/admin/admins/:id/unlock` (extension of the contract)

No body (or `{}`). Lifts a sign-in lockout (§12.1) before its 15 minutes run out: the failed sign-in counter returns to 0. Check the `admin.login_failed` entries first: a lockout is often someone guessing. Idempotent. Audit `admin.unlock` (`details: { failedLogins, locked }`).

**200** `{ "admin": … }`. Errors: `400 VALIDATION_FAILED`, `404 ADMIN_NOT_FOUND`, `409 SELF_ACTION`.

### 17.12 `GET` and `DELETE /api/admin/admins/:id/sessions` (extension of the contract)

**GET** lists the live sessions of a console user, newest first, never a token, its hash or a CSRF token:

```json
{ "items": [ { "createdAt": "2026-10-02T07:12:00.000Z", "lastSeenAt": "2026-10-02T07:40:00.000Z", "expiresAt": "2026-10-02T15:12:00.000Z", "mfaPassed": true, "userAgent": "Mozilla/5.0 (Macintosh; …) Chrome/129.0 Safari/537.36", "current": false } ] }
```

`current` marks the session making the request (an ADMIN may list its own sessions). **DELETE** (no body) ends every session of another console user, for a lost laptop or a shared screen; the password still works. Audit `admin.sessions_revoke` (`details.sessionsRevoked`).

**200** GET `{ "items": [ … ] }`; DELETE `{ "sessionsRevoked": number }`. Errors: `400 VALIDATION_FAILED`, `404 ADMIN_NOT_FOUND`, `409 SELF_ACTION` (DELETE).

### 17.13 `POST /api/admin/admins/:id/totp/reset` (extension of the contract)

**ADMIN**. Recovery for a lost authenticator, after an identity check: removes the admin's TOTP enrolment and **ends every session of that admin** (they were opened with the lost device), in one transaction with the audit entry `admin.totp.disable` (`details.sessionsRevoked`; the actor is the resetting ADMIN). The admin then signs in with the password and enrols a new device (§12.4). An ADMIN may reset its own second factor; its current session ends too. No body (or `{}`).

**200** `{ "admin": { …admin object…, "totpEnabled": false } }`. Errors: `400 VALIDATION_FAILED` (`:id` not a UUID), `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 ADMIN_NOT_FOUND`, `409 TOTP_NOT_ENABLED`.

The same operations exist on the command line (`scripts/admin.ts list`, `reset-totp`, `role`, `disable` and `enable`), together with `create`, `totp-setup` and `totp-enable` (see [DEPLOYMENT](DEPLOYMENT.md)): the fallback when no ADMIN can sign in, and the only way to create an ADMIN or grant the ADMIN role.

---

## 18. Static web applications

Served when the web build (`dist/web`) exists; not rate-limited by the application.

| Path | Serves | Caching |
|---|---|---|
| `/` | `302` redirect to `/verify` | |
| `/verify`, `/verify/*` | The verification app shell (`dist/web/verify/index.html`). Its own routes: `/verify` (NOW, plan NOCTURNE, and the screens of a scan), `/verify/pieces` (MY PIECES, §10.5, its tabs PIECES, ORDERS and RELEASES), `/verify/pieces/<productId>` (a piece of MY PIECES, plan NOCTURNE, C4; back from it returns to MY PIECES; an address that is not one of the account's pieces shows MY PIECES), `/verify/c#{token}` (an ownership certificate, §8.7: the token in the fragment, which the server never receives), `/verify/lookbook` (THE COLLECTION, §8.8) and `/verify/lookbook/<slug>` (a model's sheet; back from it returns to THE COLLECTION, then to NOW; an address under `/verify/lookbook` that is none shows THE COLLECTION, its address put back), `/verify/releases` (THE RELEASES: its tab LIVE, §8.9, the LIVE RELEASES first, §8.10; its tab PAST, §8.11, the one shown kept with the page's place in the history), `/verify/releases/how` (HOW RELEASES WORK, §8.13; back from it returns to the page it was opened from) and `/verify/releases/<id>` (a release's page and its entry, §10.10; a LIVE RELEASE's page, which becomes its room, line, turn and outcome, §10.12; back from it returns to THE RELEASES, then to NOW; an address under `/verify/releases` that is none shows THE RELEASES, its address put back), `/verify/circle` (THE CIRCLE, §10.11) and `/verify/circle/<id>` (a post, its answer or its vote; back from it returns to THE CIRCLE, then to NOW; an address under `/verify/circle` that is none shows THE CIRCLE, its address put back); any other path shows NOW, its address put back to `/verify` | `no-cache` |
| `/verify/releases/<id>/board` | The same shell, the **boutique board** of a LIVE RELEASE (§8.10), its secret in the fragment (`#<secret>`, never sent): served with `X-Robots-Tag: noindex, nofollow`, and the page carries a robots meta tag of its own | `no-cache` |
| `/VERIFY/C`, and any other spelling of `/verify/c` | `301` redirect to `/verify/c` (`GET`, `HEAD`): the ownership certificate's PDF letters its address in capitals (§8.7). A browser keeps the fragment, the certificate's token, across the redirect | |
| `/admin`, `/admin/*` | The admin console shell (`dist/web/admin/index.html`) | `no-cache` |
| `/legal`, `/legal/*` | The legal pages' shell (`dist/web/legal/index.html`, J-06). Its own routes: `/legal/privacy` (the privacy policy), `/legal/terms` (the terms of use), `/legal/notice` (the legal notice), `/legal/faq` (the FAQ), and `/legal`, their index; any other path shows the index, its address put back to `/legal`. The language is `?lang=fr` or `?lang=en`, else the browser's (`navigator.languages`), else English; the page reads `GET /api/v1/client-services` (§8.4) to show the contact of ORBES Client Services where it names it | `no-cache` |
| `/assets/*` | Bundles and stylesheets | Content-hashed names: `public, max-age=31536000, immutable`; others `no-cache`. Dotfiles are never served. |

Without a build, these paths answer `404 NOT_FOUND`. Each app has its main bundle and, for the two that read codes with the camera, a decoder worker (`verify-worker-<hash>.js`; `admin-worker-<hash>.js`, the same decoder for the console's sale mode, §16.18), named by the shell's `<meta name="orbes-worker">`; the main bundles never carry the decoder. Every shell is served with `Permissions-Policy: camera=(self)` and a CSP that allows workers from the page's origin. The verification app links the legal pages at the foot of its landing, under every result and at the foot of MY PIECES (in a new tab), and under CREATE ACCOUNT (the terms of use and the privacy policy, in a new tab); theorbes.com may link the same addresses.

---

## 19. Integration guide for resellers and third parties

Two complementary ways to check an ORBES CODE:

| | Online: `POST /api/v1/verify` | Offline: signature check with the published keys |
|---|---|---|
| Proves ORBES signed the code | Yes | Yes |
| Registry status (revoked or superseded code, revoked, retired, lost or stolen product) | Yes | **No** |
| Ownership, warranty, anomaly scoring | Yes | No |
| Works without network access to ORBES | No | Yes, once the key list is cached |

Neither proves that the physical object is the one ORBES made: a printed code can be copied. Treat a valid signature as "this code was issued by ORBES", and rely on the online answer for anything about the product's current status.

### 19.1 Obtaining the code data

What a scanner decodes from the printed ORBES CODE is 79 bytes: `payload (13) ‖ Ed25519 signature (64) ‖ CRC-16 (2)`. The symbol format is specified in [ORBES-CODE-SPEC](ORBES-CODE-SPEC.md); the base64url (no padding) spelling of those 79 bytes, 106 characters, is what the online API takes.

### 19.2 Online verification from a server

- Call `POST /api/v1/verify` with `{ "code": "<106 base64url characters>" }` from your **server**. The endpoint sends no CORS headers, so browser code on another origin cannot read its response.
- No credentials or CSRF token are needed. The default budget is 60 requests per minute per client IP; a 429 answer carries `Retry-After`.
- **Keep the `orbes_device` cookie** the first response sets and send it back on later calls; it identifies your installation in the scan history. The anomaly rules count distinct *sources* — the client IP pseudonym first, then the device cookie, then the session — so calls from one address count once whether or not the cookie is kept, while the same product verified from many addresses within minutes (many stores, many networks) can raise anomaly findings (source diversity, scan velocity) that turn later results into `SUSPICIOUS_ACTIVITY` for genuine customers.
- Every call is recorded as a scan of the product and feeds its anomaly history. Verify when a product is actually in hand; do not poll.
- Use `state` for decisions, and show `title` / `message` to people. All states answer HTTP 200.

### 19.3 Offline signature verification

1. **Fetch the keys** from `GET https://<ORBES origin>/.well-known/orbes-keys.json` (or `/api/v1/keys`). The list is public, CORS-enabled and cacheable for 5 minutes; refresh it regularly, since keys are rotated and revoked.
2. **Check the frame.** Exactly 79 bytes. CRC-16/CCITT-FALSE (polynomial `0x1021`, initial value `0xFFFF`, no reflection, no final XOR; check value `0x29B1` for `"123456789"`) over bytes 0–76 must equal bytes 77–78 (big-endian). The CRC only catches read errors; it is not a security check.
3. **Parse the payload** (bytes 0–12, big-endian, see [CRYPTOGRAPHY §3](CRYPTOGRAPHY.md#3-canonical-payload-code-01)):

   | Offset | Size | Field | Valid values |
   |---:|---:|---|---|
   | 0 | 1 | `codeVersion << 4 \| genomeVersion` | code version 1; genome version 1–15 |
   | 1 | 1 | `keyId` | 1–255 |
   | 2 | 4 | packed identity | `year = 2000 + (v >>> 25)`, `categoryIndex = (v >>> 20) & 0x1F` (1–31), `serial = v & 0xFFFFF` (1–999 999); year ≤ 2099 |
   | 6 | 1 | `issue` | 1–255 |
   | 7 | 2 | `issuedDay` | days since 2024-01-01 UTC |
   | 9 | 4 | `nonce` | any |

   Reject anything outside these ranges.
4. **Select the key** whose `keyId` equals byte 1 and decode its `publicKey` (base64url, 32 bytes). An unknown key id means the signature cannot be trusted.
5. **Build the signed message:** the 13 ASCII bytes `ORBES-CODE/v1`, one `0x00` byte, then the 13 payload bytes (27 bytes in total).
6. **Verify Ed25519 strictly** (RFC 8032): reject non-canonical encodings, `S ≥ L`, and small-order public keys. Some libraries are permissive by default; in particular, OpenSSL 3.5 (which backs Node's `crypto.verify`) accepts the identity point as a public key, which makes the signature `R = identity, S = 0` verify for every message. With `@noble/curves`, pass `{ zip215: false }`.
7. **Interpret the key status:**
   - `ACTIVE` or `RETIRED`: a valid signature means ORBES issued this code.
   - `REVOKED`: the key list publishes the trust cut-off: `compromisedAt`, or `revokedAt` when no compromise time was given. ORBES keeps trusting only codes whose **registry record** was created strictly before the cut-off. Offline, the only date available is the signed `issuedDay` — and whoever stole the key can sign any `issuedDay`, so a date before the cut-off proves nothing. Apply the cut-off one way only: a code whose `issuedDay` (UTC) falls on a day after the cut-off's UTC day is **refused** (ORBES refuses it too); any other code under a revoked key is **not verifiable offline** — use the online API.
8. **Derive the product id** for display: look up the category letter for `categoryIndex` in `GET /api/v1/categories` (or a cached copy), then format `O{YY}-{C}-{serial}` with the serial zero-padded to at least 5 digits (e.g. `O26-J-00184`).

Reference implementation (Node.js 22, `@noble/curves` 2.x), tested against the public sample vector:

```js
import { ed25519 } from '@noble/curves/ed25519.js';

function crc16CcittFalse(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** data: Uint8Array(79) decoded from the symbol; keys: the `keys` array of /.well-known/orbes-keys.json */
export function verifyOrbesCode(data, keys) {
  if (!(data instanceof Uint8Array) || data.length !== 79) return { ok: false, reason: 'LENGTH' };
  if (crc16CcittFalse(data.subarray(0, 77)) !== ((data[77] << 8) | data[78])) return { ok: false, reason: 'CRC' };

  const payload = data.subarray(0, 13);
  const signature = data.subarray(13, 77);
  const codeVersion = payload[0] >> 4;
  const genomeVersion = payload[0] & 0x0f;
  const keyId = payload[1];
  const packed = payload[2] * 2 ** 24 + (payload[3] << 16) + (payload[4] << 8) + payload[5];
  const identity = { year: 2000 + Math.floor(packed / 2 ** 25), categoryIndex: Math.floor(packed / 2 ** 20) & 0x1f, serial: packed & 0xfffff };
  const issue = payload[6];
  if (codeVersion !== 1 || genomeVersion === 0 || keyId === 0 || issue === 0 || identity.year > 2099 ||
      identity.categoryIndex === 0 || identity.serial === 0 || identity.serial > 999_999) {
    return { ok: false, reason: 'PAYLOAD' };
  }

  const key = keys.find((k) => k.keyId === keyId);
  if (!key) return { ok: false, reason: 'UNKNOWN_KEY' };
  const publicKey = new Uint8Array(Buffer.from(key.publicKey, 'base64url'));
  const message = new Uint8Array([...new TextEncoder().encode('ORBES-CODE/v1'), 0x00, ...payload]);

  let valid = false;
  try {
    valid = ed25519.verify(signature, message, publicKey, { zip215: false }); // strict RFC 8032
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'BAD_SIGNATURE' };
  const issuedDay = (payload[7] << 8) | payload[8];
  if (key.status === 'REVOKED') {
    const DAY = 86_400_000;
    const cutoff = Date.parse(key.compromisedAt ?? key.revokedAt); // the published trust cut-off
    const issuedAt = Date.UTC(2024, 0, 1) + issuedDay * DAY; // 00:00 UTC of the signed issue day
    // Issued on a later UTC day than the cut-off: refused. Earlier dates can be forged with the stolen key.
    if (Number.isFinite(cutoff) && issuedAt >= Math.floor(cutoff / DAY) * DAY + DAY) return { ok: false, reason: 'KEY_REVOKED' };
    return { ok: false, reason: 'KEY_REVOKED_VERIFY_ONLINE' };
  }

  return { ok: true, keyId, keyStatus: key.status, genomeVersion, identity, issue, issuedDay };
}
```

Test vector: `docs/vectors/code01-sample.json` (`framedDataHex`, signed by the sample public key `publicKeyHex`, which is never valid in production). With `keys = [{ keyId: 1, publicKey: <publicKeyHex as base64url>, status: 'ACTIVE' }]`, the function returns `ok: true`, identity `{ year: 2026, categoryIndex: 1, serial: 184 }`, issue 1, issued day 745; flipping any bit of the frame makes it fail.

### 19.4 What to show

- Offline success: "Signed by ORBES". Not "authentic" or "genuine": the code may be a copy, and the product may since have been revoked, re-coded, reported lost or stolen.
- For the current status, ownership or warranty, use the online API and display its `title` and `message` unchanged.
- An `INVALID_SIGNATURE`, `UNKNOWN` or `MALFORMED_CODE` answer, or a failed offline check, is not proof of counterfeiting either (a damaged print or a bad read produce the same result); refer the customer to ORBES Client Services.
