/**
 * The console's LIVE RELEASES, pure (web/admin/model/live.ts) and its API client (web/admin/api.ts): the bounds mirror
 * the server's; the states said as the console says them; prices, sizes and add-ons read from the dialogs and written
 * back; what each part's dialog would send, and refuse, before anything is sent; what each role may do now; the live
 * board's figures; a reservation's reference as /verify and the server say it; the tones; the client's paths, bodies
 * and the CSV saved.
 */
import { describe, expect, it } from 'vitest';
import { DROP_DESCRIPTION_MAX, DROP_QUANTITY_MAX, DROP_TITLE_MAX } from '../../src/server/services/drops.js';
import {
  LIVE_ADD_PIECES,
  LIVE_ADDONS_MAX,
  LIVE_EXTEND_MINUTES,
  LIVE_MESSAGE_MAX,
  LIVE_MIN_PARTICIPATIONS,
  LIVE_PAY_MINUTES,
  LIVE_PER_ACCOUNT,
  LIVE_PHASES as SERVER_LIVE_PHASES,
  LIVE_ROOM_OPENS_MINUTES,
  LIVE_SIZE_STOCK_MAX,
  LIVE_SURPRISE_MAX,
  LIVE_TURN_SECONDS,
} from '../../src/server/services/live.js';
import {
  defaultQuantityLine as serverQuantityLine,
  LIVE_ACCESS_MODELS_MAX,
  LIVE_ADDON_LIMITS,
  LIVE_CONSOLE_LINE_MAX,
  LIVE_CURRENCIES as SERVER_CURRENCIES,
  LIVE_PRICE_MAX_MINOR,
  LIVE_QUANTITY_LINE_MAX,
  LIVE_SIZES,
  liveReference as serverReference,
} from '../../src/server/services/live-console.js';
import { AFTER_ROOM_DELAY_MINUTES, AFTER_ROOM_LENGTH_MINUTES } from '../../src/server/services/after-room.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import {
  addonsText,
  AFTER_ROOM_SKIPS,
  afterRoomStateLabel,
  afterRoomTiming,
  combineLine,
  defaultQuantityLine,
  formatMoney,
  LIVE_LIMITS,
  liveActions,
  liveBoardFigures,
  liveEntryActions,
  liveEntryDeadline,
  liveLead,
  livePageKey,
  livePartChange,
  livePartProblem,
  livePartValues,
  livePhrase,
  liveReference,
  liveStateLabel,
  moneyField,
  newLiveInput,
  newLiveProblem,
  newLiveValues,
  parseAddons,
  parseMoney,
  surpriseLine,
  parseSizes,
  priorityLine,
  sizesText,
  windowLine,
} from '../../src/web/admin/model/live.js';
import { can } from '../../src/web/admin/model/permissions.js';
import { toneOf } from '../../src/web/admin/model/tone.js';
import { LIVE_CURRENCIES, LIVE_ENTRY_STATUSES, LIVE_PHASES, type LiveBoard, type LiveRelease } from '../../src/web/admin/types.js';
import { liveReference as verifyReference } from '../../src/web/verify/live-model.js';

const ID = '0f8e7d6c-5b4a-4321-8fed-cba987654321';
const NOW = new Date('2026-11-09T09:00:00.000Z');

function release(o: Partial<LiveRelease> = {}): LiveRelease {
  return {
    id: ID,
    title: 'THE MONOLITHE RING',
    model: { id: 'm1', name: 'MONOLITHE', type: 'RING', active: true },
    phase: 'DRAFT',
    over: false,
    announcedAt: null,
    roomOpensAt: '2026-11-10T17:55:00.000Z',
    opensAt: '2026-11-10T18:00:00.000Z',
    closesAt: '2026-11-10T19:00:00.000Z',
    quantity: 5,
    quantityLine: '5 PIECES',
    priceMinor: 480_000,
    currency: 'EUR',
    endedReason: null,
    entries: Object.fromEntries(LIVE_ENTRY_STATUSES.map((s) => [s, 0])) as LiveRelease['entries'],
    interest: 0,
    description: null,
    editable: true,
    roomOpensMinutes: 5,
    turnSeconds: 30,
    payMinutes: 5,
    perAccount: 1,
    minTier: 0,
    tierPriority: true,
    access: { models: [], collection: null, minParticipations: null, segment: null, combine: 'AND', text: 'every ORBES account' },
    surprise: { enabled: false, text: null },
    locationId: null,
    location: { id: 'l1', name: 'FRANCE WAREHOUSE' },
    question: {
      text: 'WHAT WOULD YOU HAVE WANTED?',
      answers: ['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND'],
      custom: false,
      enabled: true,
      state: 'WAITING',
      opensAt: null,
      closesAt: null,
      asked: { tookPart: 0, interest: 0 },
      answered: 0,
      tally: [
        { answer: 1, label: 'ANOTHER SIZE', count: 0 },
        { answer: 2, label: 'ANOTHER FINISH', count: 0 },
        { answer: 3, label: 'ANOTHER PRICE BAND', count: 0 },
      ],
    },
    sizes: [
      { id: 's52', label: '52', stock: 3 },
      { id: 's54', label: '54', stock: 2 },
    ],
    addons: [{ id: 'a1', label: 'ENGRAVING', line: 'Your initials, by hand', priceMinor: 15_000 }],
    tierWindows: [{ tier: 3, turnSeconds: null, payMinutes: 10 }],
    announceAt: null,
    silhouetteAt: null,
    nameAt: null,
    photoAt: null,
    stages: null,
    silhouette: null,
    boardLink: null,
    circlePosts: [],
    publishedAt: null,
    cancelledAt: null,
    pausedAt: null,
    pausedMs: 0,
    endedAt: null,
    createdAt: '2026-11-01T09:00:00.000Z',
    createdBy: null,
    seedHash: 'ab'.repeat(32),
    afterRoom: null,
    afterRoomOf: null,
    guaranteed: { places: 0, pieces: 0 },
    ...o,
  };
}

