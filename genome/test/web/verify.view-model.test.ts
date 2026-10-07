import { describe, expect, it } from 'vitest';
import { UNUSUAL_ACTIVITY_OWNER_COPY, VERIFICATION_COPY } from '../../src/server/services/copy.js';
import { ApiError } from '../../src/web/verify/api.js';
import {
  ACCOUNT_PASSWORD,
  ACTION_LABELS,
  ASSURANCE_NOTE,
  classifyCameraError,
  CONTACT,
  DEFAULT_CARE,
  MESSAGES,
  DISCONTINUED,
  FALLBACK_TITLES,
  HINTS,
  NOT_DELIVERED_NOTE,
  PHOTOS,
  PROBLEMS,
  problemForApiError,
  RECEIVING,
  REPORT,
  RESALE_ACTION,
  RESALE_GUIDANCE,
  STAFF_SCAN_NOTE,
  STATUS,
  type ProblemKind,
} from '../../src/web/verify/copy.js';
import { storyCardModel } from '../../src/web/verify/story-card.js';
import { VERIFICATION_STATES, type VerificationState, type VerifyOutcome } from '../../src/web/verify/types.js';
import {
  discontinuedYearOf,
  formatDate,
  formatDateLong,
  formatDateTime,
  formatDateTimeLong,
  initialTab,
  isAuthenticState,
  modelWithVariant,
  normalizeCodeInput,
  photoModels,
  pieceLines,
  recoveryContactModel,
  registrationOpen,
  resultViewModel,
  shortReference,
  splitTitle,
  toneOf,
} from '../../src/web/verify/view-model.js';

const GENOME = {
  id: 'O26-J-00184',
  version: 'GENOME-01',
  fingerprint: 'G1-E1DC-BE52',
  glyphs: [14, 1, 13, 12, 11, 14, 5, 2],
  ids: ['QUARTER_ORB_SW', 'RING_POINT', 'QUARTER_ORB_SE', 'QUARTER_ORB_NE', 'ARC_PAIR_NWSE', 'QUARTER_ORB_SW', 'HALF_ARC_E', 'SMALL_ORBIT'],
};

const PRODUCT = {
  productId: 'O26-J-00184',
  category: { code: 'J', name: 'Jewelry' },
  collection: 'Orbit',
  model: 'Monolithe',
  type: 'Ring',
  material: '925 Sterling Silver',
  createdYear: 2026,
  productionDate: '2026-09-12',
  care: 'Wipe with a soft, dry cloth.',
};

function outcome(state: VerificationState, extra: Partial<VerifyOutcome> = {}): VerifyOutcome {
  const authentic = state.startsWith('AUTHENTIC');
  return {
    state,
    scanId: '4515b884-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
    verifiedAt: '2026-10-01T08:30:00.000Z',
    title: VERIFICATION_COPY[state].title,
    message: VERIFICATION_COPY[state].message,
    ...(authentic || state === 'SUSPICIOUS_ACTIVITY' || state === 'REVOKED'
      ? {
          verification: { signature: 'VALID', keyId: 1, codeVersion: 'CODE-01', genomeVersion: 'GENOME-01', issuedAt: '2026-10-01', issue: 1, assurance: 'CODE' },
          genome: GENOME,
        }
      : {}),
    ...(authentic
      ? {
          product: PRODUCT,
          warranty: { status: 'ACTIVE', startDate: '2026-09-20', endDate: '2028-09-20' },
          ownership: { registered: false, you: false },
        }
      : {}),
    ...extra,
  } as VerifyOutcome;
}

describe('verify view-model: tone and titles', () => {
  it('maps every state to a tone; only AUTHENTIC* are positive', () => {
    const tones = Object.fromEntries(VERIFICATION_STATES.map((s) => [s, toneOf(s)]));
    expect(tones).toEqual({
      AUTHENTIC: 'authentic',
      AUTHENTIC_FIRST_REGISTRATION: 'authentic',
      AUTHENTIC_REGISTERED: 'authentic',
      AUTHENTIC_OWNERSHIP_VERIFIED: 'authentic',
      SUSPICIOUS_ACTIVITY: 'caution',
      REVOKED: 'void',
      UNKNOWN: 'void',
      INVALID_SIGNATURE: 'void',
      MALFORMED_CODE: 'caution',
    });
    expect(VERIFICATION_STATES.filter(isAuthenticState)).toHaveLength(4);
  });

  it('splits server titles into a main title and a sub-title', () => {
    expect(splitTitle('AUTHENTIC — FIRST REGISTRATION')).toEqual({ main: 'AUTHENTIC', sub: 'FIRST REGISTRATION' });
    expect(splitTitle('AUTHENTIC - REGISTERED')).toEqual({ main: 'AUTHENTIC', sub: 'REGISTERED' });
    expect(splitTitle('UNUSUAL ACTIVITY DETECTED')).toEqual({ main: 'UNUSUAL ACTIVITY DETECTED' });
    // A hyphen inside a word is not a separator.
    expect(splitTitle('NON-STANDARD')).toEqual({ main: 'NON-STANDARD' });
  });

  it('keeps the fallback titles identical to the server copy', () => {
    for (const s of VERIFICATION_STATES) expect(FALLBACK_TITLES[s], s).toBe(VERIFICATION_COPY[s].title);
  });
});

