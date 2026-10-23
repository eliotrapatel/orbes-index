/**
 * The LIVE RELEASES in the console (Clients › Club › Drops) — pure helpers, no DOM.
 *
 *  - The bounds the server holds a release to (services/live.ts, services/live-console.ts), mirrored and tested.
 *  - Where a release stands, said as the console says it (DRAFT, SCHEDULED, ANNOUNCED, ROOM OPEN, LIVE, SOLD OUT,
 *    CLOSED, ENDED, CANCELLED), its tone, and one line under the page's title.
 *  - The dialogs of its settings, one per part (the release, its sizes, its access, its times, its turns and holds, its
 *    add-ons, its after-room, its surprise): their values as the form holds them (times as `datetime-local` values read in UTC, prices in units, the
 *    sizes one per line `52 = 3`, the add-ons one per line `ENGRAVING | 150 | Your initials, by hand`), what the server
 *    would refuse before anything is sent, and the change to send (the lists with the ids they keep).
 *  - What each role may do now: edit until the announcement, publish, cancel before the room opens, the silhouette and
 *    the board link (OPERATOR); the live controls (OPERATOR: pause, resume, extend, add pieces, free a hold, let in, a
 *    host message; ADMIN: end now with a typed phrase, remove from the line). Client Services follows each confirmed
 *    reservation on the Orders board (plan LIVE RELEASE+: model/orders.ts).
 *  - The live board's figures, and a reservation's reference.
 *  - The pace and the hold (ONE QUEUE, D1): X people per batch every Y minutes and the hold after the opening (minutes,
 *    0 = none), required in the New live release dialog and in the times part, and the live board's Pace block (D11, add
 *    only): its figures (in the queue, admitted all ways, the batches, the next batch in Paris time, kept; the turns
 *    given by the pace, beyond the pieces and the hold's end in Paris time, added), its controls (OPERATOR: SET PACE,
 *    PAUSE PACE / RESUME PACE, NEXT BATCH NOW, SHORTEN THE HOLD and END THE HOLD NOW, D4, D6, D7), the close guard's
 *    warning (D10, advice only), and the line's turn (its batch and when), queue place and estimated turn.
 *  - The after-room (plan LIVE RELEASE+, choice 2): where it stands and why it never opened, said; its own page has the
 *    live board and controls, never a setting, a publication, a cancellation or a board link of its own.
 *  - Plan LIVE RELEASE+, step S8: the question after (choice 11), its words one answer per line and its answers
 *    counted; the release's stock location (choice 16, in the sizes' part); the size mix proposed at creation (choice
 *    13) written as the sizes' lines; the feasibility check before publishing (choice 12) said per size.
 */
import { formatCount, formatDateTime, percent } from '../format.js';
import { can } from './permissions.js';
import { localUtc, tierName, utcInstant } from './club.js';
import {
  LIVE_CURRENCIES,
  LIVE_HOLD_MINUTES,
  LIVE_PACE_BATCH,
  LIVE_PACE_MINUTES,
  type AdminRole,
  type AfterRoomSkip,
  type LiveFeasibility,
  type LiveQuestion,
  type LiveSizeMix,
  type LiveAfterRoom,
  type LiveAfterRoomSettings,
  type LiveBoard,
  type LiveCard,
  type LiveCurrency,
  type LiveEntry,
  type LivePace,
  type LivePaceState,
  type LivePhase,
  type LiveRelease,
  type LiveSettings,
  type LiveSettingsChange,
} from '../types.js';

/** The bounds of services/live.ts and services/live-console.ts (test/web/admin.model.test.ts compares them). */
export const LIVE_LIMITS = Object.freeze({
  title: 120,
  description: 2000,
  sizes: 24,
  sizeLabel: 12,
  stock: 10_000,
  quantity: 10_000,
  quantityLine: 40,
  addons: 6,
  addonLabel: 40,
  addonLine: 120,
  priceMaxMinor: 100_000_000,
  roomOpensMinutes: Object.freeze({ min: 1, max: 60, default: 5 }),
  turnSeconds: Object.freeze({ min: 10, max: 300, default: 30 }),
  payMinutes: Object.freeze({ min: 1, max: 60, default: 5 }),
  perAccount: Object.freeze({ min: 1, max: 5, default: 1 }),
  extendMinutes: Object.freeze({ min: 1, max: 240 }),
  addPieces: Object.freeze({ min: 1, max: 1000 }),
  message: 140,
  accessModels: 20,
  /** Plan LIVE RELEASE+: a rule of taking part, 1 to 100 releases (choice 4); a surprise's description (choice 3). */
  minParticipations: Object.freeze({ min: 1, max: 100 }),
  surprise: 500,
  /** The open entries the live board carries. */
  line: 200,
  /** The after-room (services/after-room.ts): it opens this long after the sell-out, open this long, in minutes. */
  afterRoomDelay: Object.freeze({ min: 1, max: 60, default: 10 }),
  afterRoomLength: Object.freeze({ min: 5, max: 120, default: 15 }),
  /** The question after (services/question.ts LIVE_QUESTION_LIMITS): its words, its 2 to 6 answers of one line each. */
  question: Object.freeze({ text: 120, answer: 40, minAnswers: 2, maxAnswers: 6 }),
  /** The pace (services/live.ts LIVE_PACE_BATCH, LIVE_PACE_MINUTES): X people per batch every Y minutes. */
  pace: Object.freeze({ batch: LIVE_PACE_BATCH, minutes: LIVE_PACE_MINUTES }),
  /** The hold after the opening (services/live.ts LIVE_HOLD_MINUTES), in minutes: 0 for none. */
  hold: LIVE_HOLD_MINUTES,
});

/** The hold's field, in the owner's words (ANSWERS r5, D1): 'Hold after the opening (minutes, 0 = none)'. */
export const LIVE_HOLD_LABEL = 'Hold after the opening (minutes, 0 = none)';

/**
 * The host message's dialog says where the line shows (ONE QUEUE, D11; the mockup's FROM ORBES under ORBES on #queue,
 * #sold, #after-wait, #turn and #secured, none on #confirmed and #after-door; production's room, draw and late comer's
 * entry, unchanged, D32).
 */
export const LIVE_MESSAGE_HINT =
  'One line, shown on the room, the draw, the late comer’s entry, the queue, SOLD OUT for your size, the after-room’s waiting screen, the turn and SECURED, until the next one.';

/** The question after when the console does not rewrite it (services/live.ts LIVE_QUESTION_DEFAULT). */
export const LIVE_QUESTION_DEFAULT = Object.freeze({
  text: 'WHAT WOULD YOU HAVE WANTED?',
  answers: Object.freeze(['ANOTHER SIZE', 'ANOTHER FINISH', 'ANOTHER PRICE BAND']),
});

// ── Where a release stands ─────────────────────────────────────────────────

/** A release's state as the console says it: its phase, an ended one by its reason (an after-room's, its own words). */
export function liveStateLabel(r: Pick<LiveCard, 'phase' | 'endedReason'>, afterRoom = false): string {
  // An after-room is never announced: a DRAFT waits for its release's sell-out, then it opens at its time, or never.
  if (afterRoom && r.phase !== 'ENDED' && r.phase !== 'LIVE') return r.phase === 'DRAFT' ? 'AFTER A SELL-OUT' : r.phase === 'CANCELLED' ? 'NOT OPENED' : 'OPENS SOON';
  if (r.phase === 'ENDED') return r.endedReason === 'SOLD_OUT' ? 'SOLD OUT' : r.endedReason === 'ENDED' ? 'ENDED' : 'CLOSED';
  return { DRAFT: 'DRAFT', HIDDEN: 'SCHEDULED', ANNOUNCED: 'ANNOUNCED', ROOM: 'ROOM OPEN', LIVE: 'LIVE', CANCELLED: 'CANCELLED' }[r.phase];
}