describe('the console of the LIVE RELEASES mirrors the server', () => {
  it('holds the same bounds, phases and currencies', () => {
    expect(LIVE_LIMITS).toMatchObject({
      title: DROP_TITLE_MAX,
      description: DROP_DESCRIPTION_MAX,
      sizes: LIVE_SIZES.max,
      sizeLabel: LIVE_SIZES.label,
      stock: LIVE_SIZE_STOCK_MAX,
      quantity: DROP_QUANTITY_MAX,
      quantityLine: LIVE_QUANTITY_LINE_MAX,
      addons: LIVE_ADDONS_MAX,
      addonLabel: LIVE_ADDON_LIMITS.label,
      addonLine: LIVE_ADDON_LIMITS.line,
      priceMaxMinor: LIVE_PRICE_MAX_MINOR,
      roomOpensMinutes: { ...LIVE_ROOM_OPENS_MINUTES },
      turnSeconds: { ...LIVE_TURN_SECONDS },
      payMinutes: { ...LIVE_PAY_MINUTES },
      perAccount: { ...LIVE_PER_ACCOUNT },
      extendMinutes: { ...LIVE_EXTEND_MINUTES },
      addPieces: { ...LIVE_ADD_PIECES },
      message: LIVE_MESSAGE_MAX,
      accessModels: LIVE_ACCESS_MODELS_MAX,
      line: LIVE_CONSOLE_LINE_MAX,
      afterRoomDelay: { ...AFTER_ROOM_DELAY_MINUTES },
      afterRoomLength: { ...AFTER_ROOM_LENGTH_MINUTES },
      minParticipations: { ...LIVE_MIN_PARTICIPATIONS },
      surprise: LIVE_SURPRISE_MAX,
    });
    expect([...LIVE_PHASES]).toEqual([...SERVER_LIVE_PHASES]);
    expect([...LIVE_CURRENCIES]).toEqual([...SERVER_CURRENCIES]);
  });

  it('says a reservation’s reference and the default quantity line as the server and /verify do', () => {
    expect(liveReference(ID)).toBe('LR-0F8E7D6C');
    expect(liveReference(ID)).toBe(serverReference(ID));
    expect(liveReference(ID)).toBe(verifyReference(ID));
    for (const n of [1, 2, 25]) expect(defaultQuantityLine(n)).toBe(serverQuantityLine(n));
    expect(defaultQuantityLine(1)).toBe('1 PIECE');
  });
});