describe('verify view-model: AUTHENTIC', () => {
  const vm = resultViewModel(outcome('AUTHENTIC'), { offsetMinutes: 120 });

  it('shows the state, the genome and the brand product lines', () => {
    expect(vm.tone).toBe('authentic');
    expect(vm.titleMain).toBe('AUTHENTIC');
    expect(vm.titleSub).toBeUndefined();
    expect(vm.message).toBe(VERIFICATION_COPY.AUTHENTIC.message);
    expect(vm.genome).toMatchObject({ id: 'O26-J-00184', fingerprint: 'G1-E1DC-BE52', versionNumber: 1, glyphs: GENOME.glyphs });
    expect(vm.productLines).toEqual(['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
  });

  it('offers the four tabs in the specified order', () => {
    expect(vm.tabs).toEqual(['product', 'warranty', 'care', 'ownership']);
  });

  it('fills the product and verification rows', () => {
    expect(vm.productRows).toEqual([
      ['PRODUCT ID', 'O26-J-00184'],
      ['COLLECTION', 'ORBIT'],
      ['MODEL', 'MONOLITHE'],
      ['TYPE', 'RING'],
      ['CATEGORY', 'JEWELRY'],
      ['MATERIAL', '925 STERLING SILVER'],
      ['CREATED', '2026'],
      ['PRODUCTION DATE', '12 SEP 2026'],
    ]);
    expect(vm.verificationRows).toEqual([
      ['SIGNATURE', 'VALID · ORBES KEY 01'],
      ['CODE', 'CODE-01 · ISSUE 1'],
      ['GENOME', 'GENOME-01'],
      ['ISSUED', '1 OCT 2026'],
      ['ASSURANCE', 'PRINTED CODE'],
    ]);
    expect(vm.assuranceNote).toBeUndefined();
  });

  it('describes the warranty, the care and the limits of a code', () => {
    expect(vm.warranty).toEqual({
      status: 'ACTIVE',
      rows: [
        ['STATUS', 'ACTIVE'],
        ['FROM', '20 SEP 2026'],
        ['UNTIL', '20 SEP 2028'],
      ],
      note: 'This piece is covered by the ORBES warranty until 20 September 2028.',
    });
    expect(vm.care).toBe('Wipe with a soft, dry cloth.');
    expect(vm.footnote).toBe(ASSURANCE_NOTE);
    expect(vm.footnote).toMatch(/cannot prove that an object is genuine/);
  });

  it('shows the time of verification in the viewer zone and a short reference', () => {
    expect(vm.verifiedAt).toBe('1 OCT 2026 · 10:30');
    expect(vm.reference).toBe('4515B884');
  });

  it('has no ownership action when the piece is not yet registrable', () => {
    expect(vm.ownership).toEqual({ kind: 'unregistered' });
  });

  it('keeps the size out of the brand lines (contract §4) but lists it as SIZE (NOCTURNE N1: the field set at issuance, formerly VARIANT; a value written before as it is), and falls back to the default care text', () => {
    // The demo's O26-J-00184 is a SIZE 52 MONOLITHE RING: its lines read MONOLITHE / RING / JEWELRY / 925 STERLING SILVER / CREATED 2026.
    const v = resultViewModel(outcome('AUTHENTIC', { product: { ...PRODUCT, variant: 'Size 52', care: '  ' } }));
    expect(v.productLines).toEqual(['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
    expect(v.productRows).toContainEqual(['SIZE', 'SIZE 52']);
    expect(v.productRows.map((r) => r[0])).not.toContain('VARIANT');
    expect(v.care).toBe(DEFAULT_CARE);
  });
});

describe('verify view-model: the model\'s name and the piece\'s lines of a result (NOCTURNE N4, C9; addition 1)', () => {
  it('sets the model\'s name over TYPE / CATEGORY / MATERIAL / SIZE / CREATED, the size as written at issuance', () => {
    const vm = resultViewModel(outcome('AUTHENTIC', { product: { ...PRODUCT, variant: '17' } }));
    expect(vm.modelName).toBe('MONOLITHE');
    expect(vm.pieceLines).toEqual(['RING', 'JEWELRY', '925 STERLING SILVER', 'SIZE 17', 'CREATED 2026']);
    // The brand lines of MY PIECES (contract §4) are as they were.
    expect(vm.productLines).toEqual(['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
  });

  it('names a value written with its word once, leaves out a size never written, and ends with DISCONTINUED', () => {
    expect(pieceLines({ ...PRODUCT, variant: 'Size 52' })).toEqual(['RING', 'JEWELRY', '925 STERLING SILVER', 'SIZE 52', 'CREATED 2026']);
    expect(pieceLines({ ...PRODUCT, variant: '  ' })).toEqual(['RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
    expect(pieceLines({ ...PRODUCT, variant: null })).toEqual(['RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
    expect(pieceLines({ ...PRODUCT, variant: '16', discontinuedYear: 2027 }).slice(-2)).toEqual(['CREATED 2026', 'DISCONTINUED · 2027']);
  });

  it('has neither on a result that is not authentic', () => {
    const vm = resultViewModel(outcome('INVALID_SIGNATURE'));
    expect(vm.modelName).toBeUndefined();
    expect(vm.pieceLines).toEqual([]);
  });
});

describe('verify view-model: DISCONTINUED (P-R06)', () => {
  it('says DISCONTINUED · <year> last of the brand lines, and its row in PRODUCT, when the server sends the year', () => {
    const vm = resultViewModel(outcome('AUTHENTIC_REGISTERED', { product: { ...PRODUCT, discontinuedYear: 2027 } }));
    expect(vm.productLines).toEqual(['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026', 'DISCONTINUED · 2027']);
    expect(vm.productLines.at(-1)).toBe(DISCONTINUED.line(2027));
    expect(vm.productRows.slice(-2)).toEqual([
      ['PRODUCTION DATE', '12 SEP 2026'],
      ['DISCONTINUED', '2027'],
    ]);
    // The piece still verifies as it did: the state, the tabs and the rest of the result are unchanged.
    expect(vm.tone).toBe('authentic');
    expect(vm.tabs).toEqual(['product', 'warranty', 'care', 'ownership']);
  });

  it('says nothing without a year, nor for one that is not a year', () => {
    for (const discontinuedYear of [undefined, 0, 2027.5, 99999, '2027' as unknown as number, null as unknown as number]) {
      const vm = resultViewModel(outcome('AUTHENTIC', { product: { ...PRODUCT, ...(discontinuedYear === undefined ? {} : { discontinuedYear }) } }));
      expect(vm.productLines, String(discontinuedYear)).toEqual(['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
      expect(vm.productRows.some(([label]) => label === 'DISCONTINUED'), String(discontinuedYear)).toBe(false);
    }
    expect(discontinuedYearOf(2027)).toBe(2027);
    expect(discontinuedYearOf(-2027)).toBeNull();
  });

  it('writes its line in the house voice: capitals, no word of BRAND §4.5', () => {
    expect(DISCONTINUED.line(2027)).toBe('DISCONTINUED · 2027');
    expect(DISCONTINUED.row).toBe('DISCONTINUED');
  });
});

describe('verify view-model: ownership modes', () => {
  it('FIRST_REGISTRATION opens registration with the scan token', () => {
    const vm = resultViewModel(
      outcome('AUTHENTIC_FIRST_REGISTRATION', { registration: { token: 'tok_abc', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: true } }),
    );
    expect(vm.titleMain).toBe('AUTHENTIC');
    expect(vm.titleSub).toBe('FIRST REGISTRATION');
    expect(vm.ownership).toEqual({ kind: 'register', token: 'tok_abc', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: true, underReview: false });
  });

  it('FIRST_REGISTRATION of a staff scan (S-07, `staffScan`): nothing to register, and the tab says why', () => {
    const vm = resultViewModel(outcome('AUTHENTIC_FIRST_REGISTRATION', { staffScan: true }));
    expect(vm.ownership).toEqual({ kind: 'staff' });
    // Not the registration's tab: the result opens on PRODUCT as for any piece the viewer cannot register.
    expect(vm.tabs).toEqual(['product', 'warranty', 'care', 'ownership']);
    // The flag decides, not the absence of a token: a staff scan never registers, a customer's scan without a token cannot.
    expect(
      resultViewModel(outcome('AUTHENTIC_FIRST_REGISTRATION', { staffScan: true, registration: { token: 'tok', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: false } })).ownership,
    ).toEqual({ kind: 'staff' });
    expect(resultViewModel(outcome('AUTHENTIC_FIRST_REGISTRATION')).ownership).toEqual({ kind: 'unregistered' });
    expect(resultViewModel(outcome('AUTHENTIC_FIRST_REGISTRATION', { registration: { token: '', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: false } })).ownership).toEqual({
      kind: 'unregistered',
    });
  });

  it('OWNERSHIP_VERIFIED is the viewer’s own piece, with any pending transfer', () => {
    const vm = resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', { ownership: { registered: true, you: true, transferPending: true } }));
    expect(vm.titleSub).toBe('OWNERSHIP VERIFIED');
    expect(vm.ownership).toEqual({ kind: 'yours', productId: 'O26-J-00184', transferPending: true });
    expect(vm.notice).toBeUndefined();
  });

  it('tells the owner about unusual activity once: the server message already says it, so no second notice', () => {
    const vm = resultViewModel(
      outcome('AUTHENTIC_OWNERSHIP_VERIFIED', { notice: 'UNUSUAL_ACTIVITY', message: UNUSUAL_ACTIVITY_OWNER_COPY.message, ownership: { registered: true, you: true } }),
    );
    expect(vm.message).toMatch(/Unusual activity has been recorded/);
    expect(vm.notice).toBeUndefined();
    expect(vm.tone).toBe('authentic');
  });

  it('keeps the owner notice when the server message does not mention the unusual activity', () => {
    const vm = resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', { notice: 'UNUSUAL_ACTIVITY', ownership: { registered: true, you: true } }));
    expect(vm.message).not.toMatch(/unusual activity/i);
    expect(vm.notice).toMatch(/Unusual activity has been recorded/);
  });

  it('REGISTERED belongs to someone else', () => {
    const vm = resultViewModel(outcome('AUTHENTIC_REGISTERED', { ownership: { registered: true, you: false } }));
    expect(vm.ownership).toEqual({ kind: 'registered', productId: 'O26-J-00184', transferPending: false });
    expect(initialTab(vm)).toBe('product');
  });

  describe('REGISTERED with the transfer window of this scan (F-03)', () => {
    const transfer = { token: 'tok_transfer', expiresAt: '2026-10-01T08:45:00.000Z' };

    it('carries the window beside the pending transfer it is for, and opens on OWNERSHIP', () => {
      const vm = resultViewModel(outcome('AUTHENTIC_REGISTERED', { ownership: { registered: true, you: false, transferPending: true }, transfer }));
      expect(vm.ownership).toEqual({ kind: 'registered', productId: 'O26-J-00184', transferPending: true, transfer });
      expect(initialTab(vm)).toBe('ownership');
      // Without a window (signed out, or signed in after the scan), the result opens on PRODUCT as before.
      const pending = resultViewModel(outcome('AUTHENTIC_REGISTERED', { ownership: { registered: true, you: false, transferPending: true } }));
      expect(pending.ownership).toEqual({ kind: 'registered', productId: 'O26-J-00184', transferPending: true });
      expect(initialTab(pending)).toBe('product');
    });

    it('never infers a window the server did not give with a pending transfer', () => {
      expect(resultViewModel(outcome('AUTHENTIC_REGISTERED', { ownership: { registered: true, you: false }, transfer })).ownership).toEqual({
        kind: 'registered',
        productId: 'O26-J-00184',
        transferPending: false,
      });
      for (const bad of [{ ...transfer, token: '' }, { token: 7, expiresAt: transfer.expiresAt }, { token: 'x' }]) {
        const vm = resultViewModel(outcome('AUTHENTIC_REGISTERED', { ownership: { registered: true, you: false, transferPending: true }, transfer: bad as unknown as typeof transfer }));
        expect(vm.ownership).not.toHaveProperty('transfer');
      }
      // The owner's own piece and a first registration take no transfer, whatever they carry.
      expect(resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', { ownership: { registered: true, you: true, transferPending: true }, transfer })).ownership.kind).toBe('yours');
      expect(initialTab(resultViewModel(outcome('AUTHENTIC_FIRST_REGISTRATION', { registration: { token: 't', expiresAt: transfer.expiresAt, claimCodeRequired: false } })))).toBe('ownership');
      // A result that is neither authentic nor UNUSUAL ACTIVITY takes none either.
      for (const state of ['REVOKED', 'UNKNOWN', 'INVALID_SIGNATURE'] as const) expect(resultViewModel(outcome(state, { transfer })).ownership).toEqual({ kind: 'unregistered' });
    });

    it('UNUSUAL ACTIVITY with a transfer window (the server\'s exception): the piece its GENOME names, under review, no tabs', () => {
      const vm = resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { transfer }));
      expect(vm.ownership).toEqual({ kind: 'registered', productId: GENOME.id, transferPending: true, transfer, underReview: true });
      expect(vm.tabs).toEqual([]);
      expect(vm.productLines).toEqual([]);
      // The reference of the scan for Client Services, and FORGOTTEN PASSWORD? where the sign-in may be offered.
      expect(resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { transfer }), { clientServices: { email: 'clientservices@theorbes.com' } }).recoveryContact).toBeDefined();
      // Without a usable window, or without a GENOME naming a piece, nothing to receive.
      expect(resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { transfer: { ...transfer, token: '' } })).ownership).toEqual({ kind: 'unregistered' });
      expect(resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { transfer, genome: undefined })).ownership).toEqual({ kind: 'unregistered' });
      expect(resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { transfer, genome: { ...GENOME, id: 'not a piece' } })).ownership).toEqual({ kind: 'unregistered' });
      // A registration token with the claim code required comes first (an unowned piece has no transfer anyway).
      const registration = { token: 'tok_reg', expiresAt: transfer.expiresAt, claimCodeRequired: true };
      expect(resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { transfer, registration })).ownership.kind).toBe('register');
    });

    it('a staff scan (S-07) of a piece whose transfer is pending names the console session: no window, and no VERIFY AGAIN', () => {
      // The server gives a staff scan no window: verifying again in this browser would only repeat it.
      const vm = resultViewModel(outcome('AUTHENTIC_REGISTERED', { staffScan: true, ownership: { registered: true, you: false, transferPending: true } }));
      expect(vm.ownership).toEqual({ kind: 'registered', productId: 'O26-J-00184', transferPending: true, staff: true });
      expect(vm.ownership).not.toHaveProperty('transfer');
      expect(initialTab(vm)).toBe('product');
      // A window sent anyway is not used on a staff scan.
      expect(resultViewModel(outcome('AUTHENTIC_REGISTERED', { staffScan: true, ownership: { registered: true, you: false, transferPending: true }, transfer })).ownership).toEqual({
        kind: 'registered',
        productId: 'O26-J-00184',
        transferPending: true,
        staff: true,
      });
      // Without a pending transfer there is nothing to receive: an owner who signs in and verifies again is still recognised.
      expect(resultViewModel(outcome('AUTHENTIC_REGISTERED', { staffScan: true, ownership: { registered: true, you: false } })).ownership).toEqual({ kind: 'registered', productId: 'O26-J-00184', transferPending: false });
      expect(RECEIVING.staffScan).toMatch(/scan it in a browser that is not signed in to the console\.$/);
    });

    it('counts the windows on this device\'s clock: one 20 minutes fast still offers the 15 minutes of the scan', () => {
      // The scan at 08:30 server time; the window ends at 08:45. The device's clock reads 08:50 when the result arrives.
      const receivedAt = Date.parse('2026-10-01T08:50:00.000Z');
      const registration = { token: 'tok_reg', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: false };
      const reg = resultViewModel(outcome('AUTHENTIC_FIRST_REGISTRATION', { registration }), { receivedAt }).ownership as { kind: 'register'; expiresAt: string };
      expect(reg.expiresAt).toBe('2026-10-01T09:05:00.000Z');
      expect(registrationOpen(reg.expiresAt, receivedAt + 14 * 60_000)).toBe(true);
      expect(registrationOpen(reg.expiresAt, receivedAt + 15 * 60_000)).toBe(false);
      // Without the shift, the same device would have found the window closed on arrival.
      expect(registrationOpen(registration.expiresAt, receivedAt)).toBe(false);
      const pending = { ownership: { registered: true, you: false, transferPending: true }, transfer };
      const win = (resultViewModel(outcome('AUTHENTIC_REGISTERED', pending), { receivedAt }).ownership as { transfer: { token: string; expiresAt: string } }).transfer;
      expect(win).toEqual({ token: 'tok_transfer', expiresAt: '2026-10-01T09:05:00.000Z' });
      // A clock 10 minutes slow: the window ends 15 minutes after arrival on that clock too, never later.
      const slow = Date.parse('2026-10-01T08:20:00.000Z');
      const late = (resultViewModel(outcome('AUTHENTIC_REGISTERED', pending), { receivedAt: slow }).ownership as { transfer: { expiresAt: string } }).transfer;
      expect(late.expiresAt).toBe('2026-10-01T08:35:00.000Z');
      // On an UNUSUAL ACTIVITY result as well; and without an arrival time, the server's expiry as written.
      expect((resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { transfer }), { receivedAt }).ownership as { transfer: { expiresAt: string } }).transfer.expiresAt).toBe('2026-10-01T09:05:00.000Z');
      expect((resultViewModel(outcome('AUTHENTIC_REGISTERED', pending)).ownership as { transfer: { expiresAt: string } }).transfer.expiresAt).toBe(transfer.expiresAt);
    });

    it('speaks of the piece and of a scan, never of a token, a product or blame (BRAND §4.5)', () => {
      expect(RECEIVING.title).toBe('RECEIVING THIS PIECE');
      expect(RECEIVING.submit).toBe('RECEIVE THIS PIECE');
      expect(RECEIVING.until('13:14')).toBe('RECEIVING OPEN UNTIL 13:14');
      const words = Object.values(RECEIVING).map((v) => (typeof v === 'string' ? v : v('13:14'))).join(' ');
      expect(words).not.toMatch(/token|\bproducts?\b|fake|counterfeit|fraud|stolen|support|genuine|!/i);
    });
  });
});

