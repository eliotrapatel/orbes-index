/**
 * The ownership certificate's page (F-06, certificate-model.ts) and its copy, with the lines MY PIECES adds to
 * create, share and withdraw a link. Pure: no DOM. The page itself is driven in Chromium by verify.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { computeGenome } from '../../src/core/genome/index.js';
import { packIdentity } from '../../src/core/identity.js';
import { certificateScreen, certificateTokenOf, ownerCertificateLine } from '../../src/web/verify/certificate-model.js';
import { CERTIFICATE, PIECES } from '../../src/web/verify/copy.js';
import { genomeRowMarkup } from '../../src/web/verify/genome-view.js';
import { pieceGenomeModel, pieceModel } from '../../src/web/verify/pieces-model.js';
import type { CertificateLookup } from '../../src/web/verify/types.js';
import { productLines } from '../../src/web/verify/view-model.js';

const G = computeGenome(packIdentity({ year: 2026, categoryIndex: 1, serial: 184 }), 1);
const TOKEN = '7Q2MZXKW4R8T1V0G3H5J6K9N2P4S6T8V0W2X4Y6Z8A1B3C5D7E9G';

type Valid = Extract<CertificateLookup, { status: 'VALID' }>;

function valid(extra: Partial<Valid> = {}): Valid {
  return {
    status: 'VALID',
    checkedAt: '2026-10-03T12:34:00.000Z',
    certificate: { issuedAt: '2026-10-03T09:00:00.000Z', expiresAt: '2027-01-01T09:00:00.000Z' },
    piece: {
      productId: 'O26-J-00184',
      category: { code: 'J', name: 'Jewelry' },
      collection: 'ORBIT',
      model: 'Monolithe',
      type: 'Ring',
      variant: null,
      material: '925 Sterling Silver',
      createdYear: 2026,
      genome: { id: 'O26-J-00184', version: 1, fingerprint: G.fingerprint, glyphs: [...G.glyphs], pattern: G.ids.join('·') },
    },
    ownership: { verified: true, since: '2026-10-01' },
    warranty: { status: 'ACTIVE', startDate: '2026-09-20', endDate: '2028-09-20' },
    incidentReported: false,
    ...extra,
  };
}

describe('certificate link: the token is the fragment', () => {
  it('reads the token from the fragment, grouped or not, and nothing else', () => {
    expect(certificateTokenOf(`#${TOKEN}`)).toBe(TOKEN);
    const grouped = TOKEN.match(/.{4}/g)!.join('-');
    expect(certificateTokenOf(`#${grouped}`)).toBe(grouped);
    expect(certificateTokenOf(`#${encodeURIComponent(` ${grouped.toLowerCase()} `)}`)).toBe(grouped.toLowerCase());
    for (const bad of ['', '#', '#<script>', '#%E0%A4%A', `#${'A'.repeat(200)}`, '#a&b=c']) expect(certificateTokenOf(bad), bad).toBeNull();
  });
});

describe('certificate page', () => {
  it('VALID: the piece on its plate, the record, this certificate, and what it does not attest', () => {
    const s = certificateScreen(valid(), { offsetMinutes: 120 });
    if (s.kind !== 'valid') throw new Error(s.kind);
    expect(s.state).toBe('VALID');
    expect(s.lead).toBe(CERTIFICATE.lead.valid);
    expect(s.productId).toBe('O26-J-00184');
    expect(s.key).toBe('o26-j-00184');
    // The plate of MY PIECES: the same GENOME model, drawn by the same core renderer.
    expect(s.genome).toEqual(pieceGenomeModel(valid().piece.genome));
    expect(genomeRowMarkup(s.genome!, { layout: 'orbit' })).not.toBeNull();
    expect(s.productLines).toEqual(['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
    expect(s.productLines).toEqual(productLines({ model: 'Monolithe', type: 'Ring', category: { name: 'Jewelry' }, material: '925 Sterling Silver', createdYear: 2026 }));
    expect(s.recordRows).toEqual([
      ['OWNERSHIP', 'VERIFIED'],
      ['SINCE', '1 OCT 2026'],
      ['WARRANTY', 'ACTIVE'],
      ['FROM', '20 SEP 2026'],
      ['UNTIL', '20 SEP 2028'],
      ['LOSS OR THEFT', 'NONE REPORTED'],
    ]);
    // When the record was read, in the reader's time; the certificate's own days.
    expect(s.certificateRows).toEqual([
      ['CHECKED', '3 OCT 2026 · 14:34'],
      ['ISSUED', '3 OCT 2026'],
      ['VALID UNTIL', '1 JAN 2027'],
    ]);
    expect(s.note).toBe(CERTIFICATE.note);
  });

  it('says when the ownership is not yet verified, and a warranty not yet started', () => {
    const s = certificateScreen(valid({ ownership: { verified: false, since: '2026-10-01' }, warranty: { status: 'NOT_STARTED' } }));
    if (s.kind !== 'valid') throw new Error(s.kind);
    expect(s.recordRows).toEqual([
      ['OWNERSHIP', 'REGISTERED · NOT YET VERIFIED'],
      ['SINCE', '1 OCT 2026'],
      ['WARRANTY', 'NOT YET STARTED'],
      ['LOSS OR THEFT', 'NONE REPORTED'],
    ]);
    // A GENOME the app cannot draw faithfully is left out, never guessed; an id that is not one never becomes an element id.
    const odd = certificateScreen(valid({ piece: { ...valid().piece, productId: '"><img>', genome: null } }));
    if (odd.kind !== 'valid') throw new Error(odd.kind);
    expect(odd.genome).toBeUndefined();
    expect(odd.key).toBe('');
  });

  it('NO LONGER VALID, and NOT FOUND for a 404 or a link without a token: one sentence each, nothing about the piece', () => {
    expect(certificateScreen({ status: 'NO_LONGER_VALID', checkedAt: '2026-10-03T12:34:00.000Z' })).toEqual({ kind: 'ended', state: 'NO LONGER VALID', lead: CERTIFICATE.lead.ended });
    expect(certificateScreen(null)).toEqual({ kind: 'unknown', state: 'NOT FOUND', lead: CERTIFICATE.lead.unknown });
  });

  it('lists an owner\'s link by its days, or as no longer valid', () => {
    expect(ownerCertificateLine({ createdAt: '2026-10-03T09:00:00.000Z', expiresAt: '2027-01-01T09:00:00.000Z', valid: true })).toBe('CREATED 3 OCT 2026 · VALID UNTIL 1 JAN 2027');
    expect(ownerCertificateLine({ createdAt: '2026-10-03T09:00:00.000Z', expiresAt: '2027-01-01T09:00:00.000Z', valid: false })).toBe('CREATED 3 OCT 2026 · NO LONGER VALID');
  });
});

describe('certificate copy (BRAND §4.5, §4.6)', () => {
  const strings = (o: unknown): string[] =>
    typeof o === 'string' ? [o] : typeof o === 'function' ? [String((o as (...x: string[]) => string)('3 OCT 2026', '1 JAN 2027'))] : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : [];
  const page = strings(CERTIFICATE);
  const owner = strings({ ...PIECES }).filter((l) => /CERTIFICATE|LINK|WITHDRAW|COPY|OPEN|DAYS|certificate|link/.test(l));

  it('never says AUTHENTIC on a certificate: it attests a record, not the object it is shown with', () => {
    for (const line of page) expect(line, line).not.toMatch(/authentic|genuine|\breal\b|certified|guarantee/i);
    expect(CERTIFICATE.lead.valid).toMatch(/It attests this record, not the object it is shown with: to check an object, scan its ORBES CODE\./);
  });

  it('speaks of pieces and links, never of products or tokens, and never accuses', () => {
    for (const line of [...page, ...owner]) expect(line, line).not.toMatch(/\bproducts?\b|\btokens?\b|fake|counterfeit|fraud|support|alert|danger|warning|!/i);
    // To the public, a declaration is a loss or theft reported: the word STOLEN stays on the owner's own page (§4.5).
    for (const line of page) expect(line, line).not.toMatch(/stolen/i);
    expect(PIECES.certificateLead).toMatch(/reported lost or stolen/);
  });

  it('names no owner, and says so', () => {
    expect(CERTIFICATE.note).toMatch(/names no owner/);
    expect(PIECES.certificateLead).toMatch(/never shows your name or your email/);
  });

  it('writes titles and labels in tracked capitals', () => {
    for (const label of [CERTIFICATE.title, CERTIFICATE.record, CERTIFICATE.certificate, CERTIFICATE.pdf, CERTIFICATE.scan, ...Object.values(CERTIFICATE.state), ...Object.values(CERTIFICATE.rows), PIECES.certificateTitle, PIECES.createCertificate, PIECES.confirmCertificate, PIECES.certificateLink, PIECES.copyLink, PIECES.openLink, PIECES.withdraw]) {
      expect(label).toMatch(/^[A-Z ]+$/);
    }
    expect(Object.values(PIECES.certificateDays)).toEqual(['7 DAYS', '30 DAYS', '90 DAYS']);
  });

  it('keeps the plate model of MY PIECES', () => {
    const owned = pieceModel({
      ...valid().piece,
      acquiredVia: 'FIRST_REGISTRATION',
      verified: true,
      since: '2026-10-01T08:00:00.000Z',
      transfer: { pending: false },
      incident: null,
      incidentResolvable: false,
      inService: false,
      warranty: { status: 'ACTIVE' },
    });
    const s = certificateScreen(valid());
    if (s.kind !== 'valid') throw new Error(s.kind);
    expect(s.genome).toEqual(owned.genome);
    expect(s.productLines).toEqual(owned.productLines);
  });
});
