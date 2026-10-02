import { describe, expect, it } from 'vitest';
import { UNUSUAL_ACTIVITY_OWNER_COPY, VERIFICATION_COPY } from '../../src/server/services/copy.js';
import { ApiError } from '../../src/web/verify/api.js';
import {
  ACTION_LABELS,
  ASSURANCE_NOTE,
  classifyCameraError,
  CONTACT,
  DEFAULT_CARE,
  FALLBACK_TITLES,
  HINTS,
  NOT_DELIVERED_NOTE,
  PROBLEMS,
  problemForApiError,
  STAFF_SCAN_NOTE,
  STATUS,
  type ProblemKind,
} from '../../src/web/verify/copy.js';
import { VERIFICATION_STATES, type VerificationState, type VerifyOutcome } from '../../src/web/verify/types.js';
import {
  formatDate,
  formatDateLong,
  formatDateTime,
  isAuthenticState,
  normalizeCodeInput,
  registrationOpen,
  resultViewModel,
  shortReference,
  splitTitle,
  toneOf,
  utcOffsetLabel,
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

  it('keeps the variant out of the brand lines (contract §4) but lists it, and falls back to the default care text', () => {
    // The demo's O26-J-00184 is a SIZE 52 MONOLITHE RING: its lines read MONOLITHE / RING / JEWELRY / 925 STERLING SILVER / CREATED 2026.
    const v = resultViewModel(outcome('AUTHENTIC', { product: { ...PRODUCT, variant: 'Size 52', care: '  ' } }));
    expect(v.productLines).toEqual(['MONOLITHE', 'RING', 'JEWELRY', '925 STERLING SILVER', 'CREATED 2026']);
    expect(v.productRows).toContainEqual(['VARIANT', 'SIZE 52']);
    expect(v.care).toBe(DEFAULT_CARE);
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

  it('FIRST_REGISTRATION without a token is a staff scan (S-07): nothing to register, and the tab says why', () => {
    const vm = resultViewModel(outcome('AUTHENTIC_FIRST_REGISTRATION'));
    expect(vm.ownership).toEqual({ kind: 'staff' });
    // Not the registration's tab: the result opens on PRODUCT as for any piece the viewer cannot register.
    expect(vm.tabs).toEqual(['product', 'warranty', 'care', 'ownership']);
    expect(resultViewModel(outcome('AUTHENTIC_FIRST_REGISTRATION', { registration: { token: '', expiresAt: '2026-10-01T08:45:00.000Z', claimCodeRequired: false } })).ownership).toEqual({
      kind: 'staff',
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

describe('verify view-model: ORBES Client Services contact', () => {
  const CS = { email: 'clientservices@theorbes.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Saturday, 10:00–19:00 (Paris)' };
  /** The subject and body of a mailto: link, decoded. */
  const mail = (href: string) => {
    const m = /^mailto:([^?]+)\?subject=([^&]*)&body=([^&]*)$/.exec(href);
    expect(m, href).not.toBeNull();
    return { to: m![1], subject: decodeURIComponent(m![2]), body: decodeURIComponent(m![3]) };
  };

  it.each(['SUSPICIOUS_ACTIVITY', 'MALFORMED_CODE', 'REVOKED', 'UNKNOWN', 'INVALID_SIGNATURE'] as const)('%s (caution or void) offers it under the help line', (state) => {
    const vm = resultViewModel(outcome(state), { offsetMinutes: 120, clientServices: CS });
    expect(vm.tone).not.toBe('authentic');
    expect(vm.contact).toMatchObject({ placement: 'help', phone: { label: '+33 1 23 45 67 89', href: 'tel:+33123456789' }, hours: CS.hours });
    const { to, subject, body } = mail(vm.contact!.mailto!);
    expect(to).toBe('clientservices@theorbes.com');
    const title = VERIFICATION_COPY[state].title;
    expect(subject).toBe(`ORBES — REF 4515B884 — ${title}`);
    // The customer writes above the facts Client Services needs: the reference, the result, the time shown,
    // with its offset from UTC (Client Services in Paris reads a customer's local time unambiguously).
    expect(body).toBe(`\r\n\r\nREFERENCE: 4515B884\r\nRESULT: ${title}\r\nVERIFIED: 1 OCT 2026 · 10:30 (UTC+02:00)`);
  });

  it('encodes the subject and body for a mailto: link (no raw spaces, dashes or line breaks)', () => {
    const href = resultViewModel(outcome('INVALID_SIGNATURE'), { clientServices: CS }).contact!.mailto!;
    expect(href).toMatch(/^mailto:clientservices@theorbes\.com\?subject=ORBES%20%E2%80%94%20REF%204515B884%20%E2%80%94%20INVALID%20SIGNATURE&body=%0D%0A%0D%0AREFERENCE%3A%204515B884/);
    expect(href).not.toMatch(/[\s\r\n]/);
  });

  it('on an authentic result, appears only in the WARRANTY tab of a warranty that no longer applies', () => {
    for (const status of ['NOT_STARTED', 'ACTIVE', 'EXPIRED'] as const) {
      expect(resultViewModel(outcome('AUTHENTIC_REGISTERED', { warranty: { status } }), { clientServices: CS }).contact, status).toBeUndefined();
    }
    expect(resultViewModel(outcome('AUTHENTIC', { warranty: undefined }), { clientServices: CS }).contact).toBeUndefined();
    const vm = resultViewModel(outcome('AUTHENTIC_REGISTERED', { warranty: { status: 'VOID' } }), { offsetMinutes: 120, clientServices: CS });
    expect(vm.warranty?.status).toBe('NO LONGER VALID');
    expect(vm.contact?.placement).toBe('warranty');
    const { subject, body } = mail(vm.contact!.mailto!);
    expect(subject).toBe('ORBES — REF 4515B884 — AUTHENTIC — REGISTERED');
    expect(body).toBe('\r\n\r\nREFERENCE: 4515B884\r\nRESULT: AUTHENTIC — REGISTERED\r\nWARRANTY: NO LONGER VALID\r\nVERIFIED: 1 OCT 2026 · 10:30 (UTC+02:00)');
  });

  it('names the offset of the time in the email, whatever the zone, and only there', () => {
    const at = (offsetMinutes: number) => mail(resultViewModel(outcome('REVOKED'), { offsetMinutes, clientServices: CS }).contact!.mailto!).body.split('\r\n').at(-1);
    expect(at(0)).toBe('VERIFIED: 1 OCT 2026 · 08:30 (UTC+00:00)');
    expect(at(-300)).toBe('VERIFIED: 1 OCT 2026 · 03:30 (UTC-05:00)');
    expect(at(330)).toBe('VERIFIED: 1 OCT 2026 · 14:00 (UTC+05:30)');
    expect(at(-210)).toBe('VERIFIED: 1 OCT 2026 · 05:00 (UTC-03:30)');
    // The screen keeps the time as it was: the offset is for Client Services.
    expect(resultViewModel(outcome('REVOKED'), { offsetMinutes: 120, clientServices: CS }).verifiedAt).toBe('1 OCT 2026 · 10:30');
    expect(utcOffsetLabel(-0)).toBe('UTC+00:00');
  });

  it('shows nothing without configuration, or with neither a usable email nor a usable phone', () => {
    for (const state of VERIFICATION_STATES) {
      expect(resultViewModel(outcome(state)).contact, state).toBeUndefined();
      expect(resultViewModel(outcome(state), { clientServices: {} }).contact, state).toBeUndefined();
    }
    expect(resultViewModel(outcome('REVOKED'), { clientServices: { hours: CS.hours } }).contact).toBeUndefined();
    // Never a link from something the server rules would have refused.
    const odd = { email: 'x@y.z?cc=a@b.c', phone: 'javascript:alert(1)', hours: CS.hours } as const;
    expect(resultViewModel(outcome('REVOKED'), { clientServices: odd }).contact).toBeUndefined();
    const loose = { email: 42, phone: ['+33 1 23 45 67 89'] } as unknown as typeof CS;
    expect(resultViewModel(outcome('REVOKED'), { clientServices: loose }).contact).toBeUndefined();
  });

  it('offers what is configured: the email alone, or the phone (with the hours) alone', () => {
    expect(resultViewModel(outcome('UNKNOWN'), { clientServices: { email: CS.email } }).contact).toEqual({
      placement: 'help',
      mailto: expect.stringMatching(/^mailto:clientservices@theorbes\.com\?/),
    });
    expect(resultViewModel(outcome('UNKNOWN'), { clientServices: { phone: '+1-212-555-0100', hours: CS.hours } }).contact).toEqual({
      placement: 'help',
      phone: { label: '+1-212-555-0100', href: 'tel:+12125550100' },
      hours: CS.hours,
    });
  });

  it('leaves the reference out of the subject when the scan id gives none', () => {
    const vm = resultViewModel(outcome('UNKNOWN', { scanId: 'not-a-scan-id' }), { clientServices: CS });
    expect(vm.reference).toBe('');
    const { subject, body } = mail(vm.contact!.mailto!);
    expect(subject).toBe('ORBES — UNKNOWN ORBES CODE');
    expect(body).not.toMatch(/REFERENCE/);
  });

  it('names ORBES Client Services in full, never the forbidden "Contact support" (BRAND §4.5)', () => {
    expect(CONTACT.action).toBe('CONTACT ORBES CLIENT SERVICES');
    expect(Object.values(CONTACT).join(' ')).not.toMatch(/support|product/i);
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
