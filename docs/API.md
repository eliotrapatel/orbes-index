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
| `/`, `/verify`, `/admin`, `/assets/…` | Web applications (§18) |

A production server answers only on an up-to-date database schema: it refuses to start with pending migrations unless started with `--migrate` (or `MIGRATE_ON_START=true`), or after `npm run db:migrate` ([DEPLOYMENT](DEPLOYMENT.md)). Development and test servers migrate on start.

### 1.2 Requests

- **JSON only.** Request bodies must be sent with `Content-Type: application/json` (a `charset` parameter is accepted). Any other content type, including `text/plain` and form encodings, is refused with `415 UNSUPPORTED_MEDIA_TYPE`. **One exception**: the photograph routes of the console (`POST /api/admin/models/:id/image`, §13.4, and `POST /api/admin/products/:productId/photo`, §14.12) take the image itself, as `image/jpeg` or `image/webp`, and nothing else (`415`, "Send the image itself, as image/jpeg or image/webp (at most 1 MB)."); no other route accepts an image.
- **Body limit: 16 KB** (16 384 bytes). Larger bodies get `413 PAYLOAD_TOO_LARGE`. On the two photograph routes only, the limit is **1 MiB** (1 048 576 bytes).
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
- API responses carry `Cache-Control: no-store` unless an endpoint states otherwise (the public keys, the categories, the contact of Client Services, and the photographs of §8.6, cached for a year as they never change).
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

Applies to every **unsafe** request (any method other than `GET`, `HEAD`, `OPTIONS`) under the account, ownership and admin routes:

1. **Origin rule.** The `Origin` header must equal `PUBLIC_ORIGIN` exactly (scheme, host and port). A request without `Origin` is accepted only with `Sec-Fetch-Site: same-origin`. `Origin: null`, look-alike hosts and `Sec-Fetch-Site: same-site` or `cross-site` are refused.
2. **Token rule.** When the request is authenticated by a session cookie, the header `x-csrf-token` must equal that session's CSRF token (compared in constant time). Tokens of other sessions are refused.

