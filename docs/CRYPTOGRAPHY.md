# ORBES GENOME CODE™ — Cryptographic Specification

Status: v1.0 (normative for CODE-01). Implementation:

- `genome/src/core/payload.ts`
- `genome/src/core/identity.ts`
- `genome/src/core/verify/ed25519.ts`
- `genome/src/server/crypto/`
- `genome/src/server/keys/`

**Ground rules.** No cryptographic primitive or protocol was invented. Everything below uses published standards: Ed25519 (RFC 8032), SHA-256 (FIPS 180-4), HMAC (RFC 2104), HKDF (RFC 5869), AES-256-GCM (SP 800-38D), scrypt (RFC 7914) and TOTP (RFC 6238). Security never depends on keeping the format or the algorithms secret.

---

## 1. Objects

| Object | Secret? | Where |
|---|---|---|
| Product identity `O26-J-00184` | Public | Code payload, database |
| Genome (GENOME-01) | Public, derived from identity | Code (drawn), database |
| Canonical payload (13 bytes) | Public | Code, database |
| Ed25519 signature (64 bytes) | Public | Code, database |
| Ed25519 private key (seed) | **Secret** | KMS/HSM or encrypted local key store, never in the DB, logs or frontend |
| Ed25519 public key (32 bytes) | Public | `cryptographic_keys`, `/.well-known/orbes-keys.json` |

## 2. Canonical product identity

The canonical text form is `O{YY}-{C}-{NNNNN}`:

- `YY`: production year − 2000 (00–99);
- `C`: one uppercase category letter, resolved through the category registry to an immutable index 1–31;
- `NNNNN`: the serial, 1–999 999, zero-padded to at least 5 digits. A 6-digit serial never starts with 0.

Exactly one text spelling is accepted per identity.

It is packed into 32 bits (big-endian on the wire):

```
bits 31..25  year − 2000   (7 bits)
bits 24..20  category index (5 bits, 0 reserved)
bits 19..0   serial         (20 bits)
```

Example: `O26-J-00184` with J = 1 packs to `0x341000B8`.

## 3. Canonical payload (CODE-01)

13 bytes, fixed layout:

| Offset | Size | Field | Rules |
|---:|---:|---|---|
| 0 | 1 | `codeVersion << 4 \| genomeVersion` | codeVersion = 1; genomeVersion 1…15 (0 reserved) |
| 1 | 1 | `keyId` | 1…255 (0 reserved); selects the verification key |
| 2 | 4 | packed identity | see §2 |
| 6 | 1 | `issue` | 1…255; incremented on each re-issue of a code for the same product |
| 7 | 2 | `issuedDay` | big-endian u16, days since 2024-01-01 UTC |
| 9 | 4 | `nonce` | 4 random bytes chosen at issuance (CSPRNG) |

**Canonicality.** Every field has exactly one valid encoding, and decoders reject anything else:

- a wrong length;
- a version other than 1;
- a reserved value;
- an identity out of range.

Two different byte strings never decode to the same payload, so the bytes that are signed are the canonical representation.

**Genome.** The genome ID equals the product identity, and the genome pattern is a pure function of the identity and the genome version (see [ORBES-GENOME-SPEC](ORBES-GENOME-SPEC.md)). Both inputs are signed, so the genome is cryptographically bound without spending bytes on it.

### 3.1 Why not CBOR or JSON (decision record)

We measured the same fields in alternative encodings:

| Encoding | Bytes | Framed data with signature + CRC | Effect on the code |
|---|---:|---:|---|
| **Fixed binary (chosen)** | **13** | **79** | RS(164,79), 1 344 cells, 50 u |
| Deterministic CBOR, integer keys, packed identity | 25 | 91 | ≈ 189-byte codeword, +15 % cells |
| Deterministic CBOR, integer keys, text product ID | 32 | 98 | ≈ 203-byte codeword, +24 % cells |
| Deterministic CBOR, short string keys (incl. genome_id) | 64 | 130 | > 255 bytes: two RS blocks, +65 % cells |
| JSON | 140 | 206 | impractical for small jewellery |

Every byte costs print area, which matters for jewellery (target ≤ 20 mm). Deterministic CBOR (RFC 8949 §4.2.1) solves canonicality but adds type headers and keys. A versioned fixed layout is canonical by construction and 2–2.5× smaller.

CBOR remains the recommended encoding for *server-side* signed artifacts that are not printed, such as future verification receipts.

## 4. Signatures

### 4.1 Algorithm
**Ed25519** (RFC 8032, PureEdDSA over edwards25519 with SHA-512). Signatures are 64 bytes and public keys 32 bytes. Signing is deterministic, so no per-signature randomness can leak the key.

### 4.2 Signing message (domain separation)

```
message = UTF-8("ORBES-CODE/v1") ‖ 0x00 ‖ payload(13 bytes)
signature = Ed25519.Sign(privateKey, message)
```