describe('verify view-model: the second-hand guidance (J-02)', () => {
  const registered = (extra: Partial<VerifyOutcome> = {}) => outcome('AUTHENTIC_REGISTERED', { ownership: { registered: true, you: false }, ...extra });

  it('tells a buyer under AUTHENTIC — REGISTERED to ask the seller for a transfer code, with a link to RECEIVING THIS PIECE', () => {
    const vm = resultViewModel(registered());
    expect(vm.notice).toBe(RESALE_GUIDANCE);
    expect(vm.noticeLink).toEqual({ label: RESALE_ACTION, tab: 'ownership' });
    expect(vm.tabs).toContain('ownership');
    expect(vm.ownership.kind).toBe('registered');
    // The same while a transfer is pending, and whatever the warranty says.
    for (const extra of [{ ownership: { registered: true, you: false, transferPending: true } }, { warranty: { status: 'VOID' as const } }]) {
      const other = resultViewModel(registered(extra));
      expect(other.notice).toBe(RESALE_GUIDANCE);
      expect(other.noticeLink).toEqual({ label: RESALE_ACTION, tab: 'ownership' });
    }
  });

  it('is said for AUTHENTIC — REGISTERED only: never on OWNERSHIP VERIFIED, FIRST REGISTRATION nor any other state', () => {
    const registration = { token: 'tok_scan', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: true };
    for (const state of VERIFICATION_STATES.filter((s) => s !== 'AUTHENTIC_REGISTERED')) {
      for (const extra of [{}, { ownership: { registered: true, you: false } }, { ownership: { registered: true, you: true } }, { registration }]) {
        const vm = resultViewModel(outcome(state, extra));
        expect(vm.notice, state).not.toBe(RESALE_GUIDANCE);
        expect(vm.noticeLink, state).toBeUndefined();
      }
    }
    // The viewer's own piece, and the first registration (no owner, so no transfer code can exist yet).
    expect(resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', { ownership: { registered: true, you: true } })).notice).toBeUndefined();
    expect(resultViewModel(outcome('AUTHENTIC_FIRST_REGISTRATION', { registration })).notice).toBeUndefined();
  });

  it('never covers a notice of unusual activity, said by the notice or by the server message', () => {
    const own = resultViewModel(registered({ notice: 'UNUSUAL_ACTIVITY' }));
    expect(own.notice).toMatch(/^Unusual activity has been recorded/);
    expect(own.noticeLink).toBeUndefined();
    const said = resultViewModel(registered({ notice: 'UNUSUAL_ACTIVITY', message: UNUSUAL_ACTIVITY_OWNER_COPY.message }));
    expect(said.notice).toBeUndefined();
    expect(said.noticeLink).toBeUndefined();
  });

  it('links only where the OWNERSHIP tab shows RECEIVING THIS PIECE', () => {
    // A response without its ownership block: the sentence stands, but there is no section to open.
    const vm = resultViewModel(outcome('AUTHENTIC_REGISTERED', { ownership: undefined }));
    expect(vm.ownership).toEqual({ kind: 'unregistered' });
    expect(vm.notice).toBe(RESALE_GUIDANCE);
    expect(vm.noticeLink).toBeUndefined();
  });

  it('says it in the words of the packaging kit, without a word of BRAND §4.5', () => {
    expect(RESALE_GUIDANCE).toBe('Buying this piece? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one.');
    expect(RESALE_ACTION).toBe('I HAVE A TRANSFER CODE');
    for (const line of [RESALE_GUIDANCE, RESALE_ACTION]) {
      expect(line).not.toMatch(/\bproduct\b|fake|counterfeit|fraud|stolen|alert|danger|warning|genuine|token|!/i);
    }
  });
});

describe('verify view-model: the ceremony of a first registration (P-D01)', () => {
  const mine = { ownership: { registered: true, you: true } };

  it('names the model and its collection, in capitals, on the result VIEW AS OWNER opens after a first registration', () => {
    const vm = resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', mine), { ceremony: true });
    expect(vm.ceremony).toEqual({ name: 'MONOLITHE', collection: 'ORBIT' });
    // Neither a rank nor a vintage (choice 6): the GENOME, then the name and the collection, nothing else.
    expect(Object.keys(vm.ceremony!)).toEqual(['name', 'collection']);
    // The piece registered without its claim code reads AUTHENTIC — REGISTERED to its owner: the same ceremony.
    expect(resultViewModel(outcome('AUTHENTIC_REGISTERED', mine), { ceremony: true }).ceremony).toEqual({ name: 'MONOLITHE', collection: 'ORBIT' });
  });

  it('leaves the collection out when the model has none', () => {
    const vm = resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', { ...mine, product: { ...PRODUCT, collection: undefined } }), { ceremony: true });
    expect(vm.ceremony).toEqual({ name: 'MONOLITHE' });
    expect(resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', { ...mine, product: { ...PRODUCT, collection: '  ' } }), { ceremony: true }).ceremony).toEqual({ name: 'MONOLITHE' });
  });

  it('is never there without the flag: every other result, a scan, VERIFY AGAIN, a piece received', () => {
    expect(resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', mine)).ceremony).toBeUndefined();
    expect(resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', mine), { ceremony: false }).ceremony).toBeUndefined();
  });

  it('celebrates only a piece that is the reader\'s, authentic, with its GENOME and its model', () => {
    // Another account signed in meanwhile: the piece is someone else's.
    expect(resultViewModel(outcome('AUTHENTIC_REGISTERED', { ownership: { registered: true, you: false } }), { ceremony: true }).ceremony).toBeUndefined();
    expect(resultViewModel(outcome('AUTHENTIC_FIRST_REGISTRATION'), { ceremony: true }).ceremony).toBeUndefined();
    // Not authentic: no tabs, no product, no ceremony.
    for (const state of ['SUSPICIOUS_ACTIVITY', 'REVOKED', 'UNKNOWN'] as const) {
      expect(resultViewModel(outcome(state, mine), { ceremony: true }).ceremony, state).toBeUndefined();
    }
    // No GENOME to reveal (glyphs the app cannot read), or no model to name.
    expect(resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', { ...mine, genome: { ...GENOME, glyphs: [1, 2, 3] } }), { ceremony: true }).ceremony).toBeUndefined();
    expect(resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', { ...mine, product: { ...PRODUCT, model: ' ' } }), { ceremony: true }).ceremony).toBeUndefined();
  });

  it('offers both share links (BP-10): SHARE THE GENOME, and SHARE TO STORIES\'s REGISTERED card with the model\'s photograph', () => {
    const photo = `/api/v1/media/${'d'.repeat(64)}`;
    const withPhoto = { ...mine, product: { ...PRODUCT, type: 'Bracelet', modelVariant: 'Gold', imageUrl: photo } };
    const vm = resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', withPhoto), { ceremony: true, offsetMinutes: 120 });
    expect(vm.ceremony).toEqual({ name: 'MONOLITHE', collection: 'ORBIT' });
    expect(vm.story).toEqual({ photo, model: 'Monolithe', variant: 'Gold', type: 'Bracelet', collection: 'Orbit', at: '2026-10-01T08:30:00.000Z', zone: 120 });
    expect(storyCardModel('registered', vm.story!)).toEqual({ origin: 'registered', photo, status: 'REGISTERED', eyebrow: 'BRACELET · ORBIT', title: ['MONOLITHE', 'IN GOLD'], date: '1 OCTOBER 2026' });
    // Without the model's photograph: the ceremony and SHARE THE GENOME, no story card.
    const bare = resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', mine), { ceremony: true });
    expect(bare.ceremony).toBeDefined();
    expect(storyCardModel('registered', bare.story!)).toBeNull();
    // Never without the ceremony.
    expect(resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', withPhoto)).story).toBeUndefined();
    expect(resultViewModel(outcome('AUTHENTIC_REGISTERED', { ...withPhoto, ownership: { registered: true, you: false } }), { ceremony: true }).story).toBeUndefined();
  });

  it('carries neither the identity of the piece nor anything of the account', () => {
    const vm = resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', mine), { ceremony: true });
    const text = JSON.stringify(vm.ceremony);
    for (const secret of [PRODUCT.productId, GENOME.fingerprint, GENOME.id]) expect(text).not.toContain(secret);
  });
});

describe('verify view-model: negative states', () => {
  it('SUSPICIOUS_ACTIVITY shows the genome but no product, tabs or footnote', () => {
    // Defensive: even if a product block were present, a non-authentic result never shows it.
    const vm = resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { product: PRODUCT, warranty: { status: 'ACTIVE' } }));
    expect(vm.tone).toBe('caution');
    expect(vm.titleMain).toBe('UNUSUAL ACTIVITY DETECTED');
    expect(vm.genome?.id).toBe('O26-J-00184');
    expect(vm.productLines).toEqual([]);
    expect(vm.tabs).toEqual([]);
    expect(vm.warranty).toBeUndefined();
    expect(vm.footnote).toBeUndefined();
    expect(vm.ownership).toEqual({ kind: 'unregistered' });
  });

  describe('SUSPICIOUS_ACTIVITY with a registration token (the server’s step 10 exception)', () => {
    const registration = { token: 'tok_card', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: true };

    it('opens registration for the holder of the certificate card, claim code required, with the tabs left empty', () => {
      const vm = resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { registration }));
      expect(vm.ownership).toEqual({ kind: 'register', token: 'tok_card', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: true, underReview: true });
      expect(vm.tone).toBe('caution');
      expect(vm.titleMain).toBe('UNUSUAL ACTIVITY DETECTED');
      expect(vm.tabs).toEqual([]);
      // Still no product data: the section offers the sign-in and the claim code, nothing else.
      expect(vm.productLines).toEqual([]);
      expect(vm.productRows).toEqual([]);
      expect(vm.warranty).toBeUndefined();
      expect(vm.footnote).toBeUndefined();
    });

    it('never shows product data, even if a product block came with the token', () => {
      const vm = resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { registration, product: PRODUCT, warranty: { status: 'ACTIVE' }, ownership: { registered: false, you: false } }));
      expect(vm.ownership.kind).toBe('register');
      expect(vm.productLines).toEqual([]);
      expect(vm.tabs).toEqual([]);
      expect(vm.warranty).toBeUndefined();
    });

    it('offers nothing when the claim code is not required, or without a token (the same rule as the server)', () => {
      expect(resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { registration: { ...registration, claimCodeRequired: false } })).ownership).toEqual({ kind: 'unregistered' });
      expect(resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { registration: { ...registration, token: '' } })).ownership).toEqual({ kind: 'unregistered' });
      const loose = { ...registration, claimCodeRequired: 'true' } as unknown as typeof registration;
      expect(resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { registration: loose })).ownership).toEqual({ kind: 'unregistered' });
    });

    it.each(['REVOKED', 'UNKNOWN', 'INVALID_SIGNATURE', 'MALFORMED_CODE'] as const)('%s never offers registration, whatever it carries', (state) => {
      expect(resultViewModel(outcome(state, { registration })).ownership).toEqual({ kind: 'unregistered' });
    });
  });

  it('REVOKED keeps the genome for reference', () => {
    const vm = resultViewModel(outcome('REVOKED'));
    expect(vm.tone).toBe('void');
    expect(vm.titleMain).toBe('REVOKED');
    expect(vm.genome).toBeDefined();
    expect(vm.tabs).toEqual([]);
  });

  it.each(['UNKNOWN', 'INVALID_SIGNATURE', 'MALFORMED_CODE'] as const)('%s shows only the state and message', (state) => {
    const vm = resultViewModel(outcome(state));
    expect(vm.titleMain).toBe(VERIFICATION_COPY[state].title);
    expect(vm.genome).toBeUndefined();
    expect(vm.productLines).toEqual([]);
    expect(vm.verificationRows).toEqual([]);
    expect(vm.tabs).toEqual([]);
    expect(vm.footnote).toBeUndefined();
  });

  it('treats an unknown state as unreadable and never upgrades it', () => {
    const vm = resultViewModel({ ...outcome('AUTHENTIC'), state: 'GENUINE' as VerificationState, title: '' });
    expect(vm.state).toBe('MALFORMED_CODE');
    expect(vm.tone).toBe('caution');
    expect(vm.titleMain).toBe('UNREADABLE CODE');
    expect(vm.tabs).toEqual([]);
    expect(vm.productLines).toEqual([]);
  });

  it('drops a malformed genome instead of drawing it', () => {
    expect(resultViewModel(outcome('AUTHENTIC', { genome: { ...GENOME, glyphs: [1, 2, 3] } })).genome).toBeUndefined();
    expect(resultViewModel(outcome('AUTHENTIC', { genome: { ...GENOME, glyphs: [1, 2, 3, 4, 5, 6, 7, 16] } })).genome).toBeUndefined();
  });
});