describe('the console of the LIVE RELEASES', () => {
  it('says each state, an ended release by its reason, with its tone', () => {
    const said = LIVE_PHASES.filter((p) => p !== 'ENDED').map((phase) => [liveStateLabel({ phase, endedReason: null }), toneOf('livePhase', phase)]);
    expect(said).toEqual([
      ['DRAFT', 'outline'],
      ['SCHEDULED', 'outline'],
      ['ANNOUNCED', 'outline'],
      ['ROOM OPEN', 'solid'],
      ['LIVE', 'solid'],
      ['CANCELLED', 'muted'],
    ]);
    expect((['SOLD_OUT', 'CLOSED', 'ENDED'] as const).map((endedReason) => liveStateLabel({ phase: 'ENDED', endedReason }))).toEqual(['SOLD OUT', 'CLOSED', 'ENDED']);
    expect(LIVE_ENTRY_STATUSES.map((s) => toneOf('liveEntry', s))).toEqual(['outline', 'outline', 'solid', 'alert', 'solid', 'muted', 'muted', 'muted', 'muted', 'alert', 'muted']);
    // A hold waits for PAY as an open case waits for the staff.
    expect(toneOf('liveEntry', 'SECURED')).toBe(toneOf('case', 'OPEN'));
  });

  it('reads and writes prices in units, as the house writes them', () => {
    expect(['4800', '4 800', '4800.5', '4800,50', '0', '0.05', '1234567.89'].map(parseMoney)).toEqual([480_000, 480_000, 480_050, 480_050, 0, 5, 123_456_789]);
    expect(['', 'abc', '-1', '1.234', '12345678', '4800.']).toEqual(['', 'abc', '-1', '1.234', '12345678', '4800.'].filter((s) => parseMoney(s) === null));
    expect([moneyField(480_000), moneyField(480_050), moneyField(5)]).toEqual(['4800', '4800.50', '0.05']);
    expect(formatMoney(480_000, 'EUR')).toBe('€ 4 800');
    expect(formatMoney(15_050, 'CHF')).toBe('CHF 150.50');
    expect(formatMoney(100, 'GBP')).toBe('£ 1');
  });

  it('reads the sizes one per line, keeping the ids of the labels it already has, and refuses what the server would', () => {
    const existing = [{ id: 's52', label: '52' }];
    expect(parseSizes('52 = 3\n54: 2\nONE SIZE 25\n\n  56=0 ', existing)).toEqual({
      sizes: [
        { id: 's52', label: '52', stock: 3 },
        { label: '54', stock: 2 },
        { label: 'ONE SIZE', stock: 25 },
        { label: '56', stock: 0 },
      ],
    });
    const problems = [
      ['', /List the sizes/],
      ['52', /Line 1: a size’s label, then its stock/],
      ['= 3', /Line 1/],
      ['A VERY LONG SIZE = 1', /at most 12 characters/],
      ['52 = 10001', /at most 10.000 pieces/],
      ['S = 1\ns = 2', /The size s is listed twice/],
      ['52 = 0', /1 to 10.000 pieces in all/],
      [Array.from({ length: 25 }, (_, i) => `S${i} = 1`).join('\n'), /at most 24 sizes/],
    ] as const;
    for (const [text, problem] of problems) {
      const r = parseSizes(text);
      expect('problem' in r ? r.problem : '', text).toMatch(problem);
    }
    expect(sizesText([{ label: '52', stock: 3 }, { label: 'ONE SIZE', stock: 25 }])).toBe('52 = 3\nONE SIZE = 25');
  });

  it('reads the add-ons one per line (label | price | line), at most six', () => {
    expect(parseAddons('ENGRAVING | 150 | Your initials, by hand\nGIFT BOX | 0\nCARE | 90.50 | Two years | of care', [{ id: 'a1', label: 'ENGRAVING' }])).toEqual({
      addons: [
        { id: 'a1', label: 'ENGRAVING', line: 'Your initials, by hand', priceMinor: 15_000 },
        { label: 'GIFT BOX', line: null, priceMinor: 0 },
        { label: 'CARE', line: 'Two years | of care', priceMinor: 9_050 },
      ],
    });
    expect(parseAddons('')).toEqual({ addons: [] });
    for (const [text, problem] of [
      ['ENGRAVING', /the label, then its price/],
      ['| 150', /label has 1 to 40/],
      ['ENGRAVING | free', /the label, then its price/],
      [`ENGRAVING | 1 | ${'x'.repeat(121)}`, /at most 120 characters/],
      [Array.from({ length: 7 }, (_, i) => `A${i} | 1`).join('\n'), /at most 6 add-ons/],
    ] as const) {
      const r = parseAddons(text);
      expect('problem' in r ? r.problem : '', text).toMatch(problem);
    }
    expect(addonsText(release().addons)).toBe('ENGRAVING | 150 | Your initials, by hand');
  });

  it('creates a release from its essentials, every other setting by default', () => {
    const v = newLiveValues(NOW);
    expect(v).toMatchObject({ opensAt: '2026-11-10T18:00', closesAt: '2026-11-10T19:00', currency: 'EUR', sizes: 'ONE SIZE = 25' });
    expect(newLiveProblem(v)).toBe('Choose the model of the release.');
    const ok: Record<string, string> = { ...v, modelId: 'm1', title: ' THE RING ', price: '4 800' };
    expect(newLiveProblem(ok)).toBeNull();
    expect(newLiveInput(ok)).toEqual({ modelId: 'm1', title: 'THE RING', opensAt: '2026-11-10T18:00:00.000Z', closesAt: '2026-11-10T19:00:00.000Z', priceMinor: 480_000, currency: 'EUR', sizes: [{ label: 'ONE SIZE', stock: 25 }] });
    expect(newLiveProblem({ ...ok, closesAt: ok.opensAt })).toBe('The release ends after T0.');
    expect(newLiveProblem({ ...ok, price: 'x' })).toMatch(/price of a piece/);
    expect(newLiveProblem({ ...ok, currency: 'JPY' })).toBe('Choose the currency.');
    expect(newLiveProblem({ ...ok, sizes: '' })).toMatch(/List the sizes/);
  });

  it('sends only what a part’s dialog changed, and nothing when it changed nothing', () => {
    const r = release();
    for (const part of ['release', 'sizes', 'access', 'times', 'turns', 'addons'] as const) {
      const v = livePartValues(r, part);
      expect([part, livePartProblem(r, part, v)]).toEqual([part, null]);
      expect([part, livePartChange(r, part, v)]).toEqual([part, {}]);
    }
    expect(livePartChange(r, 'release', { ...livePartValues(r, 'release'), price: '5000', currency: 'CHF', perAccount: '2', description: ' A ring. ' })).toEqual({
      priceMinor: 500_000,
      currency: 'CHF',
      perAccount: 2,
      description: 'A ring.',
    });
    // Sizes: the ids kept by label; the quantity line left empty is the default, which follows the stock.
    expect(livePartChange(r, 'sizes', { sizes: '54 = 4\n52 = 3\n56 = 1', quantityLine: '' })).toEqual({
      sizes: [
        { id: 's54', label: '54', stock: 4 },
        { id: 's52', label: '52', stock: 3 },
        { label: '56', stock: 1 },
      ],
    });
    expect(livePartChange(r, 'sizes', { sizes: '52 = 3\n54 = 2', quantityLine: '5 PIECES · NEVER MORE' })).toEqual({ quantityLine: '5 PIECES · NEVER MORE' });
    const own = release({ quantityLine: '5 PIECES · NEVER MORE' });
    expect(livePartValues(own, 'sizes').quantityLine).toBe('5 PIECES · NEVER MORE');
    expect(livePartChange(own, 'sizes', { sizes: '52 = 3\n54 = 2', quantityLine: '' })).toEqual({ quantityLine: null });
    expect(livePartProblem(r, 'sizes', { sizes: '52 = 3', quantityLine: 'X'.repeat(41) })).toMatch(/at most 40 characters/);
    // Access: the models ticked, the collection, the tier, the priority.
    expect(livePartChange(r, 'access', { minTier: '2', tierPriority: '', collectionId: 'c1', 'model:m2': 'true', 'model:m1': 'true', 'model:m3': '' })).toEqual({
      minTier: 2,
      tierPriority: false,
      accessModelIds: ['m1', 'm2'],
      accessCollectionId: 'c1',
    });
    // Times in UTC; an empty stage sent as null.
    const timed = release({ nameAt: '2026-11-10T12:00:00.000Z' });
    expect(livePartValues(timed, 'times')).toMatchObject({ nameAt: '2026-11-10T12:00', announceAt: '', roomOpensMinutes: '5' });
    expect(livePartChange(timed, 'times', { ...livePartValues(timed, 'times'), nameAt: '', announceAt: '2026-11-10T09:00', roomOpensMinutes: '10' })).toEqual({
      announceAt: '2026-11-10T09:00:00.000Z',
      nameAt: null,
      roomOpensMinutes: 10,
    });
    expect(livePartProblem(r, 'times', { ...livePartValues(r, 'times'), silhouetteAt: 'soon' })).toMatch(/the silhouette, or leave it empty/);
    expect(livePartProblem(r, 'times', { ...livePartValues(r, 'times'), roomOpensMinutes: '61' })).toMatch(/1 to 60 minutes/);
    // Published and announced later: the announcement emptied would be the publication, past, the release announced at once.
    const hidden = release({ phase: 'HIDDEN', publishedAt: '2026-11-01T09:00:00.000Z', announcedAt: '2026-11-10T09:00:00.000Z', announceAt: '2026-11-10T09:00:00.000Z' });
    expect(livePartProblem(hidden, 'times', { ...livePartValues(hidden, 'times'), announceAt: '' })).toBe('A published release keeps an announcement time; set one later than now.');
    expect(livePartProblem(hidden, 'times', livePartValues(hidden, 'times'))).toBeNull();
    expect(livePartProblem(r, 'times', { ...livePartValues(r, 'times'), announceAt: '' })).toBeNull();
    // Turns: the release's, and the overrides per tier (PALLADIUM: 10 minutes to pay).
    expect(livePartValues(r, 'turns')).toMatchObject({ turnSeconds: '30', payMinutes: '5', 'pay:3': '10', 'turn:3': '', 'pay:0': '' });
    expect(livePartChange(r, 'turns', { ...livePartValues(r, 'turns'), 'turn:2': '60', 'pay:3': '' })).toEqual({ tierWindows: [{ tier: 2, turnSeconds: 60, payMinutes: null }] });
    expect(livePartProblem(r, 'turns', { ...livePartValues(r, 'turns'), 'pay:1': '90' })).toMatch(/^TITANE: the time to pay is 1 to 60 minutes/);
    expect(livePartChange(r, 'addons', { addons: 'ENGRAVING | 150 | Your initials, by hand\nGIFT BOX | 0' })).toEqual({
      addons: [
        { id: 'a1', label: 'ENGRAVING', line: 'Your initials, by hand', priceMinor: 15_000 },
        { label: 'GIFT BOX', line: null, priceMinor: 0 },
      ],
    });
    expect(livePartProblem(r, 'release', { ...livePartValues(r, 'release'), perAccount: '6' })).toMatch(/1 to 5 pieces/);
  });

  it('sets the access beyond the tier (the releases taken part in, a segment, AND or OR) and the surprise, sending only what changed', () => {
    const r = release();
    const v = livePartValues(r, 'access');
    expect(v).toMatchObject({ minParticipations: '', segmentId: '', combine: 'AND' });
    expect(livePartChange(r, 'access', v)).toEqual({});
    expect(livePartChange(r, 'access', { ...v, minParticipations: '3', segmentId: 'seg1', combine: 'OR' })).toEqual({ minParticipations: 3, accessSegmentId: 'seg1', accessCombine: 'OR' });
    expect(livePartProblem(r, 'access', { ...v, minParticipations: '0' })).toBe('Releases taken part in: 1 to 100, or leave it empty.');
    expect(livePartProblem(r, 'access', { ...v, minParticipations: '101' })).toMatch(/1 to 100/);
    expect(livePartProblem(r, 'access', { ...v, combine: 'XOR' })).toBe('Choose how the rules combine.');
    const set = release({ access: { models: [], collection: null, minParticipations: 3, segment: { id: 'seg1', name: 'Regulars' }, combine: 'OR', text: 'collectors who have taken part in 3 releases or selected collectors' } });
    expect(livePartChange(set, 'access', { ...livePartValues(set, 'access'), minParticipations: '', segmentId: '' })).toEqual({ minParticipations: null, accessSegmentId: null });
    expect([combineLine('AND'), combineLine('OR')]).toEqual(['Every rule is needed (AND)', 'Any one rule is enough (OR)']);
    // The surprise: on with its description, off keeping it.
    expect(livePartValues(r, 'surprise')).toEqual({ enabled: '', text: '' });
    expect(livePartProblem(r, 'surprise', { enabled: 'true', text: ' ' })).toMatch(/^Say what goes in the box/);
    expect(livePartProblem(r, 'surprise', { enabled: 'true', text: 'x'.repeat(501) })).toMatch(/at most 500 characters/);
    expect(livePartChange(r, 'surprise', { enabled: 'true', text: ' A silk pouch. ' })).toEqual({ surpriseEnabled: true, surpriseText: 'A silk pouch.' });
    const surprised = release({ surprise: { enabled: true, text: 'A silk pouch.' } });
    expect(livePartChange(surprised, 'surprise', { enabled: '', text: 'A silk pouch.' })).toEqual({ surpriseEnabled: false });
    expect(surpriseLine(surprised)).toBe('In every box · A silk pouch.');
    expect(surpriseLine(release({ surprise: { enabled: false, text: 'A silk pouch.' } }))).toBe('None (kept: A silk pouch.)');
    expect(surpriseLine(r)).toBe('None');
  });

  it('offers each role what it may do in the phase: OPERATOR edits until the announcement and runs the controls, ADMIN ends', () => {
    const draft = release();
    expect(liveActions(draft, 'AUDITOR')).toEqual({ edit: false, publish: false, cancel: false, circlePost: false, boardLink: false, pause: false, resume: false, extend: false, addPieces: false, message: false, end: false });
    expect(liveActions(draft, 'OPERATOR')).toMatchObject({ edit: true, publish: true, cancel: true, circlePost: false, boardLink: true, pause: false, extend: false, end: false });
    // Published, not announced yet: the sizes change in the settings, not by ADD PIECES (the quantity line follows them);
    // its post of the circle is added or withdrawn; no host message before the announcement.
    const hidden = release({ phase: 'HIDDEN', editable: true, publishedAt: '2026-11-01T09:00:00.000Z' });
    expect(liveActions(hidden, 'OPERATOR')).toMatchObject({ edit: true, cancel: true, circlePost: true, addPieces: false, extend: true, message: false });
    const announced = release({ phase: 'ANNOUNCED', editable: false, publishedAt: '2026-11-01T09:00:00.000Z' });
    expect(liveActions(announced, 'OPERATOR')).toMatchObject({ edit: false, publish: false, cancel: true, circlePost: false, addPieces: true, extend: true, message: true, pause: false });
    // The room open: no cancellation, no pause before T0.
    expect(liveActions({ ...announced, phase: 'ROOM' }, 'OPERATOR')).toMatchObject({ cancel: false, pause: false, addPieces: true, message: true, extend: true });
    // The phase is the server's: the page's clock plays no part (a board in another phase has the page read again).
    const live = release({ phase: 'LIVE', editable: false, publishedAt: '2026-11-01T09:00:00.000Z' });
    expect(liveActions(live, 'OPERATOR')).toMatchObject({ cancel: false, pause: true, resume: false, extend: true, addPieces: true, message: true, end: false });
    expect(liveActions(live, 'ADMIN')).toMatchObject({ end: true });
    const during = new Date('2026-11-10T18:10:00.000Z');
    expect(liveActions({ ...live, pausedAt: during.toISOString() }, 'OPERATOR')).toMatchObject({ pause: false, resume: true });
    const ended = { ...live, phase: 'ENDED' as const, endedAt: during.toISOString() };
    expect(liveActions(ended, 'ADMIN')).toMatchObject({ pause: false, extend: false, addPieces: false, message: false, end: false, cancel: false });
    expect(liveActions({ ...hidden, phase: 'CANCELLED', editable: false }, 'ADMIN')).toMatchObject({ edit: false, cancel: false, circlePost: false, boardLink: false, extend: false, end: false });
    // The page's state: another phase, a pause, the end or the last hold settled read it again.
    const key = (o: Partial<{ phase: LiveBoard['phase']; paused: boolean; ended: boolean; over: boolean }> = {}) => livePageKey({ phase: 'ROOM', paused: false, ended: false, over: false, ...o });
    expect(key()).toBe(key({}));
    expect(new Set([key(), key({ phase: 'LIVE' }), key({ paused: true }), key({ phase: 'ENDED' }), key({ phase: 'ENDED', ended: true }), key({ phase: 'ENDED', ended: true, over: true })]).size).toBe(6);
    expect(can('OPERATOR', 'endLiveRelease')).toBe(false);
    expect(can('ADMIN', 'removeLiveEntry')).toBe(true);
    const board = { phase: 'LIVE' as const, paused: false, endedAt: null };
    expect(liveEntryActions({ status: 'QUEUED' }, board, 'OPERATOR')).toEqual({ letIn: true, free: false, remove: false });
    expect(liveEntryActions({ status: 'QUEUED' }, { ...board, paused: true }, 'OPERATOR')).toEqual({ letIn: false, free: false, remove: false });
    expect(liveEntryActions({ status: 'SECURED' }, board, 'ADMIN')).toEqual({ letIn: false, free: true, remove: true });
    expect(liveEntryActions({ status: 'CONFIRMED' }, board, 'ADMIN')).toEqual({ letIn: false, free: false, remove: false });
    expect(liveEntryActions({ status: 'SECURED' }, board, 'AUDITOR')).toEqual({ letIn: false, free: false, remove: false });
    expect([livePhrase('end', draft), livePhrase('cancel', draft)]).toEqual(['END 0F8E7D6C', 'CANCEL 0F8E7D6C']);
  });

  it('sets the after-room with the release: on or off, its model, price, sizes, add-ons, delay and length, its ids kept', () => {
    const none = release();
    expect(livePartValues(none, 'afterRoom')).toEqual({ enabled: '', modelId: '', price: '', sizes: 'ONE SIZE = 5', addons: '', delay: '10', length: '15' });
    // Off and staying off: nothing to send, nothing to check.
    expect(livePartProblem(none, 'afterRoom', livePartValues(none, 'afterRoom'))).toBeNull();
    expect(livePartChange(none, 'afterRoom', livePartValues(none, 'afterRoom'))).toEqual({});
    const on = { ...livePartValues(none, 'afterRoom'), enabled: 'true', modelId: 'm2', price: '900', sizes: '52 = 2\n54 = 1', addons: 'GIFT BOX | 50' };
    expect(livePartProblem(none, 'afterRoom', on)).toBeNull();
    expect(livePartChange(none, 'afterRoom', on)).toEqual({
      afterRoom: { modelId: 'm2', priceMinor: 90_000, sizes: [{ label: '52', stock: 2 }, { label: '54', stock: 1 }], addons: [{ label: 'GIFT BOX', line: null, priceMinor: 5_000 }], delayMinutes: 10, lengthMinutes: 15 },
    });
    expect(livePartProblem(none, 'afterRoom', { ...on, modelId: '' })).toMatch(/model/);
    expect(livePartProblem(none, 'afterRoom', { ...on, price: 'x' })).toMatch(/price/);
    expect(livePartProblem(none, 'afterRoom', { ...on, sizes: '' })).toMatch(/^The after-room: list the sizes/);
    expect(livePartProblem(none, 'afterRoom', { ...on, addons: 'X | nope' })).toMatch(/^The after-room: line 1/);
    expect(livePartProblem(none, 'afterRoom', { ...on, delay: '0' })).toBe('The after-room opens 1 to 60 minutes after the sell-out.');
    expect(livePartProblem(none, 'afterRoom', { ...on, length: '121' })).toBe('The after-room is open 5 to 120 minutes.');
    // Set: its values, its sizes and add-ons keeping their ids; the same again changes nothing; off removes it.
    const afterRoom = {
      id: 'c1',
      model: { id: 'm2', name: 'AFTERGLOW', type: 'RING', active: true },
      priceMinor: 90_000,
      currency: 'EUR',
      sizes: [{ id: 'z52', label: '52', stock: 2 }],
      quantity: 2,
      addons: [{ id: 'g1', label: 'GIFT BOX', line: null, priceMinor: 5_000 }],
      delayMinutes: 5,
      lengthMinutes: 20,
      state: 'WAITING' as const,
      phase: 'DRAFT' as const,
      opensAt: null,
      closesAt: null,
      endedReason: null,
      skipped: null,
      guests: 0,
      entries: Object.fromEntries(LIVE_ENTRY_STATUSES.map((x) => [x, 0])) as LiveRelease['entries'],
    };
    const set = release({ afterRoom });
    const values = livePartValues(set, 'afterRoom');
    expect(values).toEqual({ enabled: 'true', modelId: 'm2', price: '900', sizes: '52 = 2', addons: 'GIFT BOX | 50', delay: '5', length: '20' });
    expect(livePartChange(set, 'afterRoom', values)).toEqual({});
    expect(livePartChange(set, 'afterRoom', { ...values, sizes: '52 = 3', length: '30' })).toEqual({
      afterRoom: { modelId: 'm2', priceMinor: 90_000, sizes: [{ id: 'z52', label: '52', stock: 3 }], addons: [{ id: 'g1', label: 'GIFT BOX', line: null, priceMinor: 5_000 }], delayMinutes: 5, lengthMinutes: 30 },
    });
    expect(livePartChange(set, 'afterRoom', { ...values, enabled: '' })).toEqual({ afterRoom: null });
    // Where it stands, said.
    expect(afterRoomTiming(afterRoom)).toBe('5 min after the sell-out, open 20 min');
    expect(afterRoomStateLabel(afterRoom)).toBe('AFTER A SELL-OUT');
    expect([afterRoomStateLabel({ state: 'OPENS', endedReason: null }), afterRoomStateLabel({ state: 'OPEN', endedReason: null }), afterRoomStateLabel({ state: 'NOT_OPENED', endedReason: null })]).toEqual(['OPENS SOON', 'OPEN', 'NOT OPENED']);
    expect([afterRoomStateLabel({ state: 'OVER', endedReason: 'SOLD_OUT' }), afterRoomStateLabel({ state: 'OVER', endedReason: 'CLOSED' })]).toEqual(['SOLD OUT', 'CLOSED']);
    expect(Object.keys(AFTER_ROOM_SKIPS).sort()).toEqual(['CANCELLED', 'NOT_SOLD_OUT', 'NO_GUESTS']);
  });

  it('gives an after-room\'s own page its live controls only, and its own lead', () => {
    const child = release({ phase: 'DRAFT', editable: false, afterRoomOf: { id: ID, title: 'THE MONOLITHE RING' } });
    expect(liveActions(child, 'ADMIN')).toMatchObject({ edit: false, publish: false, cancel: false, circlePost: false, boardLink: false });
    const live = { ...child, phase: 'LIVE' as const, publishedAt: '2026-11-10T19:00:00.000Z' };
    expect(liveActions(live, 'ADMIN')).toMatchObject({ edit: false, publish: false, cancel: false, boardLink: false, pause: true, extend: true, addPieces: true, message: true, end: true });
    expect(liveLead(child)).toMatch(/^The after-room of the release above: it opens only if that release sells out/);
    expect(liveLead(live)).toMatch(/^Open: its guests/);
    expect(liveLead({ ...child, phase: 'CANCELLED' })).toMatch(/^Never opened/);
    expect(liveLead({ ...child, phase: 'ENDED', over: true })).toMatch(/^Over/);
    expect(liveLead(release())).toMatch(/^A draft/);
    expect(['DRAFT', 'ANNOUNCED', 'ROOM', 'LIVE', 'CANCELLED'].map((phase) => liveStateLabel({ phase: phase as LiveRelease['phase'], endedReason: null }, true))).toEqual(['AFTER A SELL-OUT', 'OPENS SOON', 'OPENS SOON', 'LIVE', 'NOT OPENED']);
    expect(liveStateLabel({ phase: 'ENDED', endedReason: 'SOLD_OUT' }, true)).toBe('SOLD OUT');
  });

  it('shows the board’s figures, a deadline, the windows and the line’s rule', () => {
    const b = {
      totals: { stock: 5, left: 1, held: 2, sold: 2, waiting: 0, line: 7, turns: 2, secured: 1, confirmed: 2, missed: 3, expired: 1, interest: 40, inRoom: 12, released: 1, departed: 0, removed: 0, ended: 0 },
      lineTotal: 10,
    } as unknown as LiveBoard;
    expect(liveBoardFigures(b).map((f) => [f.label, f.value, f.note])).toEqual([
      ['In the room', '12', '0 BEFORE T0'],
      ['In line', '7', '10 OPEN ENTRIES'],
      ['Turns', '2', 'HOLDING THE SEAL'],
      ['Secured', '1', 'TO PAY'],
      ['Confirmed', '2', '2 OF 5 PIECES'],
      ['Pieces left', '1', '2 HELD MAY RETURN'],
      ['Missed turns', '3', 'A TURN THAT RAN OUT'],
      ['Ended holds', '1', '1 GIVEN BACK'],
    ]);
    expect(liveEntryDeadline({ status: 'TURN', turnExpiresAt: '2026-11-10T18:00:30.000Z', holdExpiresAt: null })).toBe('Until 10 NOV 2026 · 18:00:30 UTC');
    expect(liveEntryDeadline({ status: 'SECURED', turnExpiresAt: null, holdExpiresAt: '2026-11-10T18:05:30.000Z' })).toBe('To pay until 10 NOV 2026 · 18:05:30 UTC');
    expect(liveEntryDeadline({ status: 'QUEUED', turnExpiresAt: null, holdExpiresAt: null })).toBeNull();
    expect(windowLine({ tier: 3, turnSeconds: null, payMinutes: 10 })).toBe('PALLADIUM · 10 min to pay');
    expect(windowLine({ tier: 0, turnSeconds: 60, payMinutes: 2 })).toBe('NO TIER · 60 s to hold · 2 min to pay');
    expect(priorityLine(false)).toBe('At random for all');
  });
});