/** One line under the page's title: what the release's phase asks of the staff now. */
export function liveLead(r: Pick<LiveRelease, 'phase' | 'over' | 'endedReason'> & { afterRoomOf?: LiveRelease['afterRoomOf'] }): string {
  if (r.afterRoomOf) return afterRoomLead(r);
  switch (r.phase) {
    case 'DRAFT':
      return 'A draft: nothing of it is public. Set every part of it, then publish it: it is announced at its time, each stage revealed at its own.';
    case 'HIDDEN':
      return 'Published, announced at the time below: until then every setting still changes. Once announced, only its stock rises (ADD PIECES).';
    case 'ANNOUNCED':
      return 'Announced on /verify: collectors say I’LL BE THERE with a size. The room opens at the time below; the settings are fixed, only the stock rises.';
    case 'ROOM':
      return 'The room is open: collectors enter it with a size, before T0. At T0 the line forms, by tier then at random, and the turns begin.';
    case 'LIVE':
      return 'Live: the line takes its turns, size by size, while pieces are free. The board below follows it second by second.';
    case 'ENDED':
      return r.over
        ? 'Over: the release has left THE RELEASES. ORBES Client Services follows each confirmed reservation on the Orders board.'
        : 'Ending: no new turn; the turns and holds still running finish at their deadlines.';
    default:
      return 'Cancelled before its room opened: its page answers that it is not known.';
  }
}

/** The after-room's own page: what it is now. Its settings are its release's. */
function afterRoomLead(r: Pick<LiveRelease, 'phase' | 'over'>): string {
  switch (r.phase) {
    case 'DRAFT':
      return 'The after-room of the release above: it opens only if that release sells out, for those still in its line, in their order. It is set with that release.';
    case 'CANCELLED':
      return 'Never opened: the release did not sell out with anyone left in its line, or was cancelled.';
    case 'LIVE':
      return 'Open: its guests enter with their size and take their turns in the order of the release’s line. Nobody else sees it.';
    case 'ENDED':
      return r.over
        ? 'Over: each confirmed reservation is an order, on the Orders board.'
        : 'Ending: no new turn; the turns and holds still running finish at their deadlines.';
    default:
      return 'Opened by the release’s sell-out for those still in its line: they see its door at its opening, below. Nobody else sees it.';
  }
}

/** Where an after-room stands, as the release's page says it. */
export function afterRoomStateLabel(a: Pick<LiveAfterRoom, 'state' | 'endedReason'>): string {
  switch (a.state) {
    case 'WAITING':
      return 'AFTER A SELL-OUT';
    case 'OPENS':
      return 'OPENS SOON';
    case 'OPEN':
      return 'OPEN';
    case 'OVER':
      return a.endedReason === 'SOLD_OUT' ? 'SOLD OUT' : a.endedReason === 'ENDED' ? 'ENDED' : 'CLOSED';
    default:
      return 'NOT OPENED';
  }
}

/** Why an after-room never opened, in words. */
export const AFTER_ROOM_SKIPS: Readonly<Record<AfterRoomSkip, string>> = Object.freeze({
  NO_GUESTS: 'Nobody was left in the line at the sell-out.',
  NOT_SOLD_OUT: 'The release ended without selling out.',
  CANCELLED: 'The release was cancelled.',
});

/** When an after-room opens and for how long: `10 min after the sell-out, open 15 min`. */
export function afterRoomTiming(a: Pick<LiveAfterRoom, 'delayMinutes' | 'lengthMinutes'>): string {
  return `${a.delayMinutes} min after the sell-out, open ${a.lengthMinutes} min`;
}

// ── Money and lines ────────────────────────────────────────────────────────

const SIGNS: Readonly<Record<string, string>> = Object.freeze({ EUR: '€', GBP: '£', USD: '$', CHF: 'CHF' });

/** A price as the house writes it: `€ 4 800`, `€ 4 800.50` (the groups never break). */
export function formatMoney(minor: number, currency: string): string {
  const value = Number.isFinite(minor) ? Math.max(0, Math.round(minor)) : 0;
  const units = String(Math.floor(value / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const cents = value % 100;
  return `${SIGNS[currency] ?? currency} ${units}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}

/** A price typed in units (`4800`, `4 800`, `4800.50`, `4800,5`) in cents; null when it is not one. */
export function parseMoney(text: string | null | undefined): number | null {
  const s = (text ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [units, cents = ''] = s.split('.');
  return Number(units) * 100 + Number(cents.padEnd(2, '0'));
}

/** Cents as the form shows them: `4800`, `4800.50`. */
export function moneyField(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

/** The reference of an entry for ORBES Client Services, as /verify shows it: `LR-` and eight figures of its id. */
export function liveReference(entryId: string): string {
  return `LR-${entryId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** The quantity line a release says by default: `25 PIECES`. */
export function defaultQuantityLine(quantity: number, set = false): string {
  return set ? `${quantity} ${quantity === 1 ? 'SET' : 'SETS'}` : `${quantity} ${quantity === 1 ? 'PIECE' : 'PIECES'}`;
}

/** The sizes as one line: `52 × 3 · 54 × 2`. */
export function sizesLine(sizes: readonly { label: string; stock: number }[]): string {
  return sizes.map((s) => `${s.label} × ${formatCount(s.stock)}`).join(' · ');
}

/** The line at T0, said: by tier first, then at random; or at random for all. */
export function priorityLine(tierPriority: boolean): string {
  return tierPriority ? 'By tier first (PALLADIUM, PLATINE, TITANE, then the others), then at random' : 'At random for all';
}

/** A tier's override of the windows: `PALLADIUM · 60 s to hold · 10 min to pay`. */
export function windowLine(w: { tier: number; turnSeconds: number | null; payMinutes: number | null }): string {
  return [tierLabel(w.tier), w.turnSeconds !== null ? `${w.turnSeconds} s to hold` : null, w.payMinutes !== null ? `${w.payMinutes} min to pay` : null]
    .filter((x) => x !== null)
    .join(' · ');
}

/** Who may enter, by tier: the select of the Access dialog. */
export const LIVE_TIER_OPTIONS = Object.freeze([
  { value: '0', label: 'Every ORBES account' },
  { value: '1', label: 'Owners (TITANE and up)' },
  { value: '2', label: 'From PLATINE' },
  { value: '3', label: 'PALLADIUM only' },
]);

// ── The sizes and the add-ons, as the form holds them ──────────────────────

/** The sizes, one per line: `52 = 3`. */
export function sizesText(sizes: readonly { label: string; stock: number }[]): string {
  return sizes.map((s) => `${s.label} = ${s.stock}`).join('\n');
}

/**
 * The sizes typed one per line (`52 = 3`, `52: 3`, `ONE SIZE 25`), each keeping the id of the release's size of the same
 * label; a message for the first line that is not one.
 */
export function parseSizes(text: string, existing: readonly { id: string; label: string }[] = []): { sizes: { id?: string; label: string; stock: number }[] } | { problem: string } {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0) return { problem: 'List the sizes, one per line: its label, then its stock (52 = 3).' };
  if (lines.length > LIVE_LIMITS.sizes) return { problem: `A release has at most ${LIVE_LIMITS.sizes} sizes.` };
  const sizes: { id?: string; label: string; stock: number }[] = [];
  const seen = new Set<string>();
  for (const [i, line] of lines.entries()) {
    const m = /^(.*?)\s*(?:=|:|\s)\s*(\d{1,6})$/.exec(line);
    const label = m?.[1]?.trim() ?? '';
    if (!m || label === '') return { problem: `Line ${i + 1}: a size’s label, then its stock (52 = 3).` };
    if (label.length > LIVE_LIMITS.sizeLabel) return { problem: `Line ${i + 1}: a size’s label has at most ${LIVE_LIMITS.sizeLabel} characters.` };
    const stock = Number(m[2]);
    if (stock > LIVE_LIMITS.stock) return { problem: `Line ${i + 1}: a size holds at most ${formatCount(LIVE_LIMITS.stock)} pieces.` };
    if (seen.has(label.toUpperCase())) return { problem: `The size ${label} is listed twice.` };
    seen.add(label.toUpperCase());
    const id = existing.find((s) => s.label === label)?.id;
    sizes.push({ ...(id ? { id } : {}), label, stock });
  }
  const total = sizes.reduce((n, s) => n + s.stock, 0);
  if (total < 1 || total > LIVE_LIMITS.quantity) return { problem: `A release offers 1 to ${formatCount(LIVE_LIMITS.quantity)} pieces in all.` };
  return { sizes };
}

// ── A set's sizes per piece (macro scope K44 T1) ───────────────────────────

/** A piece's lines of sizes in a set release's dialog: `sizes1` to `sizes4`. */
export const liveSizesField = (piece: number): string => `sizes${piece}`;

/** A piece's sizes as its lines: `52 = 3`, one per line. */
export function pieceSizesText(sizes: readonly { label: string; stock: number; piece?: number | null }[], piece: number): string {
  return sizesText(sizes.filter((s) => s.piece === piece));
}

/**
 * A set release's sizes, each piece's lines (`sizes1` to `sizes4`, `names` its pieces in order) parsed as a model's,
 * each size keeping the id of the release's size of the same piece and label; the first problem named by its piece.
 */
export function parseSetSizes(
  v: Record<string, string>,
  names: readonly string[],
  existing: readonly { id: string; label: string; piece?: number | null }[] = [],
): { sizes: { id?: string; label: string; stock: number; piece: number }[] } | { problem: string } {
  const out: { id?: string; label: string; stock: number; piece: number }[] = [];
  for (const [i, name] of names.entries()) {
    const piece = i + 1;
    const p = parseSizes(v[liveSizesField(piece)] ?? '', existing.filter((s) => s.piece === piece));
    if ('problem' in p) return { problem: `${name}: ${p.problem.charAt(0).toLowerCase()}${p.problem.slice(1)}` };
    out.push(...p.sizes.map((x) => ({ ...x, piece })));
  }
  return { sizes: out };
}

/** A set release's pieces by name, in order: « AURA », « AURA · STEEL ». */
export function releasePieceNames(r: Pick<LiveRelease, 'set'>): string[] {
  return (r.set?.pieces ?? []).map((p) => [p.model.name, ...(p.model.variant ? [p.model.variant] : [])].join(' · ').toUpperCase());
}

/** A set release's sets on sale: the smallest of its pieces' totals. */
export function setsOnSale(sizes: readonly { stock: number; piece?: number | null }[], pieces: number): number {
  if (pieces < 1) return 0;
  return Math.min(...Array.from({ length: pieces }, (_, i) => sizes.filter((s) => s.piece === i + 1).reduce((n, s) => n + s.stock, 0)));
}

/** The add-ons, one per line: `ENGRAVING | 150 | Your initials, by hand`. */
export function addonsText(addons: readonly { label: string; line: string | null; priceMinor: number }[]): string {
  return addons.map((a) => [a.label, moneyField(a.priceMinor), ...(a.line ? [a.line] : [])].join(' | ')).join('\n');
}

/** The add-ons typed one per line (label | price | line), each keeping the id of the release's add-on of the same label. */
export function parseAddons(
  text: string,
  existing: readonly { id: string; label: string }[] = [],
): { addons: { id?: string; label: string; line: string | null; priceMinor: number }[] } | { problem: string } {
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length > LIVE_LIMITS.addons) return { problem: `A release offers at most ${LIVE_LIMITS.addons} add-ons.` };
  const addons: { id?: string; label: string; line: string | null; priceMinor: number }[] = [];
  for (const [i, raw] of lines.entries()) {
    const [label = '', price = '', ...rest] = raw.split('|').map((p) => p.trim());
    const line = rest.join(' | ').trim();
    if (!label || label.length > LIVE_LIMITS.addonLabel) return { problem: `Line ${i + 1}: an add-on’s label has 1 to ${LIVE_LIMITS.addonLabel} characters.` };
    const priceMinor = parseMoney(price);
    if (priceMinor === null || priceMinor > LIVE_LIMITS.priceMaxMinor) return { problem: `Line ${i + 1}: the label, then its price (ENGRAVING | 150 | its line).` };
    if (line.length > LIVE_LIMITS.addonLine) return { problem: `Line ${i + 1}: an add-on’s line has at most ${LIVE_LIMITS.addonLine} characters.` };
    const id = existing.find((a) => a.label === label)?.id;
    addons.push({ ...(id ? { id } : {}), label, line: line === '' ? null : line, priceMinor });
  }
  return { addons };
}

// ── The dialogs ────────────────────────────────────────────────────────────

const whole = (v: string | undefined): number | null => (/^\s*\d{1,6}\s*$/.test(v ?? '') ? Number(v) : null);
const inRange = (v: string | undefined, b: { min: number; max: number }) => {
  const n = whole(v);
  return n !== null && n >= b.min && n <= b.max ? n : null;
};

/** The New live release dialog's values: T0 tomorrow at 18:00 UTC for an hour, one size of 25. */
export function newLiveValues(now: Date): Record<string, string> {
  const opens = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 18));
  return {
    // Macro scope K44 T1: WHAT IT SELLS, A MODEL by default; a set's price and sizes per piece in their own fields.
    offer: 'MODEL',
    modelId: '',
    setId: '',
    title: '',
    opensAt: localUtc(opens.toISOString()),
    closesAt: localUtc(new Date(opens.getTime() + 3_600_000).toISOString()),
    price: '',
    priceSet: '',
    currency: 'EUR',
    locationId: '',
    // D1: the pace and the hold, required (a hold of 0: none).
    paceBatch: '',
    paceMinutes: '',
    holdMinutes: '0',
    sizes: 'ONE SIZE = 25',
    sizes1: '',
    sizes2: '',
    sizes3: '',
    sizes4: '',
  };
}