describe('verify view-model: assurance and warranty notes', () => {
  it('explains a missing hardware proof without changing the state', () => {
    const o = outcome('AUTHENTIC');
    const vm = resultViewModel({ ...o, verification: { ...o.verification!, assurance: 'CODE_ONLY', hardwareProofRequired: true } });
    expect(vm.state).toBe('AUTHENTIC');
    expect(vm.verificationRows.at(-1)).toEqual(['ASSURANCE', 'PRINTED CODE ONLY']);
    expect(vm.assuranceNote).toMatch(/secure hardware check/);
  });

  it.each([
    ['NOT_STARTED', 'NOT YET STARTED', /begins on the date of purchase/],
    ['EXPIRED', 'EXPIRED', /has ended/],
    ['VOID', 'NO LONGER VALID', /no longer applies/],
  ] as const)('warranty %s', (status, label, note) => {
    const vm = resultViewModel(outcome('AUTHENTIC', { warranty: { status } }));
    expect(vm.warranty?.status).toBe(label);
    expect(vm.warranty?.rows).toEqual([['STATUS', label]]);
    expect(vm.warranty?.note).toMatch(note);
  });

  it('never surfaces fields the server did not send', () => {
    const vm = resultViewModel(outcome('AUTHENTIC'));
    const text = JSON.stringify(vm).toLowerCase();
    for (const word of ['risk', 'score', 'threshold', 'anomal', 'reason']) expect(text).not.toContain(word);
  });
});

