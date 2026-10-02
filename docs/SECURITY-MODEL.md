# ORBES GENOME CODE™ — Security Model

Status: v0.1. Companion documents: [THREAT-MODEL](THREAT-MODEL.md) (what we defend against) and [CRYPTOGRAPHY](CRYPTOGRAPHY.md) (primitives and formats).

## 1. Principles

1. **Established cryptography only.** Ed25519, SHA-256, HMAC-SHA-256, scrypt and AES-256-GCM, all from `node:crypto` or the audited `@noble/*` libraries. No home-made primitives.
2. **No security through obscurity.** The code format, the Genome permutation, the source code and the public keys are all assumed public. The only secrets are the private keys, server-side peppers and secrets, and user credentials.
3. **The server decides.** Browsers decode codes for speed. The server re-validates every byte and makes every decision.
4. **Separate identity from authentication.** The Genome is public identity. The signature is the proof of issuance. Ownership and lifecycle are registry state, so changing them never touches the cryptographic identity.
5. **Honest outcomes.** The public states describe exactly what was verified. They never claim the physical object is genuine.
6. **Minimise personal data.** Codes contain no personal data. Scan telemetry is pseudonymous (HMAC), coarse and purpose-bound.
7. **Defence in depth with auditability.** Every privileged mutation is audited in a tamper-evident hash chain.

## 2. What a verification proves

| Layer | Check | Proves |
|---|---|---|
| A. Authentic code | Ed25519 signature by an ORBES key over the canonical payload | The data was issued by ORBES. |
| B. Registered product | The identity, code issue and payload hash match the registry | The code corresponds to a product ORBES recorded. |
| C. Valid status | The product and code are not revoked, retired or counterfeit-flagged | The identity is currently active. |
| D. Lifecycle consistency | Ownership, warranty and transfer state | The scan is consistent with the product's history. |
| E. Anomaly detection | Scan-pattern rules and risk score | No suspicious duplication or travel is currently detected. |

None of these layers proves that the scanned object is the original physical item. Hardware binding (see [FUTURE-HARDWARE](FUTURE-HARDWARE.md)) is the planned path towards that.

## 3. Controls catalogue

### 3.1 Cryptographic controls
- **Signing:** Ed25519 (RFC 8032, pure). Domain-separated message: `"ORBES-CODE/v1" ‖ 0x00 ‖ payload`.
- **Verification:** `node:crypto`. Verification fails if the signature is not exactly 64 bytes or the key is not exactly 32 bytes. Malformed inputs never throw past the verification boundary.
- **Weak keys:** one strict rule, `isStrictEd25519PublicKey` in `src/server/crypto/ed25519-node.ts` (canonical encoding of a point of order > 8), is applied by `verifyEd25519Node` before OpenSSL and by `KeyService` before it registers any key: small-order and non-canonical keys (with which `R = identity, S = 0` verifies for every message) can neither verify nor be registered.
- **Key ids:** a 1-byte key id is carried in every code and resolved only through the `cryptographic_keys` registry. Unknown ids give `INVALID_SIGNATURE`.
- **Verify-after-sign:** every signature produced at issuance is verified with the registered public key before it is stored.
- **Key states:** ACTIVE (one at a time, enforced by a partial unique index), RETIRED (verify-only) and REVOKED (with `compromised_at`). Codes registered before the compromise remain trusted. Anything else signed by a revoked key — a later code, or an identity ORBES never registered — fails with `INVALID_SIGNATURE`: the revoked-key rule runs right after the signature check, before the registry lookup can answer `UNKNOWN`. The public key list publishes `revokedAt` and `compromisedAt` (never the reason).
- **Decision order:** parse → key lookup → signature → revoked-key trust → genome-version support → registry → genome cross-check → statuses → anomalies → ownership → authenticators (PLATFORM-CONTRACTS §2.4). Every signed field is authenticated before it is interpreted: an edited genome version is `INVALID_SIGNATURE`; only a *validly signed* unsupported version is `UNKNOWN` (server outdated, logged).

### 3.2 Key custody
- `KeyProvider` interface: `generate`, `sign`.
  - `LocalKeyProvider` (development and small deployments): Ed25519 seeds encrypted with AES-256-GCM under `KEY_ENCRYPTION_KEY`, with the kid as AAD. Directory mode 0700, files 0600. Integrity-checked on load.
  - `MemoryKeyProvider`: tests and demo only. Refused when `ORBES_ENV=production`.
  - A KMS/HSM provider implements the same two methods. The private key never leaves the KMS.
