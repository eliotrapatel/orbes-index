/**
 * The simulation lab's own instruments: the redaction checker must catch
 * leaks (otherwise "0 leaks" in the report means nothing), the expectation
 * matcher must be exact, and the damage generators must be deterministic and
 * stay inside their region.
 */
import { describe, expect, it } from 'vitest';
import { blankAnnulus, describeExpect, matches, redactionViolations, scuff, tally } from './lab.js';
import { SCENARIOS } from './scenarios.js';
import { createGray } from '../support/raster.js';

const base = { state: 'AUTHENTIC', scanId: 's', verifiedAt: 't', title: 'AUTHENTIC', message: 'm' };
const authentic = {
  ...base,
  verification: { signature: 'VALID', keyId: 1, codeVersion: 'CODE-01', genomeVersion: 'GENOME-01', issuedAt: '2026-06-01', issue: 1, assurance: 'CODE' },
  product: { productId: 'O26-J-00001', category: { code: 'J', name: 'Jewelry' }, model: 'MONOLITHE', type: 'RING', material: 'SILVER', createdYear: 2026 },
  genome: { id: 'O26-J-00001', version: 'GENOME-01', fingerprint: 'G1-0000-0000', glyphs: [1, 2, 3, 4, 5, 6, 7, 8], ids: ['a'] },
  warranty: { status: 'ACTIVE', startDate: '2026-06-01', endDate: '2028-06-01' },
  ownership: { registered: false, you: false },
};

describe('redactionViolations', () => {
  it('accepts a contract-shaped AUTHENTIC body (warranty status ACTIVE is not a raw product status)', () => {
    expect(redactionViolations(authentic)).toEqual([]);
  });

  it('accepts the minimal bodies of the failure states', () => {
    for (const state of ['UNKNOWN', 'INVALID_SIGNATURE', 'MALFORMED_CODE']) expect(redactionViolations({ ...base, state })).toEqual([]);
    expect(redactionViolations({ ...base, state: 'REVOKED', genome: authentic.genome, verification: authentic.verification })).toEqual([]);
  });

  it('flags internal fields, wherever they are', () => {
    expect(redactionViolations({ ...authentic, riskScore: 61 })).toContain('field riskScore not allowed in AUTHENTIC');
    expect(redactionViolations({ ...authentic, product: { ...authentic.product, status: 'OWNED' } }).join()).toMatch(/product\.status/);
    expect(redactionViolations({ ...base, state: 'INVALID_SIGNATURE', reasons: ['BAD_SIGNATURE'] }).join()).toMatch(/reasons.*BAD_SIGNATURE|BAD_SIGNATURE.*reasons/s);
  });

  it('flags product data on non-authentic states and missing blocks on authentic ones', () => {
    expect(redactionViolations({ ...base, state: 'SUSPICIOUS_ACTIVITY', product: authentic.product }).join()).toMatch(/field product not allowed/);
    expect(redactionViolations({ ...base, state: 'UNKNOWN', genome: authentic.genome }).join()).toMatch(/field genome not allowed/);
    const { ownership: _o, ...noOwnership } = authentic;
    expect(redactionViolations(noOwnership)).toContain('AUTHENTIC without ownership');
  });

  it('allows a registration block on SUSPICIOUS_ACTIVITY only when the claim code is required', () => {
    const registration = { token: 't'.repeat(43), expiresAt: '2026-06-01T10:15:00.000Z', claimCodeRequired: true };
    const susp = { ...base, state: 'SUSPICIOUS_ACTIVITY', genome: authentic.genome, verification: authentic.verification };
    expect(redactionViolations({ ...susp, registration })).toEqual([]);
    expect(redactionViolations({ ...susp, registration: { ...registration, claimCodeRequired: false } })).toContain(
      'SUSPICIOUS_ACTIVITY registration without a required claim code',
    );
    expect(redactionViolations({ ...base, state: 'REVOKED', registration }).join()).toMatch(/field registration not allowed/);
  });

  it('flags internal vocabulary, raw statuses and secrets inside values', () => {
    expect(redactionViolations({ ...base, message: 'risk 55 below threshold' }).join()).toMatch(/risk.*threshold/s);
    expect(redactionViolations({ ...base, message: 'IMPOSSIBLE_TRAVEL' }).join()).toMatch(/IMPOSSIBLE_TRAVEL/);
    expect(redactionViolations({ ...base, title: 'ACTIVATED' })).toContain('raw status "ACTIVATED"');
    expect(redactionViolations({ ...base, state: 'UNKNOWN', message: 'id 123e4567' }, ['123e4567'])).toEqual(['secret 123e4567…']);
  });

  it('refuses non-objects', () => {
    expect(redactionViolations(null)).toEqual(['body is not a JSON object']);
    expect(redactionViolations({})).toEqual(['no state']);
  });
});

