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
  LIVE_PAY_MINUTES,
  LIVE_PER_ACCOUNT,
  LIVE_PHASES as SERVER_LIVE_PHASES,
  LIVE_ROOM_OPENS_MINUTES,
  LIVE_SIZE_STOCK_MAX,
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
  LIVE_RESOLUTION_NOTE_MAX,
  LIVE_SIZES,
  liveReference as serverReference,
} from '../../src/server/services/live-console.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import {
  addonsText,
  canResolve,
  defaultQuantityLine,
  formatMoney,
  LIVE_LIMITS,
  liveActions,
  liveBoardFigures,
  liveEntryActions,
  liveEntryDeadline,
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
  parseSizes,
  priorityLine,
  reservationAddons,
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
    access: { models: [], collection: null, text: 'every ORBES account' },
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
      note: LIVE_RESOLUTION_NOTE_MAX,
      accessModels: LIVE_ACCESS_MODELS_MAX,
      line: LIVE_CONSOLE_LINE_MAX,
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
    expect([toneOf('liveResolution', 'CONCLUDED'), toneOf('liveResolution', 'CANCELLED')]).toEqual(['solid', 'muted']);
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

  it('offers each role what it may do now: OPERATOR edits until the announcement and runs the controls, ADMIN ends', () => {
    const draft = release();
    expect(liveActions(draft, 'AUDITOR', NOW)).toEqual({ edit: false, publish: false, cancel: false, boardLink: false, pause: false, resume: false, extend: false, addPieces: false, message: false, end: false });
    expect(liveActions(draft, 'OPERATOR', NOW)).toMatchObject({ edit: true, publish: true, cancel: true, boardLink: true, pause: false, extend: false, end: false });
    const announced = release({ phase: 'ANNOUNCED', editable: false, publishedAt: '2026-11-01T09:00:00.000Z' });
    expect(liveActions(announced, 'OPERATOR', NOW)).toMatchObject({ edit: false, publish: false, cancel: true, addPieces: true, extend: true, message: true, pause: false });
    const live = release({ phase: 'LIVE', editable: false, publishedAt: '2026-11-01T09:00:00.000Z' });
    const during = new Date('2026-11-10T18:10:00.000Z');
    expect(liveActions(live, 'OPERATOR', during)).toMatchObject({ cancel: false, pause: true, resume: false, extend: true, addPieces: true, message: true, end: false });
    expect(liveActions(live, 'ADMIN', during)).toMatchObject({ end: true });
    expect(liveActions({ ...live, pausedAt: during.toISOString() }, 'OPERATOR', during)).toMatchObject({ pause: false, resume: true });
    const ended = { ...live, phase: 'ENDED' as const, endedAt: during.toISOString() };
    expect(liveActions(ended, 'ADMIN', during)).toMatchObject({ pause: false, extend: false, addPieces: false, message: false, end: false });
    expect(can('OPERATOR', 'endLiveRelease')).toBe(false);
    expect(can('ADMIN', 'removeLiveEntry')).toBe(true);
    const board = { phase: 'LIVE' as const, paused: false, endedAt: null };
    expect(liveEntryActions({ status: 'QUEUED' }, board, 'OPERATOR')).toEqual({ letIn: true, free: false, remove: false });
    expect(liveEntryActions({ status: 'QUEUED' }, { ...board, paused: true }, 'OPERATOR')).toEqual({ letIn: false, free: false, remove: false });
    expect(liveEntryActions({ status: 'SECURED' }, board, 'ADMIN')).toEqual({ letIn: false, free: true, remove: true });
    expect(liveEntryActions({ status: 'CONFIRMED' }, board, 'ADMIN')).toEqual({ letIn: false, free: false, remove: false });
    expect(liveEntryActions({ status: 'SECURED' }, board, 'AUDITOR')).toEqual({ letIn: false, free: false, remove: false });
    expect([livePhrase('end', draft), livePhrase('cancel', draft)]).toEqual(['END 0F8E7D6C', 'CANCEL 0F8E7D6C']);
    expect(canResolve({ resolution: null }, 'OPERATOR')).toBe(true);
    expect(canResolve({ resolution: 'CONCLUDED' }, 'ADMIN')).toBe(false);
    expect(canResolve({ resolution: null }, 'AUDITOR')).toBe(false);
  });

  it('shows the board’s figures, a deadline, the windows, the line’s rule and a reservation’s add-ons', () => {
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
    expect(reservationAddons({ currency: 'EUR', addons: [{ id: 'a', label: 'ENGRAVING', priceMinor: 15_000 }] })).toBe('ENGRAVING € 150');
    expect(reservationAddons({ currency: 'EUR', addons: [] })).toBe('None');
  });
});

describe('AdminApi: the LIVE RELEASES', () => {
  it('reads, edits, controls and concludes them on their paths, a timer’s read never ending the session, the CSV saved', async () => {
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
    await api.resolveLiveReservation(ID, 'e1', 'CANCELLED', '');
    await api.resolveLiveReservation(ID, 'e1', 'CONCLUDED', 'Paid.');
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
      `POST /api/admin/live/${ID}/entries/e1/resolve`,
      `POST /api/admin/live/${ID}/entries/e1/resolve`,
      `GET /api/admin/live/${ID}/entries?status=OPEN&page=1&pageSize=50`,
      `POST /api/admin/live/${ID}/silhouette`,
    ]);
    const bodies = calls.map((c) => (typeof c.init.body === 'string' ? JSON.parse(c.init.body) : c.init.body));
    expect(bodies[3]).toEqual({ circlePost: true });
    expect(bodies[7]).toEqual({ minutes: 15 });
    expect(bodies[8]).toEqual({ sizeId: 's52', pieces: 2 });
    expect(bodies[9]).toEqual({ text: 'The vault opens.' });
    expect(bodies[13]).toEqual({ resolution: 'CANCELLED' });
    expect(bodies[14]).toEqual({ resolution: 'CONCLUDED', note: 'Paid.' });
    expect((calls[16]!.init.headers as Record<string, string>)['content-type']).toBe('image/webp');
    expect(calls.every((c) => c.init.method === 'GET' || (c.init.headers as Record<string, string>)['x-csrf-token'] === 'tok')).toBe(true);
    expect(api.liveStreamUrl(ID)).toBe(`/api/admin/live/${ID}/stream`);

    // A timer's read of the board answered 401: thrown, the session left to the admin's next action.
    answers.push(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in.' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    await expect(api.liveBoard(ID, { background: true })).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toBe(0);

    answers.push(new Response('"reference"\r\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8; header=present', 'content-disposition': 'attachment; filename="ORBES-live-0F8E7D6C-reservations-2026-11-10.csv"' } }));
    const csv = await api.liveReservationsCsv(ID);
    expect(csv.filename).toBe('ORBES-live-0F8E7D6C-reservations-2026-11-10.csv');
    expect(await csv.blob.text()).toBe('"reference"\r\n');
  });
});