- Private keys never appear in the database, logs, API responses, frontend bundles or generated codes.

### 3.3 Authentication and sessions
- **Passwords:** scrypt (N = 2¹⁵, r = 8, p = 1), 16-byte salt, 32-byte output, constant-time comparison, minimum 12 characters.
- **Customers:**
  - Per-account login throttle: after 10 wrong passwords within 15 minutes, logins to that account are refused for the rest of the window without checking the password, with the same `INVALID_CREDENTIALS` answer and timing as a wrong password (no lockout oracle, no enumeration). It complements the per-IP `auth` rate limit, which a distributed guesser can spread across addresses.
  - **Accepted:** registration answers `409 EMAIL_TAKEN` for an existing email, which lets a caller test whether an email has an account. Without an email channel (no verification or reset mail exists yet) registration cannot answer both cases alike; the `auth` rate limit bounds the probing rate. Revisit when email verification is added.
  - **Password change** (`POST /api/v1/account/password`, C-04): the current password is required. A wrong one answers `400 CURRENT_PASSWORD_INVALID`, never a 401 (the apps end the session on any 401), and counts in the per-account login throttle above, so a stolen session cannot guess the password faster than a login; while the account is throttled the current password is not checked. The change ends every other session of the account and keeps the caller's.
  - **Assisted recovery** (C-04). There is no email channel, so a forgotten password goes through ORBES Client Services:
    - after an **identity check** (the procedure is written with counsel), an ADMIN issues a one-time recovery code in the console (`POST /api/admin/owners/:id/recovery-code`, audited `account.recovery_code.issue`). It is 12 Crockford base32 characters (60 bits), shown once and stored only as an scrypt hash (`account_recovery_codes`), valid **30 minutes** (`RECOVERY_CODE_TTL_MS`: one delay for every recovery code, the shorter and safer of the two briefs that asked for it), used once, one open per account (a new code revokes the previous one; a partial unique index enforces it), never in the audit log, and only for an ACTIVE account;
    - the customer enters it on /verify with a new password (`POST /api/v1/account/recover`, session-less, origin check, `auth` rate group). The same `400 RECOVERY_CODE_INVALID`, at the same cost (one scrypt), answers an unknown email and a wrong, malformed, expired, used or replaced code: no account enumeration. At most 5 failures per account per rolling hour, counted from the audit log (`account.recover_failed`) under the account's row lock, so the limit holds across instances; then even the right code is refused for the rest of the hour;
    - in one transaction the recovery stores the new password, **ends every session of the account**, **cancels its pending transfers** and **pauses new transfers out of it for 72 hours** (`accounts.transfers_frozen_until`, `409 TRANSFERS_PAUSED`). Whoever obtained a code by impersonating the customer can neither keep a session they had nor hand the pieces on at once; the real customer, who still has their pieces registered, reaches Client Services within the pause. A LOCKED account is refused (`403 ACCOUNT_LOCKED`) even with the right code, and the lock revokes the open code (below);
    - **Accepted:** someone who knows a customer's email can spend the 5 attempts and hold that customer's recovery back for up to an hour (the failures are in the account's audit entries); the identity check is a human process, and the pause, the audit trail (`account.recover`, naming the account, never the email or the code) and the 30-minute life of a code bound what a mistake in it can cost.
  - **Lock** (A-06, `POST /api/admin/owners/:id/lock`, ADMIN, audited `account.lock`): ORBES Client Services can lock an account, for example while a takeover is suspected. In one transaction the status becomes LOCKED, every session of the account ends, its pending transfers are cancelled and its **open recovery code is revoked**: a code obtained by fooling the identity check is precisely the takeover a lock is for (THREAT-MODEL U), so it must not work again after an unlock. A transfer request already on its way is refused under the account's row lock, and so is a sign-in whose password check was under way: login reads the account again `FOR SHARE` in the transaction that opens the session, so no session opened during the lock survives it to work again after an unlock. Sign-in then answers `403 ACCOUNT_LOCKED` only once the password is right (a wrong one answers as ever), so the lock reveals nothing to whoever does not hold it; the revoked code fails like a replaced one. The pieces stay registered. Unlocking (`account.unlock`) restores sign-in; cancelled transfers stay cancelled and the revoked code stays revoked (Client Services issues a new one if the customer needs it).
- **Admins:**
  - Lockout after 10 failures for 15 minutes, re-locking while the counter stays at the threshold, so guessing gets a bounded budget. **Trade-off (accepted):** anyone who knows an admin's email can keep that admin locked out by sending wrong passwords (slowed to 10 attempts per minute per IP by the `auth` rate limit). Mitigations: admin emails are not published, the console sits behind the same origin as the public app only if needed (an IP allow-list or VPN in front of `/admin` and `/api/admin` removes the exposure), and another ADMIN or `scripts/admin.ts` can act meanwhile.
  - TOTP (RFC 6238); the secret is stored with AES-256-GCM. Required in production (`ADMIN_REQUIRE_MFA`, default true; `false` is accepted with a warning at every start). An ADMIN can reset a lost second factor (`POST /api/admin/admins/:id/totp/reset`, audited); the reset ends every session of that admin.
  - **First enrolment is trust on first use:** in the console, whoever first signs in with an admin's password can enrol their own authenticator. Recommended: enrol new admins from the shell (`scripts/admin.ts totp-setup` then `totp-enable`) and hand the secret over in person, before the password is used in the console.
  - Roles: ADMIN > OPERATOR > AUDITOR, where AUDITOR is read-only and reads customers' emails masked (§3.6).
- **Sessions:**
  - The token is 32 random bytes in an httpOnly, SameSite=Strict cookie, Secure in production. In production the cookies carry the `__Host-` prefix (`__Host-orbes_session`, `__Host-orbes_admin`, `__Host-orbes_device`): browsers then require Secure, `Path=/` and no `Domain`, so a sibling subdomain or a plain-HTTP response cannot plant or shadow them (session fixation, cookie tossing).
  - The database stores only the token's SHA-256 hash.
  - The token rotates on login **and on every privilege change**: TOTP enrolment replaces the session by a new MFA-passed one (new token and CSRF token, same absolute expiry), so a token captured before the step-up never carries MFA. Session lifetime is bounded (absolute expiry).
  - Each session has its own CSRF token.

### 3.4 Request integrity
- **Input validation:** strict zod schemas (unknown keys rejected), a 16 KB body limit, and length bounds on every string. The verify route accepts any `code` string of at most 1024 characters, so that every undecodable submission is recorded as a `MALFORMED_CODE` scan (evidence for the console); the service reads only strings of 1–200 base64url characters that decode to exactly 79 bytes. Longer or non-string codes are refused with 400 and not recorded.
- **CSRF:** every cookie-authenticated mutation requires `x-csrf-token` equal to the session's token. The `Origin` must match the configured public origin (or `Sec-Fetch-Site: same-origin`); the session-less writes (account registration and login, the assisted account recovery `POST /api/v1/account/recover`, admin login, and a customer's report on a scan, `POST /api/v1/reports`) need that origin check alone.
- **Rate limits:** per IP and route group, covering verify, authentication, admin, claim attempts per product and transfer acceptance.
- **Replay:** registration tokens, transfer codes and recovery codes are random, stored hashed, single-use and time-limited, and consumed transactionally. Transfer codes (60 bits) are stored as HMAC-SHA256 under a server key derived with HKDF from `COOKIE_SECRET` (info `orbes/transfer-code/v1`): the lookup stays deterministic, but a leaked `ownership_transfers` table cannot be brute-forced offline. Rotating `COOKIE_SECRET` invalidates pending transfer codes.
- **SQL:** all queries go through Kysely's parameterised builder. Raw SQL is limited to migrations and static statements.

