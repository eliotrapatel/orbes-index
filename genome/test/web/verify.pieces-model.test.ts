/**
 * MY PIECES (F-01): the owner's piece as its plate and its tabs show it (pieces-model.ts), and the copy of
 * the page. Pure: no DOM. The page itself is driven in Chromium by verify.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { computeGenome } from '../../src/core/genome/index.js';
import { packIdentity } from '../../src/core/identity.js';
import { genomeRowMarkup } from '../../src/web/verify/genome-view.js';
import { CONTACT, PIECES } from '../../src/web/verify/copy.js';
import { PIECE_TAB_LABELS, PIECE_TABS, pieceModel, serviceRows } from '../../src/web/verify/pieces-model.js';
import type { OwnedPiece, ServiceRecord } from '../../src/web/verify/types.js';
import { pieceContactModel, productLines, resultViewModel, warrantyModel } from '../../src/web/verify/view-model.js';

const G = computeGenome(packIdentity({ year: 2026, categoryIndex: 1, serial: 184 }), 1);

function piece(extra: Partial<OwnedPiece> = {}): OwnedPiece {
  return {
    productId: 'O26-J-00184',
    category: { code: 'J', name: 'Jewelry' },
    collection: 'ORBIT',
    model: 'Monolithe',
    type: 'Ring',
    variant: 'SIZE 52',
    material: '925 Sterling Silver',
    createdYear: 2026,
    acquiredVia: 'FIRST_REGISTRATION',
    verified: true,
    since: '2026-10-01T08:13:21.929Z',
    transfer: { pending: false },
    incident: null,
    incidentResolvable: false,
    incidentReportable: true,
    inService: false,
    certificateAllowed: true,
    genome: { id: 'O26-J-00184', version: 1, fingerprint: G.fingerprint, glyphs: [...G.glyphs], pattern: G.ids.join('·') },
    warranty: { status: 'ACTIVE', startDate: '2026-09-20', endDate: '2028-09-20' },
    imageUrl: null,
    photoUrl: null,
    ...extra,
  };
}

describe('MY PIECES: a piece on its plate', () => {
  it('draws the GENOME of the list (integer version, glyph ids as one pattern) as the result does, and the same product lines', () => {
    const m = pieceModel(piece());
    expect(m.productId).toBe('O26-J-00184');
    expect(m.key).toBe('o26-j-00184');
    expect(m.genome).toEqual({ id: 'O26-J-00184', version: 'GENOME-01', versionNumber: 1, fingerprint: G.fingerprint, glyphs: [...G.glyphs], ids: [...G.ids] });
    // The core renderer accepts it: the fingerprint it recomputes is the server's.
    expect(genomeRowMarkup(m.genome!, { layout: 'orbit' })).not.toBeNull();
    expect(m.productLines).toEqual(['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
    expect(m.productLines).toEqual(productLines({ model: 'Monolithe', type: 'Ring', category: { name: 'Jewelry' }, material: '925 Sterling Silver', createdYear: 2026 }));
    // A genome the app cannot draw faithfully is left out, never guessed.
    expect(pieceModel(piece({ genome: { ...piece().genome!, glyphs: [1, 2, 3] } })).genome).toBeUndefined();
    expect(pieceModel(piece({ genome: null })).genome).toBeUndefined();
    // An id that is not a product id never becomes part of an element id.
    expect(pieceModel(piece({ productId: '"><img>' })).key).toBe('');
  });

  it('shows the photographs ORBES holds of the piece as an authentic result does (F-04): its own, then its model\'s, each with its alternative text', () => {
    const own = `/api/v1/media/${'a'.repeat(64)}`;
    const ref = `/api/v1/media/${'b'.repeat(64)}`;
    expect(pieceModel(piece()).photos).toEqual([]);
    const both = pieceModel(piece({ photoUrl: own, imageUrl: ref }));
    expect(both.photos).toEqual([
      { kind: 'piece', src: own, alt: 'This piece, O26-J-00184, photographed by ORBES at issuance', caption: 'THIS PIECE' },
      { kind: 'model', src: ref, alt: 'The MONOLITHE RING model, photographed by ORBES', caption: 'THE MODEL' },
    ]);
    // The same models as the result's for the same piece, so both screens say the same.
    const outcome = resultViewModel({
      state: 'AUTHENTIC_OWNERSHIP_VERIFIED',
      scanId: '0b7f3a52-6c1e-4d2a-9f3b-2c4d5e6f7a8b',
      verifiedAt: '2026-10-03T09:00:00.000Z',
      title: 'AUTHENTIC — OWNERSHIP VERIFIED',
      message: '',
      product: { productId: 'O26-J-00184', category: { code: 'J', name: 'Jewelry' }, model: 'Monolithe', type: 'Ring', material: '925 Sterling Silver', createdYear: 2026, photoUrl: own, imageUrl: ref },
    });
    expect(both.photos).toEqual(outcome.photos);
    expect(pieceModel(piece({ imageUrl: ref })).photos.map((p) => p.kind)).toEqual(['model']);
    // Only this origin's media route, named by a SHA-256: anything else is dropped, never shown.
    expect(pieceModel(piece({ photoUrl: 'https://example.com/a.jpg', imageUrl: `${ref}?x` })).photos).toEqual([]);
  });

  it('opens on OWNERSHIP, then WARRANTY and SERVICE', () => {
    expect(PIECE_TABS).toEqual(['ownership', 'warranty', 'service']);
    expect(PIECE_TABS.map((t) => PIECE_TAB_LABELS[t])).toEqual(['OWNERSHIP', 'WARRANTY', 'SERVICE']);
  });

  it('says since when the piece is the owner\'s, how it came, whether the ownership is verified', () => {
    const m = pieceModel(piece());
    expect(m.status).toBe('REGISTERED TO YOU');
    expect(m.ownershipRows).toEqual([
      ['SINCE', '1 OCT 2026'],
      ['ACQUIRED', 'FIRST REGISTRATION'],
      ['OWNERSHIP', 'VERIFIED'],
    ]);
    expect(m.ownershipNotes).toEqual([]);
    const unverified = pieceModel(piece({ verified: false, acquiredVia: 'TRANSFER' }));
    expect(unverified.ownershipRows.slice(1)).toEqual([
      ['ACQUIRED', 'TRANSFER'],
      ['OWNERSHIP', 'NOT YET VERIFIED'],
    ]);
    expect(unverified.ownershipNotes).toEqual(['ORBES Client Services may ask for a proof of purchase to verify your ownership.']);
    expect(pieceModel(piece({ acquiredVia: 'ADMIN' })).ownershipRows[1]).toEqual(['ACQUIRED', 'ORBES CLIENT SERVICES']);
  });

  it('shows a transfer under way, and a service', () => {
    const t = pieceModel(piece({ transfer: { pending: true, expiresAt: '2026-10-08T08:13:21.929Z' } }));
    expect(t.status).toBe('TRANSFER PENDING');
    expect(t.transferPending).toBe(true);
    expect(t.ownershipRows.at(-1)).toEqual(['TRANSFER', 'PENDING UNTIL 8 OCT 2026']);
    expect(t.ownershipNotes).toEqual(['A transfer of this piece is pending until 8 October 2026. You may cancel it at any time before it is accepted.']);
    const s = pieceModel(piece({ inService: true }));
    expect(s.status).toBe('IN SERVICE');
    expect(s.ownershipNotes).toEqual([PIECES.inService]);
  });

  it('shares the WARRANTY rows and sentence of a result', () => {
    const w = { status: 'ACTIVE', startDate: '2026-09-20', endDate: '2028-09-20' } as const;
    expect(pieceModel(piece({ warranty: w })).warranty).toEqual(warrantyModel(w));
    expect(warrantyModel(w)).toEqual({
      status: 'ACTIVE',
      rows: [
        ['STATUS', 'ACTIVE'],
        ['FROM', '20 SEP 2026'],
        ['UNTIL', '20 SEP 2028'],
      ],
      note: 'This piece is covered by the ORBES warranty until 20 September 2028.',
    });
    // The very rows of a result's WARRANTY tab.
    const vm = resultViewModel({
      state: 'AUTHENTIC',
      scanId: '4515b884-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
      verifiedAt: '2026-10-01T08:30:00.000Z',
      title: 'AUTHENTIC',
      message: 'm',
      product: { productId: 'O26-J-00184', category: { code: 'J', name: 'Jewelry' }, model: 'M', type: 'T', material: 'S', createdYear: 2026 },
      warranty: w,
    });
    expect(vm.warranty).toEqual(warrantyModel(w));
    expect(pieceModel(piece({ warranty: { status: 'BROKEN' as 'ACTIVE' } })).warranty).toBeUndefined();
  });
});

describe('MY PIECES: loss and theft', () => {
  it('offers REPORT LOST / STOLEN on a piece not reported', () => {
    expect(pieceModel(piece()).incident).toEqual({ kind: 'reportable' });
  });

  it('offers no REPORT LOST / STOLEN on a piece the server would refuse to report (revoked, retired, flagged): ORBES Client Services instead', () => {
    // The server names no status, only the flag (incidentReportable false, with certificateAllowed false beside it).
    const refused = pieceModel(piece({ incidentReportable: false, certificateAllowed: false }));
    expect(refused.incident).toEqual({ kind: 'not-reportable' });
    expect(refused).toMatchObject({ status: 'REGISTERED TO YOU', certificateOffered: false });
    // Its other lines stay: a pending transfer can still be cancelled, a service is still said.
    const pending = pieceModel(piece({ incidentReportable: false, transfer: { pending: true, expiresAt: '2026-10-08T00:00:00.000Z' }, inService: true }));
    expect(pending).toMatchObject({ transferPending: true, status: 'TRANSFER PENDING' });
    expect(pending.ownershipNotes).toEqual([expect.stringMatching(/^A transfer of this piece is pending/), 'This piece is with ORBES for a service. Its history is under SERVICE.']);
    // A reported piece reads as reported, whatever the flag says (false while it is).
    expect(pieceModel(piece({ incident: 'LOST', incidentResolvable: true, incidentReportable: false })).incident).toEqual({ kind: 'found' });
    // A server that predates the flag: offered, as before (the server still refuses what it must).
    const older: Partial<OwnedPiece> = piece();
    delete older.incidentReportable;
    expect(pieceModel(older as OwnedPiece).incident).toEqual({ kind: 'reportable' });
  });

  it('offers PIECE FOUND for a loss the owner reported, and nothing to press for a theft or a loss Client Services recorded', () => {
    const lost = pieceModel(piece({ incident: 'LOST', incidentResolvable: true }));
    expect(lost).toMatchObject({ status: 'REPORTED LOST', incident: { kind: 'found' } });
    expect(pieceModel(piece({ incident: 'STOLEN', incidentResolvable: false }))).toMatchObject({ status: 'REPORTED STOLEN', incident: { kind: 'with-services', type: 'STOLEN' } });
    // The server alone says a loss is the owner's to withdraw; a STOLEN never is, whatever the flag says.
    expect(pieceModel(piece({ incident: 'LOST', incidentResolvable: false })).incident).toEqual({ kind: 'with-services', type: 'LOST' });
    expect(pieceModel(piece({ incident: 'STOLEN', incidentResolvable: true })).incident).toEqual({ kind: 'with-services', type: 'STOLEN' });
    // A reported piece shows no transfer (the report cancelled it) and no service note.
    const reported = pieceModel(piece({ incident: 'STOLEN', transfer: { pending: true, expiresAt: '2026-10-08T00:00:00.000Z' }, inService: true }));
    expect(reported.transferPending).toBe(false);
    expect(reported.ownershipNotes).toEqual([]);
  });

  it('offers OWNERSHIP CERTIFICATE (F-06) on a piece the server allows one for, never on a reported one', () => {
    expect(pieceModel(piece()).certificateOffered).toBe(true);
    // Revoked, flagged or retired (the server names no status, only the flags): creation would always be refused.
    const revoked = pieceModel(piece({ certificateAllowed: false, incidentReportable: false }));
    expect(revoked.certificateOffered).toBe(false);
    // It is still the owner's, but REPORT LOST / STOLEN is absent too: the server would refuse the report.
    expect(revoked).toMatchObject({ status: 'REGISTERED TO YOU', incident: { kind: 'not-reportable' } });
    expect(revoked.incident.kind).not.toBe('reportable');
    // Reported lost or stolen: no section, whatever the flag says.
    for (const p of [piece({ incident: 'LOST', incidentResolvable: true }), piece({ incident: 'STOLEN' })]) expect(pieceModel(p).certificateOffered).toBe(false);
    // A server that predates the flag: offered, as before.
    const older: Partial<OwnedPiece> = piece();
    delete older.certificateAllowed;
    expect(pieceModel(older as OwnedPiece).certificateOffered).toBe(true);
  });

  it('gives ORBES Client Services an email that names the piece and its status line', () => {
    const c = pieceContactModel({ email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89' }, 'O26-J-00184', 'REPORTED STOLEN')!;
    expect(c.placement).toBe('piece');
    const m = /^mailto:([^?]+)\?subject=([^&]*)&body=([^&]*)$/.exec(c.mailto!)!;
    expect([m[1], decodeURIComponent(m[2]), decodeURIComponent(m[3])]).toEqual(['clientservices@theorbes.com', 'ORBES — O26-J-00184 — REPORTED STOLEN', `\r\n\r\n${CONTACT.piece}: O26-J-00184`]);
    expect(c.phone).toEqual({ label: '+33 1 23 45 67 89', href: 'tel:+33123456789' });
    expect(pieceContactModel({}, 'O26-J-00184', 'REPORTED STOLEN')).toBeNull();
    expect(pieceContactModel(undefined, 'O26-J-00184', 'REPORTED STOLEN')).toBeNull();
  });
});

describe('MY PIECES: the service history', () => {
  const svc = (extra: Partial<ServiceRecord>): ServiceRecord => ({ id: 's', type: 'POLISH', status: 'COMPLETED', location: 'Paris atelier', openedAt: '2026-10-01T09:00:00.000Z', closedAt: '2026-10-03T16:30:00.000Z', ...extra });

  it('one row per service: its type, its dates and its place', () => {
    expect(
      serviceRows([
        svc({}),
        svc({ type: 'CLEANING', closedAt: '2026-10-01T11:00:00.000Z', location: null }),
        svc({ type: 'REPAIR', status: 'OPEN', closedAt: null }),
        svc({ type: 'RESIZE', status: 'CANCELLED', closedAt: '2026-10-02T09:00:00.000Z', location: null }),
      ]),
    ).toEqual([
      ['POLISH', '1 OCT 2026 – 3 OCT 2026 · PARIS ATELIER'],
      ['CLEANING', '1 OCT 2026'],
      ['REPAIR', 'IN PROGRESS SINCE 1 OCT 2026 · PARIS ATELIER'],
      ['RESIZE', 'CANCELLED · 1 OCT 2026'],
    ]);
    expect(serviceRows([])).toEqual([]);
  });
});

describe('MY PIECES: copy (BRAND §4.5)', () => {
  const strings = (o: unknown): string[] =>
    typeof o === 'string' ? [o] : typeof o === 'function' ? [String((o as (x: string) => string)('8 October 2026'))] : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : [];
  const all = strings(PIECES);

  it('speaks of pieces, never products, and never accuses', () => {
    for (const line of all) expect(line, line).not.toMatch(/\bproducts?\b|fake|counterfeit|fraud|support|genuine|alert|danger|warning|!/i);
    expect(all.join(' ')).toMatch(/\bpiece\b/);
  });

  it('keeps LOST and STOLEN to the owner\'s own declaration: what a scan shows is UNUSUAL ACTIVITY', () => {
    expect(PIECES.report).toBe('REPORT LOST / STOLEN');
    expect(PIECES.found).toBe('PIECE FOUND');
    expect(PIECES.reportLead).toMatch(/every scan of its code will then show UNUSUAL ACTIVITY/);
    expect(PIECES.reportEffect).toMatch(/UNUSUAL ACTIVITY/);
    for (const line of [...Object.values(PIECES.reported), PIECES.lostByYou, ...Object.values(PIECES.withClientServices)]) expect(line).toMatch(/UNUSUAL ACTIVITY/);
    // A theft is Client Services' to withdraw; a loss the owner's.
    expect(PIECES.reportHow.STOLEN).toMatch(/ORBES Client Services check the piece and withdraw the report/);
    expect(PIECES.reportHow.LOST).toMatch(/you withdraw the report yourself, here: PIECE FOUND/);
  });

  it('writes titles and labels in tracked capitals', () => {
    for (const label of [PIECES.title, PIECES.link, PIECES.report, PIECES.found, PIECES.confirmReport, PIECES.confirmFound, PIECES.cancel, PIECES.scan, ...Object.values(PIECES.status), ...Object.values(PIECES.tabs)]) {
      expect(label).toMatch(/^[A-Z /]+$/);
    }
  });
});