describe('verify view-model: the photograph of an authentic piece (F-04; NOCTURNE, decision 9: the model\'s, never the piece\'s own)', () => {
  const MODEL_URL = `/api/v1/media/${'a1'.repeat(32)}`;
  const PIECE_URL = `/api/v1/media/${'b2'.repeat(32)}`;
  const withPhoto = (state: VerificationState) => outcome(state, state.startsWith('AUTHENTIC') ? { product: { ...PRODUCT, imageUrl: MODEL_URL } } : {});

  it('shows its model\'s photograph, captioned THE MODEL, its alternative text naming the model and its variant, never the piece', () => {
    for (const state of ['AUTHENTIC', 'AUTHENTIC_FIRST_REGISTRATION', 'AUTHENTIC_REGISTERED', 'AUTHENTIC_OWNERSHIP_VERIFIED'] as const) {
      expect(resultViewModel(withPhoto(state)).photos, state).toEqual([{ kind: 'model', src: MODEL_URL, alt: 'The MONOLITHE RING model, photographed by ORBES', caption: 'THE MODEL' }]);
    }
    // A variant (N1): « The MONOLITHE BRACELET model in steel, photographed by ORBES ».
    const steel = resultViewModel(outcome('AUTHENTIC', { product: { ...PRODUCT, type: 'Bracelet', modelVariant: 'Steel', imageUrl: MODEL_URL } }));
    expect(steel.photos).toEqual([{ kind: 'model', src: MODEL_URL, alt: 'The MONOLITHE BRACELET model in steel, photographed by ORBES', caption: 'THE MODEL' }]);
    expect(PHOTOS.note(1)).toBe('Photographed by ORBES. Compare it with the piece in your hands.');
    expect(Object.keys(PHOTOS)).not.toContain('piece');
  });

  it('shows only what the server sent: the model\'s photograph, or none; a piece\'s own photograph never, whatever came', () => {
    expect(resultViewModel(outcome('AUTHENTIC', { product: { ...PRODUCT, imageUrl: MODEL_URL } })).photos.map((p) => p.kind)).toEqual(['model']);
    // An older server's piece photograph is not read.
    const old = { ...PRODUCT, photoUrl: PIECE_URL } as unknown as typeof PRODUCT;
    expect(resultViewModel(outcome('AUTHENTIC', { product: old })).photos).toEqual([]);
    expect(resultViewModel(outcome('AUTHENTIC')).photos).toEqual([]);
  });

  it('never on a result that is not authentic, even if a product block came with it', () => {
    for (const state of VERIFICATION_STATES.filter((s) => !s.startsWith('AUTHENTIC'))) {
      const vm = resultViewModel(outcome(state, { product: { ...PRODUCT, imageUrl: MODEL_URL } }));
      expect(vm.photos, state).toEqual([]);
    }
  });

  it('takes a photograph only from this origin\'s media route', () => {
    for (const url of ['https://evil.example/x.jpg', '//evil.example/x.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', `/api/v1/media/${'A1'.repeat(32)}`, `/api/v1/media/${'a1'.repeat(31)}`, `/api/v1/media/${'a1'.repeat(32)}?x=1`]) {
      expect(photoModels({ model: 'M', type: 'T', imageUrl: url }), url).toEqual([]);
    }
    // The owner's list of pieces sends null for a missing photograph.
    expect(photoModels({ model: 'M', type: 'T', imageUrl: null })).toEqual([]);
  });

  it('names a model with its variant as a sentence does (N1): « MONOLITHE in blue »', () => {
    expect(modelWithVariant('MONOLITHE', 'Blue')).toBe('MONOLITHE in blue');
    expect(modelWithVariant('MONOLITHE', '  Rose   Gold ')).toBe('MONOLITHE in rose gold');
    for (const none of [null, undefined, '', '  ']) expect(modelWithVariant('MONOLITHE', none)).toBe('MONOLITHE');
  });
});

