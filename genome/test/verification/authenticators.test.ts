import { describe, expect, it } from 'vitest';
import {
  AuthenticatorRegistry,
  parseAuthPolicy,
  PrintedCodeAuthenticator,
  UnimplementedAuthenticator,
  type AuthenticatorContext,
  type PhysicalAuthenticator,
} from '../../src/server/authenticators/index.js';

const ok: AuthenticatorContext = {
  product: { id: 'p', productId: 'O26-J-00001' },
  code: { id: 'c', status: 'ACTIVE' },
  checks: { signatureValid: true, registered: true },
};

describe('PrintedCodeAuthenticator', () => {
  const a = new PrintedCodeAuthenticator();
  it('passes only when the signature and registry checks passed', async () => {
    expect(a.implemented).toBe(true);
    expect(await a.evaluate(undefined, ok)).toEqual({ kind: 'PRINTED_CODE', status: 'PASS' });
    expect((await a.evaluate(undefined, { ...ok, checks: { signatureValid: false, registered: true } })).status).toBe('FAIL');
    expect((await a.evaluate(undefined, { ...ok, checks: { signatureValid: true, registered: false } })).status).toBe('FAIL');
    expect((await a.evaluate(undefined, { ...ok, code: null })).status).toBe('FAIL');
    expect((await a.evaluate(undefined, { product: null, code: null })).status).toBe('NOT_PROVIDED');
  });
});

describe('parseAuthPolicy', () => {
  it('always includes PRINTED_CODE first, dedupes, normalises case and keeps unknown parts', () => {
    expect(parseAuthPolicy(undefined)).toEqual(['PRINTED_CODE']);
    expect(parseAuthPolicy('')).toEqual(['PRINTED_CODE']);
    expect(parseAuthPolicy('PRINTED_CODE')).toEqual(['PRINTED_CODE']);
    expect(parseAuthPolicy('secure_nfc+PRINTED_CODE')).toEqual(['PRINTED_CODE', 'SECURE_NFC']);
    expect(parseAuthPolicy('PRINTED_CODE+SECURE_NFC+SECURE_NFC')).toEqual(['PRINTED_CODE', 'SECURE_NFC']);
    expect(parseAuthPolicy('PRINTED_CODE+QUANTUM_DUST')).toEqual(['PRINTED_CODE', 'QUANTUM_DUST']);
  });
});

