/**
 * MY PIECES (F-01): the owner's piece as its plate and its tabs show it (pieces-model.ts), and the copy of
 * the page. Pure: no DOM. The page itself is driven in Chromium by verify.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { computeGenome } from '../../src/core/genome/index.js';
import { packIdentity } from '../../src/core/identity.js';
import { genomeRowMarkup } from '../../src/web/verify/genome-view.js';
import { CONTACT, DEFAULT_CARE, ORBES_CARE, PIECES } from '../../src/web/verify/copy.js';
import { careOfferModel, PIECE_TAB_LABELS, PIECE_TABS, pieceModel, pieceOriginModel, releaseDay, serviceRows } from '../../src/web/verify/pieces-model.js';
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
    care: 'Store on its own in the ORBES pouch.',
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

  it('shows the photograph of its model as an authentic result does (F-04; NOCTURNE, decision 9: never the piece\'s own), its alternative text naming the model and its variant', () => {
    const ref = `/api/v1/media/${'b'.repeat(64)}`;
    expect(pieceModel(piece()).photos).toEqual([]);
    const shown = pieceModel(piece({ imageUrl: ref }));
    expect(shown.photos).toEqual([{ kind: 'model', src: ref, alt: 'The MONOLITHE RING model, photographed by ORBES', caption: 'THE MODEL' }]);
    // The same model as the result's for the same piece, so both screens say the same.
    const outcome = resultViewModel({
      state: 'AUTHENTIC_OWNERSHIP_VERIFIED',
      scanId: '0b7f3a52-6c1e-4d2a-9f3b-2c4d5e6f7a8b',
      verifiedAt: '2026-10-03T09:00:00.000Z',
      title: 'AUTHENTIC — OWNERSHIP VERIFIED',
      message: '',
      product: { productId: 'O26-J-00184', category: { code: 'J', name: 'Jewelry' }, model: 'Monolithe', type: 'Ring', material: '925 Sterling Silver', createdYear: 2026, imageUrl: ref },
    });
    expect(shown.photos).toEqual(outcome.photos);
    // A variant (N1) is named in it: « The MONOLITHE RING model in gold ».
    expect(pieceModel(piece({ imageUrl: ref, modelVariant: 'Gold' })).photos[0]?.alt).toBe('The MONOLITHE RING model in gold, photographed by ORBES');
    // An older server's photograph of the piece is not read; only this origin's media route, named by a SHA-256.
    expect(pieceModel(piece({ photoUrl: ref } as unknown as Partial<OwnedPiece>)).photos).toEqual([]);
    expect(pieceModel(piece({ imageUrl: `${ref}?x` })).photos).toEqual([]);
  });

  it('opens on OWNERSHIP, then WARRANTY, SERVICE and CARE (P-M02): four labels, the width of the result\'s four', () => {
    expect(PIECE_TABS).toEqual(['ownership', 'warranty', 'service', 'care']);
    expect(PIECE_TABS.map((t) => PIECE_TAB_LABELS[t])).toEqual(['OWNERSHIP', 'WARRANTY', 'SERVICE', 'CARE']);
    // SERVICE in place of the result's PRODUCT: the same seven letters, so the four fit as the result's do.
    const result = resultViewModel({
      state: 'AUTHENTIC',
      scanId: '4515b884-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
      verifiedAt: '2026-10-01T08:30:00.000Z',
      title: 'AUTHENTIC',
      message: 'm',
      product: { productId: 'O26-J-00184', category: { code: 'J', name: 'Jewelry' }, model: 'M', type: 'T', material: 'S', createdYear: 2026 },
    });
    const width = (labels: string[]) => labels.join('').length;
    expect(width(PIECE_TABS.map((t) => PIECE_TAB_LABELS[t]))).toBe(width(result.tabs.map((t) => t.toUpperCase())));
  });

  it('says since when the piece is the owner\'s, how it came, whether the ownership is verified', () => {
    const m = pieceModel(piece());
    expect(m.status).toBe('REGISTERED TO YOU');
    // ACQUIRED, OWNERSHIP, SINCE, as a piece's OWNERSHIP tab sets them (C4).
    expect(m.ownershipRows).toEqual([
      ['ACQUIRED', 'FIRST REGISTRATION'],
      ['OWNERSHIP', 'VERIFIED'],
      ['SINCE', '1 OCT 2026'],
    ]);
    expect(m.ownershipNotes).toEqual([]);
    const unverified = pieceModel(piece({ verified: false, acquiredVia: 'TRANSFER' }));
    expect(unverified.ownershipRows.slice(0, 2)).toEqual([
      ['ACQUIRED', 'TRANSFER'],
      ['OWNERSHIP', 'NOT YET VERIFIED'],
    ]);
    expect(unverified.ownershipNotes).toEqual(['ORBES Client Services may ask for a proof of purchase to verify your ownership.']);
    expect(pieceModel(piece({ acquiredVia: 'ADMIN' })).ownershipRows[0]).toEqual(['ACQUIRED', 'ORBES CLIENT SERVICES']);
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

describe('MY PIECES: the CARE tab (P-M02)', () => {
  it('shows the care of the piece\'s model as a result\'s CARE tab does, else the general care text', () => {
    expect(pieceModel(piece()).care).toBe('Store on its own in the ORBES pouch.');
    expect(pieceModel(piece({ care: '  Wipe with a soft cloth.  ' })).care).toBe('Wipe with a soft cloth.');
    for (const care of [null, '', '   ']) expect(pieceModel(piece({ care })).care, String(care)).toBe(DEFAULT_CARE);
    // The very text of the result's CARE tab for the same model.
    const vm = resultViewModel({
      state: 'AUTHENTIC',
      scanId: '4515b884-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
      verifiedAt: '2026-10-01T08:30:00.000Z',
      title: 'AUTHENTIC',
      message: 'm',
      product: { productId: 'O26-J-00184', category: { code: 'J', name: 'Jewelry' }, model: 'M', type: 'T', material: 'S', createdYear: 2026, care: 'Store on its own in the ORBES pouch.' },
    });
    expect(pieceModel(piece()).care).toBe(vm.care);
  });

  it('presents ORBES Care: annual care, priority repair and an extended warranty', () => {
    const m = careOfferModel({});
    expect(m.label).toBe('ORBES CARE');
    expect(m.benefits).toHaveLength(3);
    expect(m.benefits[0]).toMatch(/annual care/i);
    expect(m.benefits[1]).toMatch(/priority repair/i);
    expect(m.benefits[2]).toMatch(/extended warranty/i);
  });

  it('offers SUBSCRIBE, a link to the subscription page, only when ORBES publishes an https one; otherwise says subscriptions open soon', () => {
    const url = 'https://whop.com/orbes/care';
    expect(careOfferModel({ careSubscribeUrl: url })).toMatchObject({
      subscribe: { href: url, text: 'SUBSCRIBE', label: 'Subscribe to ORBES Care, in a new tab' },
      soon: null,
    });
    // The contact of ORBES Client Services is not needed for it, nor does it need the link.
    expect(careOfferModel({ email: 'clientservices@theorbes.com', careSubscribeUrl: url }).subscribe?.href).toBe(url);
    for (const cs of [undefined, {}, { email: 'clientservices@theorbes.com' }]) {
      expect(careOfferModel(cs)).toMatchObject({ subscribe: null, soon: 'Subscriptions open soon.' });
    }
    // Checked again in the browser, as the server does (config.ts): https only, no credentials, no space.
    for (const bad of ['http://whop.com/orbes', 'javascript:alert(1)', 'https://user:pw@whop.com/orbes', 'https://whop.com/a b', '//whop.com/orbes', 'whop.com/orbes', `https://whop.com/${'a'.repeat(2048)}`, '']) {
      expect(careOfferModel({ careSubscribeUrl: bad }), bad).toMatchObject({ subscribe: null, soon: ORBES_CARE.soon });
    }
    expect(careOfferModel({ careSubscribeUrl: 42 as unknown as string }).subscribe).toBeNull();
  });

  it('speaks of pieces and care, never products, in the brand\'s words', () => {
    const lines = [ORBES_CARE.careLabel, ORBES_CARE.label, ORBES_CARE.lead, ...ORBES_CARE.benefits, ORBES_CARE.subscribe, ORBES_CARE.subscribeLabel, ORBES_CARE.soon];
    for (const line of lines) expect(line, line).not.toMatch(/\bproducts?\b|\btokens?\b|\bNFT\b|crypto|lottery|\bREAL\b|alert|warning|!/i);
    for (const label of [ORBES_CARE.careLabel, ORBES_CARE.label, ORBES_CARE.subscribe]) expect(label).toMatch(/^[A-Z ]+$/);
    // A plain sentence, nothing to press, while no subscription page is published.
    expect(ORBES_CARE.soon).toBe('Subscriptions open soon.');
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

describe('MY PIECES (plan NOCTURNE, N5): a piece in the list and on its page (C3, C4)', () => {
  it('names its model, says its type, material and size in the list, its lines with SIZE on its page (addition 1)', () => {
    const m = pieceModel(piece({ type: 'Bracelet', variant: '17' }));
    expect(m.name).toBe('MONOLITHE');
    expect(m.listLine).toBe('BRACELET · 925 STERLING SILVER · SIZE 17');
    expect(m.pieceLines).toEqual(['BRACELET', 'JEWELRY', '925 STERLING SILVER', 'SIZE 17', 'CREATED 2026']);
    // A size written with its word is not named twice; none, no size.
    expect(pieceModel(piece()).listLine).toBe('RING · 925 STERLING SILVER · SIZE 52');
    expect(pieceModel(piece({ variant: null })).listLine).toBe('RING · 925 STERLING SILVER');
  });

  it('says its state in one line: REGISTERED TO YOU since its date, with the check; else its status alone', () => {
    const m = pieceModel(piece());
    expect(m.stateLine).toBe('REGISTERED TO YOU · SINCE 1 OCT 2026');
    expect(m.registered).toBe(true);
    const lost = pieceModel(piece({ incident: 'LOST', incidentResolvable: true }));
    expect([lost.stateLine, lost.registered]).toEqual(['REPORTED LOST', false]);
    expect(pieceModel(piece({ incident: 'STOLEN' })).stateLine).toBe('REPORTED STOLEN');
    expect(pieceModel(piece({ transfer: { pending: true, expiresAt: '2026-10-08T08:13:21.929Z' } })).stateLine).toBe('TRANSFER PENDING');
    expect(pieceModel(piece({ inService: true })).stateLine).toBe('IN SERVICE');
    // Its model's sheet, when it is PUBLIC in THE COLLECTION.
    expect(pieceModel(piece({ lookbook: 'monolithe' })).lookbook).toBe('monolithe');
    expect(pieceModel(piece({ lookbook: null })).lookbook).toBeNull();
  });

  it('says where it comes from (addition 2): its release by the day it took place, its order and its step; nothing without an order', () => {
    const now = new Date('2026-10-05T16:49:00.000Z');
    const origin = {
      release: { id: '6b2f9a52-0c1e-4d2a-9f3b-2c4d5e6f7a8b', mode: 'DRAW' as const, at: '2026-09-14T18:01:00.000Z' },
      order: { reference: 'OR-7C21A9F0', channel: 'DRAW' as const, status: 'DELIVERED' as const, at: '2026-09-22T12:00:00.000Z' },
    };
    expect(pieceOriginModel(origin, now, 120)).toEqual({
      release: { id: origin.release.id, title: 'THE DRAW OF 14 SEPTEMBER', href: `/verify/releases/${origin.release.id}` },
      order: { reference: 'OR-7C21A9F0', title: 'ORDER OR-7C21A9F0', line: 'DELIVERED ON 22 SEP 2026' },
    });
    expect(pieceOriginModel({ ...origin, release: { ...origin.release, mode: 'LIVE', at: '2026-10-05T03:00:00.000Z' } }, now, 120)!.release!.title).toBe('THE LIVE RELEASE OF 5 OCTOBER');
    // The private salon: the order alone.
    expect(pieceOriginModel({ ...origin, release: null }, now, 120)!.release).toBeNull();
    // A boutique sale: nothing; an order the app cannot read: nothing either.
    expect(pieceOriginModel(null, now)).toBeNull();
    expect(pieceOriginModel(undefined, now)).toBeNull();
    expect(pieceOriginModel({ ...origin, order: { ...origin.order, reference: '"><b>' } }, now)).toBeNull();
    expect(pieceOriginModel({ ...origin, order: { ...origin.order, status: 'LOST' as never } }, now)).toBeNull();
    // On the piece: read with it, this phone's clock.
    expect(pieceModel(piece({ origin }), { now, offsetMinutes: 120 }).origin).toEqual(pieceOriginModel(origin, now, 120));
    expect(pieceModel(piece()).origin).toBeNull();
  });

  it('names the day of a release on this phone\'s calendar, its year only when it is not this one', () => {
    const now = new Date('2026-10-05T16:49:00.000Z');
    expect(releaseDay('2026-09-14T18:01:00.000Z', now, 120)).toBe('14 SEPTEMBER');
    expect(releaseDay('2026-09-14T23:30:00.000Z', now, 120)).toBe('15 SEPTEMBER');
    expect(releaseDay('2025-12-31T10:00:00.000Z', now, 0)).toBe('31 DECEMBER 2025');
    expect(releaseDay('not a date', now)).toBe('');
  });
});