describe('verify view-model: WRITE TO ORBES CLIENT SERVICES (CS-01)', () => {
  const CS = { email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Saturday, 10:00–19:00 (Paris)' };
  const SCAN = '4515b884-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

  it.each(['SUSPICIOUS_ACTIVITY', 'MALFORMED_CODE', 'REVOKED', 'UNKNOWN', 'INVALID_SIGNATURE'] as const)('%s (caution or void) offers it under the help line, the scan attached', (state) => {
    const vm = resultViewModel(outcome(state), { offsetMinutes: 120, clientServices: CS });
    expect(vm.tone).not.toBe('authentic');
    // The scan by its id, and the label the sheet shows under CONCERNING: its REF and its result, as the server writes it.
    expect(vm.write).toEqual({ placement: 'help', context: { kind: 'SCAN', id: SCAN, label: `REF 4515B884 · ${state.replace(/_/g, ' ')}` } });
  });

  it('never builds an email, a phone or the hours for a result: the button attaches the scan, and needs no configuration', () => {
    for (const clientServices of [undefined, {}, CS]) {
      const vm = resultViewModel(outcome('INVALID_SIGNATURE'), clientServices ? { clientServices } : {});
      expect(vm.write?.context?.id).toBe(SCAN);
      expect(JSON.stringify(vm.write)).not.toMatch(/mailto:|tel:|clientservices@|\+33|Monday/);
    }
  });

  it('on an authentic result, appears only in the WARRANTY tab of a warranty that no longer applies, about the warranty', () => {
    for (const status of ['NOT_STARTED', 'ACTIVE', 'EXPIRED'] as const) {
      expect(resultViewModel(outcome('AUTHENTIC_REGISTERED', { warranty: { status } }), { clientServices: CS }).write, status).toBeUndefined();
    }
    expect(resultViewModel(outcome('AUTHENTIC', { warranty: undefined }), { clientServices: CS }).write).toBeUndefined();
    const vm = resultViewModel(outcome('AUTHENTIC_REGISTERED', { warranty: { status: 'VOID' } }), { offsetMinutes: 120, clientServices: CS });
    expect(vm.warranty?.status).toBe('NO LONGER VALID');
    expect(vm.write).toEqual({ placement: 'warranty', context: { kind: 'SCAN', id: SCAN, about: 'WARRANTY', label: 'REF 4515B884 · AUTHENTIC REGISTERED · WARRANTY NO LONGER VALID' } });
  });

  it('attaches nothing when the scan id gives none, or to a staff scan (the server refuses to attach one), the button still shown', () => {
    const vm = resultViewModel(outcome('UNKNOWN', { scanId: 'not-a-scan-id' }), { clientServices: CS });
    expect(vm.reference).toBe('');
    expect(vm.write).toEqual({ placement: 'help', context: null });
    expect(resultViewModel(outcome('UNKNOWN', { staffScan: true }), {}).write).toEqual({ placement: 'help', context: null });
  });

  it('names ORBES Client Services in full, never the forbidden "Contact support" (BRAND §4.5)', () => {
    expect(CONTACT.action).toBe('CONTACT ORBES CLIENT SERVICES');
    expect(MESSAGES.write).toBe('WRITE TO ORBES CLIENT SERVICES');
    expect(Object.values(CONTACT).join(' ')).not.toMatch(/support|product/i);
    // The only words left of the email: its action, its reference and the subject under FORGOTTEN PASSWORD?.
    expect(Object.keys(CONTACT).sort()).toEqual(['action', 'recoverySubject', 'reference']);
  });
});

describe('verify view-model: FORGOTTEN PASSWORD? (C-04)', () => {
  const CS = { email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Saturday, 10:00–19:00 (Paris)' };
  const registered = outcome('AUTHENTIC_REGISTERED', { ownership: { registered: true, you: false } });

  it('offers ORBES Client Services wherever the OWNERSHIP panel may ask for a sign-in, with an email that says why', () => {
    const vm = resultViewModel(registered, { offsetMinutes: 120, clientServices: CS });
    expect(vm.ownership.kind).toBe('registered');
    // The email alone: the phone and the hours are no longer shown in the collector app (CS-01).
    expect(vm.recoveryContact).toEqual({ placement: 'recovery', mailto: expect.stringMatching(/^mailto:clientservices@theorbes\.com\?/) });
    const m = /^mailto:([^?]+)\?subject=([^&]*)&body=([^&]*)$/.exec(vm.recoveryContact!.mailto!)!;
    expect([m[1], decodeURIComponent(m[2]), decodeURIComponent(m[3])]).toEqual(['clientservices@theorbes.com', 'ORBES — FORGOTTEN PASSWORD', '\r\n\r\nREFERENCE: 4515B884']);
    // The result's own button is unchanged: an active warranty asks for none.
    expect(vm.write).toBeUndefined();
    const firstRegistration = outcome('AUTHENTIC_FIRST_REGISTRATION', { registration: { token: 't', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: true } });
    expect(resultViewModel(firstRegistration, { clientServices: CS }).recoveryContact?.placement).toBe('recovery');
    // The certificate-card section of an UNUSUAL ACTIVITY result signs in too.
    const card = outcome('SUSPICIOUS_ACTIVITY', { registration: { token: 't', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: true } });
    expect(resultViewModel(card, { clientServices: CS }).recoveryContact?.placement).toBe('recovery');
  });

  it('is absent where no sign-in is offered, and without a usable configuration', () => {
    expect(resultViewModel(outcome('AUTHENTIC'), { clientServices: CS }).recoveryContact).toBeUndefined();
    expect(resultViewModel(outcome('INVALID_SIGNATURE'), { clientServices: CS }).recoveryContact).toBeUndefined();
    expect(resultViewModel(registered).recoveryContact).toBeUndefined();
    expect(resultViewModel(registered, { clientServices: { hours: CS.hours } }).recoveryContact).toBeUndefined();
    // A phone alone gives nothing: the email is the one way it remains.
    expect(resultViewModel(registered, { clientServices: { phone: CS.phone, hours: CS.hours } }).recoveryContact).toBeUndefined();
    expect(recoveryContactModel({ email: 'x@y.z?cc=a@b.c', phone: 'javascript:alert(1)' }, '4515B884')).toBeNull();
    // Without a reference, the email asks for nothing more than the subject says.
    expect(recoveryContactModel({ email: CS.email }, '')).toEqual({ placement: 'recovery', mailto: 'mailto:clientservices@theorbes.com?subject=ORBES%20%E2%80%94%20FORGOTTEN%20PASSWORD&body=%0D%0A' });
  });

  it('says who gives the code, how long it lasts, and what a recovery does, without blame or "support" (BRAND §4.5)', () => {
    expect(ACCOUNT_PASSWORD.forgotten).toBe('FORGOTTEN PASSWORD?');
    expect(ACCOUNT_PASSWORD.change).toBe('CHANGE PASSWORD');
    expect(ACCOUNT_PASSWORD.forgottenLead).toMatch(/ORBES Client Services .* identity, .* one-time recovery code, valid for 30 minutes\.$/);
    expect(ACCOUNT_PASSWORD.recovered('5 October 2026, 11:00')).toBe(
      'Your password has been changed: sign in with it. For your security, every session of your account has ended, its pending transfers were cancelled, its certificate links were withdrawn and new transfers are paused until 5 October 2026, 11:00.',
    );
    const words = Object.values(ACCOUNT_PASSWORD).map((v) => (typeof v === 'string' ? v : v('5 October 2026, 11:00'))).join(' ');
    expect(words).not.toMatch(/support|product|fake|counterfeit|!/i);
    expect(CONTACT.recoverySubject).toBe('ORBES — FORGOTTEN PASSWORD');
  });

  it('formats the end of the transfer pause for a sentence, in the viewer\'s zone', () => {
    expect(formatDateTimeLong('2026-10-05T09:00:00.000Z', 120)).toBe('5 October 2026, 11:00');
    expect(formatDateTimeLong('2026-12-31T23:30:00.000Z', 60)).toBe('1 January 2027, 00:30');
    expect(formatDateTimeLong('not a date')).toBe('');
  });
});

describe('verify view-model: WHERE DID YOU SEE OR BUY THIS PIECE?', () => {
  const NEGATIVE: VerificationState[] = ['SUSPICIOUS_ACTIVITY', 'MALFORMED_CODE', 'REVOKED', 'UNKNOWN', 'INVALID_SIGNATURE'];
  const CS = { email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89' };

  it('is offered on every result that was not authentic, attached to its scan and its reference, configured contact or not', () => {
    for (const state of NEGATIVE) {
      for (const clientServices of [undefined, {}, CS]) {
        const vm = resultViewModel(outcome(state, { scanId: '4515B884-1C2D-4E5F-8A9B-0C1D2E3F4A5B' }), clientServices ? { clientServices } : {});
        expect(vm.report, state).toEqual({ scanId: '4515b884-1c2d-4e5f-8a9b-0c1d2e3f4a5b', reference: '4515B884' });
      }
    }
    // Also beside the certificate-card section of an UNUSUAL ACTIVITY result that carries a registration token.
    const card = resultViewModel(outcome('SUSPICIOUS_ACTIVITY', { registration: { token: 'tok', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: true } }));
    expect(card.ownership.kind).toBe('register');
    expect(card.report?.reference).toBe('4515B884');
  });

  it('is never offered on an authentic result, nor without a scan id to attach it to', () => {
    for (const state of ['AUTHENTIC', 'AUTHENTIC_FIRST_REGISTRATION', 'AUTHENTIC_REGISTERED', 'AUTHENTIC_OWNERSHIP_VERIFIED'] as const) {
      expect(resultViewModel(outcome(state), { clientServices: CS }).report, state).toBeUndefined();
    }
    // Even the owner told about unusual activity elsewhere: the result is authentic.
    expect(resultViewModel(outcome('AUTHENTIC_OWNERSHIP_VERIFIED', { notice: 'UNUSUAL_ACTIVITY' })).report).toBeUndefined();
    for (const scanId of ['', 'not-a-scan-id', '4515b884']) expect(resultViewModel(outcome('UNKNOWN', { scanId })).report, scanId).toBeUndefined();
  });

  it('is never offered on a staff scan (S-07): a browser signed in to the console scans as staff, and a staff scan takes no report', () => {
    for (const state of NEGATIVE) {
      const vm = resultViewModel(outcome(state, { scanId: '4515B884-1C2D-4E5F-8A9B-0C1D2E3F4A5B', staffScan: true }), { clientServices: CS });
      expect(vm.report, state).toBeUndefined();
      // The rest of the result is the customer's: the reference and Client Services stay (the button, nothing attached).
      expect(vm.reference, state).toBe('4515B884');
      expect(vm.write, state).toEqual({ placement: 'help', context: null });
    }
  });

  it('asks without accusing, and asks for no contact details (BRAND §4.5)', () => {
    expect(REPORT.title).toBe('WHERE DID YOU SEE OR BUY THIS PIECE?');
    expect(Object.values(REPORT.channels)).toEqual(['BOUTIQUE', 'ONLINE', 'PRIVATE SALE', 'OTHER']);
    const all = [REPORT.title, REPORT.lead, REPORT.place, REPORT.placeHint, REPORT.note, REPORT.noteHint, REPORT.send, REPORT.sent, REPORT.kept('4515B884')].join(' ');
    expect(all).not.toMatch(/fake|counterfeit|fraud|stolen|support|product/i);
    expect(REPORT.noteHint).toMatch(/leave out your name and contact details/);
    expect(REPORT.kept('4515B884')).toBe('Your answer is kept with reference 4515B884.');
    expect(REPORT.kept('')).toBe('Your answer is kept with this scan.');
  });
});

describe('verify view-model: formatting helpers', () => {
  it('formats dates without locale dependence', () => {
    expect(formatDate('2026-01-05')).toBe('5 JAN 2026');
    expect(formatDate('2028-12-31T23:00:00.000Z')).toBe('31 DEC 2028');
    expect(formatDate('soon')).toBe('soon');
    expect(formatDate(undefined)).toBe('');
    expect(formatDateLong('2028-09-20')).toBe('20 September 2028');
    expect(formatDateLong('2028-13-01')).toBe('2028-13-01');
  });

  it('formats date-times at a fixed offset', () => {
    expect(formatDateTime('2026-10-01T23:30:00.000Z', 0)).toBe('1 OCT 2026 · 23:30');
    expect(formatDateTime('2026-10-01T23:30:00.000Z', 120)).toBe('2 OCT 2026 · 01:30');
    expect(formatDateTime('2026-10-01T01:30:00.000Z', -300)).toBe('30 SEP 2026 · 20:30');
    expect(formatDateTime('not a date')).toBe('');
  });

  it('shortens scan ids', () => {
    expect(shortReference('4515b884-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBe('4515B884');
    expect(shortReference('<script>')).toBe('');
    expect(shortReference('')).toBe('');
  });

  it('checks the registration window against the clock', () => {
    const now = Date.parse('2026-10-01T08:30:00.000Z');
    expect(registrationOpen('2026-10-01T08:45:00.000Z', now)).toBe(true);
    expect(registrationOpen('2026-10-01T08:30:00.000Z', now)).toBe(false);
    expect(registrationOpen('garbage', now)).toBe(false);
  });

  it('normalises typed claim and transfer codes', () => {
    expect(normalizeCodeInput('ab12cd34ef56')).toBe('AB12-CD34-EF56');
    expect(normalizeCodeInput(' ab12-cd34 ef56 ')).toBe('AB12-CD34-EF56');
    expect(normalizeCodeInput('ab12c')).toBe('AB12-C');
    expect(normalizeCodeInput('AB12CD34EF56XYZ')).toBe('AB12-CD34-EF56');
    expect(normalizeCodeInput('')).toBe('');
  });
});

describe('verify copy', () => {
  const kinds = Object.keys(PROBLEMS) as ProblemKind[];

  it('gives every problem a title, a sentence and labelled actions', () => {
    for (const k of kinds) {
      const p = PROBLEMS[k];
      expect(p.title, k).toMatch(/^[A-Z ,—’'-]+$/);
      expect(p.message.length, k).toBeGreaterThan(20);
      expect(ACTION_LABELS[p.primary], k).toBeDefined();
      if (p.secondary) expect(ACTION_LABELS[p.secondary], k).toBeDefined();
      expect(p.secondary, k).not.toBe(p.primary);
    }
  });

  it('every camera problem offers the photo upload', () => {
    for (const k of kinds.filter((x) => x.startsWith('camera-'))) {
      expect([PROBLEMS[k].primary, PROBLEMS[k].secondary], k).toContain('upload');
    }
  });

  it('says a piece not sold yet has not been delivered, and why a staff scan offers no registration (S-07)', () => {
    expect(NOT_DELIVERED_NOTE).toBe('This piece has not yet been delivered by ORBES or an authorised retailer. Registration opens once it has been.');
    expect(STAFF_SCAN_NOTE).toMatch(/signed in to the ORBES console/);
    expect(STAFF_SCAN_NOTE).toMatch(/registration is not offered/);
    for (const line of [NOT_DELIVERED_NOTE, STAFF_SCAN_NOTE]) {
      // The customer's object is a piece; the BRAND §4.5 words never used to the public.
      expect(line).toMatch(/\bpiece\b/);
      expect(line).not.toMatch(/\bproduct\b|fake|counterfeit|fraud|stolen|alert|danger|warning|genuine/i);
    }
  });

  it('never claims that an object is genuine', () => {
    const all = [
      ...Object.values(PROBLEMS).flatMap((p) => [p.title, p.message]),
      ...Object.values(STATUS),
      ...Object.values(HINTS),
      DEFAULT_CARE,
    ].join(' ');
    expect(all.toLowerCase()).not.toMatch(/genuine|guarantee|certif(y|ies) (that|this)/);
    // The single mention of "genuine" is the explicit limitation.
    expect(ASSURANCE_NOTE).toMatch(/cannot prove/);
  });

  it('classifies camera failures', () => {
    const env = { isSecureContext: true, hasGetUserMedia: true };
    const err = (name: string) => Object.assign(new Error(name), { name });
    expect(classifyCameraError(err('NotAllowedError'), env)).toBe('camera-denied');
    expect(classifyCameraError(err('PermissionDeniedError'), env)).toBe('camera-denied');
    expect(classifyCameraError(err('SecurityError'), env)).toBe('camera-denied');
    expect(classifyCameraError(err('NotFoundError'), env)).toBe('camera-missing');
    expect(classifyCameraError(err('OverconstrainedError'), env)).toBe('camera-missing');
    expect(classifyCameraError(err('NotReadableError'), env)).toBe('camera-in-use');
    expect(classifyCameraError(err('AbortError'), env)).toBe('camera-in-use');
    expect(classifyCameraError(err('TypeError'), env)).toBe('camera-unsupported');
    expect(classifyCameraError(err('Weird'), env)).toBe('camera-failed');
    expect(classifyCameraError(null, env)).toBe('camera-failed');
    expect(classifyCameraError(err('NotAllowedError'), { isSecureContext: false, hasGetUserMedia: false })).toBe('camera-insecure');
    expect(classifyCameraError(undefined, { isSecureContext: true, hasGetUserMedia: false })).toBe('camera-unsupported');
  });

  it('maps API failures to problem screens', () => {
    expect(problemForApiError(new ApiError(0, 'NETWORK', 'x'))).toBe('network');
    expect(problemForApiError(new ApiError(0, 'TIMEOUT', 'x'))).toBe('network');
    expect(problemForApiError(new ApiError(429, 'RATE_LIMITED', 'x'))).toBe('rate-limited');
    expect(problemForApiError(new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe('server');
    expect(problemForApiError(new ApiError(400, 'VALIDATION_FAILED', 'x'))).toBe('server');
    expect(problemForApiError(new Error('boom'))).toBe('server');
  });
});