describe('AdminApi: the LIVE RELEASES', () => {
  it('reads, edits and controls them on their paths, a timer’s read never ending the session', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers: Response[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return answers.shift() ?? new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    let unauthorized = 0;
    const api = new AdminApi({ fetch, onUnauthorized: () => unauthorized++ });
    api.setCsrf('tok');
    await api.liveReleases(2, 20);
    await api.createLiveRelease({ modelId: 'm', title: 'T', opensAt: 'a', closesAt: 'b', priceMinor: 1, sizes: [{ label: '52', stock: 1 }] });
    await api.updateLiveRelease(ID, { title: 'U' });
    await api.publishLiveRelease(ID, true);
    await api.issueLiveBoardLink(ID);
    await api.revokeLiveBoardLink(ID);
    await api.pauseLive(ID);
    await api.extendLive(ID, 15);
    await api.addLivePieces(ID, 's52', 2);
    await api.messageLive(ID, 'The vault opens.');
    await api.endLive(ID);
    await api.letInLiveEntry(ID, 'e1');
    await api.removeLiveEntry(ID, 'e1');
    await api.liveEntries(ID, { status: 'OPEN', page: 1, pageSize: 50 });
    await api.setLiveSilhouette(ID, new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/webp' }));
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/live?page=2&pageSize=20',
      'POST /api/admin/live',
      `PATCH /api/admin/live/${ID}`,
      `POST /api/admin/live/${ID}/publish`,
      `POST /api/admin/live/${ID}/board-link`,
      `DELETE /api/admin/live/${ID}/board-link`,
      `POST /api/admin/live/${ID}/pause`,
      `POST /api/admin/live/${ID}/extend`,
      `POST /api/admin/live/${ID}/stock`,
      `POST /api/admin/live/${ID}/messages`,
      `POST /api/admin/live/${ID}/end`,
      `POST /api/admin/live/${ID}/entries/e1/let-in`,
      `POST /api/admin/live/${ID}/entries/e1/remove`,
      `GET /api/admin/live/${ID}/entries?status=OPEN&page=1&pageSize=50`,
      `POST /api/admin/live/${ID}/silhouette`,
    ]);
    const bodies = calls.map((c) => (typeof c.init.body === 'string' ? JSON.parse(c.init.body) : c.init.body));
    expect(bodies[3]).toEqual({ circlePost: true });
    expect(bodies[7]).toEqual({ minutes: 15 });
    expect(bodies[8]).toEqual({ sizeId: 's52', pieces: 2 });
    expect(bodies[9]).toEqual({ text: 'The vault opens.' });
    expect((calls[14]!.init.headers as Record<string, string>)['content-type']).toBe('image/webp');
    expect(calls.every((c) => c.init.method === 'GET' || (c.init.headers as Record<string, string>)['x-csrf-token'] === 'tok')).toBe(true);
    expect(api.liveStreamUrl(ID)).toBe(`/api/admin/live/${ID}/stream`);

    // A timer's read of the board answered 401: thrown, the session left to the admin's next action.
    answers.push(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in.' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    await expect(api.liveBoard(ID, { background: true })).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toBe(0);
  });
});
