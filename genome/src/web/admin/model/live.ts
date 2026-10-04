/**
 * The LIVE RELEASES in the console (Clients › Club › Drops) — pure helpers, no DOM.
 *
 *  - The bounds the server holds a release to (services/live.ts, services/live-console.ts), mirrored and tested.
 *  - Where a release stands, said as the console says it (DRAFT, SCHEDULED, ANNOUNCED, ROOM OPEN, LIVE, SOLD OUT,
 *    CLOSED, ENDED, CANCELLED), its tone, and one line under the page's title.
 *  - The dialogs of its settings, one per part (the release, its sizes, its access, its times, its turns and holds, its
 *    add-ons): their values as the form holds them (times as `datetime-local` values read in UTC, prices in units, the
 *    sizes one per line `52 = 3`, the add-ons one per line `ENGRAVING | 150 | Your initials, by hand`), what the server
 *    would refuse before anything is sent, and the change to send (the lists with the ids they keep).
 *  - What each role may do now: edit until the announcement, publish, cancel before the room opens, the silhouette and
 *    the board link (OPERATOR); the live controls (OPERATOR: pause, resume, extend, add pieces, free a hold, let in, a
 *    host message; ADMIN: end now with a typed phrase, remove from the line); Client Services' outcome (OPERATOR).
 *  - The live board's figures, and a reservation's reference, add-ons and total.
 */
import { formatCount, formatDateTime } from '../format.js';
import { can } from './permissions.js';
import { localUtc, tierName, utcInstant } from './club.js';
import { LIVE_CURRENCIES, type AdminRole, type LiveBoard, type LiveCard, type LiveCurrency, type LiveEntry, type LivePhase, type LiveRelease, type LiveReservation, type LiveSettings, type LiveSettingsChange } from '../types.js';

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
  note: 500,
  accessModels: 20,
  /** The open entries the live board carries. */
  line: 200,
});

// ── Where a release stands ─────────────────────────────────────────────────

/** A release's state as the console says it: its phase, an ended one by its reason. */
export function liveStateLabel(r: Pick<LiveCard, 'phase' | 'endedReason'>): string {
  if (r.phase === 'ENDED') return r.endedReason === 'SOLD_OUT' ? 'SOLD OUT' : r.endedReason === 'ENDED' ? 'ENDED' : 'CLOSED';
  return { DRAFT: 'DRAFT', HIDDEN: 'SCHEDULED', ANNOUNCED: 'ANNOUNCED', ROOM: 'ROOM OPEN', LIVE: 'LIVE', CANCELLED: 'CANCELLED' }[r.phase];
}

/** One line under the page's title: what the release's phase asks of the staff now. */
export function liveLead(r: Pick<LiveRelease, 'phase' | 'over' | 'endedReason'>): string {
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
        ? 'Over: the release has left THE RELEASES. ORBES Client Services concludes each confirmed reservation below.'
        : 'Ending: no new turn; the turns and holds still running finish at their deadlines.';
    default:
      return 'Cancelled before its room opened: its page answers that it is not known.';
  }
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
  };
}

/** The parts of a release's settings, each its own dialog. */
export type LivePart = 'release' | 'sizes' | 'access' | 'times' | 'turns' | 'addons';

/** A part's values, as its dialog's form holds them. */
export function livePartValues(r: LiveRelease, part: LivePart): Record<string, string> {
  switch (part) {
    case 'release':
      return { modelId: r.model.id, title: r.title, description: r.description ?? '', price: moneyField(r.priceMinor), currency: r.currency, perAccount: String(r.perAccount) };
    case 'sizes':
      return { sizes: sizesText(r.sizes), quantityLine: r.quantityLine === defaultQuantityLine(r.quantity) ? '' : r.quantityLine };
    case 'access':
      return {
        minTier: String(r.minTier),
        tierPriority: r.tierPriority ? 'true' : '',
        collectionId: r.access.collection?.id ?? '',
        ...Object.fromEntries(r.access.models.map((m) => [`model:${m.id}`, 'true'])),
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
  }
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
  }
}

// ── What may be done now ───────────────────────────────────────────────────

export interface LiveActions {
  /** Every setting, the silhouette: until the announcement. */
  edit: boolean;
  publish: boolean;
  /** Before the room opens. */
  cancel: boolean;
  /** The boutique board's link: issue (or replace), revoke. */
  boardLink: boolean;
  pause: boolean;
  resume: boolean;
  extend: boolean;
  /** ADD PIECES: announced, not ended (before the announcement, the sizes are changed in the settings). */
  addPieces: boolean;
  message: boolean;
  /** ADMIN, a phrase to type. */
  end: boolean;
}

/** What `role` may do to the release at `now` (the server checks again; this hides only what would be refused). */
export function liveActions(r: Pick<LiveRelease, 'phase' | 'editable' | 'publishedAt' | 'pausedAt' | 'roomOpensAt' | 'closesAt' | 'endedAt' | 'opensAt'>, role: AdminRole | null | undefined, now: Date): LiveActions {
  const manage = can(role, 'manageDrops');
  const t = now.getTime();
  const published = r.publishedAt !== null && r.phase !== 'CANCELLED';
  const running = published && r.endedAt === null && t < Date.parse(r.closesAt);
  const live = running && t >= Date.parse(r.opensAt);
  return {
    edit: manage && r.editable,
    publish: manage && r.phase === 'DRAFT',
    cancel: manage && (r.phase === 'DRAFT' || (published && t < Date.parse(r.roomOpensAt))),
    boardLink: manage && r.phase !== 'CANCELLED',
    pause: manage && live && r.pausedAt === null,
    resume: manage && r.pausedAt !== null && published,
    extend: manage && running,
    addPieces: manage && running && !r.editable,
    message: manage && running,
    end: can(role, 'endLiveRelease') && running,
  };
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

// ── Client Services ────────────────────────────────────────────────────────

/** A reservation's add-ons: `ENGRAVING € 150 · GIFT BOX € 0`, or none. */
export function reservationAddons(r: Pick<LiveReservation, 'addons' | 'currency'>): string {
  return r.addons.length ? r.addons.map((a) => `${a.label} ${formatMoney(a.priceMinor, r.currency)}`).join(' · ') : 'None';
}

/** Whether `role` may conclude or cancel the reservation now: OPERATOR, while it has no outcome. */
export function canResolve(r: Pick<LiveReservation, 'resolution'>, role: AdminRole | null | undefined): boolean {
  return r.resolution === null && can(role, 'manageDrops');
}

/** The phases where the release has been published and lives (the board, the line, Client Services). */
export function hasBoard(phase: LivePhase): boolean {
  return phase !== 'DRAFT' && phase !== 'CANCELLED';
}
