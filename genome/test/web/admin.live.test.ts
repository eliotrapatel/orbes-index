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
  AFTER_ROOM_SKIPS,
  closeGuardLine,
  holdLine,
  holdShortenProblem,
  LIVE_HOLD_LABEL,
  LIVE_MESSAGE_HINT,
  liveEntryQueue,
  paceCloseGuard,
  afterRoomStateLabel,
  afterRoomTiming,
  combineLine,
  defaultQuantityLine,
  formatMoney,
  LIVE_LIMITS,
  liveActions,
  liveBoardFigures,
  liveEntryActions,
  liveEntryAdmission,
  liveEntryDeadline,
  liveLead,
  livePaceActions,
  livePaceFigures,
  livePageKey,
  livePartChange,
  livePartProblem,
  livePartValues,
  livePhrase,
  liveReference,
  liveStateLabel,
  moneyField,
  newLiveInput,
  newLivePickField,
  newLiveProblem,
  newLiveValues,
  paceHint,
  paceLine,
  paceProblem,
  parisClock,
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
    // ONE QUEUE (D1): every release has a pace and a hold after the opening.
    pace: { batch: 250, minutes: 1 },
    holdMinutes: 0,
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
    addonPick: [{ id: 'a1', name: 'ENGRAVING', line: 'Your initials inside the band', kind: 'SERVICE', engraving: true, active: true, priceMinor: 15_000 }],
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

  it('creates a release from its essentials, every other setting by default', () => {
    const v = newLiveValues(NOW);
    expect(v).toMatchObject({ opensAt: '2026-11-10T18:00', closesAt: '2026-11-10T19:00', currency: 'EUR', sizes: 'ONE SIZE = 25' });
    expect(v).toMatchObject({ paceBatch: '', paceMinutes: '', holdMinutes: '0' });
    expect(newLiveProblem(v)).toBe('Choose the model of the release.');
    // ONE QUEUE (D1): the pace and the hold are required (a hold of 0: none).
    const noPace: Record<string, string> = { ...v, modelId: 'm1', title: ' THE RING ', price: '4 800' };
    expect(newLiveProblem(noPace)).toBe('Say how many people per batch, every how many minutes.');
    expect(newLiveProblem({ ...noPace, paceBatch: '250', paceMinutes: '61' })).toBe('A pace gives 1 to 5\u2009000 turns every 1 to 60 minutes.');
    expect(newLiveProblem({ ...noPace, paceBatch: '250', paceMinutes: '1', holdMinutes: '' })).toBe('A hold after the opening lasts 0 to 120 minutes (0 for none).');
    expect(newLiveProblem({ ...noPace, paceBatch: '250', paceMinutes: '1', holdMinutes: '121' })).toBe('A hold after the opening lasts 0 to 120 minutes (0 for none).');
    const ok: Record<string, string> = { ...noPace, paceBatch: '250', paceMinutes: '1', holdMinutes: '10' };
    expect(newLiveProblem(ok)).toBeNull();
    expect(newLiveInput(ok)).toEqual({
      modelId: 'm1',
      title: 'THE RING',
      opensAt: '2026-11-10T18:00:00.000Z',
      closesAt: '2026-11-10T19:00:00.000Z',
      priceMinor: 480_000,
      currency: 'EUR',
      pace: { batch: 250, minutes: 1 },
      holdMinutes: 10,
      sizes: [{ label: 'ONE SIZE', stock: 25 }],
    });
    // Lot Q2, step Q2.7 (D3, N7): its Add-ons offered, one list per currency, the release's currency's boxes sent in their
    // order; none listed (unread), the server's default; none ticked, none offered.
    expect(newLivePickField('GBP')).toBe('addonIds:GBP');
    expect(newLiveInput({ ...ok, 'addonIds:EUR': 'a1,a2', 'addonIds:GBP': 'a3' })).toMatchObject({ currency: 'EUR', addonIds: ['a1', 'a2'] });
    expect(newLiveInput({ ...ok, currency: 'GBP', 'addonIds:EUR': 'a1,a2', 'addonIds:GBP': 'a3' })).toMatchObject({ currency: 'GBP', addonIds: ['a3'] });
    expect(newLiveInput({ ...ok, 'addonIds:EUR': '' })).toMatchObject({ addonIds: [] });
    expect(newLiveInput({ ...ok, 'addonIds:GBP': 'a3' })).not.toHaveProperty('addonIds');
    expect(newLiveProblem({ ...ok, closesAt: ok.opensAt })).toBe('The release ends after T0.');
    expect(newLiveProblem({ ...ok, price: 'x' })).toMatch(/price of a piece/);
    expect(newLiveProblem({ ...ok, currency: 'JPY' })).toBe('Choose the currency.');
    expect(newLiveProblem({ ...ok, sizes: '' })).toMatch(/List the sizes/);
  });

  it('sends only what a part’s dialog changed, and nothing when it changed nothing', () => {
    const r = release();
    // Lot Q2, step Q2.4 (D2): the release add-ons' part is gone (its pick of the catalogue is read in its Add-ons section).
    for (const part of ['release', 'sizes', 'access', 'times', 'turns'] as const) {
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
    // A segment that reads the engagement score is chosen and sent like any other (plan CUSTOMER INTELLIGENCE §3.6
    // C.5.4, question 15): no mark, no refusal; GET /api/admin/segments/names still gives the id and the name alone.
    const scored = release({ access: { models: [], collection: null, minParticipations: null, segment: { id: 'seg-score', name: 'Engaged' }, combine: 'AND', text: 'selected collectors' } });
    expect(livePartValues(scored, 'access')).toMatchObject({ segmentId: 'seg-score' });
    expect(livePartProblem(r, 'access', { ...v, segmentId: 'seg-score' })).toBeNull();
    expect(livePartChange(r, 'access', { ...v, segmentId: 'seg-score' })).toEqual({ accessSegmentId: 'seg-score' });
    expect(livePartChange(scored, 'access', livePartValues(scored, 'access'))).toEqual({});
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

  it('sets the after-room with the release: on or off, its model, price, sizes, delay and length, its ids kept (its add-ons its own pick, lot Q2)', () => {
    const none = release();
    expect(livePartValues(none, 'afterRoom')).toEqual({ enabled: '', modelId: '', price: '', sizes: 'ONE SIZE = 5', delay: '10', length: '15' });
    // Off and staying off: nothing to send, nothing to check.
    expect(livePartProblem(none, 'afterRoom', livePartValues(none, 'afterRoom'))).toBeNull();
    expect(livePartChange(none, 'afterRoom', livePartValues(none, 'afterRoom'))).toEqual({});
    const on = { ...livePartValues(none, 'afterRoom'), enabled: 'true', modelId: 'm2', price: '900', sizes: '52 = 2\n54 = 1' };
    expect(livePartProblem(none, 'afterRoom', on)).toBeNull();
    expect(livePartChange(none, 'afterRoom', on)).toEqual({
      afterRoom: { modelId: 'm2', priceMinor: 90_000, sizes: [{ label: '52', stock: 2 }, { label: '54', stock: 1 }], delayMinutes: 10, lengthMinutes: 15 },
    });
    expect(livePartProblem(none, 'afterRoom', { ...on, modelId: '' })).toMatch(/model/);
    expect(livePartProblem(none, 'afterRoom', { ...on, price: 'x' })).toMatch(/price/);
    expect(livePartProblem(none, 'afterRoom', { ...on, sizes: '' })).toMatch(/^The after-room: list the sizes/);
    expect(livePartProblem(none, 'afterRoom', { ...on, delay: '0' })).toBe('The after-room opens 1 to 60 minutes after the sell-out.');
    expect(livePartProblem(none, 'afterRoom', { ...on, length: '121' })).toBe('The after-room is open 5 to 120 minutes.');
    // Set: its values, its sizes keeping their ids; the same again changes nothing; off removes it.
    const afterRoom = {
      id: 'c1',
      model: { id: 'm2', name: 'AFTERGLOW', type: 'RING', active: true },
      priceMinor: 90_000,
      currency: 'EUR',
      sizes: [{ id: 'z52', label: '52', stock: 2 }],
      quantity: 2,
      addonPick: [{ id: 'g1', name: 'GIFT BOX', line: null, kind: 'SERVICE' as const, engraving: false, active: true, priceMinor: 5_000 }],
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
    expect(values).toEqual({ enabled: 'true', modelId: 'm2', price: '900', sizes: '52 = 2', delay: '5', length: '20' });
    expect(livePartChange(set, 'afterRoom', values)).toEqual({});
    expect(livePartChange(set, 'afterRoom', { ...values, sizes: '52 = 3', length: '30' })).toEqual({
      afterRoom: { modelId: 'm2', priceMinor: 90_000, sizes: [{ id: 'z52', label: '52', stock: 3 }], delayMinutes: 5, lengthMinutes: 30 },
    });
    expect(livePartChange(set, 'afterRoom', { ...values, enabled: '' })).toEqual({ afterRoom: null });
    // Lot Q2, step Q2.7 (D3): its own pick, sent only once changed (the boxes in their order); a new after-room's always.
    expect(livePartChange(set, 'afterRoom', { ...values, addonIds: 'g1' })).toEqual({});
    expect(livePartChange(set, 'afterRoom', { ...values, addonIds: '' })).toEqual({
      afterRoom: { modelId: 'm2', priceMinor: 90_000, sizes: [{ id: 'z52', label: '52', stock: 2 }], addonIds: [], delayMinutes: 5, lengthMinutes: 20 },
    });
    expect(livePartChange(set, 'afterRoom', { ...values, addonIds: 'a1,g1', length: '30' })).toMatchObject({ afterRoom: { addonIds: ['a1', 'g1'], lengthMinutes: 30 } });
    expect(livePartChange(none, 'afterRoom', { ...on, addonIds: 'g1' })).toEqual({
      afterRoom: { modelId: 'm2', priceMinor: 90_000, sizes: [{ label: '52', stock: 2 }, { label: '54', stock: 1 }], addonIds: ['g1'], delayMinutes: 10, lengthMinutes: 15 },
    });
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

describe('the console of a LIVE RELEASE’s pace and hold (ONE QUEUE, lot Q1 §4)', () => {
  it('holds the pace and the hold in the times part, both required (ONE QUEUE, D1; M1 « both figures or neither (blank: no pace) » gone), sending only what changed', () => {
    const r = release();
    expect(LIVE_LIMITS.pace).toEqual({ batch: { min: 1, max: 5000 }, minutes: { min: 1, max: 60 } });
    expect(LIVE_LIMITS.hold).toEqual({ min: 0, max: 120 });
    const v = livePartValues(r, 'times');
    expect(v).toMatchObject({ paceBatch: '250', paceMinutes: '1', holdMinutes: '0' });
    expect(livePartProblem(r, 'times', v)).toBeNull();
    expect(livePartChange(r, 'times', v)).toEqual({});
    expect(livePartChange(r, 'times', { ...v, paceBatch: ' 90 ', paceMinutes: '2' })).toEqual({ pace: { batch: 90, minutes: 2 } });
    expect(livePartChange(r, 'times', { ...v, paceMinutes: '5' })).toEqual({ pace: { batch: 250, minutes: 5 } });
    expect(livePartChange(r, 'times', { ...v, holdMinutes: '15' })).toEqual({ holdMinutes: 15 });
    expect(livePartProblem(r, 'times', { ...v, paceBatch: '', paceMinutes: '' })).toBe('Say how many people per batch, every how many minutes.');
    for (const [batch, minutes] of [['250', ''], ['', '1'], ['0', '1'], ['5001', '1'], ['250', '61'], ['2.5', '1'], ['250', 'soon']]) {
      expect([batch, minutes, livePartProblem(r, 'times', { ...v, paceBatch: batch, paceMinutes: minutes })]).toEqual([batch, minutes, 'A pace gives 1 to 5\u2009000 turns every 1 to 60 minutes.']);
    }
    for (const hold of ['', '-1', '121', '2.5']) expect(livePartProblem(r, 'times', { ...v, holdMinutes: hold })).toBe('A hold after the opening lasts 0 to 120 minutes (0 for none).');
    // SET PACE: both figures needed there too.
    expect(paceProblem('', '')).toBe('Say how many people per batch, every how many minutes.');
    expect(paceProblem('5001', '1')).toBe('A pace gives 1 to 5\u2009000 turns every 1 to 60 minutes.');
    expect(paceProblem('5000', '60')).toBeNull();
    // Said in the owner's words of the New live release dialog (D1: « People per batch », « Every (minutes) »).
    expect([paceLine({ batch: 250, minutes: 1 }), paceLine({ batch: 1, minutes: 5 }), paceLine({ batch: 5000, minutes: 60 })]).toEqual([
      '250 people per batch, every minute',
      '1 person per batch, every 5 minutes',
      '5\u2009000 people per batch, every 60 minutes',
    ]);
    // The hold after the opening, in the times part: its label the owner's (its figure in --font: views/live.ts).
    expect(LIVE_HOLD_LABEL).toBe('Hold after the opening (minutes, 0 = none)');
    expect([holdLine(0), holdLine(undefined), holdLine(1), holdLine(10)]).toEqual(['None', 'None', '1 minute after the opening', '10 minutes after the opening']);
    expect(paceHint(500)).toBe('Turns given from the line, 1 to 5\u2009000 per batch, every 1 to 60 minutes, in the line’s order, where a piece is free. The room holds 500, as the load test measured.');
    expect(paceHint(null)).toBe('Turns given from the line, 1 to 5\u2009000 per batch, every 1 to 60 minutes, in the line’s order, where a piece is free.');
  });

  it('draws the Pace block’s figures in Paris time, a dash while held, and offers its controls to an OPERATOR from T0 to the end', () => {
    // 18:04 UTC in November is 19:04 in Paris; in July, 20:04.
    expect([parisClock('2026-11-10T18:04:09.000Z'), parisClock('2026-07-10T18:04:09.000Z', { seconds: true }), parisClock(null)]).toEqual(['19:04', '20:04:09', '—']);
    const pace = {
      batch: 250,
      minutes: 1,
      nextAt: '2026-11-10T18:04:00.000Z',
      pausedAt: null,
      paused: false,
      batches: 4,
      waiting: 4120,
      admitted: 1000,
      turnsGiven: 996,
      letIn: 4,
      holdMinutes: 0,
      holdEndsAt: null,
      beyond: 3870,
      closeGuard: null,
    };
    const live = { phase: 'LIVE' as const, paused: false, endedAt: null, pace };
    // D11, add only: the four M1 figures kept (their meanings said), then the turns given by the pace and those beyond
    // the pieces; the hold's end only while the hold lasts.
    expect(livePaceFigures(live).map((f) => [f.label, f.value, f.note, f.testId])).toEqual([
      ['In the queue', '4\u2009120', 'WAITING IN THE QUEUE', 'live-pace-waiting'],
      ['Admitted', '1\u2009000', 'GIVEN A TURN, ALL WAYS', 'live-pace-admitted'],
      ['Batches', '4', '250 EVERY MINUTE', 'live-pace-batches'],
      ['Next batch', '19:04', 'PARIS TIME', 'live-pace-next'],
      ['Turns given', '996', 'BY THE PACE', 'live-pace-turns'],
      ['Beyond the pieces', '3\u2009870', 'PAST THEIR SIZE’S PIECES', 'live-pace-beyond'],
    ]);
    const next = (b: Parameters<typeof livePaceFigures>[0]) => livePaceFigures(b)[3]!;
    expect(next({ ...live, phase: 'ROOM', pace: { ...pace, minutes: 5, batches: 0 } })).toMatchObject({ value: '19:04', note: 'PARIS · AT T0' });
    expect(next({ ...live, pace: { ...pace, paused: true, pausedAt: '2026-11-10T18:03:00.000Z' } })).toMatchObject({ value: '—', note: 'PACE PAUSED' });
    expect(next({ ...live, paused: true })).toMatchObject({ value: '—', note: 'RELEASE PAUSED' });
    expect(next({ ...live, phase: 'ENDED', endedAt: '2026-11-10T18:30:00.000Z' })).toMatchObject({ value: '—', note: 'NONE AFTER THE END' });
    expect(livePaceFigures({ ...live, pace: { ...pace, minutes: 5 } })[2]!.note).toBe('250 EVERY 5 MINUTES');
    // The hold after the opening (D4): before T0 the first batch and the hold's end at T0 + the hold, in Paris; held
    // like the next batch while a pause holds it; gone with the hold (and after the end).
    const held = { ...pace, batches: 0, nextAt: '2026-11-10T18:10:00.000Z', holdMinutes: 10, holdEndsAt: '2026-11-10T18:10:00.000Z' };
    const hold = (b: Parameters<typeof livePaceFigures>[0]) => livePaceFigures(b).find((f) => f.testId === 'live-pace-hold') ?? null;
    expect(next({ ...live, phase: 'ROOM', pace: held })).toMatchObject({ value: '19:10', note: 'PARIS · T0 + 10 MIN' });
    expect(hold({ ...live, phase: 'ROOM', pace: held })).toEqual({ label: 'Hold ends', value: '19:10', note: 'PARIS · T0 + 10 MIN', testId: 'live-pace-hold' });
    expect(hold({ ...live, pace: held })).toMatchObject({ value: '19:10', note: 'PARIS TIME' });
    expect(hold({ ...live, pace: { ...held, paused: true } })).toMatchObject({ value: '—', note: 'PACE PAUSED' });
    expect(hold({ ...live, paused: true, pace: held })).toMatchObject({ value: '—', note: 'RELEASE PAUSED' });
    expect(hold({ ...live, phase: 'ENDED', endedAt: '2026-11-10T18:30:00.000Z', pace: held })).toBeNull();
    expect(hold(live)).toBeNull();
    expect(livePaceFigures({ ...live, pace: held }).map((f) => f.label)).toEqual(['In the queue', 'Admitted', 'Batches', 'Next batch', 'Turns given', 'Beyond the pieces', 'Hold ends']);

    // SET PACE until the end; PAUSE or RESUME PACE and NEXT BATCH NOW from T0 (NEXT BATCH NOW not while the release is
    // PAUSED, N3; under PAUSE PACE it works); SHORTEN THE HOLD and END THE HOLD NOW from the announcement while the hold
    // lasts (D4; before the announcement the hold is a setting, N14).
    const none = { set: false, pause: false, resume: false, next: false, shorten: false, endHold: false };
    expect(livePaceActions(live, 'OPERATOR', false)).toEqual({ ...none, set: true, pause: true, next: true });
    expect(livePaceActions({ ...live, pace: { ...pace, paused: true } }, 'OPERATOR', false)).toEqual({ ...none, set: true, resume: true, next: true });
    expect(livePaceActions({ ...live, paused: true }, 'OPERATOR', false)).toEqual({ ...none, set: true, pause: true });
    // Nobody in the queue: no NEXT BATCH NOW (an empty batch would give no turn).
    expect(livePaceActions({ ...live, pace: { ...pace, waiting: 0 } }, 'OPERATOR', false)).toEqual({ ...none, set: true, pause: true });
    for (const phase of ['HIDDEN', 'ANNOUNCED', 'ROOM'] as const) expect([phase, livePaceActions({ ...live, phase }, 'OPERATOR', false)]).toEqual([phase, { ...none, set: true }]);
    for (const phase of ['ANNOUNCED', 'ROOM'] as const) expect([phase, livePaceActions({ ...live, phase, pace: held }, 'OPERATOR', false)]).toEqual([phase, { ...none, set: true, shorten: true, endHold: true }]);
    expect(livePaceActions({ ...live, phase: 'HIDDEN', pace: held }, 'OPERATOR', false)).toEqual({ ...none, set: true });
    expect(livePaceActions({ ...live, pace: held }, 'OPERATOR', false)).toEqual({ ...none, set: true, pause: true, next: true, shorten: true, endHold: true });
    // A hold already shortened to 0 (its first batch due at T0): only ended.
    expect(livePaceActions({ ...live, phase: 'ROOM', pace: { ...held, holdMinutes: 0 } }, 'OPERATOR', false)).toEqual({ ...none, set: true, endHold: true });
    expect(livePaceActions({ ...live, phase: 'ENDED', endedAt: '2026-11-10T18:30:00.000Z', pace: held }, 'ADMIN', false)).toEqual(none);
    expect(livePaceActions({ ...live, endedAt: '2026-11-10T18:30:00.000Z' }, 'ADMIN', false)).toEqual(none);
    expect(livePaceActions({ ...live, pace: held }, 'AUDITOR', false)).toEqual(none);
    // An after-room never has a pace.
    expect(livePaceActions({ ...live, pace: null }, 'ADMIN', true)).toEqual(none);

    // The line's Admitted column: the batch and when, in Paris; WAITING for a batch; none before the line.
    expect(liveEntryAdmission({ status: 'TURN', admittedAt: '2026-11-10T18:02:00.000Z', batch: 3, letIn: false })).toEqual({ text: 'Batch 3', at: '19:02 Paris' });
    expect(liveEntryAdmission({ status: 'QUEUED', admittedAt: '2026-11-10T18:00:00.000Z', batch: 0, letIn: false })).toEqual({ text: 'At once', at: '19:00 Paris' });
    // Let in by the console: said so, whatever the batch count was then.
    expect(liveEntryAdmission({ status: 'TURN', admittedAt: '2026-11-10T18:02:30.000Z', batch: 3, letIn: true })).toEqual({ text: 'Let in', at: '19:02 Paris' });
    expect(liveEntryAdmission({ status: 'QUEUED', admittedAt: null, batch: null, letIn: false })).toEqual({ text: 'Waiting', at: null });
    expect(liveEntryAdmission({ status: 'WAITING', admittedAt: null, batch: null, letIn: false })).toEqual({ text: '—', at: null });
    // D11: each person's queue place (in its size) and estimated turn in Paris time, while in the queue.
    expect(liveEntryQueue({ placeInSize: 1240, estimatedTurnAt: '2026-11-10T18:12:00.000Z' })).toEqual({ place: '1\u2009240', turn: '19:12 Paris' });
    expect(liveEntryQueue({ placeInSize: 3, estimatedTurnAt: null })).toEqual({ place: '3', turn: '—' });
    expect(liveEntryQueue({ placeInSize: null, estimatedTurnAt: null })).toEqual({ place: '—', turn: '—' });
    expect(liveEntryQueue({})).toEqual({ place: '—', turn: '—' });
  });

  it('warns when the pace cannot offer every piece before the close (D10, advice only), and shortens the hold only (D4)', () => {
    expect(closeGuardLine(120)).toBe('AT THIS PACE, 120 PIECES REMAIN AT THE CLOSE');
    expect(closeGuardLine(1)).toBe('AT THIS PACE, 1 PIECE REMAINS AT THE CLOSE');
    expect(closeGuardLine(1200)).toBe('AT THIS PACE, 1\u2009200 PIECES REMAIN AT THE CLOSE');
    expect([closeGuardLine(3, true), closeGuardLine(1, true)]).toEqual(['AT THIS PACE, 3 SETS REMAIN AT THE CLOSE', 'AT THIS PACE, 1 SET REMAINS AT THE CLOSE']);
    // As the server reads it (services/live-queue.ts closeGuard): the batches from the next one (which keeps its time),
    // every Y minutes, each strictly before the close, times X, against the pieces not confirmed.
    const next = '2026-11-10T18:10:00.000Z';
    const close = '2026-11-10T19:00:00.000Z';
    // 50 minutes: 50 batches of 1 every minute for 170 pieces: 120 remain; 5 every 10 minutes: 5 batches, 25 turns.
    expect(paceCloseGuard({ batch: 1, minutes: 1 }, next, close, 170)).toBe(120);
    expect(paceCloseGuard({ batch: 5, minutes: 10 }, next, close, 30)).toBe(5);
    expect(paceCloseGuard({ batch: 5, minutes: 10 }, next, close, 25)).toBeNull();
    // 50 minutes every 15: batches at 0, 15, 30, 45 (4).
    expect(paceCloseGuard({ batch: 10, minutes: 15 }, next, close, 41)).toBe(1);
    expect(paceCloseGuard({ batch: 1, minutes: 1 }, close, close, 3)).toBe(3);
    expect(paceCloseGuard({ batch: 1, minutes: 1 }, next, close, 0)).toBeNull();
    // SHORTEN THE HOLD: a whole number of minutes, shorter than the hold now; none to shorten at 0.
    expect(holdShortenProblem('5', 10)).toBeNull();
    expect(holdShortenProblem('0', 10)).toBeNull();
    for (const v of ['10', '11', '', '-1', '2.5', 'soon']) expect([v, holdShortenProblem(v, 10)]).toEqual([v, 'A shorter hold: 0 to 9 minutes after the opening.']);
    expect(holdShortenProblem('0', 2)).toBeNull();
    expect(holdShortenProblem('1', 2)).toBeNull();
    expect(holdShortenProblem('2', 2)).toBe('A shorter hold: 0 to 1 minute after the opening.');
    expect(holdShortenProblem('0', 0)).toBe('This release has no hold left to shorten.');
  });

  it('says where the host message shows, as the collector screens show it (D11; mockup FROM ORBES on #queue, #sold, #after-wait, #turn, #secured; none on #confirmed and #after-door)', () => {
    expect(LIVE_MESSAGE_HINT).toBe('One line, shown on the room, the draw, the late comer’s entry, the queue, SOLD OUT for your size, the after-room’s waiting screen, the turn and SECURED, until the next one.');
    expect(LIVE_MESSAGE_HINT).not.toMatch(/CONFIRMED|door/i);
  });

  it('sends SET PACE, PAUSE PACE, RESUME PACE, NEXT BATCH NOW, SHORTEN THE HOLD and END THE HOLD NOW on their paths, and reads those beyond the pieces', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch, onUnauthorized: () => {} });
    api.setCsrf('tok');
    await api.setLivePace(ID, { batch: 250, minutes: 1 });
    await api.pauseLivePace(ID);
    await api.resumeLivePace(ID);
    await api.nextLiveBatch(ID);
    await api.shortenLiveHold(ID, 5);
    await api.endLiveHold(ID);
    await api.liveEntries(ID, { status: 'BEYOND', page: 1, pageSize: 50 });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      `PUT /api/admin/live/${ID}/pace`,
      `POST /api/admin/live/${ID}/pace/pause`,
      `POST /api/admin/live/${ID}/pace/resume`,
      `POST /api/admin/live/${ID}/pace/next`,
      `POST /api/admin/live/${ID}/hold/shorten`,
      `POST /api/admin/live/${ID}/hold/end`,
      `GET /api/admin/live/${ID}/entries?status=BEYOND&page=1&pageSize=50`,
    ]);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ batch: 250, minutes: 1 });
    expect(JSON.parse(calls[4]!.init.body as string)).toEqual({ minutes: 5 });
    expect(calls.every((c) => c.init.method === 'GET' || (c.init.headers as Record<string, string>)['x-csrf-token'] === 'tok')).toBe(true);
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
