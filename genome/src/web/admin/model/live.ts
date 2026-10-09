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
});

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
export function defaultQuantityLine(quantity: number): string {
  return `${quantity} ${quantity === 1 ? 'PIECE' : 'PIECES'}`;
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
    modelId: '',
    title: '',
    opensAt: localUtc(opens.toISOString()),
    closesAt: localUtc(new Date(opens.getTime() + 3_600_000).toISOString()),
    price: '',
    currency: 'EUR',
    locationId: '',
    sizes: 'ONE SIZE = 25',
  };
}

function timesProblem(opens: string | null, closes: string | null): string | null {
  if (!opens || !closes) return 'Use the date and time pickers (UTC) for T0 and the end.';
  if (Date.parse(closes) <= Date.parse(opens)) return 'The release ends after T0.';
  return null;
}

/** What the server would refuse in the New live release dialog; null when it may be sent. */
export function newLiveProblem(v: Record<string, string>): string | null {
  if (!v.modelId) return 'Choose the model of the release.';
  const title = (v.title ?? '').trim();
  if (!title || title.length > LIVE_LIMITS.title) return `A title is one line of 1 to ${LIVE_LIMITS.title} characters.`;
  const t = timesProblem(utcInstant(v.opensAt), utcInstant(v.closesAt));
  if (t) return t;
  const price = parseMoney(v.price);
  if (price === null || price > LIVE_LIMITS.priceMaxMinor) return 'The price of a piece, in units (4800, or 4800.50).';
  if (!(LIVE_CURRENCIES as readonly string[]).includes(v.currency)) return 'Choose the currency.';
  const sizes = parseSizes(v.sizes);
  return 'problem' in sizes ? sizes.problem : null;
}

/** The body of a new release (POST /api/admin/live), from values newLiveProblem accepted: every other setting by default. */
export function newLiveInput(v: Record<string, string>): LiveSettings {
  const sizes = parseSizes(v.sizes) as { sizes: { label: string; stock: number }[] };
  return {
    modelId: v.modelId,
    title: v.title.trim(),
    opensAt: utcInstant(v.opensAt)!,
    closesAt: utcInstant(v.closesAt)!,
    priceMinor: parseMoney(v.price)!,
    currency: v.currency as LiveCurrency,
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
      return { modelId: r.model.id, title: r.title, description: r.description ?? '', price: moneyField(r.priceMinor), currency: r.currency, perAccount: String(r.perAccount) };
    case 'sizes':
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
      if (!v.modelId) return 'Choose the model of the release.';
      const title = (v.title ?? '').trim();
      if (!title || title.length > LIVE_LIMITS.title) return `A title is one line of 1 to ${LIVE_LIMITS.title} characters.`;
      if ((v.description ?? '').trim().length > LIVE_LIMITS.description) return `The description has at most ${LIVE_LIMITS.description} characters.`;
      const price = parseMoney(v.price);
      if (price === null || price > LIVE_LIMITS.priceMaxMinor) return 'The price of a piece, in units (4800, or 4800.50).';
      if (!(LIVE_CURRENCIES as readonly string[]).includes(v.currency)) return 'Choose the currency.';
      if (inRange(v.perAccount, LIVE_LIMITS.perAccount) === null) return `A person secures ${LIVE_LIMITS.perAccount.min} to ${LIVE_LIMITS.perAccount.max} pieces.`;
      return null;
    }
    case 'sizes': {
      const sizes = parseSizes(v.sizes, r.sizes);
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
      return null;
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
      if (v.modelId !== r.model.id) out.modelId = v.modelId;
      if (v.title.trim() !== r.title) out.title = v.title.trim();
      if ((description === '' ? null : description) !== (r.description ?? null)) out.description = description === '' ? null : description;
      if (parseMoney(v.price) !== r.priceMinor) out.priceMinor = parseMoney(v.price)!;
      if (v.currency !== r.currency) out.currency = v.currency as LiveCurrency;
      if (Number(v.perAccount) !== r.perAccount) out.perAccount = Number(v.perAccount);
      return out;
    }
    case 'sizes': {
      const sizes = (parseSizes(v.sizes, r.sizes) as { sizes: { id?: string; label: string; stock: number }[] }).sizes;
      if (JSON.stringify(sizes.map((s) => [s.id ?? null, s.label, s.stock])) !== JSON.stringify(r.sizes.map((s) => [s.id, s.label, s.stock]))) out.sizes = sizes;
      const typed = (v.quantityLine ?? '').trim();
      const quantity = sizes.reduce((n, s) => n + s.stock, 0);
      const now = r.quantityLine === defaultQuantityLine(r.quantity) ? null : r.quantityLine;
      const next = typed === '' || typed === defaultQuantityLine(quantity) ? null : typed;
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
  return [
    { label: 'In the room', value: formatCount(t.inRoom), note: `${formatCount(t.waiting)} BEFORE T0`, testId: 'live-in-room' },
    { label: 'In line', value: formatCount(t.line), note: `${formatCount(b.lineTotal)} OPEN ${b.lineTotal === 1 ? 'ENTRY' : 'ENTRIES'}`, testId: 'live-line' },
    { label: 'Turns', value: formatCount(t.turns), note: 'HOLDING THE SEAL', testId: 'live-turns' },
    { label: 'Secured', value: formatCount(t.secured), note: 'TO PAY', testId: 'live-secured' },
    { label: 'Confirmed', value: formatCount(t.confirmed), note: `${formatCount(t.sold)} OF ${formatCount(t.stock)} PIECES`, testId: 'live-confirmed' },
    { label: 'Pieces left', value: formatCount(t.left), note: `${formatCount(t.held)} HELD MAY RETURN`, testId: 'live-left' },
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
