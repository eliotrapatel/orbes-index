/**
 * Physical authenticators (contract §2.11).
 *
 * A static printed code proves that ORBES issued and signed an identity; it
 * cannot prove that the object in front of the camera is the original (a code
 * can be copied). Stronger, object-bound evidence (secure NFC, secure
 * element, tamper-evident seals) is future work. Those kinds are declared
 * here so products can already carry a policy that requires them, but they
 * are NOT implemented: the registry reports them UNSUPPORTED and the
 * verification result degrades to `CODE_ONLY` assurance with
 * `hardwareProofRequired`. Nothing here simulates hardware security.
 */

export const AUTHENTICATOR_KINDS = ['PRINTED_CODE', 'SECURE_NFC', 'SECURE_ELEMENT', 'TAMPER_EVIDENT'] as const;
export type AuthenticatorKind = (typeof AUTHENTICATOR_KINDS)[number];
/** Same list, under the name issuance uses for policy validation. */
export const AUTH_POLICY_KINDS = AUTHENTICATOR_KINDS;
export const DEFAULT_AUTH_POLICY = 'PRINTED_CODE';

export type AuthenticatorStatus = 'PASS' | 'FAIL' | 'NOT_PROVIDED' | 'UNSUPPORTED';
export type Assurance = 'CODE' | 'CODE_ONLY' | 'CODE_AND_HARDWARE';

export interface AuthenticatorResult {
  kind: AuthenticatorKind | string;
  status: AuthenticatorStatus;
  /** Internal, short and non-sensitive (stored on authentication_events, never public). */
  detail?: string;
}

/** What the verification service already established about the scanned code. */
export interface AuthenticatorChecks {
  /** Ed25519 signature valid under a trusted key. */
  signatureValid: boolean;
  /** Product and code found in the registry and the payload hash matches. */
  registered: boolean;
}

export interface AuthenticatorContext {
  product: { id: string; productId?: string; authPolicy?: string } | null;
  code: { id: string; status?: string } | null;
  checks?: AuthenticatorChecks;
}

export interface PhysicalAuthenticator {
  readonly kind: AuthenticatorKind;
  readonly implemented: boolean;
  evaluate(evidence: unknown, ctx: AuthenticatorContext): Promise<AuthenticatorResult>;
}

/** The printed ORBES CODE: passes when the signature and registry checks passed. */
export class PrintedCodeAuthenticator implements PhysicalAuthenticator {
  readonly kind = 'PRINTED_CODE' as const;
  readonly implemented = true;

  async evaluate(_evidence: unknown, ctx: AuthenticatorContext): Promise<AuthenticatorResult> {
    const c = ctx?.checks;
    if (!c) return { kind: this.kind, status: 'NOT_PROVIDED', detail: 'no verification checks supplied' };
    if (!c.signatureValid) return { kind: this.kind, status: 'FAIL', detail: 'signature' };
    if (!c.registered || !ctx.product || !ctx.code) return { kind: this.kind, status: 'FAIL', detail: 'registry' };
    return { kind: this.kind, status: 'PASS' };
  }
}

/**
 * Placeholder for a hardware authenticator that does not exist yet. It never
 * evaluates evidence: `implemented` is false, so the registry reports it
 * UNSUPPORTED without calling it.
 */
export class UnimplementedAuthenticator implements PhysicalAuthenticator {
  readonly implemented = false;
  constructor(readonly kind: Exclude<AuthenticatorKind, 'PRINTED_CODE'>) {}

  async evaluate(): Promise<AuthenticatorResult> {
    return { kind: this.kind, status: 'UNSUPPORTED', detail: 'not implemented' };
  }
}

export interface PolicyEvaluation {
  /** Normalised policy, e.g. 'PRINTED_CODE+SECURE_NFC'. */
  policy: string;
  results: AuthenticatorResult[];
  assurance: Assurance;
  /** The policy asks for hardware evidence that was not verified. */
  hardwareProofRequired: boolean;
  /** Every required authenticator passed. */
  satisfied: boolean;
}