The domain string binds the signature to this exact use and format version. A signature made for any other ORBES purpose (receipts, CODE-02, …) can never be replayed as a CODE-01 signature, and the reverse holds too. The implementation refuses to build a signing message for anything other than a 13-byte payload.

### 4.3 Framing in the code

```
framed = payload ‖ signature ‖ CRC-16/CCITT-FALSE(payload ‖ signature)   = 79 bytes
```

The CRC is **not** a security control. Its job is to catch Reed-Solomon miscorrection before the data reaches the server. It is the last of three guards: the reference decoder caps Reed-Solomon erasures at 70 so that parity still checks every correction, and the verify app confirms heavily corrected reads with a second frame (ORBES-CODE-SPEC §11). A miscorrection that slipped through would reach the server as a well-formed code with a wrong signature, that is, a false INVALID SIGNATURE on a genuine piece.

### 4.4 Verification (server-side, authoritative)

The order is normative ([PLATFORM-CONTRACTS](../genome/PLATFORM-CONTRACTS.md) §2.4): parse → key lookup → signature → revoked-key trust → genome-version support → registry → genome cross-check → statuses → anomalies → ownership → authenticators.

1. base64url-decode the submitted code (≤ 200 characters). It must be exactly 79 bytes. Check the CRC-16. Decode the payload strictly (§3: code version 1, reserved values such as genome version 0 refused). Any failure gives `MALFORMED_CODE`.
2. Resolve `keyId` in the key registry. An unknown key gives `INVALID_SIGNATURE`.
3. Verify Ed25519 **strictly** (a failure gives `INVALID_SIGNATURE`). The signature covers every payload field, so it is checked **before** the genome version is interpreted: a code whose genome version was edited is a forgery (`INVALID_SIGNATURE`), not an unreadable code.
   - **Weak keys:** the public key must be a canonical encoding of a point that is not of small order. **This is checked explicitly before calling OpenSSL.** OpenSSL 3.5, which backs `node:crypto`, accepts the identity point as a public key, and with it the signature `R = identity, S = 0` verifies for *every* message. The rule is one exported function, `isStrictEd25519PublicKey` in `src/server/crypto/ed25519-node.ts`: `verifyEd25519Node` applies it before OpenSSL, and `KeyService` applies the same function before it registers any key, so a key that could never verify can never be registered either.
   - **Malleability:** `S` must be canonical (`S < L`); the `S + L` variant is rejected.
   - **Isomorphic verifier:** the `@noble/curves` verifier runs with `zip215: false`, i.e. strict RFC 8032 rules rather than the permissive ZIP-215 rules.
4. **Revoked-key trust**, before any registry outcome: a `REVOKED` key vouches only for a code whose registry record (product + issue) was created before the key's cut-off (`compromised_at`, else `revoked_at`). Anything else it signed — a later code, an identity that was never registered, an issue that does not exist — gives `INVALID_SIGNATURE` (reason `KEY_REVOKED`), so a stolen key cannot even produce an `UNKNOWN` answer after revocation.
5. **Genome-version support:** a validly signed, trusted code whose genome version this server does not know gives `UNKNOWN` (reason `UNSUPPORTED_GENOME_VERSION`) and a server warning: the server is outdated, not the code.
6. Registry checks (product, code issue and payload hash), genome cross-check, revocations and lifecycle. These are described in [SECURITY-MODEL](SECURITY-MODEL.md) and implemented in `services/verification.ts`.

**Malformed input.** Wrong lengths, invalid points, non-canonical encodings and non-canonical `S` all make verification return `false`. None of them throws.

**Signer check.** Every signature is verified with the registered public key immediately after signing at issuance (verify-after-sign).