function timesProblem(opens: string | null, closes: string | null): string | null {
  if (!opens || !closes) return 'Use the date and time pickers (UTC) for T0 and the end.';
  if (Date.parse(closes) <= Date.parse(opens)) return 'The release ends after T0.';
  return null;
}

/**
 * What the server would refuse in the New live release dialog; null when it may be sent. A set's (macro scope K44 T1,
 * `offer` SET): its set, its one price, each of its pieces' sizes (`pieces`: their names, in order).
 */
export function newLiveProblem(v: Record<string, string>, pieces: readonly string[] = []): string | null {
  const set = v.offer === 'SET';
  if (set ? !v.setId : !v.modelId) return set ? 'Choose the set of the release.' : 'Choose the model of the release.';
  const title = (v.title ?? '').trim();
  if (!title || title.length > LIVE_LIMITS.title) return `A title is one line of 1 to ${LIVE_LIMITS.title} characters.`;
  const t = timesProblem(utcInstant(v.opensAt), utcInstant(v.closesAt));
  if (t) return t;
  const price = parseMoney(set ? v.priceSet : v.price);
  if (price === null || price > LIVE_LIMITS.priceMaxMinor) return set ? 'The price of the set, in units (4800, or 4800.50).' : 'The price of a piece, in units (4800, or 4800.50).';
  if (!(LIVE_CURRENCIES as readonly string[]).includes(v.currency)) return 'Choose the currency.';
  const pace = paceProblem(v.paceBatch, v.paceMinutes) ?? holdProblem(v.holdMinutes);
  if (pace) return pace;
  const sizes = set ? parseSetSizes(v, pieces) : parseSizes(v.sizes);
  return 'problem' in sizes ? sizes.problem : null;
}

/** The body of a new release (POST /api/admin/live), from values newLiveProblem accepted: every other setting by default. */
export function newLiveInput(v: Record<string, string>, pieces: readonly string[] = []): LiveSettings {
  const set = v.offer === 'SET';
  const sizes = (set ? parseSetSizes(v, pieces) : parseSizes(v.sizes)) as { sizes: { label: string; stock: number; piece?: number }[] };
  return {
    ...(set ? { setId: v.setId } : { modelId: v.modelId }),
    title: v.title.trim(),
    opensAt: utcInstant(v.opensAt)!,
    closesAt: utcInstant(v.closesAt)!,
    priceMinor: parseMoney(set ? v.priceSet : v.price)!,
    currency: v.currency as LiveCurrency,
    pace: paceOf(v.paceBatch, v.paceMinutes)!,
    holdMinutes: Number(v.holdMinutes),
    sizes: sizes.sizes,
    ...(v.locationId ? { stockLocationId: v.locationId } : {}),
  };
}

/** A size mix proposed (plan LIVE RELEASE+, choice 13) as the sizes' lines of a dialog: `52 = 4`, one per line; null with none. */
export function sizeMixText(mix: Pick<LiveSizeMix, 'sizes'>): string | null {
  return mix.sizes.length ? mix.sizes.map((s) => `${s.label} = ${s.stock}`).join('\n') : null;
}

/** The size mix in one line: `52 = 4 (4 in stock) · 54 = 5 (1 in stock, 4 to order)`: what the stock does not cover is ordered from the suppliers. */
export function sizeMixLine(mix: Pick<LiveSizeMix, 'sizes'>): string {
  return mix.sizes
    .map((s) => `${s.label} = ${formatCount(s.stock)} (${[s.fromStock ? `${formatCount(s.fromStock)} in stock` : null, s.fromDemand ? `${formatCount(s.fromDemand)} to order` : null].filter(Boolean).join(', ')})`)
    .join(' · ');
}

