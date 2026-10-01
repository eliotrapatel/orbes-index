# ORBES GENOME CODE™ — Future Secure Hardware

Status: design for future work. **No hardware security is implemented today.** This document explains how secure hardware can be added later without redesigning the system.

## 1. Why hardware

An ORBES CODE is a printed or engraved pattern. A copy of it is just as valid as the original (see [THREAT-MODEL](THREAT-MODEL.md), threats A, B and J). Cryptography proves *who issued the data*. Only a secret held inside the physical object can prove that *this object* is the one ORBES made.

Secure hardware closes that gap with a **challenge–response** protocol. The verifier sends a fresh random challenge. A chip embedded in the product signs it with a private key that cannot be extracted. A copy of the printed code cannot answer a fresh challenge.

## 2. The abstraction (implemented)

Code: `genome/src/server/authenticators/`.

```ts
type AuthenticatorKind = 'PRINTED_CODE' | 'SECURE_NFC' | 'SECURE_ELEMENT' | 'TAMPER_EVIDENT';

interface PhysicalAuthenticator {
  readonly kind: AuthenticatorKind;
  readonly implemented: boolean;
  evaluate(evidence: unknown, ctx: { product; code }): Promise<{
    kind: AuthenticatorKind;
    status: 'PASS' | 'FAIL' | 'NOT_PROVIDED' | 'UNSUPPORTED';
    detail?: string;
  }>;
}
```

| Authenticator | Status | Proves |
|---|---|---|
| `PrintedCodeAuthenticator` | **Implemented** | The scanned code is signed by ORBES and registered (signature + registry + lifecycle). |
| `SECURE_NFC` — placeholder `UnimplementedAuthenticator('SECURE_NFC')`; a future `SecureNFCAuthenticator` class replaces it | Placeholder only → `UNSUPPORTED` | The physical tag holds the private key bound to this product. |
| `SECURE_ELEMENT` — placeholder `UnimplementedAuthenticator('SECURE_ELEMENT')`; a future `SecureElementAuthenticator` replaces it | Placeholder only → `UNSUPPORTED` | Same, for a secure element connected through a companion device. |
| `TAMPER_EVIDENT` — placeholder `UnimplementedAuthenticator('TAMPER_EVIDENT')`; a future `TamperEvidentAuthenticator` replaces it | Placeholder only → `UNSUPPORTED` | A tamper-evident seal or label is intact (e.g. an optical/void label, read by a dedicated reader). |

### Authentication policy

Each product carries an `auth_policy`, for example:

- `PRINTED_CODE`: the default for every product today.
- `PRINTED_CODE+SECURE_NFC`: intended for high-value pieces.

During verification, the `AuthenticatorRegistry` evaluates the policy:

- Every factor the policy requires either passes, or the result's **assurance** is lowered. The public outcome then carries `assurance: 'CODE_ONLY'` and `hardwareProofRequired: true`. The scanner shows that hardware verification is required for full assurance.
- An authenticator that is not implemented returns `UNSUPPORTED`, never `PASS`. The system cannot "fake" a hardware pass.

Assurance levels returned by the API:

| Assurance | Meaning |
|---|---|
| `CODE` | The policy needs only the printed code, and it passed. |
| `CODE_ONLY` | The policy needs hardware evidence that was not provided or is not yet supported. The code itself passed. |
| `CODE_AND_HARDWARE` | (future) Every required factor passed, hardware included. |

## 3. Target design: Secure NFC (NTAG 424 DNA class)

Recommended candidate: NFC Forum Type 4 tags with AES-128 SUN/SDM (e.g. NXP NTAG 424 DNA), or tags offering asymmetric (ECC) signatures. Both kinds can be read by iOS (Core NFC) and Android (Web NFC in Chrome on Android, or the native SDK).

### Binding at issuance

1. When the product is issued, the tag is personalised. Either:
   - a per-tag AES key (diversified from a master key in the HSM), or
   - an on-tag ECC key pair, whose public key is registered.
2. The tag UID and key reference are stored in a future `hardware_authenticators` table. It references `products.id` and is versioned like codes.
3. The ORBES CODE is unchanged. A future CODE version could add a "hardware present" flag to the signed payload, so that removing or swapping the tag can be detected.

### Verification

```
scanner ──(1) GET /api/v1/hardware/challenge?product=… ──► server: random 16-byte challenge, 60 s TTL, single use
scanner ──(2) NFC: tag computes SUN MAC / ECDSA signature over challenge (+ tag counter)
scanner ──(3) POST /api/v1/verify { code, hardware: { kind: 'SECURE_NFC', response } }
server  ──(4) SecureNFCAuthenticator.evaluate() (future class): check MAC/signature, monotonic counter, UID binding, challenge freshness
```

The counter and freshness checks defeat replay. The non-extractable key defeats cloning.

## 4. Mobile-web constraints

| Platform | Printed code | NFC |
|---|---|---|
| Android Chrome | ✓ (getUserMedia) | ✓ Web NFC (NDEF only; SUN/SDM works through an NDEF URL with an encrypted parameter) |
| iOS Safari | ✓ | ✗ (Core NFC requires an app or an App Clip) |

Because of this, `SECURE_NFC` on iOS will need an App Clip or a native app. The policy model handles this: an iOS web scan still shows **AUTHENTIC** with `CODE_ONLY` assurance.

## 5. What must not change when hardware arrives

- Product identity, Genome and printed codes of existing products, which stay verifiable forever.
- Verification states. Hardware only raises assurance; it never redefines states.
- The `PhysicalAuthenticator` interface. New kinds are added, existing ones are not changed.

## 6. Open questions

- Per-tag cost and the effect on jewellery form factors (ring shanks, pendant bails).
- Personalisation logistics and dual control over the HSM master keys.
- Privacy: tags must not allow tracking. Use SUN/SDM with encrypted UIDs, so no static identifier is broadcast.