### 4.5 Test vectors
- RFC 8032 §7.1 tests 1–3 pass for both the `node:crypto` signer and both verifiers.
- The ORBES sample vector, with a public sample key that is never valid in production, is in `docs/vectors/code01-sample.json` and [ORBES-CODE-SPEC §13](ORBES-CODE-SPEC.md#13-test-vectors).

## 5. Key management

### 5.1 Key registry
`cryptographic_keys(key_id 1…255, kid, algorithm='Ed25519', public_key, status, provider, provider_ref, timestamps…)`.

| Status | Signs? | Verifies? |
|---|---|---|
| `ACTIVE` | yes (exactly one key, DB-enforced) | yes |
| `RETIRED` | no | yes. Historical products stay verifiable forever. |
| `REVOKED` | no | Only codes whose registry record predates `compromised_at` (or `revoked_at`). Anything else it signed, registered identity or not, is `INVALID_SIGNATURE` (checked right after the signature, before the registry, §4.4). |

**Publication.** `GET /api/v1/keys` and `/.well-known/orbes-keys.json` publish every key with `status`, `activatedAt`, `retiredAt`, `revokedAt` and `compromisedAt` (never the revocation reason), so offline verifiers know the cut-off. Offline, only the signed `issuedDay` is available, and a stolen key can sign any date: a code dated after the cut-off day can be refused offline, anything else under a revoked key needs the online check ([API §19.3](API.md#193-offline-signature-verification)).

**Key ids** are allocated as the lowest unused value and are never reused: registry rows are never deleted (a database trigger rejects `DELETE` and `TRUNCATE` on `cryptographic_keys`, see [DATABASE §5.7](DATABASE.md#57-cryptographic_keys)), so an id once used stays bound to its public key. Every code carries its `keyId`, so verification always picks the key that signed it, whatever key is active today.

### 5.2 Rotation
Rotation is `POST /api/admin/keys/rotate` (ADMIN) or `npm run keys:generate`:

1. A new key pair is generated by the provider.
2. It is registered as ACTIVE, and the previous ACTIVE key becomes RETIRED.

Everything happens in a single transaction and is audited. New codes are signed with the new key. Existing codes are unaffected.

**Recommended cadence:** yearly, after any staff change involving key custodians, and immediately on suspicion of compromise.

### 5.3 Compromise response
1. `POST /api/admin/keys/:keyId/revoke { reason, compromisedAt }`.
2. Rotate.
3. Investigate `VALID_SIGNATURE_UNREGISTERED` and `CODE_MISMATCH` anomalies, which are the signature of minted forgeries.
4. Optionally re-issue codes for high-value products signed by the compromised key.

### 5.4 Key custody — the `KeyProvider` abstraction

```ts
interface KeyProvider {
  readonly name: string;
  generate(kid: string): Promise<{ publicKey: Uint8Array; providerRef: string }>;
  sign(providerRef: string, message: Uint8Array): Promise<Uint8Array>;
}
```

The rest of the system only ever sees a `providerRef` and public keys.

| Provider | Use | Custody |
|---|---|---|
| `LocalKeyProvider` | Development, small deployments | Ed25519 seed encrypted with **AES-256-GCM** under `KEY_ENCRYPTION_KEY` (32 bytes) with a random 96-bit IV, AAD = kid. One file per key in `KEY_DIR` (dir 0700, files 0600). Tampered files are refused (GCM tag). |
| `MemoryKeyProvider` | Tests, demo | In-process only. Refused when `ORBES_ENV=production`. |
| KMS / HSM provider (to implement per vendor) | Production | Non-exportable Ed25519 key inside the KMS/HSM. `sign` is an authenticated API call; the private key never enters the process. Check the vendor's Ed25519 (EdDSA) support at integration time. |

## 6. Other cryptographic uses

| Use | Construction |
|---|---|
| Passwords, claim codes | scrypt N = 2¹⁵, r = 8, p = 1, 16-byte salt, 32-byte output; constant-time compare. Encoded as `scrypt$15$8$1$salt$hash`. |
| Sessions | 32-byte CSPRNG token in a cookie; SHA-256(token) in the DB. A new token on login and on the admin step-up to MFA (TOTP enrolment). |
| Registration tokens | CSPRNG (32 bytes), stored hashed (SHA-256 with domain separation), single use, 15-minute TTL. |
| Transfer codes | CSPRNG, 12 Crockford base32 characters (60 bits), single use, 7-day TTL. Stored as HMAC-SHA-256 of the canonical code under a key derived with HKDF-SHA-256 from `COOKIE_SECRET` (salt `ORBES`, info `orbes/transfer-code/v1`): deterministic for the lookup, but a leaked table cannot be brute-forced without the server secret. |
| TOTP (admins) | RFC 6238 (HMAC-SHA-1, 30 s, 6 digits, ±1 step, replay-protected). The secret is sealed with AES-256-GCM under a key derived with HKDF-SHA-256. |
| IP / device pseudonyms | HMAC-SHA-256(`IP_HASH_PEPPER`, value). Raw values are never stored. |
| Audit log | Hash chain: `hash_n = SHA-256(hash_{n−1} ‖ canonicalJSON(entry_n))`, genesis = 32 zero bytes. |
| Genome permutation | 8-round Feistel network with a SHA-256 round function. **Not a security mechanism.** It is a public, keyless bijection used only to spread visual identities (see [ORBES-GENOME-SPEC](ORBES-GENOME-SPEC.md)). |

## 7. What the cryptography does NOT prove

The signature proves that **ORBES issued this identity and this code**. It does not prove that the object carrying the code is the one ORBES made, because a printed code can be copied. See [THREAT-MODEL](THREAT-MODEL.md) and [FUTURE-HARDWARE](FUTURE-HARDWARE.md).

## 8. Future evolution
- **CODE-02** may add a hardware-binding flag to the signed payload, or a different signature scheme. The domain string becomes `ORBES-CODE/v2`.
- **Post-quantum:** when standardised post-quantum signatures fit the print budget (today ML-DSA signatures are ≥ 2.4 KB, which is impractical in print), a future version can switch schemes. Old codes keep verifying with their recorded keys.