/** The parts of a release's settings, each its own dialog. */
export type LivePart = 'release' | 'sizes' | 'access' | 'times' | 'turns' | 'addons' | 'afterRoom' | 'surprise' | 'question';

/** A part's values, as its dialog's form holds them. */
export function livePartValues(r: LiveRelease, part: LivePart): Record<string, string> {
  switch (part) {
    case 'release':
      // Macro scope K44 T1: a set's release keeps its set here (another set takes its place with its sizes, in Sizes).
      return { ...(r.set ? { setId: r.set.id } : { modelId: r.model.id }), title: r.title, description: r.description ?? '', price: moneyField(r.priceMinor), currency: r.currency, perAccount: String(r.perAccount) };
    case 'sizes':
      if (r.set) {
        return {
          ...Object.fromEntries(r.set.pieces.map((p) => [liveSizesField(p.piece), pieceSizesText(r.sizes, p.piece)])),
          quantityLine: r.quantityLine === defaultQuantityLine(r.quantity, true) ? '' : r.quantityLine,
          locationId: r.locationId ?? '',
        };
      }
      return { sizes: sizesText(r.sizes), quantityLine: r.quantityLine === defaultQuantityLine(r.quantity) ? '' : r.quantityLine, locationId: r.locationId ?? '' };
    case 'access':
      return {
        minTier: String(r.minTier),
        tierPriority: r.tierPriority ? 'true' : '',
        collectionId: r.access.collection?.id ?? '',
        ...Object.fromEntries(r.access.models.map((m) => [`model:${m.id}`, 'true'])),
        minParticipations: r.access.minParticipations === null ? '' : String(r.access.minParticipations),
        segmentId: r.access.segment?.id ?? '',
        combine: r.access.combine,
      };
    case 'times':
      return {
        announceAt: localUtc(r.announceAt),
        silhouetteAt: localUtc(r.silhouetteAt),
        nameAt: localUtc(r.nameAt),
        photoAt: localUtc(r.photoAt),
        roomOpensMinutes: String(r.roomOpensMinutes),
        opensAt: localUtc(r.opensAt),
        closesAt: localUtc(r.closesAt),
        paceBatch: r.pace ? String(r.pace.batch) : '',
        paceMinutes: r.pace ? String(r.pace.minutes) : '',
        holdMinutes: String(r.holdMinutes ?? 0),
      };
    case 'turns':
      return {
        turnSeconds: String(r.turnSeconds),
        payMinutes: String(r.payMinutes),
        ...Object.fromEntries(
          [0, 1, 2, 3].flatMap((t) => {
            const w = r.tierWindows.find((x) => x.tier === t);
            return [
              [`turn:${t}`, w?.turnSeconds !== null && w?.turnSeconds !== undefined ? String(w.turnSeconds) : ''],
              [`pay:${t}`, w?.payMinutes !== null && w?.payMinutes !== undefined ? String(w.payMinutes) : ''],
            ];
          }),
        ),
      };
    case 'addons':
      return { addons: addonsText(r.addons) };
    case 'afterRoom': {
      const a = r.afterRoom;
      return {
        enabled: a ? 'true' : '',
        modelId: a?.model.id ?? '',
        price: a ? moneyField(a.priceMinor) : '',
        sizes: a ? sizesText(a.sizes) : 'ONE SIZE = 5',
        addons: a ? addonsText(a.addons) : '',
        delay: String(a?.delayMinutes ?? LIVE_LIMITS.afterRoomDelay.default),
        length: String(a?.lengthMinutes ?? LIVE_LIMITS.afterRoomLength.default),
      };
    }
    case 'surprise':
      return { enabled: r.surprise.enabled ? 'true' : '', text: r.surprise.text ?? '' };
    case 'question': {
      const q = r.question;
      return { enabled: q?.enabled === false ? '' : 'true', text: q?.text ?? LIVE_QUESTION_DEFAULT.text, answers: (q?.answers ?? LIVE_QUESTION_DEFAULT.answers).join('\n') };
    }
  }
}

/** The answers typed one per line, trimmed, the empty lines left out. */
export function questionAnswers(text: string | undefined): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length > 0);
}

/** The question's words a dialog holds, as the server stores them: null and null for the default question. */
function questionWords(v: Record<string, string>): { text: string | null; answers: string[] | null } {
  const text = (v.text ?? '').trim().replace(/\s+/g, ' ');
  const answers = questionAnswers(v.answers);
  const isDefault = text === LIVE_QUESTION_DEFAULT.text && answers.length === LIVE_QUESTION_DEFAULT.answers.length && answers.every((a, i) => a === LIVE_QUESTION_DEFAULT.answers[i]);
  return isDefault || (text === '' && answers.length === 0) ? { text: null, answers: null } : { text, answers };
}

/** What the server would refuse in a part's dialog, said before anything is sent; null when it may be sent. */
export function livePartProblem(r: LiveRelease, part: LivePart, v: Record<string, string>): string | null {
  switch (part) {
    case 'release': {
      if (!v.modelId && !v.setId) return 'Choose the model of the release.';
      const title = (v.title ?? '').trim();
      if (!title || title.length > LIVE_LIMITS.title) return `A title is one line of 1 to ${LIVE_LIMITS.title} characters.`;
      if ((v.description ?? '').trim().length > LIVE_LIMITS.description) return `The description has at most ${LIVE_LIMITS.description} characters.`;
      const price = parseMoney(v.price);
      if (price === null || price > LIVE_LIMITS.priceMaxMinor) return 'The price of a piece, in units (4800, or 4800.50).';
      if (!(LIVE_CURRENCIES as readonly string[]).includes(v.currency)) return 'Choose the currency.';
      // T4: a set counts as one, 1 to 5 sets per person.
      if (inRange(v.perAccount, LIVE_LIMITS.perAccount) === null) return `A person secures ${LIVE_LIMITS.perAccount.min} to ${LIVE_LIMITS.perAccount.max} ${r.set ? 'sets' : 'pieces'}.`;
      return null;
    }
    case 'sizes': {
      const sizes = r.set ? parseSetSizes(v, releasePieceNames(r), r.sizes) : parseSizes(v.sizes, r.sizes);
      if ('problem' in sizes) return sizes.problem;
      if ((v.quantityLine ?? '').trim().length > LIVE_LIMITS.quantityLine) return `The quantity line has at most ${LIVE_LIMITS.quantityLine} characters.`;
      return null;
    }
    case 'access': {
      if (inRange(v.minTier, { min: 0, max: 3 }) === null) return 'Choose who may enter.';
      const models = Object.keys(v).filter((k) => k.startsWith('model:') && v[k] === 'true');
      if (models.length > LIVE_LIMITS.accessModels) return `A release names at most ${LIVE_LIMITS.accessModels} models.`;
      const n = LIVE_LIMITS.minParticipations;
      if ((v.minParticipations ?? '').trim() !== '' && inRange(v.minParticipations, n) === null) return `Releases taken part in: ${n.min} to ${n.max}, or leave it empty.`;
      if (v.combine !== undefined && v.combine !== 'AND' && v.combine !== 'OR') return 'Choose how the rules combine.';
      return null;
    }
    case 'times': {
      const t = timesProblem(utcInstant(v.opensAt), utcInstant(v.closesAt));
      if (t) return t;
      if (inRange(v.roomOpensMinutes, LIVE_LIMITS.roomOpensMinutes) === null) return `The room opens ${LIVE_LIMITS.roomOpensMinutes.min} to ${LIVE_LIMITS.roomOpensMinutes.max} minutes before T0.`;
      for (const [k, label] of [['announceAt', 'the announcement'], ['silhouetteAt', 'the silhouette'], ['nameAt', 'the name'], ['photoAt', 'the photograph']] as const) {
        if ((v[k] ?? '').trim() !== '' && utcInstant(v[k]) === null) return `Use the date and time picker (UTC) for ${label}, or leave it empty.`;
      }
      // Emptied on a published release, the announcement would be its publication, already past: announced at once.
      if (r.publishedAt !== null && utcInstant(v.announceAt) === null) return 'A published release keeps an announcement time; set one later than now.';
      return paceProblem(v.paceBatch, v.paceMinutes) ?? holdProblem(v.holdMinutes);
    }
    case 'turns': {
      if (inRange(v.turnSeconds, LIVE_LIMITS.turnSeconds) === null) return `A turn lasts ${LIVE_LIMITS.turnSeconds.min} to ${LIVE_LIMITS.turnSeconds.max} seconds.`;
      if (inRange(v.payMinutes, LIVE_LIMITS.payMinutes) === null) return `The time to pay is ${LIVE_LIMITS.payMinutes.min} to ${LIVE_LIMITS.payMinutes.max} minutes.`;
      for (const t of [0, 1, 2, 3]) {
        const turn = (v[`turn:${t}`] ?? '').trim();
        const pay = (v[`pay:${t}`] ?? '').trim();
        if (turn && inRange(turn, LIVE_LIMITS.turnSeconds) === null) return `${tierLabel(t)}: a turn lasts ${LIVE_LIMITS.turnSeconds.min} to ${LIVE_LIMITS.turnSeconds.max} seconds, or leave it empty.`;
        if (pay && inRange(pay, LIVE_LIMITS.payMinutes) === null) return `${tierLabel(t)}: the time to pay is ${LIVE_LIMITS.payMinutes.min} to ${LIVE_LIMITS.payMinutes.max} minutes, or leave it empty.`;
      }
      return null;
    }
    case 'addons': {
      const addons = parseAddons(v.addons, r.addons);
      return 'problem' in addons ? addons.problem : null;
    }
    case 'afterRoom': {
      if (v.enabled !== 'true') return null;
      if (!v.modelId) return 'Choose the after-room’s model.';
      const price = parseMoney(v.price);
      if (price === null || price > LIVE_LIMITS.priceMaxMinor) return 'The after-room’s price of a piece, in units (4800, or 4800.50).';
      const sizes = parseSizes(v.sizes, r.afterRoom?.sizes ?? []);
      if ('problem' in sizes) return `The after-room: ${sizes.problem.charAt(0).toLowerCase()}${sizes.problem.slice(1)}`;
      const addons = parseAddons(v.addons, r.afterRoom?.addons ?? []);
      if ('problem' in addons) return `The after-room: ${addons.problem.charAt(0).toLowerCase()}${addons.problem.slice(1)}`;
      const d = LIVE_LIMITS.afterRoomDelay;
      if (inRange(v.delay, d) === null) return `The after-room opens ${d.min} to ${d.max} minutes after the sell-out.`;
      const l = LIVE_LIMITS.afterRoomLength;
      if (inRange(v.length, l) === null) return `The after-room is open ${l.min} to ${l.max} minutes.`;
      return null;
    }
    case 'surprise': {
      const text = (v.text ?? '').trim();
      if (v.enabled === 'true' && !text) return 'Say what goes in the box: the description is printed on the packing slips and work sheets.';
      if (text.length > LIVE_LIMITS.surprise) return `The description has at most ${LIVE_LIMITS.surprise} characters.`;
      return null;
    }
    case 'question': {
      const q = LIVE_LIMITS.question;
      const text = (v.text ?? '').trim();
      const answers = questionAnswers(v.answers);
      if (text === '' && answers.length === 0) return null;
      if (text === '' || text.length > q.text || /[\r\n]/.test(text)) return `The question is one line of 1 to ${q.text} characters (empty with no answer: the default question).`;
      if (answers.length < q.minAnswers || answers.length > q.maxAnswers) return `The question has ${q.minAnswers} to ${q.maxAnswers} answers, one per line.`;
      const long = answers.find((a) => a.length > q.answer);
      if (long) return `An answer has at most ${q.answer} characters: ${long}.`;
      const seen = new Set<string>();
      for (const a of answers) {
        if (seen.has(a.toUpperCase())) return `The answer ${a} is listed twice.`;
        seen.add(a.toUpperCase());
      }
      return null;
    }
  }
}