describe('AuthenticatorRegistry', () => {
  const reg = AuthenticatorRegistry.withDefaults();

  it('code-only policy → CODE assurance', async () => {
    const r = await reg.evaluate('PRINTED_CODE', undefined, ok);
    expect(r).toEqual({ policy: 'PRINTED_CODE', results: [{ kind: 'PRINTED_CODE', status: 'PASS' }], assurance: 'CODE', hardwareProofRequired: false, satisfied: true });
  });

  it.each(['SECURE_NFC', 'SECURE_ELEMENT', 'TAMPER_EVIDENT'])('hardware %s is not implemented: UNSUPPORTED, CODE_ONLY, proof required', async (kind) => {
    const r = await reg.evaluate(`PRINTED_CODE+${kind}`, { [kind]: { forged: 'evidence' } }, ok);
    expect(r.results[1]).toEqual({ kind, status: 'UNSUPPORTED', detail: 'not implemented' });
    expect(r).toMatchObject({ assurance: 'CODE_ONLY', hardwareProofRequired: true, satisfied: false });
  });

  it('unknown policy parts never upgrade assurance', async () => {
    const r = await reg.evaluate('PRINTED_CODE+FUTURE_CHIP', undefined, ok);
    expect(r.results[1]).toEqual({ kind: 'FUTURE_CHIP', status: 'UNSUPPORTED', detail: 'unknown authenticator' });
    expect(r.assurance).toBe('CODE_ONLY');
  });

  it('CODE_AND_HARDWARE only when an implemented hardware authenticator passes (future extension point)', async () => {
    const fake: PhysicalAuthenticator = {
      kind: 'SECURE_NFC',
      implemented: true,
      evaluate: async (evidence) => ({ kind: 'SECURE_NFC', status: evidence === 'good' ? 'PASS' : 'FAIL' }),
    };
    const r2 = new AuthenticatorRegistry().register(new PrintedCodeAuthenticator()).register(fake);
    expect((await r2.evaluate('PRINTED_CODE+SECURE_NFC', { SECURE_NFC: 'good' }, ok)).assurance).toBe('CODE_AND_HARDWARE');
    const bad = await r2.evaluate('PRINTED_CODE+SECURE_NFC', { SECURE_NFC: 'bad' }, ok);
    expect(bad).toMatchObject({ assurance: 'CODE_ONLY', hardwareProofRequired: true });
    // Hardware passing cannot rescue a failed code check.
    const noCode = await r2.evaluate('PRINTED_CODE+SECURE_NFC', { SECURE_NFC: 'good' }, { ...ok, checks: { signatureValid: false, registered: true } });
    expect(noCode.assurance).toBe('CODE_ONLY');
  });

  it('an authenticator that throws counts as FAIL', async () => {
    const boom: PhysicalAuthenticator = {
      kind: 'SECURE_ELEMENT',
      implemented: true,
      evaluate: async () => {
        throw new Error('driver crashed');
      },
    };
    const r = await new AuthenticatorRegistry().register(new PrintedCodeAuthenticator()).register(boom).evaluate('PRINTED_CODE+SECURE_ELEMENT', undefined, ok);
    expect(r.results[1]).toEqual({ kind: 'SECURE_ELEMENT', status: 'FAIL', detail: 'authenticator error' });
    expect(r.assurance).toBe('CODE_ONLY');
  });

  it('an unregistered PRINTED_CODE authenticator is UNSUPPORTED (empty registry)', async () => {
    const r = await new AuthenticatorRegistry().evaluate('PRINTED_CODE', undefined, ok);
    expect(r.results[0].status).toBe('UNSUPPORTED');
    expect(r.satisfied).toBe(false);
  });

  it('refuses unknown kinds at registration; placeholders never evaluate', async () => {
    expect(() => new AuthenticatorRegistry().register({ kind: 'MAGIC', implemented: true, evaluate: async () => ({ kind: 'MAGIC', status: 'PASS' }) } as never)).toThrow(TypeError);
    const p = new UnimplementedAuthenticator('SECURE_NFC');
    expect(p.implemented).toBe(false);
    expect((await p.evaluate()).status).toBe('UNSUPPORTED');
  });
});

describe('verifyInputSchema', () => {
  it('accepts the scanner body and rejects unknown keys and bad genome readings', async () => {
    const { verifyInputSchema } = await import('../../src/server/services/verification.js');
    const ok = { code: 'abc', genome: { glyphs: [0, 1, 2, 3, null, 5, 6, 7], confidence: [1, 1, 1, 1, 0, 1, 1, 1] }, client: { rsErrors: 2, source: 'camera' } };
    expect(verifyInputSchema.safeParse(ok).success).toBe(true);
    expect(verifyInputSchema.safeParse({ code: '' }).success).toBe(true); // reaches the service → MALFORMED_CODE
    expect(verifyInputSchema.safeParse({ code: 'abc', extra: 1 }).success).toBe(false);
    expect(verifyInputSchema.safeParse({ code: 'abc', genome: { glyphs: [16, 0, 0, 0, 0, 0, 0, 0] } }).success).toBe(false);
    expect(verifyInputSchema.safeParse({ code: 'abc', genome: { glyphs: [0] } }).success).toBe(false);
    expect(verifyInputSchema.safeParse({ code: 'abc', client: { source: 'fax' } }).success).toBe(false);
    expect(verifyInputSchema.safeParse({ code: 'x'.repeat(1025) }).success).toBe(false);
  });
});