### 3.5 Response hygiene
- **Public responses:** never contain risk scores, thresholds, internal statuses, owner identities, retailer data, email addresses or stack traces.
- **Errors:** a stable `{ error: { code, message } }` shape.
- **Claim codes:** returned once, at issuance. The certificate card endpoint (`POST /api/admin/certificates`, OPERATOR) takes a code back only to print it: it checks the code against its scrypt hash first, and never stores, logs, audits or repeats it in an error (audit entries carry product ids). The card draws the code as paths, never as text, and every file is a `no-store` attachment.
- **Security headers:**
  - CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  - `Permissions-Policy: camera=(self)`
  - `Referrer-Policy: no-referrer`
  - HSTS in production
  - `X-Powered-By` removed

### 3.6 Privacy
- Device identifiers are random cookies. Only `HMAC(pepper, id)` is stored.
- IP addresses are never stored. Only `HMAC(pepper, ip)` is kept, for rate limiting and diversity counting.
- Geography is coarse: a country, plus lat/lon rounded to 0.1°, when the trusted edge provides them (`GEO_MODE=cloudflare` or `headers`) or, with `GEO_MODE=mmdb`, from a local GeoIP database lookup of the client IP on the server (`src/server/geo/mmdb.ts`; the IP is looked up in memory and never stored, and no region is derived).
- Codes contain no personal data.
- **Customers' reports on their scans** (`POST /api/v1/reports`, C-02): on a result that was not authentic, the customer may say where they saw or bought the piece, with a place (≤ 200 characters) and a note (≤ 500). That free text is **personal data** (it may name a seller, a place, a person). It is kept exactly as long as the scan it is attached to, and deleted with it; it is shown to an admin session only (the Cases queue, the scans and anomalies lists), never in a public response, and never copied into the audit log, which is permanent: `scan.report` and `scan.report.close` name the scan alone, and the case's resolution note stays with the case for the same reason. The verify app asks the customer to leave out their name and contact details. One report per scan, within 24 hours of a non-authentic result, rate group `verify` (DATABASE §5.22, API §8.5).
- **Customers' accounts in the console** (A-06, `routes/admin/owners.ts`, `services/owners.ts`):
  - **Masked for an AUDITOR.** A customer's email is personal data an auditor does not need: the server sends it to an AUDITOR as `j***@example.com` (the first character, then the domain) in the owners list, its searches, the owner's sheet and a product's ownership history; OPERATOR and ADMIN read it in clear. The console holds nothing the server did not send.
  - **Search by exact email**, normalised as at sign-in, with no partial match: a search answers whether one given address has an account, nothing more. A customer who calls can also be found by the REF printed under a result (the first 8 hexadecimal characters of the scan's id), which leads to the scan, its piece and the accounts involved. Search terms travel in the query string, which neither the app's log nor Caddy's access log keeps.
  - **Right of access** (GDPR art. 15): `GET /api/admin/owners/:id/export` (ADMIN, `no-store`, audited `account.export` with counts only) returns everything the registry holds about the account, readable: profile, pieces, transfers, the scans made while signed in (with their browser family, the app's decoding measurements and the customer's reports on them), sessions, recovery codes issued, and every audit entry that names the account, whether about it (sign-ins, recovery, lock) or made by it (claim codes tried, incidents declared, transfers, reports), each with its piece or the scan's REF and never the staff member's identity or the rest of an entry's details. It leaves out what cannot be given back readably, and says so: password and code hashes, IP and device pseudonyms. The audit log has no index on the actor, so an export reads the whole log once: accepted for a rare ADMIN request.
  - **Identity check.** A recovery code, a lock at the customer's request and an export are given only after ORBES Client Services has checked that the caller is the account holder. The procedure is written with counsel: the sales and service playbook (recommendation J-09) will outline it for staff. Until it is final, the audit trail (who issued, locked or exported, and when) is the control.
- Retention: with `SCAN_RETENTION_DAYS` set, housekeeping deletes scan events older than the period, with their authentication events, scan tokens and customers' reports (DATABASE §10). The period is a legal decision; it cannot be shorter than the anomaly look-back (30 days by default), and production warns at every start while it is unset (scan history is then kept indefinitely).

### 3.7 Audit and integrity monitoring
- `audit_logs` is append-only: a trigger rejects UPDATE and DELETE.
- `product_status_history` is append-only as well (UPDATE, DELETE and TRUNCATE raise). `genomes` and `cryptographic_keys` can never be deleted: a key id is a 1-byte value signed into every code, so a deleted key row would let a later key reuse the id. Keys are retired or revoked instead (migration `0002_platform_guards`).
- Each entry stores `prev_hash` and `hash = SHA-256(prev_hash ‖ canonical JSON(entry))`.
- `GET /api/admin/audit/verify` recomputes the chain and reports the first inconsistent entry.
- Audited actions include product issuance, code reissue and revocation, artifact and certificate card downloads (with refused card requests), lifecycle transitions, ownership changes, warranty actions, key generation, rotation, retirement and revocation, category, collection and model creation, anomaly status changes, customers' reports on scans and the closing of their cases (`scan.report`, `scan.report.close`, with the scan id and never the customer's words), admin logins, admin creation, TOTP enrolment and reset, customer login failures and throttling, customer password changes, the assisted recovery of an account (`account.recovery_code.issue`, `account.recover`, `account.recover_failed`, `account.recover_throttled`, with the account id and never the email or the code), and Client Services' lock, unlock and export of an account (`account.lock`, `account.unlock`, `account.export`, with the account id and counts, never the email).