/** A tier as the overrides name it. */
export function tierLabel(tier: number): string {
  return tier === 0 ? 'NO TIER' : tierName(tier);
}

const sameInstant = (a: string | null | undefined, b: string | null | undefined) => (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null);

/** The settings of a part that differ from the release's (PATCH /api/admin/live/:id); {} when nothing changed. */
export function livePartChange(r: LiveRelease, part: LivePart, v: Record<string, string>): LiveSettingsChange {
  const out: LiveSettingsChange = {};
  switch (part) {
    case 'release': {
      const description = (v.description ?? '').trim();
      if (!r.set && v.modelId !== r.model.id) out.modelId = v.modelId;
      if (v.title.trim() !== r.title) out.title = v.title.trim();
      if ((description === '' ? null : description) !== (r.description ?? null)) out.description = description === '' ? null : description;
      if (parseMoney(v.price) !== r.priceMinor) out.priceMinor = parseMoney(v.price)!;
      if (v.currency !== r.currency) out.currency = v.currency as LiveCurrency;
      if (Number(v.perAccount) !== r.perAccount) out.perAccount = Number(v.perAccount);
      return out;
    }
    case 'sizes': {
      // Macro scope K44 T1: a set's release, its sizes per piece, its quantity its sets on sale (the scarcest piece's).
      const set = r.set ? r.set.pieces.length : 0;
      const sizes = ((r.set ? parseSetSizes(v, releasePieceNames(r), r.sizes) : parseSizes(v.sizes, r.sizes)) as { sizes: { id?: string; label: string; stock: number; piece?: number }[] }).sizes;
      if (JSON.stringify(sizes.map((s) => [s.id ?? null, s.label, s.stock, s.piece ?? null])) !== JSON.stringify(r.sizes.map((s) => [s.id, s.label, s.stock, s.piece ?? null]))) out.sizes = sizes;
      const typed = (v.quantityLine ?? '').trim();
      const quantity = set ? setsOnSale(sizes, set) : sizes.reduce((n, s) => n + s.stock, 0);
      const now = r.quantityLine === defaultQuantityLine(r.quantity, set > 0) ? null : r.quantityLine;
      const next = typed === '' || typed === defaultQuantityLine(quantity, set > 0) ? null : typed;
      if (next !== now) out.quantityLine = next;
      const location = v.locationId || null;
      if (v.locationId !== undefined && location !== r.locationId) out.stockLocationId = location;
      return out;
    }
    case 'access': {
      const minTier = Number(v.minTier);
      if (minTier !== r.minTier) out.minTier = minTier;
      const priority = v.tierPriority === 'true';
      if (priority !== r.tierPriority) out.tierPriority = priority;
      const models = Object.keys(v)
        .filter((k) => k.startsWith('model:') && v[k] === 'true')
        .map((k) => k.slice('model:'.length))
        .sort();
      if (JSON.stringify(models) !== JSON.stringify(r.access.models.map((m) => m.id).sort())) out.accessModelIds = models;
      const collection = v.collectionId || null;
      if (collection !== (r.access.collection?.id ?? null)) out.accessCollectionId = collection;
      const taken = (v.minParticipations ?? '').trim() === '' ? null : Number(v.minParticipations);
      if (v.minParticipations !== undefined && taken !== r.access.minParticipations) out.minParticipations = taken;
      const segment = v.segmentId || null;
      if (v.segmentId !== undefined && segment !== (r.access.segment?.id ?? null)) out.accessSegmentId = segment;
      if (v.combine !== undefined && v.combine !== r.access.combine) out.accessCombine = v.combine === 'OR' ? 'OR' : 'AND';
      return out;
    }
    case 'times': {
      for (const k of ['announceAt', 'silhouetteAt', 'nameAt', 'photoAt'] as const) {
        const next = utcInstant(v[k]);
        if (!sameInstant(next, r[k])) out[k] = next;
      }
      if (Number(v.roomOpensMinutes) !== r.roomOpensMinutes) out.roomOpensMinutes = Number(v.roomOpensMinutes);
      if (!sameInstant(utcInstant(v.opensAt), r.opensAt)) out.opensAt = utcInstant(v.opensAt)!;
      if (!sameInstant(utcInstant(v.closesAt), r.closesAt)) out.closesAt = utcInstant(v.closesAt)!;
      if (v.paceBatch !== undefined || v.paceMinutes !== undefined) {
        const next = paceOf(v.paceBatch, v.paceMinutes);
        const now = r.pace ? { batch: r.pace.batch, minutes: r.pace.minutes } : null;
        if (next && JSON.stringify(next) !== JSON.stringify(now)) out.pace = next;
      }
      if (v.holdMinutes !== undefined && Number(v.holdMinutes) !== (r.holdMinutes ?? 0)) out.holdMinutes = Number(v.holdMinutes);
      return out;
    }
    case 'turns': {
      if (Number(v.turnSeconds) !== r.turnSeconds) out.turnSeconds = Number(v.turnSeconds);
      if (Number(v.payMinutes) !== r.payMinutes) out.payMinutes = Number(v.payMinutes);
      const windows = [0, 1, 2, 3].flatMap((tier) => {
        const turn = (v[`turn:${tier}`] ?? '').trim();
        const pay = (v[`pay:${tier}`] ?? '').trim();
        return turn || pay ? [{ tier, turnSeconds: turn ? Number(turn) : null, payMinutes: pay ? Number(pay) : null }] : [];
      });
      if (JSON.stringify(windows) !== JSON.stringify([...r.tierWindows].sort((a, b) => a.tier - b.tier))) out.tierWindows = windows;
      return out;
    }
    case 'addons': {
      const addons = (parseAddons(v.addons, r.addons) as { addons: { id?: string; label: string; line: string | null; priceMinor: number }[] }).addons;
      if (JSON.stringify(addons.map((a) => [a.id ?? null, a.label, a.line, a.priceMinor])) !== JSON.stringify(r.addons.map((a) => [a.id, a.label, a.line, a.priceMinor]))) out.addons = addons;
      return out;
    }
    case 'afterRoom': {
      const a = r.afterRoom;
      if (v.enabled !== 'true') {
        if (a) out.afterRoom = null;
        return out;
      }
      const next: LiveAfterRoomSettings = {
        modelId: v.modelId,
        priceMinor: parseMoney(v.price)!,
        sizes: (parseSizes(v.sizes, a?.sizes ?? []) as { sizes: { id?: string; label: string; stock: number }[] }).sizes,
        addons: (parseAddons(v.addons, a?.addons ?? []) as { addons: { id?: string; label: string; line: string | null; priceMinor: number }[] }).addons,
        delayMinutes: Number(v.delay),
        lengthMinutes: Number(v.length),
      };
      const shape = (x: LiveAfterRoomSettings) =>
        JSON.stringify([
          x.modelId,
          x.priceMinor,
          x.sizes.map((s) => [s.id ?? null, s.label, s.stock]),
          (x.addons ?? []).map((y) => [y.id ?? null, y.label, y.line ?? null, y.priceMinor]),
          x.delayMinutes,
          x.lengthMinutes,
        ]);
      const now: LiveAfterRoomSettings | null = a ? { modelId: a.model.id, priceMinor: a.priceMinor, sizes: a.sizes, addons: a.addons, delayMinutes: a.delayMinutes, lengthMinutes: a.lengthMinutes } : null;
      if (!now || shape(now) !== shape(next)) out.afterRoom = next;
      return out;
    }
    case 'surprise': {
      const enabled = v.enabled === 'true';
      const text = (v.text ?? '').trim() || null;
      if (enabled !== r.surprise.enabled) out.surpriseEnabled = enabled;
      if (text !== r.surprise.text) out.surpriseText = text;
      return out;
    }
    case 'question': {
      const q = r.question;
      const enabled = v.enabled === 'true';
      if (enabled !== (q?.enabled ?? true)) out.questionEnabled = enabled;
      const next = questionWords(v);
      const now = q?.custom ? { text: q.text, answers: q.answers } : { text: null, answers: null };
      if (JSON.stringify(next) !== JSON.stringify(now)) {
        out.questionText = next.text;
        out.questionAnswers = next.answers;
      }
      return out;
    }
  }
}