/**
 * Parse a policy string ('PRINTED_CODE', 'PRINTED_CODE+SECURE_NFC', …) into
 * kinds. PRINTED_CODE is always part of a policy (the code is how the
 * product is identified at all). Unknown parts are kept so they are reported
 * UNSUPPORTED rather than silently dropped: an unknown requirement must
 * never upgrade assurance.
 */
export function parseAuthPolicy(policy: string | null | undefined): string[] {
  const raw = typeof policy === 'string' ? policy : '';
  const parts = raw
    .split('+')
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p.length > 0 && p.length <= 64);
  const out: string[] = ['PRINTED_CODE'];
  for (const p of parts) if (!out.includes(p)) out.push(p);
  return out;
}

export function isAuthenticatorKind(v: unknown): v is AuthenticatorKind {
  return typeof v === 'string' && (AUTHENTICATOR_KINDS as readonly string[]).includes(v);
}

export class AuthenticatorRegistry {
  private readonly byKind = new Map<string, PhysicalAuthenticator>();

  /** A registry with the printed-code authenticator and unimplemented placeholders for the hardware kinds. */
  static withDefaults(): AuthenticatorRegistry {
    const r = new AuthenticatorRegistry();
    r.register(new PrintedCodeAuthenticator());
    r.register(new UnimplementedAuthenticator('SECURE_NFC'));
    r.register(new UnimplementedAuthenticator('SECURE_ELEMENT'));
    r.register(new UnimplementedAuthenticator('TAMPER_EVIDENT'));
    return r;
  }

  register(a: PhysicalAuthenticator): this {
    if (!a || !isAuthenticatorKind(a.kind)) throw new TypeError('register: unknown authenticator kind');
    this.byKind.set(a.kind, a);
    return this;
  }

  get(kind: string): PhysicalAuthenticator | undefined {
    return this.byKind.get(kind);
  }

  /**
   * Evaluate a product's policy. `evidence` maps a kind to whatever the
   * client submitted for it (nothing today). An authenticator that throws
   * counts as FAIL: errors never raise assurance.
   */
  async evaluate(
    policy: string | null | undefined,
    evidence: Partial<Record<string, unknown>> | undefined,
    ctx: AuthenticatorContext,
  ): Promise<PolicyEvaluation> {
    const kinds = parseAuthPolicy(policy);
    const results: AuthenticatorResult[] = [];
    for (const kind of kinds) {
      const a = this.byKind.get(kind);
      if (!a || !a.implemented) {
        results.push({ kind, status: 'UNSUPPORTED', detail: a ? 'not implemented' : 'unknown authenticator' });
        continue;
      }
      try {
        const r = await a.evaluate(evidence?.[kind], ctx);
        results.push({ kind, status: isStatus(r?.status) ? r.status : 'FAIL', ...(r?.detail ? { detail: String(r.detail).slice(0, 200) } : {}) });
      } catch {
        results.push({ kind, status: 'FAIL', detail: 'authenticator error' });
      }
    }
    const printed = results[0];
    const hardware = results.slice(1);
    const hardwarePassed = hardware.length > 0 && hardware.every((r) => r.status === 'PASS');
    const hardwareProofRequired = hardware.length > 0 && !hardwarePassed;
    const assurance: Assurance = hardware.length === 0 ? 'CODE' : hardwarePassed && printed.status === 'PASS' ? 'CODE_AND_HARDWARE' : 'CODE_ONLY';
    return {
      policy: kinds.join('+'),
      results,
      assurance,
      hardwareProofRequired,
      satisfied: results.every((r) => r.status === 'PASS'),
    };
  }
}

function isStatus(v: unknown): v is AuthenticatorStatus {
  return v === 'PASS' || v === 'FAIL' || v === 'NOT_PROVIDED' || v === 'UNSUPPORTED';
}
