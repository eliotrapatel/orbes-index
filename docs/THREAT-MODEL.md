# ORBES GENOME CODE™ — Threat Model

Status: v0.1 · Scope: ORBES CODE-01 / GENOME-01, the verification service, the admin console and the key custody chain.

This document explains what each part of the system protects and what it cannot protect. It hides no limitations. Two rules shape everything below:

1. **A static printed code can be copied.** Scanning an ORBES CODE proves that ORBES issued and signed that code. On its own it never proves that the physical object in your hand is the original.
2. **Security never depends on secrecy of the algorithm.** We assume attackers know the full source code, the code format, the Genome permutation, the public keys, every network request and every public API.

---

## 1. Assets

| Asset | Why it matters |
|---|---|
| Ed25519 signing keys | Whoever holds a private key can issue codes that verify as ORBES. |
| Product registry (products, genomes, codes) | It is the ground truth that turns a valid signature into a *registered product*. |
| Lifecycle, ownership and warranty records | They decide the customer-facing state and the transfer of ownership. |
| Scan history | It is the input to clone and duplication detection. It also holds personal data (pseudonymous) that must be minimised. |
| Admin accounts | They can issue, revoke and reinstate products and rotate keys. |
| Customer accounts | They hold ownership rights over products. |
| Brand trust in the verification UX | A verification page shown by the wrong party, or one that overstates, damages trust. |

## 2. Adversaries

- **Counterfeiter (casual):** copies a code from a photo, a listing or a boutique display.
- **Counterfeiter (industrial):** mass-produces goods and has access to genuine products, printing equipment and photography.
- **Grey-market reseller:** tries to make stolen or diverted goods look clean.
- **Online attacker:** scripts the public API, attempts brute force and replays requests.
- **Phisher:** operates a look-alike verification website.
- **Insider:** an operator with admin access, or a contractor with infrastructure access.
- **Infrastructure attacker:** has compromised the database, a backup or a host.

## 3. Trust boundaries

```
 [ physical artifact ] --camera--> [ customer browser ] --TLS--> [ verification service ] --> [ PostgreSQL ]
                                         ^ untrusted                     |  trusted            ^ trusted (integrity monitored)
                                                                           +--> [ KeyProvider: local file | KMS | HSM ]
 [ admin browser ] --TLS + session + CSRF + role + (TOTP)--> [ admin API ]
```

Nothing the browser computes is trusted. The decoder runs client-side only for speed. The server re-parses every byte, re-checks the CRC, verifies the signature, consults the registry and makes every decision.

---

## 4. Threats

### THREAT A — Screenshot of a legitimate ORBES Code

| | |
|---|---|
| **Attack** | Photograph or screenshot a genuine code, for example from a resale listing, and present it, printed or on a screen, as proof of authenticity. |
| **Current protection** | (1) The verification state never claims physical authenticity. It reports a signed, registered identity and its lifecycle. (2) Every scan is recorded with device, coarse location and time, and the anomaly engine scores impossible travel, velocity, device diversity and geographic dispersion. (3) Ownership: when the product is registered, non-owners see **AUTHENTIC — REGISTERED** ("this identity belongs to a registered owner"). A buyer can therefore ask the seller to perform an in-app transfer, which only the real account holder can do. (4) First registration needs a fresh single-use scan token (15 min). When ORBES prints a claim code under the scratch panel of the certificate card, it also needs that code. A screenshot alone therefore cannot claim an unregistered product. |
| **Residual risk** | **High for unregistered products with no claim code.** A screenshot is indistinguishable from the original at the data level. A single re-use of a screenshot elsewhere may never trigger an anomaly. |
| **Future mitigation** | Secure NFC / secure element challenge-response (see [FUTURE-HARDWARE](FUTURE-HARDWARE.md)). Screen-capture detection heuristics (moiré, refresh banding). Customer education: "ask for a transfer". |

### THREAT B — Copying the printed code onto counterfeit products