/** The question after as the release's page says it: off, or its words and answers, the default one said so. */
export function questionLine(q: Pick<LiveQuestion, 'enabled' | 'text' | 'answers' | 'custom'>): string {
  if (!q.enabled) return 'Not asked';
  return `${q.text} · ${q.answers.join(' · ')}${q.custom ? '' : ' (the default question)'}`;
}

/** Where the question stands, said: asked after the end for seven days, open until, closed. */
export function questionStateLine(q: Pick<LiveQuestion, 'state' | 'opensAt' | 'closesAt'>): string {
  switch (q.state) {
    case 'OFF':
      return 'Not asked';
    case 'WAITING':
      return 'Asked at the release’s end, for 7 days';
    case 'OPEN':
      return `Open until ${formatDateTime(q.closesAt!)}`;
    case 'CLOSED':
      return `Closed on ${formatDateTime(q.closesAt!)}`;
  }
}

/** Each answer counted, as the hairline bars show them: its words, its count, its share of the answers. */
export function questionTallyRows(q: Pick<LiveQuestion, 'tally' | 'answered'>): { key: string; label: string; value: number; fraction: number; share: string; tone: 'solid' }[] {
  const top = Math.max(0, ...q.tally.map((t) => t.count));
  return q.tally.map((t) => ({
    key: String(t.answer),
    label: t.label,
    value: t.count,
    fraction: top > 0 ? t.count / top : 0,
    share: percent(t.count, q.answered),
    tone: 'solid' as const,
  }));
}

/**
 * The stock check in one line (plan NEXT LOT §3.5.4.3): every piece in stock, or how many will wait for supplier stock
 * once sold, and where; the sizes' own sentences follow it.
 */
export function feasibilityLine(f: Pick<LiveFeasibility, 'short' | 'location'>): string {
  const where = f.location?.name ?? 'no location';
  return f.short === 0 ? 'Every piece on sale is in stock.' : `${formatCount(f.short)} ${f.short === 1 ? 'piece' : 'pieces'} on sale will wait for supplier stock once sold (${where}).`;
}

type ShortSize = { short: number; ordered?: { expected: number; inDraft: number } | null };

/**
 * The pieces a release's Add to supplier order adds for a short size (§3.5.4.3, as the proposal §3.5.6.4): its shortfall
 * less what is already ordered for its SKU to the location, expected on supplier orders or held by a draft (0: covered).
 */
export function toAddOf(l: ShortSize): number {
  return Math.max(0, l.short - (l.ordered?.expected ?? 0) - (l.ordered?.inDraft ?? 0));
}

/** What is already ordered for a short size, said after its sentence: `Already ordered: 1 in a draft.` (null: nothing). */
export function orderedLine(l: ShortSize): string | null {
  const o = l.ordered;
  if (!o || o.expected + o.inDraft === 0) return null;
  const parts = [o.inDraft > 0 ? `${formatCount(o.inDraft)} in a draft` : null, o.expected > 0 ? `${formatCount(o.expected)} expected on supplier orders` : null].filter((x): x is string => x !== null);
  return `Already ordered: ${parts.join(' and ')}.`;
}

/** Add to supplier order from a release (§3.5.4.3): the pieces still to order, the size, the supplier's draft and where it delivers. */
export function addToOrderLine(l: ShortSize & { supplier?: { name: string } | null }, sku: string, location: string): string {
  const n = toAddOf(l);
  return `Add ${formatCount(n)} ${n === 1 ? 'piece' : 'pieces'} of ${sku} to the draft of ${l.supplier?.name ?? 'its supplier'}, to deliver to ${location}. You confirm the draft before it is sent.`;
}

/** The surprise as the release's page in the console says it: `In every box · A silk pouch`, or `None`. */
export function surpriseLine(r: Pick<LiveRelease, 'surprise'>): string {
  if (r.surprise.enabled) return `In every box · ${r.surprise.text ?? ''}`;
  return r.surprise.text ? `None (kept: ${r.surprise.text})` : 'None';
}

/** How the rules of access combine, said: `Every rule (AND)`, `Any rule (OR)`. */
export function combineLine(combine: LiveRelease['access']['combine']): string {
  return combine === 'OR' ? 'Any one rule is enough (OR)' : 'Every rule is needed (AND)';
}

// ── The pace (W4) ──────────────────────────────────────────────────────────

/** A pace said as the New live release dialog sets it (D1): `250 people per batch, every minute`, `1 person per batch, every 5 minutes`. */
export function paceLine(p: LivePace): string {
  return `${formatCount(p.batch)} ${p.batch === 1 ? 'person' : 'people'} per batch, every ${p.minutes === 1 ? 'minute' : `${p.minutes} minutes`}`;
}

/** The hold after the opening said (D1, the times part): `10 minutes after the opening`, or `None` (0). */
export function holdLine(minutes: number | null | undefined): string {
  const m = minutes ?? 0;
  return m > 0 ? `${m} ${m === 1 ? 'minute' : 'minutes'} after the opening` : 'None';
}

/** What the server would refuse in the hold after the opening (D1): a whole number of minutes, 0 (none) to the bound. */
export function holdProblem(minutes: string | undefined): string | null {
  return inRange(minutes, LIVE_HOLD_MINUTES) === null ? `A hold after the opening lasts ${LIVE_HOLD_MINUTES.min} to ${LIVE_HOLD_MINUTES.max} minutes (0 for none).` : null;
}

