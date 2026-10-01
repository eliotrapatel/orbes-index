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
- **Key ids:** a 1-byte key id is carried in every code and resolved only through the `cryptographic_keys` registry. Unknown ids give `INVALID_SIGNATURE`.
- **Verify-after-sign:** every signature produced at issuance is verified with the registered public key before it is stored.
- **Key states:** ACTIVE (one at a time, enforced by a partial unique index), RETIRED (verify-only) and REVOKED (with `compromised_at`). Codes registered before the compromise remain trusted. Anything else signed by a revoked key fails.

### 3.2 Key custody
- `KeyProvider` interface: `generate`, `sign`.
  - `LocalKeyProvider` (development and small deployments): Ed25519 seeds encrypted with AES-256-GCM under `KEY_ENCRYPTION_KEY`, with the kid as AAD. Directory mode 0700, files 0600. Integrity-checked on load.
  - `MemoryKeyProvider`: tests and demo only. Refused when `ORBES_ENV=production`.
  - A KMS/HSM provider implements the same two methods. The private key never leaves the KMS.
- Private keys never appear in the database, logs, API responses, frontend bundles or generated codes.

### 3.3 Authentication and sessions
- **Passwords:** scrypt (N = 2¹⁵, r = 8, p = 1), 16-byte salt, 32-byte output, constant-time comparison, minimum 12 characters.
- **Admins:**
  - Lockout after 10 failures for 15 minutes.
  - Optional TOTP (RFC 6238); the secret is stored with AES-256-GCM.
  - Roles: ADMIN > OPERATOR > AUDITOR, where AUDITOR is read-only.
- **Sessions:**
  - The token is 32 random bytes in an httpOnly, SameSite=Strict cookie, Secure in production.
  - The database stores only the token's SHA-256 hash.
  - The session id rotates on login. Session lifetime is bounded.
  - Each session has its own CSRF token.

### 3.4 Request integrity
- **Input validation:** strict zod schemas (unknown keys rejected), a 16 KB body limit, and length bounds on every string. The code input is base64url, at most 200 characters, and exactly 79 bytes once decoded.
- **CSRF:** every cookie-authenticated mutation requires `x-csrf-token` equal to the session's token. The `Origin` must match the configured public origin (or `Sec-Fetch-Site: same-origin`).
- **Rate limits:** per IP and route group, covering verify, authentication, admin, claim attempts per product and transfer acceptance.
- **Replay:** registration tokens and transfer codes are random, stored hashed, single-use and time-limited, and consumed transactionally.
- **SQL:** all queries go through Kysely's parameterised builder. Raw SQL is limited to migrations and static statements.

### 3.5 Response hygiene
- **Public responses:** never contain risk scores, thresholds, internal statuses, owner identities, retailer data, email addresses or stack traces.
- **Errors:** a stable `{ error: { code, message } }` shape.
- **Security headers:**
  - CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  - `Permissions-Policy: camera=(self)`
  - `Referrer-Policy: no-referrer`
  - HSTS in production
  - `X-Powered-By` removed

### 3.6 Privacy
- Device identifiers are random cookies. Only `HMAC(pepper, id)` is stored.
- IP addresses are never stored. Only `HMAC(pepper, ip)` is kept, for rate limiting and diversity counting.
- Geography is coarse: a country, plus lat/lon rounded to 0.1° when the trusted edge provides it.
- Codes contain no personal data.

### 3.7 Audit and integrity monitoring
- `audit_logs` is append-only: a trigger rejects UPDATE and DELETE.
- Each entry stores `prev_hash` and `hash = SHA-256(prev_hash ‖ canonical JSON(entry))`.
- `GET /api/admin/audit/verify` recomputes the chain and reports the first inconsistent entry.
- Audited actions include product issuance, code reissue and revocation, lifecycle transitions, ownership changes, warranty actions, key generation, rotation, retirement and revocation, category creation, anomaly status changes, and admin logins.

### 3.8 Anomaly detection
- The rules are pure functions over scan history. Thresholds are configuration and are never exposed.
- The system never revokes automatically. A human reviews anomalies.
- A logged-in current owner keeps `AUTHENTIC_OWNERSHIP_VERIFIED`, with an `UNUSUAL_ACTIVITY` notice. This limits the damage of anomaly poisoning.

## 4. Configuration hardening (production)

`loadConfig` refuses to start in production when any of these hold:
- the database is PGlite;
- the key provider is `memory`;
- `COOKIE_SECRET` or `IP_HASH_PEPPER` is shorter than 32 characters or still the development default;
- `PUBLIC_ORIGIN` is not `https:`;
- the local key provider has no `KEY_ENCRYPTION_KEY`.

## 5. Operational security checklist

- [ ] Signing keys in a KMS/HSM (or LocalKeyProvider on a dedicated host with encrypted disk).
- [ ] `KEY_ENCRYPTION_KEY`, `COOKIE_SECRET` and `IP_HASH_PEPPER` stored in a secret manager and rotated on staff changes.
- [ ] TLS everywhere. HSTS preload once the domain is stable.
- [ ] Database: least-privilege app role, TLS, encrypted backups, point-in-time recovery.
- [ ] Periodic `audit/verify`, with the chain head exported to WORM storage.
- [ ] Alerting on CRITICAL anomalies (`VALID_SIGNATURE_UNREGISTERED`, `CODE_MISMATCH`), which indicate key compromise.
- [ ] Admin accounts with TOTP. AUDITOR role for analysts.
- [ ] Key rotation at least yearly. A revocation drill documented and rehearsed.
- [ ] `npm audit` and dependency updates in CI.