### 3.8 Anomaly detection
- The rules are pure functions over scan history. Thresholds are configuration and are never exposed.
- The system never revokes automatically. A human reviews anomalies.
- A logged-in current owner keeps `AUTHENTIC_OWNERSHIP_VERIFIED`, with an `UNUSUAL_ACTIVITY` notice. This limits the damage of anomaly poisoning.
- **Before first registration**, anomaly poisoning cannot lock out the buyer either: when a scan is `SUSPICIOUS_ACTIVITY` only because of the risk score, the product has no owner, is open for registration and ships with a claim code, the response still carries a registration token with `claimCodeRequired: true`. The token is useless without the claim code from the certificate card; products without a claim code get no token while suspicious. The verification app offers it on the UNUSUAL ACTIVITY result itself, under the help line, as **DO YOU HOLD THE CERTIFICATE CARD?** (sign-in, then the claim code, required), without showing any product data (`genome/src/web/verify/view-model.ts`, `ownershipMode`). Residual risk: the claim-code limit (5 failures per product per rolling hour) counts every account's failures and then refuses the right code too, so poisoning plus 5 wrong claim codes an hour can still hold the buyer's registration back; the app then says that registration is held for up to an hour and that ORBES Client Services can assist them (THREAT-MODEL E). Counting failures per account or per source as well is server work still to do. The section also shows a visitor that the piece is unregistered and open for registration, an accepted disclosure (BRAND §4.1).
- **Sources, not cookies (SEC-7):** scan velocity and diversity count distinct sources — the IP pseudonym, else the device-cookie pseudonym, else the session — because device cookies are client-controlled: a client that drops its cookie on every request would otherwise look like many devices. Accepted trade-off: many phones behind one address (a boutique wifi, a carrier NAT) count once. Travel and dispersion use the coarse geography.
- Weights and thresholds are internal (PLATFORM-CONTRACTS §2.5). A same-place burst (scan velocity 45 ⊕ source diversity 30 = 62) reaches the default threshold of 60 without a geographic signal.