| | |
|---|---|
| **Attack** | Reprint a genuine code on counterfeit goods. |
| **Current protection** | The same detection as in A, aggregated over many products. Each physical copy produces scans from distinct devices and places. `DEVICE_DIVERSITY`, `GEO_DISPERSION` and `IMPOSSIBLE_TRAVEL` raise the risk score, and the customer then sees **UNUSUAL ACTIVITY DETECTED**. Admins can revoke the code and re-issue a new one (issue + 1) for the genuine owner's product. The genuine owner, recognised through their account, keeps **OWNERSHIP VERIFIED**. |
| **Residual risk** | **Medium.** Low-volume copying (a handful of pieces) can stay below thresholds. Detection is statistical and always after the fact. |
| **Future mitigation** | Hardware binding. Physically unclonable features (micro-engraving, tamper-evident substrates) referenced in a future CODE version. Retailer-side activation that binds code and sale. |

### THREAT C — Altering the product ID

| | |
|---|---|
| **Attack** | Edit the identity bits in a genuine code, for example to impersonate a more valuable model, or forge a code for an arbitrary ID. |
| **Current protection** | The Ed25519 signature covers the whole canonical payload (`ORBES-CODE/v1 ‖ 0x00 ‖ payload`): version, key id, identity, issue, date and nonce. Any modified bit fails verification and gives **INVALID SIGNATURE**. The Genome is derived from the signed identity, so a printed Genome that no longer matches gives **UNUSUAL ACTIVITY** (`GENOME_MISMATCH`). |
| **Residual risk** | **Negligible.** It would require breaking Ed25519 (≈ 2¹²⁸ work). |
| **Future mitigation** | None needed. Migrate to a post-quantum signature in a future CODE version when standardised options fit the print budget. |

### THREAT D — Creating random fake codes

| | |
|---|---|
| **Attack** | Generate syntactically valid ORBES CODEs with random content, or with a well-formed payload and a random signature. |
| **Current protection** | Signature verification with a key looked up by `key_id`. Unknown key ids give **INVALID SIGNATURE**. Random data passing the RS/CRC framing still fails the signature. The decoder may happily read a forged artifact: correctly decoding a forgery is expected, and rejection happens at verification. |
| **Residual risk** | **Negligible.** |
| **Future mitigation** | — |

### THREAT E — Replay attacks

| | |
|---|---|
| **Attack** | (1) Replay a captured verification request. (2) Replay a registration token or transfer code. (3) Replay many scans of someone else's product to make it look suspicious ("anomaly poisoning"). |
| **Current protection** | (1) Verification is an idempotent read. Replaying it reveals nothing new and is rate-limited per IP and route. (2) Registration tokens and transfer codes are random, stored hashed, single-use and short-lived, and are consumed in the same transaction as the ownership change. (3) The anomaly engine never revokes automatically. A logged-in owner always sees **OWNERSHIP VERIFIED** (with a notice), not "suspicious". Anomalies are reviewed by people. Device and IP data are pseudonymous HMACs, which still lets rate limits and diversity counts tell sources apart. |
| **Residual risk** | **Low–medium.** A determined attacker can make an unregistered product show **UNUSUAL ACTIVITY** to non-owners. That is a nuisance attack, not an authenticity break. |
| **Future mitigation** | Proof-of-possession for scans (hardware challenge). Bot detection on the verify endpoint. Weighting scans by device reputation. |

### THREAT F — Database compromise