Failures answer `403 CSRF_FAILED`. Session-less mutations (account registration and login, the assisted account recovery of §10.8, a customer's report on a scan of §8.5, admin login, and logout without a session) apply the origin rule only. Public endpoints (`/api/v1/verify` and the `GET` endpoints of §8) need neither.

The CSRF token is returned by account registration and login (`csrfToken`), `GET /api/v1/account/session` (when signed in), `GET /api/v1/account/me`, admin login, `GET /api/admin/auth/me` and TOTP enrolment (`POST /api/admin/auth/totp/enable`, which issues a new session). It stays the same for the life of the session.

### 2.3 Admin roles

Roles are ranked **ADMIN > OPERATOR > AUDITOR > RETAIL**; a role may do everything a lower role may, with one exception: the **sale mode** (§16.18) names its roles, RETAIL, OPERATOR and ADMIN. Selling starts a warranty, a mutation, so the read-only AUDITOR does not sell, although it ranks above RETAIL.

| Role | May |
|---|---|
| RETAIL | A seller (A-08, migration 0008). The sale mode of a phone (§16.18: look a scanned piece up, start its warranty at a point of sale) and the list of points of sale it chooses from (`GET /api/admin/retailers`, §16.17). Manage its own session, password and second factor. **Nothing else**: no product, code, scan, owner, warranty list or dashboard, no download. |
| AUDITOR | Read every admin resource, with customers' emails masked (`j***@example.com`, §16.2), the list of points of sale included. Manage its own session, password and second factor. **Nothing it does changes the registry**: although ranked above RETAIL, it does not use the sale mode (`403 FORBIDDEN` on `/api/admin/sale/*`; the console shows it no Sale mode link). |
| OPERATOR | Additionally: every mutation not reserved to ADMIN (issuance, lifecycle transitions except to REVOKED and RETIRED, code re-issue, warranty activation, extension and voiding, service records, ownership confirmation, collections and models, created and edited (§13.3, §13.4), a model's reference photograph and the photograph of a piece, set and removed (§13.4, §14.12; F-04), anomaly triage) and **downloading code artifacts, print sheets (and their manifests) and certificate cards** (an artifact download is a `GET`, but it produces printable codes; a certificate card carries a claim code). Reads customers' emails in clear. |
| ADMIN | Additionally: categories, created, deactivated and activated again (§13.2), product revocation and retirement (transitions to REVOKED or RETIRED: both end the product's public validity, RETIRED is terminal) and reinstatement, code revocation, the revocation register, signing keys, console users (the console's Team page, §17.7–§17.13: list, create OPERATOR, AUDITOR and RETAIL accounts, change a role between OPERATOR, AUDITOR and RETAIL, disable and enable, unlock, list and end sessions, reset a lost second factor), the register of points of sale (§16.17: create, rename, deactivate), a customer's one-time recovery code (§16.10), locking and unlocking a customer's account (§16.12) and the export of everything held about it (§16.13; a `GET`, but it hands over a customer's personal data). |

ADMIN accounts and the ADMIN role are given from the shell only (`scripts/admin.ts create --role ADMIN` and `role --role ADMIN`, [DEPLOYMENT §8.2](DEPLOYMENT.md#82-further-admins-lost-authenticators-scriptsadmints)), where the second factor is enrolled out of band (SECURITY-MODEL §3.3): no route grants ADMIN. An ADMIN cannot act on its own account through the Team routes (`409 SELF_ACTION`; the TOTP reset excepted), and no change may leave the console without an active ADMIN (`409 LAST_ADMIN`).

The default rule is AUDITOR for `GET`/`HEAD` and OPERATOR for other methods; the endpoint tables state every exception. RETAIL ranks under that default, so it is refused everywhere except on the routes that declare it: `/api/admin/sale/lookup` and `/api/admin/sale/activate` (which name their roles, `roles: RETAIL, OPERATOR, ADMIN`, so an AUDITOR is refused there), `GET /api/admin/retailers` (`minRole: 'RETAIL'`) (read only, a declared deviation: the sale screen lists the points of sale), and its own session (`/api/admin/auth/logout`, `me`, `password`, `totp/setup`, `totp/enable`; login takes no session). A role unknown to the server ranks 0 and is refused everywhere. Insufficient role: `403 FORBIDDEN` ("Your role does not allow this action."). No session: `401 UNAUTHORIZED`.

### 2.4 Admin MFA

When MFA is enforced, an admin session that has not passed TOTP may use **only** the `/api/admin/auth/*` routes (login, logout, me, password change, TOTP setup and enable); every other admin route answers `403 MFA_REQUIRED`. The password change is open to such a session only while the admin has no second factor (the temporary password is replaced before enrolment): once TOTP is enrolled, it too answers `403 MFA_REQUIRED` to a session that did not pass it, so a session opened with the password alone cannot replace the password of an enrolled admin and end the sessions that passed the factor. Enrolling ends every other session of the admin (§12.4). Enforcement is set by `ADMIN_REQUIRE_MFA` (default `true` in production, `false` otherwise); `ADMIN_REQUIRE_MFA=false` in production is accepted but logged as a warning at every start. A session passes MFA by logging in with a TOTP code, or by enrolling TOTP (§12.4), which replaces it by a new MFA-passed session. The `mfaRequired` and `mfaPassed` fields of the admin login and `me` responses report both facts.

**Temporary passwords.** A staff account created by an ADMIN (§17.8) signs in with a temporary password; its admin object then says `"passwordChangeRequired": true`. Until it has chosen its own password (§12.5), its session may use only logout, `me` and the password change: every other admin route, the TOTP routes included, answers `403 PASSWORD_CHANGE_REQUIRED`. This check runs before the MFA check, so a new staff member first replaces the password, then enrols a second factor when MFA is enforced.

### 2.5 Request pipeline

For every request, before the body is parsed: cookies are read, the client IP is pseudonymised, security headers are set, the rate limit of the route's group is applied, and then (account, ownership and admin routes) the session, CSRF, temporary-password, MFA and role checks run. Unauthenticated traffic is refused before any body work. The body is then parsed (≤ 16 KB, JSON; on the two photograph routes, the image itself, ≤ 1 MiB) and validated in the handler.

---

## 3. Rate limiting

Each route belongs to one **group**. All routes of a group draw from one per-client budget per 60-second window, so a client cannot spread guessing across, say, account login, registration and admin login.

| Group | Routes | Budget per minute (variable, default) |
|---|---|---|
| `verify` | `POST /api/v1/verify`, `POST /api/v1/reports`, `POST /api/v1/certificates/lookup` and `POST /api/v1/certificates/pdf` (the ownership certificate a link opens, §8.7), `POST /api/admin/sale/lookup` (the sale mode's judgement of a code, §16.18: never a faster way to judge codes than the public route) | `RATE_LIMIT_VERIFY_PER_MINUTE`, 60 |
| `auth` | `POST /api/v1/account/register`, `POST /api/v1/account/login`, `POST /api/v1/account/password`, `POST /api/v1/account/recover`, `POST /api/v1/ownership/register`, `POST /api/v1/ownership/transfers/accept`, `POST /api/admin/auth/login`, `POST /api/admin/auth/password`, `POST /api/admin/auth/totp/setup`, `POST /api/admin/auth/totp/enable` | `RATE_LIMIT_AUTH_PER_MINUTE`, 10 |
| `admin` | Every other `/api/admin/…` route | `RATE_LIMIT_ADMIN_PER_MINUTE`, 300 |
| `api` | Every other `/api/v1/…` route, and `/.well-known/orbes-keys.json` | `RATE_LIMIT_API_PER_MINUTE`, 120 |

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
| `CURRENT_PASSWORD_INVALID` | 400 | (Password change, §10.7 and §12.5) the current password is wrong, or, for a customer, the account is throttled (§10.2). A 400, never a 401: the caller is signed in, and the web apps end the session on any 401. It counts as a failed sign-in: in the customer's login throttle (§10.2), in an admin's lockout (§12.1). |
| `FORBIDDEN` | 403 | Role too low; or a non-owner asking for a service history (also for an unknown product id, so ids cannot be enumerated); or an OPERATOR revoking or retiring a product; or an account that is not active. |
| `ACCOUNT_LOCKED` | 403 / 429 | 403: customer account LOCKED by ORBES Client Services (§16.12): after a correct password (§10.2), a correct recovery code (§10.8), or a password change, a transfer, a registration, a transfer's acceptance, a LOST / STOLEN declaration, the withdrawal of a loss or an ownership certificate's creation begun just before the lock (§10.7, §11.1–§11.3, §11.5–§11.7). 429: admin locked for 15 minutes after 10 consecutive failures. |
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
| `CODE_INTEGRITY` | 409 | The stored code failed its end-to-end integrity check and is never rendered. The message names the issue and the piece (a print sheet then says which code to leave out); what failed is logged, never returned. |
| `CLAIM_CODE_MISMATCH` | 422 | (Certificate cards, §15.7) a claim code does not match its product's hash, or is malformed. The message names the first such product, never the code. |
| `NO_CLAIM_SECRET` | 422 | (Certificate cards, §15.7) the product was issued without a claim code. |
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

Photographs (F-04, §8.6, §13.4, §14.12):

| Code | HTTP | Meaning |
|---|---|---|
| `IMAGE_INVALID` | 400 | The bytes are not a JPEG or a WebP (an SVG, a PNG, text…), do not match the declared type (a JPEG sent as `image/webp`), are damaged or truncated, use a kind of JPEG no browser draws (hierarchical, JPEG-LS), or the image is over 4 096 pixels on a side. The message says which. |
| `IMAGE_ANIMATED` | 400 | An animated WebP (its animation flag, or ANIM / ANMF chunks): a photograph is a still image. |
| `MEDIA_NOT_FOUND` | 404 | (§8.6) No stored photograph with this SHA-256: never uploaded, or removed and no longer used by any model or piece. |

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
| GET | `/api/v1/media/:sha256` | — | — | api | 8.6 |
| POST | `/api/v1/verify` | — (account cookie optional; a console cookie makes it a staff scan, §9.7) | — | verify | 9 |
| POST | `/api/v1/reports` | — (account cookie optional) | origin only | verify | 8.5 |
| POST | `/api/v1/certificates/lookup` | — | — | verify | 8.6 |
| POST | `/api/v1/certificates/pdf` | — | — | verify | 8.6 |
| POST | `/api/v1/account/register` | — | origin only | auth | 10.1 |
| POST | `/api/v1/account/login` | — | origin only | auth | 10.2 |
| POST | `/api/v1/account/logout` | Account (optional) | yes | api | 10.3 |
| POST | `/api/v1/account/password` | Account | yes | auth | 10.7 |
| POST | `/api/v1/account/recover` | — | origin only | auth | 10.8 |
| GET | `/api/v1/account/session` | Account (optional) | — | api | 10.4 |
| GET | `/api/v1/account/me` | Account | — | api | 10.4 |
| GET | `/api/v1/account/products` | Account | — | api | 10.5 |
| GET | `/api/v1/products/:productId/service-history` | Account (current owner) | — | api | 10.6 |
| POST | `/api/v1/ownership/register` | Account | yes | auth | 11.1 |
| POST | `/api/v1/ownership/transfers` | Account (current owner) | yes | api | 11.2 |
| POST | `/api/v1/ownership/transfers/accept` | Account | yes | auth | 11.3 |
| POST | `/api/v1/ownership/transfers/cancel` | Account (sender) | yes | api | 11.4 |
| POST | `/api/v1/ownership/incidents` | Account (current owner) | yes | api | 11.5 |
| POST | `/api/v1/ownership/incidents/resolve` | Account (current owner) | yes | api | 11.6 |
| POST | `/api/v1/ownership/certificates` | Account (current owner) | yes | api | 11.7 |
| GET | `/api/v1/ownership/certificates` | Account | — | api | 11.7 |
| DELETE | `/api/v1/ownership/certificates/:id` | Account (the link's owner) | yes | api | 11.7 |
| POST | `/api/admin/auth/login` | — | origin only | auth | 12.1 |
| POST | `/api/admin/auth/logout` | RETAIL (optional) | yes | admin | 12.2 |
| GET | `/api/admin/auth/me` | RETAIL | — | admin | 12.3 |
| POST | `/api/admin/auth/password` | RETAIL | yes | auth | 12.5 |
| POST | `/api/admin/auth/totp/setup` | RETAIL | yes | auth | 12.4 |
| POST | `/api/admin/auth/totp/enable` | RETAIL | yes | auth | 12.4 |
| GET | `/api/admin/dashboard` | AUDITOR | — | admin | 13.1 |
| GET | `/api/admin/categories` | AUDITOR | — | admin | 13.2 |
| POST | `/api/admin/categories` | **ADMIN** | yes | admin | 13.2 |
| POST | `/api/admin/categories/:code/active` | **ADMIN** | yes | admin | 13.2 |
| GET | `/api/admin/collections` | AUDITOR | — | admin | 13.3 |
| POST | `/api/admin/collections` | OPERATOR | yes | admin | 13.3 |
| PATCH | `/api/admin/collections/:id` | OPERATOR | yes | admin | 13.3 |
| GET | `/api/admin/models` | AUDITOR | — | admin | 13.4 |
| POST | `/api/admin/models` | OPERATOR | yes | admin | 13.4 |
| PATCH | `/api/admin/models/:id` | OPERATOR | yes | admin | 13.4 |
| POST | `/api/admin/models/:id/image` | OPERATOR | yes | admin | 13.4 |
| DELETE | `/api/admin/models/:id/image` | OPERATOR | yes | admin | 13.4 |
| GET | `/api/admin/products` | AUDITOR | — | admin | 14.1 |
| POST | `/api/admin/products` | OPERATOR | yes | admin | 14.2 |
| POST | `/api/admin/products/batch` | OPERATOR | yes | admin | 14.11 |
| GET | `/api/admin/products/:productId` | AUDITOR | — | admin | 14.3 |
| POST | `/api/admin/products/:productId/transitions` | OPERATOR (**ADMIN** for `to: REVOKED` or `RETIRED`) | yes | admin | 14.4 |
| POST | `/api/admin/products/:productId/reinstate` | **ADMIN** | yes | admin | 14.5 |
| POST | `/api/admin/products/:productId/codes/reissue` | OPERATOR | yes | admin | 15.1 |
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
| PATCH | `/api/admin/anomalies/:id` | OPERATOR | yes | admin | 16.5 |
| GET | `/api/admin/reports` | AUDITOR | — | admin | 16.8 |
| PATCH | `/api/admin/reports/:id` | OPERATOR | yes | admin | 16.9 |
| GET | `/api/admin/revocations` | AUDITOR | — | admin | 16.6 |
| POST | `/api/admin/revocations` | **ADMIN** | yes | admin | 16.7 |
| GET | `/api/admin/retailers` | RETAIL | — | admin | 16.17 |
| POST | `/api/admin/retailers` | **ADMIN** | yes | admin | 16.17 |
| PATCH | `/api/admin/retailers/:id` | **ADMIN** | yes | admin | 16.17 |
| POST | `/api/admin/sale/lookup` | RETAIL, OPERATOR, ADMIN | yes | verify | 16.18 |
| POST | `/api/admin/sale/activate` | RETAIL, OPERATOR, ADMIN | yes | admin | 16.18 |
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

Extensions of the platform contract: `GET /api/v1/account/session`, `GET /api/v1/client-services`, the photographs (`GET /api/v1/media/:sha256`, `/api/admin/models/:id/image`, `/api/admin/products/:productId/photo`; F-04), `POST /api/v1/reports`, `POST /api/v1/account/password`, `POST /api/v1/account/recover`, `POST /api/v1/ownership/incidents/resolve` and the `incidentResolvable` of `GET /api/v1/account/products`, the ownership certificates (`/api/v1/ownership/certificates`, `/api/v1/certificates/lookup` and `/pdf`, F-06), the owners' search (`?email=`, `?ref=`), `/api/admin/owners/:id` with its `recovery-code`, `lock`, `unlock` and `export`, `/api/admin/reports`, the catalogue's edits (`POST /api/admin/categories/:code/active`, `PATCH /api/admin/collections/:id`, `PATCH /api/admin/models/:id`), `/api/admin/auth/password`, `/api/admin/auth/totp/setup`, `/api/admin/auth/totp/enable`, `/api/admin/products/batch`, `/api/admin/codes/print-sheet`, `/api/admin/codes/print-sheet/manifest`, `/api/admin/codes/ids`, the filters of `GET /api/admin/codes` and the `productionBatch` filter of `GET /api/admin/products`, the `scanId` and the `from` / `to` window of `GET /api/admin/scans`, the `type`, `productId`, `sort` and `id` of `GET /api/admin/anomalies`, `/api/admin/anomalies/summary`, `/api/admin/anomalies/:id/context`, `/api/admin/analytics`, `/api/admin/certificates`, `/api/admin/products/:productId/warranty/extend`, every `/api/admin/admins` route, and the points of sale and sale mode routes (`/api/admin/retailers`, `/api/admin/sale/*`). There is no HTTP endpoint for creating ADMIN users or granting the ADMIN role (the first ADMIN is bootstrapped from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`; further ADMINs with `scripts/admin.ts create` or `role`, see [DEPLOYMENT](DEPLOYMENT.md)) or cancelling service records; those operations exist only in the services and command-line tools. A customer changes their password with §10.7, or recovers it through ORBES Client Services with §10.8; a console user changes their own with §12.5.

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

Each field is present only when configured. With nothing configured the body is `{}` (200), and the verification app shows no contact at all.

**What the verification app does with it.** The app reads it once, in parallel with its first verification. The contact never holds a result back: the result waits for it at most 1 s from the moment the verification is sent (`CONTACT_WAIT_MS`, `genome/src/web/verify/main.ts`), and shows without it if it has not come by then; the read itself gives up after 4 s (`CONTACT_TIMEOUT_MS`, `api.ts`, where the verification's own requests allow 15 s). A read that answers late still serves the next result; one that fails gives `{}` and is tried again with the next. Wherever the copy sends the customer to ORBES Client Services, it then shows, under the one sentence that asks for it:

- on every caution and void result (UNUSUAL ACTIVITY DETECTED, UNREADABLE CODE, REVOKED, UNKNOWN ORBES CODE, INVALID SIGNATURE), under the help line, and in the WARRANTY tab of an authentic result whose warranty is `VOID` (NO LONGER VALID):
  - the text link **CONTACT ORBES CLIENT SERVICES** when an email is set (a secondary action: the result's hairline button stays SCAN AGAIN or SCAN ANOTHER, BRAND §3.8): a `mailto:` link whose subject is `ORBES — REF {ref} — {title}` (the short scan reference of the result's foot, then the state title; the reference is left out when the scan id gives none) and whose body leaves two empty lines for the customer, then `REFERENCE: {ref}`, `RESULT: {title}`, `WARRANTY: NO LONGER VALID` (warranty tab only) and `VERIFIED: {date and time as shown} ({offset})`, the offset from UTC of the customer's time zone (`UTC+02:00`, `UTC-05:00`), so ORBES Client Services reads the time unambiguously (the screen shows the time alone), CRLF-separated and percent-encoded (RFC 6068);
  - the phone as a `tel:` link (digits only) when a phone is set, read in the reading face;
  - the hours beneath, when set;
- under **FORGOTTEN PASSWORD?** in the OWNERSHIP panel, wherever it offers a sign-in (§10.8): the same three lines, the email's subject being `ORBES — FORGOTTEN PASSWORD` and its body `REFERENCE: {ref}` alone, since Client Services first checks the customer's identity and then gives a one-time recovery code.

The app checks the email and phone against the same rules as the server before building any link; anything else is dropped. Authentic results otherwise show no contact. Nothing is sent to the server when the customer uses it: the email goes from the customer's own mail application.

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

A photograph that an authentic result names (§9.2 `product.imageUrl` and `product.photoUrl`, F-04), as does the owner's list of pieces (§10.5): a model's reference photograph or the photograph of one piece, uploaded in the console (§13.4, §14.12). Public, no session, rate group `api`; `HEAD` too.

`:sha256` is the lower-case hexadecimal SHA-256 of the image's bytes (upper case is accepted and read as lower case): the URL names its content, so the answer never changes.

**200** — the image itself, `Content-Type: image/jpeg` or `image/webp`, with:

| Header | Value |
|---|---|
| `Cache-Control` | `public, max-age=31536000, immutable`: a browser keeps it for a year and never asks again. |
| `ETag` | `"<sha256>"`. A request with `If-None-Match` naming it answers **304** with no body, once the image is known to exist. |
| `X-Content-Type-Options` | `nosniff`, with the Content-Security-Policy of every response (§1.3). |

What is served is what was stored: a JPEG or a WebP of at most 1 MiB and 4 096 px a side, with its EXIF and XMP removed when it was uploaded (§13.4). An image that no model and no piece uses any more (replaced or removed) is deleted and answers 404.

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
    "type": "RING",
    "variant": null,
    "material": "925 STERLING SILVER",
    "createdYear": 2026,
    "genome": { "id": "O26-J-00184", "version": 1, "fingerprint": "G1-E1DC-BE52", "glyphs": [0, 11, 10, 13, 15, 0, 0, 13], "pattern": "…" }
  },
  "ownership": { "verified": true, "since": "2026-10-01" },
  "warranty": { "status": "ACTIVE", "startDate": "2026-09-20", "endDate": "2028-09-20" },
  "incidentReported": false
}
```

- **`VALID`**: the piece (the fields of a result's product lines and its GENOME), the ownership (`verified`: by its claim code or by ORBES Client Services; `since`: the **day** it began, UTC), the warranty (as in §10.5), and `incidentReported: false`, no loss or theft reported. `checkedAt` is the moment of the reading.
- **`NO_LONGER_VALID`** (`{ "status": "NO_LONGER_VALID", "checkedAt": … }`, nothing else): the link has expired; or the piece **changed hands** (the ownership period the certificate was created in has ended: a transfer, or a change by ORBES Client Services); or the piece has been **LOST, STOLEN, REVOKED, COUNTERFEIT_FLAGGED or RETIRED since the certificate was created** (read from the status history: a piece found again, or reinstated, does not bring an earlier certificate back; its owner creates a new one). RETIRED, the terminal status, ends a certificate too.
- **`404 CERTIFICATE_NOT_FOUND`** for an unknown token, a malformed one and a link **withdrawn** (by its owner, or with the account's lock or assisted recovery, §11.7): one code and one message, so a withdrawn link says no more than one that never existed.
- **Never** a name, an email, an account, the ownership period's or the certificate's own id, nor the word AUTHENTIC: a certificate attests what the registry records, not the object it is shown with (BRAND §4.6). A scan of the piece's ORBES CODE, and the transfer bound to it (§11.3), remain what checks the object itself.

**`pdf`, 200**: the certificate as one A4 page, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="ORBES-ownership-certificate-{productId}-{YYYY-MM-DD}.pdf"` (the day of the reading), `Cache-Control: no-store`; never stored. Pure vector, no font: the lettering of the certificate card (stroked capitals), the GENOME in its orbit on an ivory plate, the monogram, the rows of the record (THE PIECE, THE RECORD), THIS CERTIFICATE (`VALID ON {day} · {hh:mm} UTC`, issued, valid until), what it does not attest, and **CHECK IT LIVE**: its link lettered (the address, then the token in groups of four) and as a link annotation, so whoever holds the page, printed or not, can check that it still holds. The lettering has capitals only, so the address prints as `VERIFY.THEORBES.COM/VERIFY/C#7Q2M-ZXKW-…`, and typed as printed it opens: the server answers any spelling of `/verify/c` but its own with `301` to `/verify/c` (§18; the browser keeps the fragment across the redirect, and the server never sees it), and the token is read in any case, with its hyphens. Deterministic for one record and one moment. `409 CERTIFICATE_NO_LONGER_VALID` when the certificate no longer holds (no PDF of it then); the same 404.

Lookups are not audited (they would flood the log); creation and withdrawal are (§11.7).

Errors: `400 VALIDATION_FAILED` (no `token`, not a string, over 128 characters, unknown field), `404 CERTIFICATE_NOT_FOUND`, `409 CERTIFICATE_NO_LONGER_VALID` (`pdf`), `429 RATE_LIMITED`.

**In the verify app:** `/verify/c#…` (§18) shows OWNERSHIP CERTIFICATE, its state (VALID, NO LONGER VALID, NOT FOUND) and one sentence; when valid, the piece in its écrin (the GENOME plate of MY PIECES), its lines, THE RECORD (OWNERSHIP, SINCE, WARRANTY, FROM, UNTIL, LOSS OR THEFT · NONE REPORTED), THIS CERTIFICATE (CHECKED, in the reader's time; ISSUED; VALID UNTIL), *A certificate names no owner…*, then DOWNLOAD PDF (the page's hairline button) and SCAN ORBES CODE (BRAND §5).

---

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
| `product.variant` | string | When set. |
| `product.material` | string | |
| `product.createdYear` | integer | Year of the identity. |
| `product.productionDate` | date | When set. |
| `product.care` | string | The model's care instructions, when set. |
| `product.imageUrl` | string | The model's reference photograph (F-04), when the model has one: `/api/v1/media/<sha256>`, a path of this origin (§8.6). |
| `product.photoUrl` | string | The photograph of this piece, taken by ORBES at issuance (F-04), when it has one: `/api/v1/media/<sha256>`. The verification app shows it first, then the model's, above the GENOME. |
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
| `transfer` | object | (F-03) `AUTHENTIC_*` states only, when the request carries the session of an account that is **not the owner** of a piece **whose transfer is pending** (`ownership.transferPending`): in practice `AUTHENTIC_REGISTERED`. **Never on a staff scan** (§9.7), never signed out, never for the owner, never on a result that is not authentic (a piece reported lost or stolen, unusual activity). |
| `transfer.token` | string | Single-use transfer token (base64url, 43 characters, purpose `TRANSFER_ACCEPT`) for `POST /api/v1/ownership/transfers/accept` (§11.3): it ties the acceptance to this scan of this piece by this account. Only its SHA-256 is stored, next to the scan, which names the account. |
| `transfer.expiresAt` | ISO timestamp | 15 minutes after the scan. |
| `staffScan` | `true` | Only on a **staff scan** (§9.7): the request carried a console session, so the scan was recorded as `ADMIN_TEST`. It then has no `registration` and takes no report (§8.5). Only the browser that holds the console cookie ever receives it. |

Note on `product.collection`: the product's own collection, else its model's — the same rule as `product_overview` and the owner's product list.

Note on the photographs (F-04): `product.imageUrl` and `product.photoUrl` come with the `product` block, so on the four `AUTHENTIC*` states only. A result that is not authentic (`UNKNOWN`, `INVALID_SIGNATURE`, `SUSPICIOUS_ACTIVITY`, `REVOKED`, `MALFORMED_CODE`) never names a photograph, even of a piece that has one: an image would say something of a piece the result cannot vouch for. **What the verification app does with them**: at the head of an authentic result, under the title and its sentence and above the GENOME, an ivory plate framed like the GENOME's shows the piece's own photograph, then its model's, each in a square frame, contained (never cropped), with its caption (THIS PIECE, THE MODEL) and an alternative text (*This piece, O26-J-00184, photographed by ORBES at issuance*; *The MONOLITHE RING model, photographed by ORBES*), then one sentence: *Photographed by ORBES. Compare them with the piece in your hands.* A photograph that cannot be loaded takes its frame with it (`genome/src/web/verify/views/photos.ts`). The app takes a photograph only from this origin's `/api/v1/media/` path.

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
| 10 | Still undecided: the viewer is the current owner → `AUTHENTIC_OWNERSHIP_VERIFIED`; another account owns it → `AUTHENTIC_REGISTERED`; no owner and product status ACTIVATED, RESOLD or SERVICED (not a pre-sale service entered from ISSUED) → `AUTHENTIC_FIRST_REGISTRATION` with a registration token (none on a staff scan, §9.7); otherwise `AUTHENTIC`. **Exception:** `SUSPICIOUS_ACTIVITY` from step 9 alone (no status, genome or code finding) on a product with no owner, open for registration as above and shipped with a claim code still carries a registration token with `claimCodeRequired: true` (not on a staff scan), so copies scanned by strangers cannot lock out the buyer holding the certificate claim code. **Transfer token (F-03):** when the state is an `AUTHENTIC*` one, another account owns the piece, its transfer is pending and the request carries the session of an account that is not that owner (not on a staff scan), the scan also mints a 15-minute `TRANSFER_ACCEPT` token (`transfer`, §9.2), which the acceptance of that transfer uses up (§11.3). | as stated |
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
- severity MEDIUM, **weight 0**: it never raises the risk score of step 9, so the state shown never changes because of it; the authentication record of every such scan lists the reason `ANOMALY:UNSOLD_PIECE_SCAN`;
- **once per piece and per UTC day**: the first such scan of the day opens the finding or adds one occurrence to the open one, later scans that day add nothing (concurrent scans included), and a finding of that type already seen for the piece that UTC day, whatever its status, is not raised again before the next day (one last seen the day before and closed today is raised again by today's first scan); `occurrences` therefore counts days;
- `details`: `country` (ISO alpha-2 of the scan, `null` when unknown), `productStatus` (`ISSUED` or `SERVICED`), `preSaleService: true` for a pre-sale service, `scanEventId` of the day's first scan.

**Staff scans.** A request whose `orbes_admin` cookie is a session the console itself would let in (alive, of an enabled console user with a known role, its password the user's own, past the second factor when `ADMIN_REQUIRE_MFA` holds) is a staff scan, whoever else the browser is signed in as:

- one scan event of type `ADMIN_TEST` naming the console user (`scan_events.admin_id`, shown as *by email* in the console's verification events, §16.1), with the IP pseudonym, coarse location and browser family but **no device, session or account pseudonym**;
- **no `UNSOLD_PIECE_SCAN`** and no history finding: the scan takes no part in step 9, the code's public history is scored as it stands, so the state is the one a customer would see now, and ADMIN_TEST scans never count in any later scoring;
- the findings of steps 6–7 are **still recorded**, with `staffScan: true` in their `details`: `VALID_SIGNATURE_UNREGISTERED`, `CODE_MISMATCH` and `GENOME_MISMATCH` describe the code, not who scanned it. A forged but validly signed code most likely reaches ORBES when Client Services checks a suspicious piece a customer brought in, from a browser signed in to the console: that scan pages on a possible key compromise (§16.4) as any other would;
- **no registration token**, also under step 10's exception, and **no transfer token** (F-03; the scan event names no account): a console user's test is never a buyer's scan. The state stays the one a customer would see (`AUTHENTIC_FIRST_REGISTRATION` included); the verify app's OWNERSHIP tab then says **STAFF SCAN**: *This browser is signed in to the ORBES console, so this scan was recorded as a staff test and registration is not offered.*
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
      "photoUrl": null
    }
  ]
}
```

| Field | Notes |
|---|---|
| `collection` | The product's collection, or else its model's; `null` when neither has one. |
| `imageUrl`, `photoUrl` | The model's reference photograph and the piece's own (F-04, §8.6), or `null`: MY PIECES shows them as an authentic result does, on their ivory plate under the piece's GENOME, each with its alternative text (BRAND §5). Not on an ownership certificate (§8.7), which attests a record, not an object. |
| `acquiredVia` | `FIRST_REGISTRATION` or `TRANSFER`. |
| `verified` | Ownership proven by claim code or confirmed by client services. |
| `transfer` | `{ "pending": true, "expiresAt": … }` while an unexpired transfer offer is pending. |
| `incident` | `"LOST"` or `"STOLEN"` while the product is reported (by its owner, §11.5, or by ORBES Client Services), else `null`. |
| `incidentResolvable` | Extension (F-01). `true` for a `LOST` the owner reported themselves, which they may withdraw (§11.6); `false` otherwise: a `STOLEN`, or a `LOST` recorded by ORBES Client Services, is theirs to withdraw. Read from the status history (the move to `LOST` was made by this account). |
| `inService` | The product is currently in after-sales service. |
| `certificateAllowed` | Extension (F-06). `true` when the owner may create a link to an ownership certificate of the piece (§11.7); `false` while it is reported lost or stolen, or revoked or retired, where the creation answers `409 CERTIFICATE_NOT_ALLOWED`: MY PIECES then leaves OWNERSHIP CERTIFICATE out. It names no status. |
| `genome.version` | Integer here (1), unlike the `"GENOME-01"` label of the verification response. |

Errors: `401 UNAUTHORIZED`.

In the verify app, this list is **MY PIECES** (`/verify/pieces`, F-01; BRAND-DESIGN-SYSTEM §5): each piece on its ivory plate with its GENOME in orbit (drawn from `glyphs`, checked against `fingerprint`; the glyph ids are `pattern` split at `·`), the product lines, then the tabs OWNERSHIP (since when, how it was acquired, whether the ownership is verified, a pending transfer, which CANCEL TRANSFER withdraws, §11.4, REPORT LOST / STOLEN or PIECE FOUND, §11.5–§11.6, and OWNERSHIP CERTIFICATE, the links of §11.7 with the open ones listed, F-06), WARRANTY and SERVICE (§10.6). The page reads the open certificate links with the pieces (`GET /api/v1/ownership/certificates`); when they cannot be read, the pieces still show and each says so. Signed out, the page offers the sign-in first: an owner whose piece is lost or stolen reaches it without scanning the piece. The landing links to it, and so does the signed-in account line of a result's OWNERSHIP tab.

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

In the verify app, the SERVICE tab of a piece in MY PIECES (§10.5) reads it when it is first opened: one row per service, its type, its dates (or IN PROGRESS SINCE …, or CANCELLED …) and its place.

### 10.7 `POST /api/v1/account/password`

The signed-in customer changes their password (C-04). Body `{ "currentPassword": string (1–1024), "newPassword": string (1–1024) }`; unknown fields are refused. Account session and CSRF rules. Rate group `auth`.

- `newPassword` follows the rules of registration (§10.1: at least 12 characters after NFKC normalisation, not equal to the email…). It is checked first, so a weak choice (`400 VALIDATION_FAILED`) costs no attempt.
- A wrong current password answers **`400 CURRENT_PASSWORD_INVALID`**, never a 401 (the verify app and the console end the session on any 401), and counts in the account's login throttle (§10.2), audited `account.login_failed` with `details.via: "password_change"`: whoever holds a session cannot guess the password faster than a login could. While the account is throttled, the current password is not checked, with the same answer.
- On success the new password is stored, **every other session of the account ends** and this one is kept. Audited `account.password_change`.
- **Nothing that happened during the check is undone.** The two scrypt evaluations (the current password, then the new one) run before the write, which then reads the account again under its row lock: if ORBES Client Services locked it meanwhile, the answer is `403 ACCOUNT_LOCKED` (§16.12); if this session has ended (an assisted recovery, §10.8, or a lock ended every session), `401 UNAUTHORIZED`; if the password is no longer the one that was checked (a recovery or another change committed first), `400 CURRENT_PASSWORD_INVALID`. In each case nothing is written: a change under way can neither undo a recovery nor outlive a lock.

**200** `{ "ok": true }`. Errors: `400 VALIDATION_FAILED`, `400 CURRENT_PASSWORD_INVALID`, `401 UNAUTHORIZED`, `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `429 RATE_LIMITED`.

In the verify app, signed in: CHANGE PASSWORD on the account line at the foot of MY PIECES (§10.5), beside SIGN OUT (F-01 moved it there from the OWNERSHIP panel, whose account line now leads to MY PIECES). A wrong current password is said on its field, and the page stays signed in.

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

---

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

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 NOT_OWNER`, `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 TRANSFER_ALREADY_PENDING`, `409 TRANSFER_NOT_ALLOWED`, `409 TRANSFERS_PAUSED`.

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
- **The scan is required and used up.** The `TRANSFER_ACCEPT` token is checked before the code is read: it must be of that piece (`productId`), unexpired, unused, and earned by **this account's** scan (the scan event names the account). Refusals: `400 TRANSFER_TOKEN_INVALID` (unknown, malformed, another purpose, another piece, another account, a scan made signed out), `409 TRANSFER_TOKEN_USED`, `410 TRANSFER_TOKEN_EXPIRED` (15 minutes). Because the token is checked first, a scan of one piece cannot be used to try piece ids against a code: every other id gets the same `TRANSFER_TOKEN_INVALID`. The token is used up **in the acceptance's transaction**, under the piece's and the transfer's row locks: any refusal there (`CANNOT_ACCEPT_OWN_TRANSFER`, `TRANSFER_NOT_ALLOWED`, a lock of the account…) leaves it unused.
- **`TRANSFER_ACCEPT_REQUIRE_PRODUCT=false`** (DEPLOYMENT §3.1; a production start logs a warning) makes `productId` and `transferToken` optional, for an acceptance assisted by ORBES Client Services: whichever is sent is still checked (a `productId` of another piece is still `409 TRANSFER_PRODUCT_MISMATCH`; a token alone stands for its piece). Without a token, a `productId` that names no issued piece is refused only once the code has been read, exactly as the id of another piece: `404 TRANSFER_NOT_FOUND` for a code that is no one's, `409 TRANSFER_PRODUCT_MISMATCH` for any other code, so the switch does not tell an account which ids exist (product ids are sequential). The switch is at the API level only: the verify app still offers RECEIVE THIS PIECE only after a signed-in scan of the piece, and neither it nor the console offers an acceptance without one, so it does not help a client whose piece cannot be scanned (LAUNCH §11). While it is set, the check is off for every pending transfer.

The previous ownership ends (`TRANSFERRED_OUT`), a new one starts (`acquiredVia: TRANSFER`, `verified` carried over) and the product becomes TRANSFERRED. The audit entry `ownership.transfer.accept` names the scan used (`details.scanEventId`, `null` for an assisted acceptance without one).

**200** `{ "productId": "O26-J-00002", "verified": true, "since": "2026-10-01T08:13:21.929Z" }`

An acceptance that was already on its way when ORBES Client Services locked the recipient's account (§16.12) is refused with `403 ACCOUNT_LOCKED`; the transfer stays pending.

In the verify app: **RECEIVING THIS PIECE** in the OWNERSHIP tab of a piece registered to someone else (BRAND §4.4). A reader signed in when they scan gets the result on that tab, with *RECEIVING OPEN UNTIL hh:mm* and the TRANSFER CODE field; one who signs in after the scan, or as another account than the scan's (the window is that account's), is asked to **VERIFY AGAIN** (the same code, now with the session); after 15 minutes the panel asks to **SCAN AGAIN**, without sending the code. With no transfer pending, there is nothing to enter; VERIFY AGAIN takes an owner who signed in after the scan to the owner view.

Errors: `400 VALIDATION_FAILED` (including a malformed transfer code, a missing or malformed `productId`, a malformed `transferToken`, an unknown field), `400 TRANSFER_SCAN_REQUIRED`, `400 TRANSFER_TOKEN_INVALID`, `401 UNAUTHORIZED`, `403 ACCOUNT_LOCKED`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `404 TRANSFER_NOT_FOUND`, `409 TRANSFER_PRODUCT_MISMATCH`, `409 TRANSFER_TOKEN_USED`, `409 TRANSFER_ALREADY_ACCEPTED`, `409 CANNOT_ACCEPT_OWN_TRANSFER`, `409 TRANSFER_STALE`, `409 TRANSFER_NOT_ALLOWED`, `410 TRANSFER_TOKEN_EXPIRED`, `410 TRANSFER_EXPIRED`, `410 TRANSFER_CANCELLED`, `429 RATE_LIMITED`.

### 11.4 `POST /api/v1/ownership/transfers/cancel`

The sender withdraws a pending offer. Body `{ "productId": string }`.

**200** `{ "ok": true }`. Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 NOT_OWNER`, `403 CSRF_FAILED`, `404 PRODUCT_NOT_FOUND`, `404 NO_PENDING_TRANSFER`.

### 11.5 `POST /api/v1/ownership/incidents`

The current owner reports the product lost or stolen. Body `{ "productId": string, "type": "LOST" | "STOLEN" }`. Any pending transfer is cancelled. From then on, verifications of the product answer `SUSPICIOUS_ACTIVITY` and its codes can no longer be printed. A loss the owner reported themselves, the owner withdraws (§11.6); a theft, and a loss recorded by ORBES Client Services, are withdrawn by Client Services once they have checked the piece (a transition back to the previous status, §14.4).

In the verify app: **REPORT LOST / STOLEN** in MY PIECES (§10.5), with no scan (an owner whose piece is gone cannot scan it), confirmed: LOST or STOLEN, then CONFIRM REPORT.

A declaration that was already on its way when ORBES Client Services locked the account (§16.12) is refused with `403 ACCOUNT_LOCKED`, as a transfer is (§11.2): the account row is re-read under its lock.

**201** `{ "productId": "O26-J-00002", "type": "LOST", "reportedAt": "2026-10-01T08:15:21.929Z" }`

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 NOT_OWNER`, `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 TRANSITION_NOT_ALLOWED` (e.g. already reported).

### 11.6 `POST /api/v1/ownership/incidents/resolve` (extension of the contract)

The current owner withdraws a loss they reported themselves: the piece has been found (F-01). Body `{ "productId": string }` (canonical id or uuid; unknown fields are refused).

- **Only the current owner**, checked first: a stranger, and an unknown id, get the same `403 NOT_OWNER`, so the route reveals neither whether a piece exists nor whether it is reported.
- **Only a `LOST` the owner declared** (§11.5): the last move of the piece's status history, into `LOST`, was made by this account. A `STOLEN`, or a `LOST` recorded by ORBES Client Services, answers `409 INCIDENT_NOT_RESOLVABLE` (*Only a loss you reported yourself can be withdrawn here. ORBES Client Services can assist you.*): a theft is withdrawn by staff once they have checked the recovered piece, so whoever takes over an account after a theft cannot make the stolen piece read as clean. A piece that is not reported answers `409 NO_INCIDENT`.
- In **one transaction**, under the piece's row lock: the piece returns to the status it held before the loss (`returnTargetOf`, the lifecycle's return rule, applied by `applyForService`, audited `product.transition` with `via: "ownership.resolveIncident"` and the reason *found by owner*), and the withdrawal is audited `ownership.incident.resolve` with `details: { type: "LOST", to }`. Verifications then answer as they did before the loss, and the piece can be transferred again.
- A withdrawal already on its way when ORBES Client Services locked the account (§16.12) is refused with `403 ACCOUNT_LOCKED`, as a declaration is: the account row is re-read under its lock before the piece.

**200**:

```json
{ "productId": "O26-J-00002", "type": "LOST", "resolvedAt": "2026-10-03T09:12:41.118Z" }
```

Errors: `400 VALIDATION_FAILED`, `401 UNAUTHORIZED`, `403 NOT_OWNER`, `403 ACCOUNT_LOCKED`, `403 CSRF_FAILED`, `409 NO_INCIDENT`, `409 INCIDENT_NOT_RESOLVABLE`.

In the verify app: **PIECE FOUND** in MY PIECES (§10.5), under a loss the owner reported, confirmed (CONFIRM). Under a theft, or a loss Client Services recorded, the page offers their contact instead (an email titled `ORBES — {product id} — REPORTED STOLEN` that names the piece, the phone, the hours).

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
      "createdAt": "2026-10-01T08:13:22.220Z"
    }
  ]
}
```

`collection` is `null` when the model has none. `active`: the model is offered for new products (§13.4, `PATCH`). `imageUrl`: the model's reference photograph (below), `null` without one. `products`: the pieces issued with the model, whose public results read its name, type, care instructions, collection and reference photograph.

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

**201** — the model object (`active: true`, `imageUrl: null`, `products: 0`). Errors: `400 VALIDATION_FAILED`, `404 CATEGORY_NOT_FOUND`, `404 COLLECTION_NOT_FOUND`, `409 SKU_PREFIX_TAKEN`.

**`PATCH /api/admin/models/:id`** (OPERATOR; extension of the contract) — changes what a model shows or offers, at least one field:

| Field | Type | Rules |
|---|---|---|
| `name` | string | 1–100 characters. Public: `product.model`. |
| `defaultMaterial` | string \| null | ≤ 200 characters; `""`/`null` clears it. Proposed by the generator; each piece keeps its own `material`. |
| `careInstructions` | string \| null | ≤ 2 000 characters; `""`/`null` clears them (the CARE tab of /verify then shows its general care text). Public: `product.care`. |
| `collectionId` | uuid \| null | Must exist; `""`/`null` = none. Public: `product.collection` of the pieces without a collection of their own. |
| `active` | boolean | `false`: no new product with this model (`POST /api/admin/products` answers `409 MODEL_INACTIVE`, the generator hides it); its pieces keep verifying as before. `true` offers it again. An issuance under way reads `active` again under a share lock in its transaction (§14.2), so it never completes with a model deactivated meanwhile. |

**Never `category`, `categoryCode` nor `skuPrefix`** (`400 VALIDATION_FAILED`, "The category and SKU prefix of a model never change: …"): the category letter is in the identity of every piece issued with the model, and the prefix starts every SKU issued with it (the database refuses them too, DATABASE §5.3). `type` cannot be changed either; any other field is unknown (400). The changes are read live by the public result (§9.2) of every piece issued with the model, at once (the collection only on the pieces without one of their own): the console says how many (`products`) before saving, and shows the care block as the client reads it. Audited `model.update` with the changed fields only, `{ before: {…}, after: {…}, issuedPieces }`; a change that changes nothing writes nothing. **200** — the model object. Errors: `400 VALIDATION_FAILED`, `404 MODEL_NOT_FOUND`, `404 COLLECTION_NOT_FOUND`.

**`POST /api/admin/models/:id/image`** (OPERATOR; extension of the contract, F-04) — sets the model's **reference photograph**, shown above the GENOME on the authentic result (§9.2 `product.imageUrl`) of every piece issued with the model, at once. The body is **the image itself**, not JSON:

- `Content-Type: image/jpeg` or `image/webp` (anything else, a JSON body included: `415 UNSUPPORTED_MEDIA_TYPE`), at most **1 MiB** (`413 PAYLOAD_TOO_LARGE`); the CSRF rules of §2.2 apply as to any mutation. These two photograph routes are the only ones with this parser and this limit (`genome/src/server/routes/admin/media.ts`).
- The type is read from the bytes (`genome/src/server/media/image.ts`): a JPEG (`FF D8 FF`) sent as `image/jpeg` or a WebP (`RIFF…WEBP`) sent as `image/webp`, still, at most 4 096 px on each side; anything else is `400 IMAGE_INVALID` (an SVG or a PNG under either name, a damaged or truncated file), an animated WebP `400 IMAGE_ANIMATED`.
- **Metadata removed** before anything is stored: from a JPEG, every APP1 segment (EXIF with its GPS position and thumbnail, XMP), every other application segment but the JFIF header (without its thumbnail), the ICC colour profile and the Adobe marker, every comment, and whatever follows the end of the image; from a WebP, the EXIF and XMP chunks (and their flags), every chunk that is not part of the picture, and whatever follows the container. The picture itself is not re-encoded: its pixels are the file's.
- Stored once under the SHA-256 of what remains (`media_objects`, DATABASE §5.26): the same photograph uploaded for two models or pieces is one row.

The console re-encodes every photograph through a canvas before sending it (2 000 px at most on the longer side, a JPEG whose quality steps down until it fits 1 MiB), which carries no metadata in the first place; the Catalogue's **Photo** dialog previews what will be sent, its size and the number of issued pieces it reaches. Audited `model.image.set` (target the model) with `{ sha256, mime, width, height, bytes, previous, issuedPieces }`: the facts of the image, never its bytes, the photograph it replaced (`null` for the first) and the pieces it reaches. The same photograph again writes nothing. The one it replaced, used by no other model or piece, is deleted (§8.6 then answers 404). **200** — the model object, `imageUrl` set. Errors: `400 VALIDATION_FAILED` (`:id` not a UUID), `400 IMAGE_INVALID`, `400 IMAGE_ANIMATED`, `404 MODEL_NOT_FOUND` (checked after the image), `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`.

**`DELETE /api/admin/models/:id/image`** (OPERATOR; extension of the contract) — removes the reference photograph: the results of the model's pieces no longer show it. No body (or `{}`). Audited `model.image.remove` with `{ previous, issuedPieces }`; removing where there is none writes nothing. The image, used by no other model or piece, is deleted. **200** — the model object, `imageUrl: null`. Errors: `400 VALIDATION_FAILED`, `404 MODEL_NOT_FOUND`.

At the edge of the VPS stack, the two photograph uploads, and only they, may carry 1 200 KB instead of 64 KB ([DEPLOYMENT §15](DEPLOYMENT.md#15-ovh-vps-deployment), `deploy/vps/Caddyfile`).

The narrative fields of a model (workshop, materials, repairability) are a later phase (A-10 phase 2).

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

`codeId`, `codeVersion` and `codeIssue` refer to the ACTIVE code and are `null` when there is none. Errors: `400 VALIDATION_FAILED`.

### 14.2 `POST /api/admin/products` — issue a product

OPERATOR. In one transaction: allocates the serial, creates the product (ISSUED), its GENOME-01, signs its first code (issue 1) with the ACTIVE key (the signature is verified before it is stored), creates the warranty row (not started) and writes the audit entry. The body is validated strictly by the issuance service. The category and the model are checked before the transaction and read again under a share lock inside it, so a deactivation (§13.2, §13.4) that commits while the piece is prepared still refuses it (`409 CATEGORY_INACTIVE`, `409 MODEL_INACTIVE`).

| Field | Type | Required | Rules |
|---|---|---|---|
| `categoryCode` | string | yes | One letter (case-insensitive). The category must exist and be active. |
| `modelId` | uuid | yes | Must exist, belong to that category and be active (§13.4). |
| `material` | string | yes | 1–200 characters, no control character (C0, DEL, C1) and no U+FFFD, the replacement character a wrong decoding leaves for a lost letter. |
| `year` | integer | no | 2000–2099; default the current UTC year. |
| `collectionId` | uuid | no | Must exist. Without it, the model's collection applies in admin and owner views. |
| `sku` | string | no | ≤ 64 characters: letters, digits, space, `.`, `_`, `-`, `/`, starting with a letter or digit. Default: model SKU prefix + slug of the variant (e.g. `MNL-RG-SIZE-52`). |
| `variant` | string | no | 1–100 characters, as `material` (no control character, no U+FFFD) |
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
- `claimCode` is present only with `withClaimSecret: true` and is **returned once**: only its scrypt hash is stored. Print it under the scratch-off panel of the certificate card supplied with the product: `POST /api/admin/certificates` (§15.7) renders that card after checking the code against its hash.
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
    "model": { "id": "73c6…", "name": "MONOLITHE", "type": "RING", "skuPrefix": "MNL-RG", "care": "Polish with a soft dry cloth.", "imageUrl": "/api/v1/media/9f2c4e8a…" },
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
  }
}
```

- `codes[].verification` re-verifies each stored code live (payload fields against the row, payload hash, Ed25519 signature, key trust). It is `{ "valid": true, "keyStatus" }` or `{ "valid": false, "reason", "keyStatus" }` with `reason` one of `UNKNOWN_KEY`, `PAYLOAD_INVALID`, `PAYLOAD_MISMATCH`, `PAYLOAD_HASH_MISMATCH`, `SIGNATURE_INVALID`, `KEY_REVOKED`. A row tampered with in the database shows up here as invalid. Read views never include `data`.
- `ownership.current` is `{ "accountId", "acquiredVia", "verified", "since", "transferPending" }` or `null`; `ownership.owners` lists every ownership period with the account's email (masked for an AUDITOR, §16.2) and display name; each account opens its sheet in the console (§16.11); `ownership.transfers` lists every transfer (a pending transfer past its expiry reads `EXPIRED`).
- `anomalies` lists up to 100 anomalies of the product, most severe first (shape and order of §16.4); `services` the service records (§14.8).
- `product.photoUrl` is the piece's own photograph (§14.12) and `product.model.imageUrl` its model's reference photograph (§13.4), each `/api/v1/media/<sha256>` or `null`: the product page shows both as /verify does (F-04).
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

OPERATOR. Up to **50 pieces that share a template**, one result per piece. Each piece is issued exactly as by §14.2 (`IssuanceService.issueProduct`): its own serial, product, GENOME-01, code signed with the ACTIVE key, warranty row and `product.issue` audit entry, **in its own transaction**. **The pieces that name their `serial` are signed first**, then those whose serial is allocated (the highest + 1), each group in the order given: an allocated serial so never takes a serial that a later piece of the batch names (`[{}, {}, { "serial": 14 }]` with 12 the highest: 14, then 15 and 16). Why 50: requests are limited to 16 KB (§1.2) and each claim code costs one scrypt; the console sends a larger batch as several requests, one after the other (*In the console*, below).

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

OPERATOR (F-04, phase 2). The **photograph of one piece**, taken when it is issued: a close view of what makes it unique (the grain of the leather, the stone), which the client compares with the piece in hand. It is shown first, before the model's reference photograph, above the GENOME of the piece's authentic results (§9.2 `product.photoUrl`). `:productId` is the canonical id or the uuid.

**`POST`** — the body is the image itself, with the same type, size, metadata and storage rules as a model's reference photograph (§13.4): `image/jpeg` or `image/webp`, at most 1 MiB, still, at most 4 096 px a side, EXIF and XMP removed, stored once by SHA-256. The console offers it **at issuance**, on the generator's result (*Add a photo of this piece*), and on the product page (*Add a photo of this piece*, then *Replace the photo of this piece*). Audited `product.photo.set` (target the product id) with `{ sha256, mime, width, height, bytes, previous }`; the same photograph again writes nothing; the one it replaced, used by nothing else, is deleted.

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

**OPERATOR** (never AUDITOR: the response holds claim codes). Renders the **certificate card** delivered with a piece: ORBES with the brand's monogram, its identity, its GENOME row, model, material, the three steps of the packaging kit, *VERIFY ONLY AT THEORBES.COM/VERIFY*, and its one-time claim code under a scratch-off panel ([BRAND-DESIGN-SYSTEM §7](BRAND-DESIGN-SYSTEM.md#7-artifact-specimens)). Never the ORBES CODE itself. Also the same data as a CSV for a print shop's variable-data run.

The claim code is shown once at issuance (§14.2) and only its scrypt hash is stored, so the console sends it back here. A `POST` because the codes travel in the body, never in a URL (CSRF-protected). Before anything is drawn, **every code is checked against its product's hash**: a card printed with a mistyped code would lock the buyer out of registration for good. The codes are never stored, logged, audited or repeated in an error.

| Field | Type | Required | Default | Rules |
|---|---|---|---|---|
| `items` | `{ productId, claimCode }[]` | yes | — | 1–50 items, one per product (a product listed twice is `400`). `productId`: canonical id or row UUID. `claimCode`: at most 32 characters, any spelling accepted at registration (case, spaces and hyphens are ignored; I and L read as 1, O as 0). |
| `format` | string | no | `pdf` | `pdf` or `csv` |
| `layout` | string | no | `card` | PDF only. `card`: one 85 × 55 mm page per card. `sheet`: A4 sheets of ten cards (2 × 5, abutting, 11 mm top and bottom margins) with cut marks outside the grid, a caption and a 10 mm scale bar. |

Checks, in this order (nothing is rendered when one fails): every product exists (`404 PRODUCT_NOT_FOUND`, naming it); every product was issued with a claim code (`422 NO_CLAIM_SECRET`); none is RETIRED, REVOKED, COUNTERFEIT_FLAGGED, LOST or STOLEN (`409 PRODUCT_NOT_PRINTABLE`); none has an owner, whose registration has spent the code (`409 ALREADY_REGISTERED`); every claim code matches its product's hash (`422 CLAIM_CODE_MISMATCH`, naming the product, never the code). A malformed code is a mismatch. Mismatches are not counted towards the customers' claim-code attempt limit (§11.1): the route needs an OPERATOR session (with TOTP in production) and every refusal is audited.

**Cost.** Each check is one scrypt (32 MiB) on the server's small worker pool, which customers' logins and claim-code registrations share. The codes are checked one at a time, in the order given, and the checks stop at the first code that does not match: the refusal names that product only, and the codes after it are not checked. Each admin has at most one certificate request in progress: a second one sent before the first is done answers `429 RATE_LIMITED` (*A certificate download is already being prepared. Wait for it to finish, then try again.*), and is not audited. The route also draws on the `admin` rate-limit group.

**200**, `Cache-Control: no-store`, as an attachment:

| `format` / `layout` | `Content-Type` | File name |
|---|---|---|
| `pdf` / `card`, one item | `application/pdf` | `ORBES-certificate-<productId>[-PROOF].pdf` |
| `pdf` / `card`, several | `application/pdf` | `ORBES-certificates-<YYYY-MM-DD>-<count>-card[-PROOF].pdf` |
| `pdf` / `sheet` | `application/pdf` | `ORBES-certificates-<YYYY-MM-DD>-<count>-sheet[-PROOF].pdf` |
| `csv` | `text/csv; charset=utf-8; header=present` | `ORBES-certificates-<YYYY-MM-DD>-<count>[-PROOF].csv` |

**The PDF** is pure vector and embeds no font: lettering is stroked geometry (the print label's), the GENOME and the monogram are filled paths, so the claim code is never text that could be searched or copied out of the file. Black is DeviceCMYK K only (as `kOnly`, §15.2). The scratch-off panel is a flat fill in the spot colour **`ORBES SCRATCH-OFF`** (a Separation colour space; its CMYK alternate, K 35 %, is only how viewers and office printers show it) set to **overprint** (`OP`/`op` true, `OPM 1`), so the claim code printed beneath it stays whole on the black plate. Tell the print shop to lay the scratch-off ink on that plate. Until the brand validates the layout, every card says **PROOF · LAYOUT NOT VALIDATED**, and the sheet caption, the document title and the file name say PROOF (`CERTIFICATE_LAYOUT_STATUS`, `genome/src/server/render/certificate.ts`). The CSV's name says PROOF too (its columns stay the print shop's).

**The CSV** (RFC 4180, UTF-8 without BOM, CRLF, a header row, every field quoted) has the columns `productId`, `model` (`<name> · <type>`), `material` and `code` (`XXXX-XXXX-XXXX`), values as recorded. A value starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with an apostrophe, so opening the file in a spreadsheet never runs a formula. The GENOME row is not in the CSV (a print shop cannot typeset it): the PDF remains the reference.

Example:

```json
{ "items": [{ "productId": "O26-J-00184", "claimCode": "7KQ2-M4TD-9XWH" }], "format": "pdf", "layout": "card" }
```

Audited: `certificate.render` with `{ productIds, count, format, layout, layoutStatus }`; each refusal after validation as `certificate.render_refused` with `{ reason, productIds, refused, format, layout }` (`refused`: the product ids concerned). Both carry canonical product ids, also for a product the request named by its uuid; only a product that was not found keeps the reference given. No claim code in either.

In the console, the generator's result screen offers **Download certificate card** while the one-time claim code is shown; the button goes with *Copy* when the operator hides the code. A batch's result (§14.11) offers the cards of all its pieces, sent in requests of 50, one after the other.

Errors: `400 VALIDATION_FAILED` (shape, bounds, a product listed twice), `401`, `403 FORBIDDEN` (AUDITOR), `403 CSRF_FAILED`, `404 PRODUCT_NOT_FOUND`, `409 PRODUCT_NOT_PRINTABLE`, `409 ALREADY_REGISTERED`, `422 NO_CLAIM_SECRET`, `422 CLAIM_CODE_MISMATCH`, `429 RATE_LIMITED` (a request of the same admin still in progress, or the `admin` group's limit).

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

`report` is the customer's report on the scan (§8.5) and the state of its case, or `null`. `productId` is the canonical id; `deviceHash` is a pseudonym (HMAC), never a raw id; the IP pseudonym is not returned. `eventType` is `VERIFY` for a public scan and `ADMIN_TEST` for a staff scan (the sale mode, §16.18, or `/api/v1/verify` from a browser signed in to the console, §9.7), whose `adminEmail` names the console user who scanned (read at display time; the row keeps `scan_events.admin_id`); `adminEmail` is `null` on every other scan. `genomeCheck` is `MATCH`, `MISMATCH`, `NOT_PROVIDED` or `INCONCLUSIVE`. `reasons` lists machine reasons such as `MALFORMED:<CRC|LENGTH|VERSION|RANGE|RESERVED|ENCODING|INPUT>`, `UNKNOWN_KEY`, `BAD_SIGNATURE`, `PRODUCT_NOT_REGISTERED`, `CODE_NOT_REGISTERED`, `CODE_MISMATCH`, `KEY_REVOKED`, `GENOME_MISMATCH`, `CODE_SUPERSEDED`, `CODE_REVOKED`, `UNSUPPORTED_GENOME_VERSION`, `UNSUPPORTED_CODE_VERSION`, `PRODUCT_<STATUS>`, `ANOMALY:<TYPE>`, `RISK_THRESHOLD`, `RISK_THRESHOLD_OWNER`, `REGISTRATION_WITH_CLAIM_CODE` (a registration token was issued on a suspicious scan, §9.4 step 10).

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
| `type` | One of the types below (extension). The list is `ANOMALY_TYPES`, derived from the weights table of `anomaly-rules.ts`: a type added there is accepted here, listed by §16.14 and offered by the console's Type filter without further change, under its console name (`UNSOLD_PIECE_SCAN` reads UNSOLD PIECE SCANNED there, in the list, the detail, the decision dialog and the Cases queue). Anything else, lower case included, is `400 VALIDATION_FAILED`. |
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

Errors: `400 VALIDATION_FAILED` (malformed id), `404 ACCOUNT_NOT_FOUND`.

In the console: `#/owners/:id`, reached from Owners, from a REF search and from a product's ownership (§14.3). It shows the account (status, email, name, country, since, id), *Pieces*, *Transfers in progress* and *Latest verifications* (each linked to its verification event and its piece), and, for an ADMIN, *Recovery code*, *Lock account* or *Unlock account*, and *Export data*. An AUDITOR reads it masked, without the actions.

### 16.12 `POST /api/admin/owners/:id/lock` and `POST /api/admin/owners/:id/unlock` (extension of the contract)

**ADMIN**. No body (or `{}`).

**Lock** an ACTIVE account, for example while a takeover is suspected or at the customer's request (then after the identity check of SECURITY-MODEL §3.6, outlined for staff in the [sales playbook](launch/SALES-PLAYBOOK.md), §6). In **one transaction**: the status becomes `LOCKED`, **every session of the account ends**, and its **pending transfers are cancelled** (audited `ownership.transfer.cancel` with `details.reason: "account_locked"`), so a transfer code already handed out no longer completes (`410 TRANSFER_CANCELLED`), and its **open links to ownership certificates are withdrawn** (§11.7; audited `ownership.certificate.revoke` with `details.reason: "account_locked"`), so a link shared by whoever held the account answers `404 CERTIFICATE_NOT_FOUND` (§8.7). Until it is unlocked the customer cannot sign in: a sign-in with the right password answers `403 ACCOUNT_LOCKED` (*This account is locked. ORBES Client Services can assist you.*, §10.2). Nor can they use a recovery code: the lock revoked the open one and none can be issued while the account is locked, so a code answers `400 RECOVERY_CODE_INVALID` like a replaced one (§10.8); `403 ACCOUNT_LOCKED` comes only when the lock lands between the check of a code and its use. A request already on its way when the lock takes effect is refused with `403 ACCOUNT_LOCKED`: a transfer (§11.2), a LOST or STOLEN declaration (§11.5), a first registration (§11.1, its claim code's check included) and the acceptance of a transfer by the locked account (§11.3), each of which reads the account again under a share lock before it locks the piece, so no piece reaches a LOCKED account; a password change (§10.7) and a sign-in whose password check was under way (§10.2). The pieces stay registered to the account; its scans keep showing them as registered. The **open recovery code is revoked** in the same transaction: a code obtained by fooling the identity check is the takeover a lock is for (THREAT-MODEL U), so it does not outlive the lock; it then fails like a replaced code (§10.8). A new one cannot be issued while the account is locked (`409 ACCOUNT_NOT_ACTIVE`).

**200** `{ "status": "LOCKED", "sessionsRevoked": 2, "transfersCancelled": 1, "recoveryCodesRevoked": 1, "certificatesRevoked": 1 }` (`recoveryCodesRevoked`: 0 or 1; a code already expired is left as it was; `certificatesRevoked`: the links withdrawn, an expired one left as it was). Audited `account.lock` with the account as target and `{ sessionsRevoked, transfersCancelled, recoveryCodesRevoked, certificatesRevoked }`; never the email.

**Unlock** a LOCKED account: the status becomes `ACTIVE` again and the customer signs in as before. Transfers cancelled, certificate links withdrawn and a recovery code revoked by the lock stay so: Client Services issues a new code if the customer needs one (§16.10). **200** `{ "status": "ACTIVE" }`. Audited `account.unlock`.

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
| `activity` | Every audit entry that names the account, oldest first: those **about** it (target: `account.register`, `account.login`, `account.login_failed`, `account.password_change`, `account.recover`, `account.recover_failed`, `account.lock`, …) and those it **made** (actor: `ownership.register`, `ownership.claim_failed`, `ownership.transfer.initiate`, `.accept`, `.cancel`, `ownership.incident`, `ownership.incident.resolve`, `ownership.certificate.create`, `ownership.certificate.revoke` (the owner's withdrawals and those of its assisted recovery; a lock's withdrawals name the ADMIN, and show in `certificates`), `product.transition`, `scan.report`, …). Each gives `occurredAt`, `action`, `by` (`account`, `admin` or `system`; never the staff member's identity), what it was about (`productId`, the piece's canonical id, or `reference`, a scan's REF, never its whole id; else `null`) and `status`, the status it gave the piece (`LOST` or `STOLEN` for a declared incident, the status it returned to for a loss withdrawn by its owner, `ownership.incident.resolve`, §11.6, the new status for a change of status) or `null`. Nothing else of an entry's details, which can name staff or other accounts. The audit log has no index on the actor, so the second half reads the whole log: accepted for this rare ADMIN request (DATABASE §5.21). A transfer the account offered and another account accepted is in `transfers`; its `ownership.transfer.accept` entry names the buyer as actor. |
| `truncated` | The lists cut at 50 000 entries (`scans`, `activity`); empty when the export is complete. |
| `notIncluded` | What the registry holds but cannot give back readably: the password and recovery codes (one-way scrypt hashes), the tokens of the certificate links (a one-way SHA-256 each), and the IP and device pseudonyms of scans, sessions and audit entries (keyed one-way hashes; no IP address or device cookie is stored). |

Audited `account.export` with the account as target and the number of entries of each list; never the content or the email.

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

### 16.17 Points of sale (boutique, extension of the contract)

The register a warranty's point of sale is chosen from (A-08, migration 0008, table `retailers`), in the product page's Activate warranty dialog (§14.6) and in the sale mode (§16.18), so a boutique is never typed three ways. Implementation: `routes/admin/retailers.ts`, `services/retailers.ts`.

**`GET /api/admin/retailers`** (RETAIL and every higher role, read only: the sale screen lists them). Query `active=true`: the active ones only (the lists a sale is chosen from); otherwise all. By name, then city.

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

---

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
{ "items": [ { "id": "6a0b…", "email": "ops@theorbes.com", "role": "OPERATOR", "totpEnabled": true, "passwordChangeRequired": false, "locked": false, "disabled": false, "createdAt": "2026-09-01T08:00:00.000Z" } ] }
```

`locked`: temporarily locked after 10 failed sign-ins (§12.1). `passwordChangeRequired`: the account still has the temporary password it was created with (§17.8). `disabled`: sign-in refused (§17.10).

The routes §17.8–§17.13 are the rest of the Team page. All are **ADMIN**, audited by `AuthService` in the transaction of the change with the acting ADMIN as actor, and answer `404 ADMIN_NOT_FOUND` for an unknown id and `400 VALIDATION_FAILED` when `:id` is not a UUID. Their admin object is the list item above. No change may target the caller's own account (`409 SELF_ACTION`; listing one's own sessions and resetting one's own second factor are allowed), and none may leave the console without an active ADMIN (`409 LAST_ADMIN`; role changes and (de)activations are serialised by an advisory lock, so two ADMINs disabling each other at the same moment cannot both succeed).

### 17.8 `POST /api/admin/admins` (extension of the contract)

Creates a staff account. Body `{ "email": string (3–254), "role": "OPERATOR" | "AUDITOR" | "RETAIL" }`; any other role, `ADMIN` included, is a `400 VALIDATION_FAILED` (ADMIN accounts come from the shell, §2.3). RETAIL (A-08) is a seller: after its own password, it reaches the sale mode only (§2.3, §16.18).

The server generates a **temporary password**: 16 Crockford base32 characters (80 bits) in four groups, `XXXX-XXXX-XXXX-XXXX`. It is returned **once**, in this response, and stored only as its scrypt hash; it is never logged nor written to the audit log. The account starts with `passwordChangeRequired: true`: at its first sign-in it can do nothing but choose its own password (§2.4, §12.5). Hand the temporary password over in person or over a trusted channel. Unlike a claim code, it is compared exactly: it is typed as shown, capitals and dashes included, and a wrong try counts as a failed sign-in (§12.1). Audit `admin.create` (`details: { role, passwordChangeRequired: true }`).

**201** `{ "admin": { …, "passwordChangeRequired": true }, "temporaryPassword": "QV7H-JFT0-QK82-V9ER" }`. Errors: `400 VALIDATION_FAILED`, `403 FORBIDDEN`, `403 CSRF_FAILED`, `409 EMAIL_TAKEN`.

### 17.9 `PATCH /api/admin/admins/:id/role` (extension of the contract)

Body `{ "role": "OPERATOR" | "AUDITOR" | "RETAIL" }`. Changes the role of another console user, an ADMIN included (stepping down), except the last active ADMIN (`409 LAST_ADMIN`). The guard reads the role from the database at every request: the change applies at that account's next request, without signing it out. Unchanged role: no-op, no audit entry. Audit `admin.role_change` (`details: { from, to }`).

**200** `{ "admin": … }`. Errors: `400 VALIDATION_FAILED`, `404 ADMIN_NOT_FOUND`, `409 SELF_ACTION`, `409 LAST_ADMIN`.

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
| `/verify`, `/verify/*` | The verification app shell (`dist/web/verify/index.html`). Its own routes: `/verify` (the landing and the screens of a scan), `/verify/pieces` (MY PIECES, §10.5) and `/verify/c#{token}` (an ownership certificate, §8.7: the token in the fragment, which the server never receives); any other path shows the landing, its address put back to `/verify` | `no-cache` |
| `/VERIFY/C`, and any other spelling of `/verify/c` | `301` redirect to `/verify/c` (`GET`, `HEAD`): the ownership certificate's PDF letters its address in capitals (§8.7). A browser keeps the fragment, the certificate's token, across the redirect | |
| `/admin`, `/admin/*` | The admin console shell (`dist/web/admin/index.html`) | `no-cache` |
| `/assets/*` | Bundles and stylesheets | Content-hashed names: `public, max-age=31536000, immutable`; others `no-cache`. Dotfiles are never served. |

Without a build, these paths answer `404 NOT_FOUND`. Each app has its main bundle and, for the two that read codes with the camera, a decoder worker (`verify-worker-<hash>.js`; `admin-worker-<hash>.js`, the same decoder for the console's sale mode, §16.18), named by the shell's `<meta name="orbes-worker">`; the main bundles never carry the decoder. Both shells are served with `Permissions-Policy: camera=(self)` and a CSP that allows workers from the page's origin.

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