## 4. Configuration hardening (production)

`loadConfig` refuses to start in production when any of these hold:
- the database is PGlite;
- the key provider is `memory`;
- `COOKIE_SECRET` or `IP_HASH_PEPPER` is shorter than 32 characters, still the development default, or has too little variety; or both are the same secret;
- `PUBLIC_ORIGIN` is not `https:`;
- the local key provider has no `KEY_ENCRYPTION_KEY`, or it is degenerate (all bytes identical);
- `TRUST_PROXY=true`: Fastify would take the left-most `X-Forwarded-For` entry as the client IP, and that entry is written by the client, so rate limits (logins, claim and transfer codes) and IP pseudonyms become forgeable. List the proxy addresses or ranges instead;
- `TRUST_PROXY` is a number (a hop count such as `1`): ambiguous, and Fastify's handling of numbers trusts nothing or everything depending on the version. Also refused outside production;
- `GEO_MODE=cloudflare` or `GEO_MODE=headers` without `TRUST_PROXY`: the location headers would be accepted from any client (and, behind Cloudflare, every client would share the edge's IP for rate limiting);
- `GEO_MODE=mmdb` without `TRUST_PROXY`: production always sits behind a TLS proxy, so the client IP would be the proxy's own address and every lookup would silently find nothing.

Refused in every environment: `GEO_MODE=mmdb` without an absolute `GEO_MMDB_PATH` (a missing file at that path is not an error: location is then simply unknown).

Accepted with a warning at every start (`configWarnings`): `ADMIN_REQUIRE_MFA=false` in production, and no `SCAN_RETENTION_DAYS` in production.

`npm start -- --demo` (demo mode) is refused in production and with any `DATABASE_URL` other than `pglite:memory`.

## 5. Operational security checklist

- [ ] Signing keys in a KMS/HSM (or LocalKeyProvider on a dedicated host with encrypted disk).
- [ ] `KEY_ENCRYPTION_KEY`, `COOKIE_SECRET` and `IP_HASH_PEPPER` stored in a secret manager and rotated on staff changes.
- [ ] TLS everywhere. HSTS preload once the domain is stable.
- [ ] Database: least-privilege app role, TLS, encrypted backups, point-in-time recovery.
- [ ] Periodic `audit/verify`, with the chain head exported to WORM storage.
- [ ] Alerting on CRITICAL anomalies (`VALID_SIGNATURE_UNREGISTERED`, `CODE_MISMATCH`), which indicate key compromise.
- [ ] Admin accounts with TOTP. AUDITOR role for analysts.
- [ ] A written identity check for customers who forgot their password, applied by ORBES Client Services before an ADMIN issues a recovery code (to finalise with counsel); recovery codes are read to the customer, never stored or forwarded.
- [ ] Key rotation at least yearly. A revocation drill documented and rehearsed.
- [ ] `npm audit` and dependency updates in CI.