| | |
|---|---|
| **Attack** | Read or modify the database: alter statuses, add fake products, change ownership, erase scan history. |
| **Current protection** | No private keys in the database (only public keys and provider references). IP addresses and device ids are stored as HMACs with a pepper held outside the DB. The audit log is **hash-chained** and append-only (a trigger rejects UPDATE/DELETE), so tampering becomes detectable with `verifyChain()`. `product_status_history` is append-only too, and `genomes` and `cryptographic_keys` rows cannot be deleted (no key id can be reused for a different key); these triggers stop application bugs and a compromised application role, not a database owner. Codes remain *self-verifying*: an attacker who inserts a fake product row still cannot produce a valid signature for it. Passwords, claim codes and TOTP secrets are scrypt-hashed or AES-GCM encrypted. |
| **Residual risk** | **Medium.** A write-capable attacker can change lifecycle and ownership state (for example un-revoke a product). The hash chain detects but does not prevent this, and an attacker with full DB control could rewrite the whole chain. |
| **Future mitigation** | Periodically anchor the audit-chain head outside the DB (signed by a separate key, published or stored in WORM storage). Postgres row-level security and least-privilege roles (app vs migrations vs read-only analytics). Point-in-time recovery. Integrity monitoring. |

### THREAT G — Private key compromise

| | |
|---|---|
| **Attack** | Steal a signing key and mint codes that verify as ORBES. |
| **Current protection** | The `KeyProvider` abstraction lets production keys live in a KMS or HSM, where they are non-exportable and signing goes through IAM. The local provider encrypts keys at rest with AES-256-GCM, with file mode 0600 and a dedicated encryption key from the environment. Every code names its `key_id`. Keys can be **revoked with a compromise timestamp**: codes whose registry record predates the compromise remain valid, and anything else signed by that key gives **INVALID SIGNATURE**. Even before revocation, forged codes for *existing* products fail the registry nonce/payload-hash match (`CODE_MISMATCH`, CRITICAL, shown as **UNUSUAL ACTIVITY**), and forged codes for *unregistered* identities give **UNKNOWN** plus a CRITICAL `VALID_SIGNATURE_UNREGISTERED` anomaly. That anomaly is an early compromise alarm. Rotation is a single admin action, and verify-after-sign guards against faulty signer output. |
| **Residual risk** | **Medium until detection.** Between theft and revocation an attacker can mint codes for unregistered identities. Those show UNKNOWN, not AUTHENTIC, so customer-facing damage is limited. |
| **Future mitigation** | HSM with dual control. Short-lived signing keys per production batch. Transparency log of issued codes. Offline root key that certifies operational keys. |

### THREAT H — Malicious frontend modification

| | |
|---|---|
| **Attack** | Tamper with the verification web app (XSS, a malicious extension, a compromised CDN) or modify the client to report AUTHENTIC. |
| **Current protection** | The client holds no secrets. The server decides every state. Strict CSP (`script-src 'self'`, no inline script or style, `frame-ancestors 'none'`). Assets are self-hosted with no third-party scripts. A modified client can only lie *to its own user*. It cannot make the server record or issue anything it would not otherwise accept. |
| **Residual risk** | **Low–medium.** A user on a compromised device can be shown anything. |
| **Future mitigation** | Subresource integrity for any future external asset. A signed verification receipt (server-signed result with a short code) that a second device or ORBES client services can check. |

### THREAT I — Fake ORBES verification website

| | |
|---|---|
| **Attack** | A counterfeiter prints a QR code or link that leads to a look-alike site which always says AUTHENTIC. |
| **Current protection** | The ORBES CODE is not a URL and does not open a website by itself. The customer must go to the official ORBES domain, so packaging and the website consistently say: "verify only at theorbes.com/verify". The public key set is published at `/.well-known/orbes-keys.json`, so third parties (resellers, insurers) can verify signatures independently. Account-based ownership means a fake site cannot show the customer's own registered products. |
| **Residual risk** | **Medium.** Phishing cannot be eliminated technically. |
| **Future mitigation** | A native app with pinned keys. Verification receipts. Domain monitoring and takedown. Customer education. |

### THREAT J — Mass-produced counterfeits using one legitimate identity