/** The pace as two figures typed: both, or neither (null: none typed). Only for figures paceProblem accepted. */
function paceOf(batch: string | undefined, minutes: string | undefined): LivePace | null {
  const b = (batch ?? '').trim();
  const m = (minutes ?? '').trim();
  return b === '' && m === '' ? null : { batch: Number(b), minutes: Number(m) };
}

/**
 * What the server would refuse in a pace's two figures, said before anything is sent; null when they may be sent. Both
 * are needed everywhere (ONE QUEUE, D1: every LIVE release has a pace; M1's « both blank: no pace » gone).
 */
export function paceProblem(batch: string | undefined, minutes: string | undefined): string | null {
  const b = (batch ?? '').trim();
  const m = (minutes ?? '').trim();
  if (b === '' && m === '') return 'Say how many people per batch, every how many minutes.';
  if (inRange(b, LIVE_PACE_BATCH) === null || inRange(m, LIVE_PACE_MINUTES) === null) {
    return `A pace gives ${formatCount(LIVE_PACE_BATCH.min)} to ${formatCount(LIVE_PACE_BATCH.max)} turns every ${LIVE_PACE_MINUTES.min} to ${LIVE_PACE_MINUTES.max} minutes.`;
  }
  return null;
}

/** The pace's hint in the times part: its bounds and the room's measured capacity (D1: every release has a pace). */
export function paceHint(capacity: number | null): string {
  return [
    `Turns given from the line, ${formatCount(LIVE_PACE_BATCH.min)} to ${formatCount(LIVE_PACE_BATCH.max)} per batch, every ${LIVE_PACE_MINUTES.min} to ${LIVE_PACE_MINUTES.max} minutes, in the line’s order, where a piece is free.`,
    capacity !== null ? `The room holds ${formatCount(capacity)}, as the load test measured.` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' ');
}