describe('expectations', () => {
  it('matches single states, sets and the AUTHENTIC* / NOT_AUTHENTIC families', () => {
    expect(matches('REVOKED', 'REVOKED')).toBe(true);
    expect(matches(['UNKNOWN', 'REVOKED'], 'UNKNOWN')).toBe(true);
    expect(matches('AUTHENTIC*', 'AUTHENTIC_REGISTERED')).toBe(true);
    expect(matches('AUTHENTIC*', 'SUSPICIOUS_ACTIVITY')).toBe(false);
    expect(matches('NOT_AUTHENTIC', 'MALFORMED_CODE')).toBe(true);
    expect(matches('NOT_AUTHENTIC', 'AUTHENTIC')).toBe(false);
    expect(matches('NOT_AUTHENTIC', undefined)).toBe(false);
    expect(describeExpect(['UNKNOWN', 'REVOKED'])).toBe('UNKNOWN or REVOKED');
    expect(tally(['A', 'B', 'A'])).toBe('A ×2, B ×1');
  });

  it('declares the ten scenarios of §27, each gap and limit attached to its own scenario', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const s of SCENARIOS) for (const id of [...s.knownGaps, ...s.knownLimits]) expect(id.startsWith(String(s.id))).toBe(true);
  });
});

describe('damage generators', () => {
  const img = createGray(500, 500, 128);
  const pxPerU = 500 / 50;
  const at = (x: number, y: number) => Math.round(250 + y * pxPerU) * 500 + Math.round(250 + x * pxPerU);

  it('scuff is deterministic and stays inside its sector', () => {
    const sector = { r0: 11, r1: 23, a0: 60, a1: 120 };
    const a = scuff(img, 'seed', sector, 200);
    expect(Buffer.compare(Buffer.from(a.data), Buffer.from(scuff(img, 'seed', sector, 200).data))).toBe(0);
    expect(Buffer.compare(Buffer.from(a.data), Buffer.from(scuff(img, 'other', sector, 200).data))).not.toBe(0);
    let inside = 0;
    for (let py = 0; py < 500; py++) {
      for (let px = 0; px < 500; px++) {
        const v = a.data[py * 500 + px];
        if (v === 128) continue;
        const x = (px + 0.5 - 250) / pxPerU;
        const y = (py + 0.5 - 250) / pxPerU;
        const r = Math.hypot(x, y);
        const deg = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
        expect(r >= 11 && r <= 23 && deg >= 60 && deg <= 120).toBe(true);
        inside++;
      }
    }
    expect(inside).toBeGreaterThan(1000);
    expect(img.data.every((v) => v === 128)).toBe(true); // the source is not modified
  });

  it('blankAnnulus paints only the annulus', () => {
    const b = blankAnnulus(img, 5.6, 9.6);
    expect(b.data[at(0, -7.5)]).toBe(255); // a genome glyph centre (north)
    expect(b.data[at(0, 0)]).toBe(128); // the seal
    expect(b.data[at(0, -12)]).toBe(128); // data orbits
  });
});