| | |
|---|---|
| **Attack** | Buy one genuine product and reprint its code on thousands of fakes. |
| **Current protection** | This is the strongest case for statistical detection. Hundreds of devices across many countries quickly exceed the `DEVICE_DIVERSITY`, `GEO_DISPERSION`, `SCAN_VELOCITY` and `IMPOSSIBLE_TRAVEL` limits, and the identity is flagged for non-owners. ORBES can revoke the code (every copy then reads **REVOKED**) and re-issue a new code to the genuine owner. Re-issue increments the issue number and creates a fresh nonce. |
| **Residual risk** | **Medium.** Detection lags the first sales. Customers who never scan are not protected. |
| **Future mitigation** | Hardware binding for high-value lines (policy `PRINTED_CODE+SECURE_NFC`). Retail activation that binds sale to code. Marketplace monitoring using the public verification API. |

---

## 5. Additional threats considered

| Threat | Protection | Residual |
|---|---|---|
| **K. Brute force of claim codes or transfer codes** | 12 Crockford-base32 characters (60 bits). Claim codes are stored as scrypt hashes; transfer codes as HMAC-SHA-256 under a server key derived from `COOKIE_SECRET`, so a leaked database cannot be brute-forced offline. Per-product attempt limits (5/hour). Route rate limits. | Negligible. |
| **L. Admin account takeover / insider abuse** | scrypt passwords, lockout, TOTP required in production (`ADMIN_REQUIRE_MFA`), a new session token on the MFA step-up, `__Host-` cookies in production, roles (AUDITOR read-only), CSRF and SameSite=Strict cookies, every mutation audited with a hash chain. Key revocation, reinstatement, retirement and TOTP resets are ADMIN-only. | Medium for insiders with ADMIN role. Mitigate with dual control (future). First TOTP enrolment in the console is trust on first use (enrol from the shell instead, SECURITY-MODEL §3.3); the lockout can be abused to keep a known admin out (accepted, SECURITY-MODEL §3.3). |
| **R. Credential stuffing against customer accounts** | Per-IP `auth` rate limit plus a per-account throttle (10 wrong passwords in 15 minutes) that answers exactly like a wrong password. scrypt slows every attempt. | Low. `EMAIL_TAKEN` on registration still reveals that an email has an account (accepted until an email channel exists). |
| **M. Malicious images against the decoder** (DoS or crash) | The decoder is memory-bounded, never throws (fuzz-tested) and runs in a Web Worker client-side. The server never decodes customer images. | Low. |
| **N. Supply-chain compromise of dependencies** | A small, well-known dependency set, a lockfile, and `npm audit` in CI. Core cryptography uses `node:crypto` (server) and audited noble libraries. | Medium (industry-wide). |
| **O. Privacy harm from scan tracking** | No raw IPs. HMAC device and IP identifiers. Coordinates rounded to about 10 km and only from trusted CDN headers. No personal data in codes. Public responses never reveal owner identity. | Low. Retention policy to be set with legal counsel. |
| **Q. False INVALID SIGNATURE on a genuine piece** (a worn or glared code miscorrected by Reed-Solomon into a CRC-valid but wrong word) | The decoder never erases more than 70 bytes, so at least 15 parity bytes still check every correction (0 miscorrections in 100 000 random words at 70, against 18 at 80), then CRC-16. The verify app submits a read whose correction load 2·errors + erasures exceeds 50 only after a second, independent frame decodes to identical data (ORBES-CODE-SPEC §11). | Very low. A wrong verdict on a genuine piece is answered by rescanning, and every result invites Client Services. |
| **P. Misleading claims** | Copy deck reviewed: no "real", "100% genuine" or "impossible to counterfeit" wording. States describe exactly what was verified. | Low. |

## 6. Security assumptions

1. Ed25519 (RFC 8032) and SHA-256 are secure. `node:crypto` and `@noble/curves` implement them correctly.
2. Production private keys live in a KMS/HSM or, for the local provider, on a host where only the service user can read the key directory and the encryption key.
3. TLS terminates at a trusted edge. When geo headers are used, they come from that trusted edge and only in the configured mode.
4. The server clock is accurate (NTP). Lifecycle and anomaly windows depend on it.
5. Database operators are trusted for availability. Integrity is monitored (audit chain), not guaranteed.
6. Customers verify on the official ORBES domain.