const PARIS_CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** An instant's time of day in Paris: `21:14`, or `21:14:05` with its seconds; an em dash when absent. */
export function parisClock(v: string | Date | null | undefined, opts: { seconds?: boolean } = {}): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = Object.fromEntries(PARIS_CLOCK.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}${opts.seconds ? `:${p.second}` : ''}`;
}

/**
 * The Pace block's figures, in the order the board shows them (ONE QUEUE, D11: add only): those in the queue, those given
 * a turn all ways (the batches and LET IN: the M1 « Admitted »), the batches so far and the next batch in Paris time (an
 * em dash, its note PACE PAUSED or RELEASE PAUSED, while either pause holds it: the figure keeps a time's width), kept;
 * then the turns given by the pace (the batches, NEXT BATCH NOW included), those in the queue beyond the pieces of their
 * size, and, while the hold after the opening lasts, when it ends in Paris time (held like the next batch), added.
 */
export function livePaceFigures(b: Pick<LiveBoard, 'phase' | 'paused' | 'endedAt'> & { pace: LivePaceState }): { label: string; value: string; note: string; testId: string }[] {
  const p = b.pace;
  const ended = b.endedAt !== null || b.phase === 'ENDED';
  const hold = p.holdMinutes ?? 0;
  const held = p.paused ? 'PACE PAUSED' : b.paused ? 'RELEASE PAUSED' : null;
  const next = ended
    ? { value: '—', note: 'NONE AFTER THE END' }
    : held
      ? { value: '—', note: held }
      : { value: parisClock(p.nextAt), note: b.phase === 'LIVE' ? 'PARIS TIME' : hold > 0 && p.holdEndsAt ? `PARIS · T0 + ${hold} MIN` : 'PARIS · AT T0' };
  const holdEnds = !ended && p.holdEndsAt ? (held ? { value: '—', note: held } : { value: parisClock(p.holdEndsAt), note: b.phase === 'LIVE' ? 'PARIS TIME' : `PARIS · T0 + ${hold} MIN` }) : null;
  return [
    { label: 'In the queue', value: formatCount(p.waiting), note: 'WAITING IN THE QUEUE', testId: 'live-pace-waiting' },
    { label: 'Admitted', value: formatCount(p.admitted), note: 'GIVEN A TURN, ALL WAYS', testId: 'live-pace-admitted' },
    { label: 'Batches', value: formatCount(p.batches), note: `${formatCount(p.batch)} EVERY ${p.minutes === 1 ? 'MINUTE' : `${p.minutes} MINUTES`}`, testId: 'live-pace-batches' },
    { label: 'Next batch', value: next.value, note: next.note, testId: 'live-pace-next' },
    { label: 'Turns given', value: formatCount(p.turnsGiven ?? p.admitted - (p.letIn ?? 0)), note: 'BY THE PACE', testId: 'live-pace-turns' },
    { label: 'Beyond the pieces', value: formatCount(p.beyond ?? 0), note: 'PAST THEIR SIZE’S PIECES', testId: 'live-pace-beyond' },
    ...(holdEnds ? [{ label: 'Hold ends', value: holdEnds.value, note: holdEnds.note, testId: 'live-pace-hold' }] : []),
  ];
}

/**
 * What `role` may do to the pace now (the server checks again; this hides only what would be refused): SET PACE until
 * the end (D7, slower or faster), on a release that is not an after-room; PAUSE PACE or RESUME PACE from T0 to the end;
 * NEXT BATCH NOW there while someone waits in the queue and the release is not PAUSED (N3: its turns are frozen; it still
 * works under PAUSE PACE); SHORTEN THE HOLD and END THE HOLD NOW from the announcement while the hold lasts (D4, N14:
 * before it the hold is a setting). OPERATOR. No control takes a pace away: every LIVE release has one (D1).
 */
export function livePaceActions(
  b: Pick<LiveBoard, 'phase' | 'endedAt'> & { paused?: boolean; pace?: LivePaceState | null },
  role: AdminRole | null | undefined,
  afterRoom: boolean,
): { set: boolean; pause: boolean; resume: boolean; next: boolean; shorten: boolean; endHold: boolean } {
  const manage = can(role, 'manageDrops') && !afterRoom;
  const running = b.endedAt === null && hasBoard(b.phase) && b.phase !== 'ENDED';
  const live = running && b.phase === 'LIVE';
  const announced = running && b.phase !== 'HIDDEN';
  const p = b.pace ?? null;
  const hold = manage && announced && p !== null && !!p.holdEndsAt;
  return {
    set: manage && running,
    pause: manage && live && p !== null && !p.paused,
    resume: manage && live && p !== null && p.paused,
    next: manage && live && p !== null && p.waiting > 0 && b.paused !== true,
    shorten: hold && (p?.holdMinutes ?? 0) > 0,
    endHold: hold,
  };
}

/** The close guard's warning (D10, advice only): `AT THIS PACE, 120 PIECES REMAIN AT THE CLOSE` (sets on a set's release). */
export function closeGuardLine(remain: number, set = false): string {
  const unit = set ? (remain === 1 ? 'SET REMAINS' : 'SETS REMAIN') : remain === 1 ? 'PIECE REMAINS' : 'PIECES REMAIN';
  return `AT THIS PACE, ${formatCount(remain)} ${unit} AT THE CLOSE`;
}

/**
 * The close guard for a pace typed in SET PACE, as the server reads it (services/live-queue.ts closeGuard): the turns
 * the pace can still give before the close (the batches from the next one, which keeps its time, every Y minutes, each
 * strictly before the close, times X) against the pieces not confirmed yet; the pieces left over, or null.
 */
export function paceCloseGuard(pace: LivePace, nextAt: string, closesAt: string, notConfirmed: number): number | null {
  if (notConfirmed <= 0) return null;
  const next = Date.parse(nextAt);
  const close = Date.parse(closesAt);
  const step = pace.minutes * 60_000;
  const batches = next < close && step > 0 ? Math.ceil((close - next) / step) : 0;
  const remain = notConfirmed - batches * pace.batch;
  return remain > 0 ? remain : null;
}

/** What the server would refuse in SHORTEN THE HOLD's new length (D4: earlier only), said before anything is sent. */
export function holdShortenProblem(minutes: string | undefined, current: number): string | null {
  const n = inRange(minutes, LIVE_HOLD_MINUTES);
  if (current < 1) return 'This release has no hold left to shorten.';
  return n === null || n >= current ? `A shorter hold: ${LIVE_HOLD_MINUTES.min} to ${current - 1} ${current - 1 === 1 ? 'minute' : 'minutes'} after the opening.` : null;
}

/**
 * An entry's turn, as the line's Admitted column says it: LET IN by the console, the batch that gave it, or at once
 * (an after-room), and when (Paris); WAITING in the queue; or none.
 */
export function liveEntryAdmission(e: Pick<LiveEntry, 'status' | 'admittedAt' | 'batch' | 'letIn'>): { text: string; at: string | null } {
  if (e.admittedAt && e.letIn) return { text: 'Let in', at: `${parisClock(e.admittedAt)} Paris` };
  if (e.admittedAt) return { text: e.batch ? `Batch ${formatCount(e.batch)}` : 'At once', at: `${parisClock(e.admittedAt)} Paris` };
  return { text: e.status === 'QUEUED' ? 'Waiting' : '—', at: null };
}

/** D11: an entry's queue place (its place in its size) and estimated turn (Paris), while it waits in the queue; dashes otherwise. */
export function liveEntryQueue(e: Pick<LiveEntry, 'placeInSize' | 'estimatedTurnAt'>): { place: string; turn: string } {
  return {
    place: e.placeInSize != null ? formatCount(e.placeInSize) : '—',
    turn: e.estimatedTurnAt ? `${parisClock(e.estimatedTurnAt)} Paris` : '—',
  };
}

// ── What may be done now ───────────────────────────────────────────────────

export interface LiveActions {
  /** Every setting, the silhouette: until the announcement. */
  edit: boolean;
  publish: boolean;
  /** Before the room opens. */
  cancel: boolean;
  /** The release's post of the circle, added or withdrawn: published, until the announcement. */
  circlePost: boolean;
  /** The boutique board's link: issue (or replace), revoke. */
  boardLink: boolean;
  pause: boolean;
  resume: boolean;
  extend: boolean;
  /** ADD PIECES: announced, not ended (before the announcement, the sizes are changed in the settings). */
  addPieces: boolean;
  /** A host message: announced, not ended (the room shows the latest). */
  message: boolean;
  /** ADMIN, a phrase to type. */
  end: boolean;
}

/**
 * What `role` may do to the release in its phase (the server checks again; this hides only what would be refused). The
 * phase is the server's, on its clock: the page is read again when its board's stream brings another (`livePageKey`).
 */
export function liveActions(r: Pick<LiveRelease, 'phase' | 'editable' | 'publishedAt' | 'pausedAt'> & { afterRoomOf?: LiveRelease['afterRoomOf'] }, role: AdminRole | null | undefined): LiveActions {
  const manage = can(role, 'manageDrops');
  // An after-room is set, published and cancelled with its release; it has no board link: its live controls only.
  const own = !r.afterRoomOf;
  const published = r.publishedAt !== null && hasBoard(r.phase);
  // Published and not ended: HIDDEN, ANNOUNCED, ROOM or LIVE.
  const running = published && r.phase !== 'ENDED';
  const announced = running && r.phase !== 'HIDDEN';
  return {
    edit: manage && r.editable && own,
    publish: manage && r.phase === 'DRAFT' && own,
    cancel: manage && (r.phase === 'DRAFT' || r.phase === 'HIDDEN' || r.phase === 'ANNOUNCED') && own,
    circlePost: manage && r.phase === 'HIDDEN' && r.editable && own,
    boardLink: manage && r.phase !== 'CANCELLED' && own,
    pause: manage && r.phase === 'LIVE' && r.pausedAt === null,
    resume: manage && r.pausedAt !== null && published,
    extend: manage && running,
    addPieces: manage && announced,
    message: manage && announced,
    end: can(role, 'endLiveRelease') && running,
  };
}

/**
 * The state the page's controls, marks and lead were drawn for: its phase, paused, ended, over. A board that says
 * another (T0 passed, a pause, the end, the last hold settled) has the page read again.
 */
export function livePageKey(x: { phase: LivePhase; paused: boolean; ended: boolean; over: boolean }): string {
  return [x.phase, x.paused ? 'PAUSED' : '', x.ended ? 'ENDED' : '', x.over ? 'OVER' : ''].join('|');
}

/** What `role` may do to an entry now: let in a QUEUED one, free a hold (OPERATOR); remove an open one (ADMIN). */
export function liveEntryActions(e: Pick<LiveEntry, 'status'>, board: Pick<LiveBoard, 'phase' | 'paused' | 'endedAt'>, role: AdminRole | null | undefined): { letIn: boolean; free: boolean; remove: boolean } {
  const manage = can(role, 'manageDrops');
  const live = board.phase === 'LIVE' && board.endedAt === null;
  return {
    letIn: manage && live && !board.paused && e.status === 'QUEUED',
    free: manage && e.status === 'SECURED',
    remove: can(role, 'removeLiveEntry') && ['WAITING', 'QUEUED', 'TURN', 'SECURED'].includes(e.status),
  };
}

/** The phrase typed before END NOW, and before a cancellation: the first eight characters of the release's id. */
export function livePhrase(action: 'end' | 'cancel', r: Pick<LiveRelease, 'id'>): string {
  return `${action === 'end' ? 'END' : 'CANCEL'} ${r.id.slice(0, 8).toUpperCase()}`;
}

// ── The live board ─────────────────────────────────────────────────────────

/** The board's figures, in the order the console shows them. */
export function liveBoardFigures(b: LiveBoard): { label: string; value: string; note: string; testId: string }[] {
  const t = b.totals;
  const set = (b.pieces?.length ?? 0) > 0;
  return [
    { label: 'In the room', value: formatCount(t.inRoom), note: `${formatCount(t.waiting)} BEFORE T0`, testId: 'live-in-room' },
    { label: 'In line', value: formatCount(t.line), note: `${formatCount(b.lineTotal)} OPEN ${b.lineTotal === 1 ? 'ENTRY' : 'ENTRIES'}`, testId: 'live-line' },
    { label: 'Turns', value: formatCount(t.turns), note: 'HOLDING THE SEAL', testId: 'live-turns' },
    { label: 'Secured', value: formatCount(t.secured), note: 'TO PAY', testId: 'live-secured' },
    // Macro scope K44 T1: a set's release counts its totals in sets.
    { label: 'Confirmed', value: formatCount(t.confirmed), note: `${formatCount(t.sold)} OF ${formatCount(t.stock)} ${set ? 'SETS' : 'PIECES'}`, testId: 'live-confirmed' },
    { label: set ? 'Sets left' : 'Pieces left', value: formatCount(t.left), note: `${formatCount(t.held)} HELD MAY RETURN`, testId: 'live-left' },
    { label: 'Missed turns', value: formatCount(t.missed), note: 'A TURN THAT RAN OUT', testId: 'live-missed' },
    { label: 'Ended holds', value: formatCount(t.expired), note: `${formatCount(t.released)} GIVEN BACK`, testId: 'live-expired' },
  ];
}

/** Where an entry stands on the line: its status, and until when a turn or a hold runs. */
export function liveEntryDeadline(e: Pick<LiveEntry, 'status' | 'turnExpiresAt' | 'holdExpiresAt'>): string | null {
  if (e.status === 'TURN' && e.turnExpiresAt) return `Until ${formatDateTime(e.turnExpiresAt, { seconds: true })}`;
  if (e.status === 'SECURED' && e.holdExpiresAt) return `To pay until ${formatDateTime(e.holdExpiresAt, { seconds: true })}`;
  return null;
}

/** The phases where the release has been published and lives (the board, the line, its orders). */
export function hasBoard(phase: LivePhase): boolean {
  return phase !== 'DRAFT' && phase !== 'CANCELLED';
}

/**
 * A release's stock location to choose: the default first (empty, following the default should it change), then every
 * other location by its name; the default by its name too only when the release names it already, and the location it
 * names kept when the locations could not be read (`named`: its name), so that saving never moves it unasked.
 */
export function locationOptions(locations: readonly { id: string; name: string; isDefault: boolean }[], selected: string, named?: string): { value: string; label: string }[] {
  const byDefault = locations.find((l) => l.isDefault);
  const options = [{ value: '', label: `The default (${byDefault?.name ?? 'none yet'})` }, ...locations.filter((l) => !l.isDefault || l.id === selected).map((l) => ({ value: l.id, label: l.name }))];
  if (selected && !options.some((o) => o.value === selected)) options.push({ value: selected, label: named ?? 'The location set' });
  return options;
}
